/**
 * Codex bridge — self-contained access to a locally logged-in Codex (ChatGPT Plus/Pro)
 * subscription. Uses only Node built-ins: no Python, no helper script on disk.
 *
 * Responsibilities:
 *   - locate CODEX_HOME (env override, then `~/.codex`) and make it writable
 *   - read tokens from `<codexHome>/auth.json` and refresh them against
 *     auth.openai.com before they expire, writing the rotated pair back
 *   - talk to `codex app-server` over stdio JSON-RPC for account + rate limits
 *     and for consuming a rate-limit reset credit
 *   - run `codex exec --json` for delegated tasks
 * @module dsh-codex-plus/bridge
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REFRESH_MARGIN_S = 24 * 3600
const RPC_TIMEOUT_MS = 45000
const INIT_TIMEOUT_MS = 25000

/** Candidate CLI locations, in probe order. */
const CLI_CANDIDATES = [
  '/usr/lib/chatgpt/resources/codex',
  '/usr/local/bin/codex',
  '/usr/bin/codex',
  join(homedir(), '.codex', 'bin', 'codex'),
  join(homedir(), '.local', 'bin', 'codex'),
]

/** Executable extensions probed on Windows, in PATHEXT order (.EXE before .CMD). */
const WIN_EXTS = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)

/**
 * Windows install locations, probed last. The Codex installer unpacks the CLI under a
 * version-hashed directory (`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`) and adds
 * only that one directory to PATH, so this glob is the fallback for a host that did not
 * inherit the user's PATH.
 * @returns {string[]}
 */
function windowsCandidates() {
  if (process.platform !== 'win32') return []
  const out = []
  const local = process.env.LOCALAPPDATA
  if (local) {
    const binRoot = join(local, 'OpenAI', 'Codex', 'bin')
    out.push(join(binRoot, 'codex.exe'))
    try {
      for (const entry of readdirSync(binRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) out.push(join(binRoot, entry.name, 'codex.exe'))
      }
    } catch {
      /* Codex is not installed under LOCALAPPDATA */
    }
  }
  const roaming = process.env.APPDATA
  if (roaming) out.push(join(roaming, 'npm', 'codex.cmd'), join(roaming, 'npm', 'codex.exe'))
  return out
}

/**
 * Resolve a bare command name through PATH. On Windows every PATHEXT variant is probed,
 * so a real `codex.exe` wins over an npm `codex.cmd` shim.
 * @returns {string | null}
 */
function resolveOnPath(command) {
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    const base = join(dir, command)
    if (process.platform !== 'win32') {
      if (existsSync(base)) return base
      continue
    }
    for (const ext of WIN_EXTS) if (existsSync(base + ext)) return base + ext
  }
  return null
}

/** Resolve the Codex CLI (`DSH_CODEX_BIN` wins). @returns {string | null} */
export function resolveCli(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null
  if (process.env.DSH_CODEX_BIN) return process.env.DSH_CODEX_BIN
  for (const candidate of CLI_CANDIDATES) if (existsSync(candidate)) return candidate
  const onPath = resolveOnPath('codex')
  if (onPath) return onPath
  for (const candidate of windowsCandidates()) if (existsSync(candidate)) return candidate
  return null
}

/**
 * Spawn the CLI. Windows cannot execute a `.cmd`/`.bat` shim directly, so those go
 * through the command interpreter; a real `.exe` is spawned as-is.
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnCli(bin, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(bin))) {
    const file = /\s/.test(String(bin)) ? `"${bin}"` : bin
    return spawn(file, args, { ...options, shell: true })
  }
  return spawn(bin, args, options)
}

/** Resolve the Codex home directory (`DSH_CODEX_HOME` wins). @returns {string} */
export function resolveCodexHome(explicit) {
  return explicit || process.env.DSH_CODEX_HOME || join(homedir(), '.codex')
}

/** Encode one JWT segment without Buffer, using base64url rules. */
function decodeSegment(segment) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
}

/** Read a JWT claim without verifying it (the tokens come from our own auth.json). */
export function tokenClaims(token) {
  try {
    return decodeSegment(String(token).split('.')[1])
  } catch {
    return null
  }
}

