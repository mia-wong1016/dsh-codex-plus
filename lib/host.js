/**
 * Host half — quota, provider wiring, and token upkeep for a locally logged-in
 * Codex (ChatGPT Plus/Pro) subscription.
 *
 * Reading the quota also (re)registers the subscription route in the host's
 * `llm-pi-ai` settings so the Codex models become selectable in DSH, and keeps
 * the OAuth access token fresh so that route never 401s on its own.
 * @module dsh-codex-plus/host
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AppServer,
  consumeResetCredit,
  ensureAccessToken,
  readModelCatalog,
  readStatus,
  resolveCli,
  resolveCodexHome,
  runTask,
} from './bridge.js'

export const name = 'codex-plus'
export const inject = ['shell', 'settings', 'settingsController', 'credentials']

/** Default route the provider profile is written to (an installed pi-ai catalog route). */
const DEFAULT_PROVIDER = 'openai-codex'
const SETTINGS_NS = 'llm-pi-ai'
const BASE_URL = 'https://chatgpt.com/backend-api'
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000

function shq(value) {
  return `'${String(value).split("'").join("'\\''")}'`
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function settingsFilePath() {
  return process.env.DSH_SETTINGS_FILE || join(dshHome(), 'settings.yaml')
}

function credentialRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Idempotently insert `providers.<route>` under the target namespace in a settings.yaml,
 * preserving every other line. Line-based on purpose: the file carries the user's own
 * formatting and other providers, and a YAML round-trip would rewrite all of it.
 */
function mergeProviderBlock(source, namespace, route, block) {
  const lines = source.split('\n')
  let nsIndex = null
  let providersIndex = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (nsIndex === null && line.startsWith(`${namespace}:`)) {
      nsIndex = index
      continue
    }
    if (nsIndex !== null && index > nsIndex && !['', ' ', '\t'].includes(line.slice(0, 1))) break
    if (nsIndex !== null && line === '  providers:') {
      providersIndex = index
      break
    }
  }
  const content = block.split('\n')
  if (nsIndex !== null && providersIndex === null) {
    return { text: [...lines.slice(0, nsIndex + 1), '  providers:', ...content, ...lines.slice(nsIndex + 1)].join('\n'), changed: true }
  }
  if (nsIndex !== null) {
    let end = lines.length
    for (let index = providersIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.trim() === '' || line.length - line.trimStart().length >= 4) continue
      end = index
      break
    }
    const present = lines.slice(providersIndex + 1, end).some((line) => line === `    ${route}:`)
    if (present) return { text: source, changed: false }
    return { text: [...lines.slice(0, end), ...content, ...lines.slice(end)].join('\n'), changed: true }
  }
  const head = lines.length > 0 && lines[lines.length - 1] === '' ? lines : [...lines, '']
  return { text: [...head, `${namespace}:`, '  providers:', ...content].join('\n'), changed: true }
}

/**
 * Apply the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config resolved plugin config
 */
