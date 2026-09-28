/**
 * Local smoke test for lib/bridge.js — exercises the real Codex CLI.
 *
 *   node test/smoke.mjs                 # uses ~/.codex (read + refresh if needed)
 *   CODEX_HOME_COPY=1 node test/smoke.mjs   # copies auth.json to a scratch home first
 */
import { cp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AppServer,
  consumeResetCredit,
  ensureAccessToken,
  readModelCatalog,
  readStatus,
  resolveCli,
  resolveCodexHome,
  tokenAccountId,
  tokenExpiry,
} from '../lib/bridge.js'

const SCRATCH = '/data/wy/publish/.test-home'

async function prepareHome() {
  if (process.env.CODEX_HOME_COPY !== '1') return resolveCodexHome()
  await mkdir(SCRATCH, { recursive: true })
  const source = join(resolveCodexHome(), 'auth.json')
  try {
    await cp(source, join(SCRATCH, 'auth.json'))
  } catch (error) {
    console.error('cannot copy auth.json:', String(error.message || error))
  }
  return SCRATCH
}

function stamp(label, value) {
  console.log(`\n=== ${label} ===`)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
}

async function main() {
  const codexHome = await prepareHome()
  const bin = resolveCli()
  stamp('resolution', { bin, codexHome })

  const token = await ensureAccessToken({ codexHome })
  if (!token.ok) {
    stamp('ensureAccessToken', token)
    process.exit(1)
  }
  stamp('token', {
    refreshed: token.refreshed,
    note: token.note,
    expiresAt: token.expiresAt,
    expiresAtIso: new Date(token.expiresAt * 1000).toISOString(),
    accountId: tokenAccountId(token.token),
    length: token.token.length,
  })

  const catalog = await readModelCatalog(codexHome)
  stamp('catalog', catalog.map((model) => model.slug))

  const server = new AppServer({ bin, codexHome })
  try {
    const status = await readStatus(server)
    stamp('status', {
      ok: status.ok,
      error: status.error || null,
      plan: status.account && status.account.planType,
      primary: status.rateLimits && status.rateLimits.primary,
      secondary: status.rateLimits && status.rateLimits.secondary,
      resetCredits: status.resetCredits && status.resetCredits.availableCount,
    })
    if (!status.ok) process.exitCode = 1

    if (process.argv.includes('--run')) {
      const { runTask } = await import('../lib/bridge.js')
      const run = await runTask({
        bin,
        codexHome,
        prompt: 'Reply with exactly: pong',
        sandbox: 'read-only',
        timeoutMs: 240000,
      })
      stamp('runTask', { ok: run.ok, text: run.text, model: run.model, elapsedMs: run.elapsedMs, error: run.error })
      if (!run.ok) process.exitCode = 1
    }

    const resetArg = process.argv.find((arg) => arg.startsWith('--reset='))
    if (resetArg) {
      const creditId = resetArg.slice('--reset='.length)
      const reset = await consumeResetCredit(server, { creditId })
      stamp('consumeResetCredit', { ok: reset.ok, outcome: reset.outcome, error: reset.error })
      if (!reset.ok) process.exitCode = 1
    }
  } finally {
    server.stop()
  }
  console.log('\nsmoke done')
}

main().catch((error) => {
  console.error('smoke failed:', error)
  process.exit(1)
})