/** `exp` of a JWT in seconds, or 0. */
export function tokenExpiry(token) {
  const claims = tokenClaims(token)
  const exp = claims && claims.exp
  return typeof exp === 'number' ? exp : 0
}

/** ChatGPT account id carried by the access token, when present. */
export function tokenAccountId(token) {
  const claims = tokenClaims(token)
  const auth = claims && claims['https://api.openai.com/auth']
  return (auth && auth.chatgpt_account_id) || null
}

/**
 * Read auth.json.
 * @param {string} codexHome
 * @returns {Promise<object>} the parsed document
 */
export async function readAuth(codexHome) {
  return JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'))
}

/**
 * Refresh the OAuth access token when it is missing or close to expiry, and write the
 * rotated triple back to auth.json.
 * @param {{ codexHome: string, marginSeconds?: number, fetchImpl?: typeof fetch, now?: number }} options
 * @returns {Promise<{ ok: boolean, token?: string, expiresAt?: number, refreshed?: boolean, note?: string, error?: string }>}
 */
export async function ensureAccessToken(options) {
  const { codexHome, marginSeconds = REFRESH_MARGIN_S, fetchImpl = fetch, now = Date.now() } = options
  let auth
  try {
    auth = await readAuth(codexHome)
  } catch (error) {
    return { ok: false, error: `cannot read auth.json: ${String((error && error.message) || error)}` }
  }
  const tokens = auth.tokens || {}
  let access = tokens.access_token || ''
  let expiry = tokenExpiry(access)
  const nowSeconds = Math.floor(now / 1000)
  let refreshed = false
  let note = 'token is fresh'

  if (!access || expiry - nowSeconds < marginSeconds) {
    if (!tokens.refresh_token) return { ok: false, error: 'no refresh_token in auth.json' }
    let fresh
    try {
      const response = await fetchImpl(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: OAUTH_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          scope: 'openid profile email',
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      fresh = await response.json()
    } catch (error) {
      if (access && expiry > nowSeconds) {
        note = `refresh failed (${String((error && error.message) || error)}); keeping the existing token`
      } else {
        return { ok: false, error: `token refresh failed: ${String((error && error.message) || error)}` }
      }
    }
    if (fresh && fresh.access_token) {
      tokens.access_token = fresh.access_token
      if (fresh.refresh_token) tokens.refresh_token = fresh.refresh_token
      if (fresh.id_token) tokens.id_token = fresh.id_token
      auth.tokens = tokens
      auth.last_refresh = new Date(now).toISOString()
      const target = join(codexHome, 'auth.json')
      const temporary = `${target}.tmp`
      await writeFile(temporary, JSON.stringify(auth), { mode: 0o600 })
      // Windows has no POSIX mode bits; there the file keeps the profile ACL's own rights.
      if (process.platform !== 'win32') await chmod(temporary, 0o600)
      await rename(temporary, target)
      access = tokens.access_token
      expiry = tokenExpiry(access)
      refreshed = true
      note = 'refreshed'
    }
  }
  if (!access) return { ok: false, error: 'no access_token' }
  return { ok: true, token: access, expiresAt: expiry, refreshed, note }
}

/** Ensure the state directories the Codex CLI needs exist. */
export async function ensureStateDirs(codexHome) {
  await mkdir(join(codexHome, 'tmp', 'arg0'), { recursive: true })
  await mkdir(join(codexHome, 'log'), { recursive: true })
}

/**
 * One `codex app-server` child, spoken to over newline-delimited JSON-RPC.
 * The child is long-lived: start it once and reuse it for every call.
 */
export class AppServer {
  #bin
  #codexHome
  #cwd
  #child = null
  #buffer = ''
  #nextId = 1
  #pending = new Map()
  #ready = false
  #starting = null

  /**
   * @param {{ bin: string, codexHome: string, cwd?: string, env?: Record<string, string> }} options
   */
  constructor(options) {
    this.#bin = options.bin
    this.#codexHome = options.codexHome
    this.#cwd = options.cwd || process.cwd()
    this.lastError = null
  }

  get running() {
    return Boolean(this.#child && this.#child.exitCode === null && !this.#child.killed)
  }

  async start() {
    if (this.running && this.#ready) return true
    if (this.#starting) return this.#starting
    this.#starting = this.#start()
    try {
      return await this.#starting
    } finally {
      this.#starting = null
    }
  }

  async #start() {
    await ensureStateDirs(this.#codexHome)
    this.#child = spawnCli(this.#bin, ['app-server', '--listen', 'stdio://'], {
      cwd: this.#cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, CODEX_HOME: this.#codexHome, TERM: 'dumb' },
    })
    this.#buffer = ''
    this.#ready = false
    this.#child.stdout.setEncoding('utf8')
    this.#child.stdout.on('data', (chunk) => this.#ingest(chunk))
    this.#child.on('exit', () => {
      this.#ready = false
      for (const slot of this.#pending.values()) slot.settle(null, 'app-server exited')
      this.#pending.clear()
    })
    const init = await this.#request('initialize', {
      clientInfo: { name: 'dsh-codex-plus', title: 'DSH Codex Plus', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    }, INIT_TIMEOUT_MS)
    if (!init.ok) {
      this.lastError = init.error || 'initialize failed'
      return false
    }
    this.#notify('initialized', {})
    this.#ready = true
    return true
  }

  #ingest(chunk) {
    this.#buffer += chunk
    let index = this.#buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).trim()
      this.#buffer = this.#buffer.slice(index + 1)
      index = this.#buffer.indexOf('\n')
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (!message || typeof message !== 'object') continue
      const id = message.id
      if (id === undefined || id === null) continue
      const slot = this.#pending.get(id)
      if (!slot) continue
      this.#pending.delete(id)
      if (message.error) slot.settle(null, JSON.stringify(message.error).slice(0, 300))
      else slot.settle(message.result, null)
    }
  }

  #write(payload) {
    this.#child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  #notify(method, params) {
    if (!this.running) return
    this.#write({ method, params })
  }

  #request(method, params, timeoutMs) {
    return new Promise((resolve) => {
      if (!this.running) {
        resolve({ ok: false, error: 'app-server is not running' })
        return
      }
      const id = this.#nextId++
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        resolve({ ok: false, error: `timeout after ${timeoutMs}ms waiting for ${method}` })
      }, timeoutMs)
      this.#pending.set(id, {
        settle: (result, error) => {
          clearTimeout(timer)
          if (error) {
            this.lastError = `${method}: ${error}`
            resolve({ ok: false, error })
          } else {
            resolve({ ok: true, result })
          }
        },
      })
      const payload = { id, method }
      if (params !== null || method === 'account/rateLimits/read') payload.params = params
      try {
        this.#write(payload)
      } catch (error) {
        this.#pending.delete(id)
        clearTimeout(timer)
        resolve({ ok: false, error: `write failed: ${String((error && error.message) || error)}` })
      }
    })
  }

  /**
   * Call one JSON-RPC method, starting the child on demand.
   * @returns {Promise<{ ok: boolean, result?: unknown, error?: string }>}
   */
  async call(method, params, timeoutMs = RPC_TIMEOUT_MS) {
    if (!(await this.start())) return { ok: false, error: this.lastError || 'app-server unavailable' }
    return this.#request(method, params, timeoutMs)
  }

  stop() {
    if (this.#child && this.#child.exitCode === null) {
      try {
        this.#child.kill()
      } catch {
        /* ignore */
      }
    }
    this.#child = null
    this.#ready = false
  }
}