export function apply(ctx, config = {}) {
  const workspace = config.workspace || process.cwd()
  const sandboxPolicy = config.sandboxPolicy === false ? undefined : { mode: 'workspace-write', workspaceRoot: workspace }
  const providerRoute = config.providerRoute || DEFAULT_PROVIDER
  const providerDisplayName = config.providerDisplayName || 'Codex (ChatGPT Plus/Pro)'
  const syncProviders = config.syncProviders !== false
  const ref = config.credentialRef || credentialRef(providerRoute)

  let server = null
  let lastSyncAt = 0
  let lastSyncResult = null

  function cliPath() {
    return resolveCli(config.codexBin) || config.codexBin || null
  }

  function codexHome() {
    return resolveCodexHome(config.codexHome)
  }

  function appServer() {
    if (!server) server = new AppServer({ bin: cliPath(), codexHome: codexHome(), cwd: workspace })
    return server
  }

  ctx.effect(() => () => {
    if (server) server.stop()
    server = null
  })

  async function runShell(command, timeoutMs) {
    const spec = ctx.shell.resolve({ command, workdir: workspace, timeoutMs, sandboxPolicy })
    const result = await ctx.shell.run(spec)
    return {
      exitCode: result.exitCode,
      stdout: String((result.stdout && result.stdout.text) || ''),
      stderr: String((result.stderr && result.stderr.text) || ''),
      timedOut: result.timedOut,
    }
  }

  /**
   * Keep the subscription route usable: fresh token in the credential store,
   * provider profile in settings.yaml, and a report of the served model ids.
   */
  async function syncProvider(force) {
    const now = Date.now()
    if (!force && lastSyncAt !== 0 && now - lastSyncAt < SYNC_MIN_INTERVAL_MS) return lastSyncResult
    const summary = { at: Math.floor(now / 1000) }
    try {
      const home = codexHome()
      const token = await ensureAccessToken({ codexHome: home })
      if (!token.ok) {
        summary.ok = false
        summary.error = token.error
      } else {
        summary.tokenExpiresAt = token.expiresAt
        summary.tokenRefreshed = token.refreshed === true
        summary.tokenNote = token.note
        if (syncProviders) {
          await ctx.credentials.set(ref, token.token)
          summary.credentialWritten = true
          const block = [
            `    ${providerRoute}:`,
            `      apiKeyEnv: ${ref}`,
            `      displayName: ${JSON.stringify(providerDisplayName)}`,
            `      baseURL: ${BASE_URL}`,
          ].join('\n')
          const path = settingsFilePath()
          try {
            const current = await readFile(path, 'utf8')
            const merged = mergeProviderBlock(current, SETTINGS_NS, providerRoute, block)
            summary.settingsChanged = merged.changed
            if (merged.changed) {
              const write = await runShell(`printf %s ${shq(merged.text)} > ${shq(path)}`, 20000)
              if (write.exitCode !== 0) throw new Error(`settings write failed: ${write.stderr.slice(0, 200)}`)
            }
            summary.settingsPath = path
          } catch (error) {
            summary.settingsError = String((error && error.message) || error).slice(0, 300)
          }
          const llm = ctx.get('llm')
          if (llm !== undefined) {
            try {
              const list = await llm.listModels(providerRoute)
              summary.models = list.map((model) => String(model.id))
            } catch (error) {
              summary.modelsError = String((error && error.message) || error).slice(0, 300)
            }
          }
        }
        summary.ok = true
      }
    } catch (error) {
      summary.ok = false
      summary.error = String((error && error.message) || error)
    }
    lastSyncAt = now
    lastSyncResult = summary
    return summary
  }

  async function statusWithProvider() {
    const cli = cliPath()
    if (!cli) {
      const provider = await syncProvider(false)
      return { ok: false, error: 'Codex CLI not found; set config.codexBin or DSH_CODEX_BIN', provider }
    }
    const status = await readStatus(appServer())
    const provider = await syncProvider(false)
    return { ...status, codexHome: codexHome(), provider }
  }

  ctx.harness.handle('codex-status', async () => statusWithProvider())
  ctx.harness.handle('codex-sync-models', async () => syncProvider(true))
  ctx.harness.handle('codex-reset', async (args) => {
    if (!args || args.confirm !== true) return { ok: false, error: 'reset requires explicit confirmation' }
    const result = await consumeResetCredit(appServer(), { creditId: args.creditId ? String(args.creditId) : undefined })
    return { ok: result.ok === true, result }
  })

  const { defineTool } = ctx.harness

  ctx.tools.register(defineTool({
    name: 'codex_quota',
    description: 'Read the local Codex (ChatGPT Plus/Pro) subscription quota — 5-hour window, weekly window, reset credits — and keep the Codex provider route in DSH up to date.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    async execute() {
      const status = await statusWithProvider()
      if (!status.ok) return { ok: false, error: status.error || 'status failed', providerSynced: Boolean(status.provider && status.provider.ok) }
      return {
        ok: true,
        plan: (status.account && status.account.planType) || '',
        email: (status.account && status.account.email) || '',
        primary: status.rateLimits ? status.rateLimits.primary : null,
        secondary: status.rateLimits ? status.rateLimits.secondary : null,
        resetCredits: status.resetCredits ? status.resetCredits.availableCount : 0,
        fetchedAt: status.fetchedAt,
        providerSynced: Boolean(status.provider && status.provider.ok),
        providerError: (status.provider && status.provider.error) || '',
        providerModels: (status.provider && status.provider.models) || null,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex_models_sync',
    description: 'Refresh the Codex subscription token and re-register the Codex models in DSH, then report which model ids DSH now serves for that route.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    async execute() {
      return await syncProvider(true)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex',
    description: 'Delegate a self-contained task to the local Codex agent (ChatGPT Plus/Pro subscription models such as gpt-5.6-sol). Returns the final answer text. Use for a second opinion, a fresh-context review, or an independent subtask; the Codex agent cannot see this conversation.',
    parameters: {
      prompt: { type: 'string', description: 'Full self-contained instruction for the Codex agent.', required: true },
      model: { type: 'string', description: 'Codex model slug (for example gpt-5.6-sol). Defaults to the account default.' },
      effort: { type: 'string', description: 'Reasoning effort.', enum: ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      sandbox: { type: 'string', description: 'Filesystem sandbox for the Codex agent.', enum: ['read-only', 'workspace-write', 'danger-full-access'] },
      cwd: { type: 'string', description: 'Working directory for the Codex agent. Defaults to the session workspace.' },
      timeoutMs: { type: 'integer', description: 'Hard timeout in milliseconds (default 300000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          model: { type: 'string' },
          sandbox: { type: 'string' },
          cwd: { type: 'string' },
          elapsedMs: { type: 'integer' },
          threadId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (args, value) => {
        if (!value) return [{ type: 'text', text: 'codex: no result' }]
        if (value.ok === false && value.error) return [{ type: 'text', text: `codex failed: ${value.error}` }]
        const head = `codex(${value.model || 'default'}, ${value.sandbox || ''}, ${Math.round((value.elapsedMs || 0) / 1000)}s)`
        return [{ type: 'text', text: `${head}\n\n${String(value.text || '').slice(0, 4000)}` }]
      },
    },
    async execute(args) {
      const result = await runTask({
        bin: cliPath(),
        codexHome: codexHome(),
        prompt: String(args.prompt || ''),
        model: args.model ? String(args.model) : undefined,
        effort: args.effort ? String(args.effort) : undefined,
        sandbox: args.sandbox ? String(args.sandbox) : 'read-only',
        cwd: args.cwd ? String(args.cwd) : workspace,
        timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 300000,
      })
      return {
        ok: result.ok === true,
        text: String(result.text || ''),
        model: String(result.model || args.model || 'default'),
        sandbox: String(result.sandbox || 'read-only'),
        cwd: String(result.cwd || workspace),
        elapsedMs: typeof result.elapsedMs === 'number' ? result.elapsedMs : 0,
        threadId: String(result.threadId || ''),
        error: String(result.error || '').slice(0, 1000),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codexprobe',
    description: 'Diagnostic: report the resolved Codex CLI, Codex home, cached model catalog, and quota read result.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1).slice(0, 6000) }],
    },
    async execute() {
      const catalog = await readModelCatalog(codexHome())
      const status = await statusWithProvider()
      return {
        bin: cliPath(),
        codexHome: codexHome(),
        catalog: catalog.map((model) => model.slug),
        statusOk: status.ok === true,
        statusError: status.error || null,
        provider: status.provider || null,
      }
    },
  }))
}