/** Read the subscription account and quota. */
export async function readStatus(server) {
  const account = await server.call('account/read', { refreshToken: false })
  if (!account.ok) return { ok: false, error: account.error }
  const limits = await server.call('account/rateLimits/read', null)
  const out = {
    ok: true,
    account: (account.result && account.result.account) || null,
    requiresOpenaiAuth: Boolean(account.result && account.result.requiresOpenaiAuth),
    rateLimits: null,
    resetCredits: null,
    fetchedAt: Math.floor(Date.now() / 1000),
  }
  if (!limits.ok) {
    out.rateLimitsError = limits.error
    return out
  }
  const payload = limits.result || {}
  const snapshot = payload.rateLimits || null
  const credits = payload.rateLimitResetCredits || {}
  out.rateLimits = snapshot
    ? {
        limitId: snapshot.limitId,
        planType: snapshot.planType,
        primary: snapshot.primary || null,
        secondary: snapshot.secondary || null,
        credits: snapshot.credits || null,
        spendControlReached: snapshot.spendControlReached ?? null,
      }
    : null
  out.resetCredits = {
    availableCount: credits.availableCount,
    credits: Array.isArray(credits.credits)
      ? credits.credits.map((credit) => ({
          id: credit.id,
          title: credit.title,
          description: credit.description,
          status: credit.status,
          resetType: credit.resetType,
          grantedAt: credit.grantedAt,
          expiresAt: credit.expiresAt,
        }))
      : null,
  }
  return out
}

/**
 * Consume one rate-limit reset credit.
 * @returns {Promise<{ ok: boolean, outcome?: string, idempotencyKey?: string, status?: object, error?: string }>}
 */
export async function consumeResetCredit(server, options = {}) {
  const creditId = typeof options.creditId === 'string' ? options.creditId.trim() : ''
  if (!creditId) return { ok: false, error: 'creditId is required' }
  const idempotencyKey = options.idempotencyKey || crypto.randomUUID()
  const params = { idempotencyKey, creditId }
  const result = await server.call('account/rateLimitResetCredit/consume', params, 60000)
  if (!result.ok) return { ok: false, error: result.error, idempotencyKey }
  const status = await readStatus(server)
  return {
    ok: true,
    outcome: result.result && result.result.outcome,
    idempotencyKey,
    status: status.ok ? status : null,
  }
}

/** Run one delegated task through `codex exec --json`. */
export async function runTask(options) {
  const {
    bin,
    codexHome,
    prompt,
    model,
    effort,
    sandbox = 'read-only',
    cwd,
    timeoutMs = 300000,
    env = process.env,
  } = options
  if (!prompt || !String(prompt).trim()) return { ok: false, error: 'prompt is required' }
  const workdir = cwd && existsSync(cwd) ? cwd : process.cwd()
  const argv = [bin, 'exec', '--json', '--skip-git-repo-check', '-s', sandbox]
  if (model) argv.push('-m', String(model))
  if (effort && effort !== 'default') argv.push('-c', `model_reasoning_effort=${JSON.stringify(String(effort))}`)
  argv.push('-')

  const started = Date.now()
  return await new Promise((resolve) => {
    const child = spawnCli(argv[0], argv.slice(1), {
      cwd: workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, CODEX_HOME: codexHome, TERM: 'dumb' },
    })
    const texts = []
    const errors = []
    let usage = null
    let threadId = null
    let stderr = ''
    let buffer = ''
    const timer = setTimeout(() => {
      errors.push(`timed out after ${timeoutMs}ms`)
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (!line) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.type === 'thread.started') threadId = event.thread_id
        else if (event.type === 'item.completed' && event.item && event.item.type === 'agent_message' && event.item.text) texts.push(event.item.text)
        else if (event.type === 'turn.completed') usage = event.usage || null
        else if (event.type === 'turn.failed' || event.type === 'error') errors.push(String(JSON.stringify(event.error || event)).slice(0, 400))
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `spawn failed: ${String((error && error.message) || error)}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const noise = stderr
        .split('\n')
        .filter((line) => line && !line.includes('bubblewrap') && !line.includes('responses_websocket') && !line.startsWith('WARNING:'))
        .join('\n')
      if (code !== 0 && errors.length === 0) errors.push(`codex exited with ${code}`)
      if (!texts.length && noise.trim()) errors.push(noise.trim().slice(-400))
      resolve({
        ok: errors.length === 0 && texts.length > 0,
        text: texts.join('\n').trim(),
        threadId,
        usage,
        model: model || null,
        sandbox,
        cwd: workdir,
        elapsedMs: Date.now() - started,
        error: errors.length > 0 ? errors[0] : null,
      })
    })
    try {
      child.stdin.end(String(prompt))
    } catch {
      /* ignore */
    }
  })
}

/** Read the locally cached model catalog (`models_cache.json`). */
export async function readModelCatalog(codexHome) {
  try {
    const data = JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8'))
    return (Array.isArray(data.models) ? data.models : []).map((model) => ({
      slug: model.slug,
      displayName: model.display_name || model.slug,
      description: model.description,
      visibility: model.visibility,
      defaultEffort: model.default_reasoning_level,
    }))
  } catch {
    return []
  }
}
