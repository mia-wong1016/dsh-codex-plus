import assert from 'node:assert/strict'
import { consumeResetCredit } from '../lib/bridge.js'

{
  let called = false
  const result = await consumeResetCredit({
    async call() {
      called = true
      return { ok: true }
    },
  })
  assert.deepEqual(result, { ok: false, error: 'creditId is required' })
  assert.equal(called, false)
}

{
  const calls = []
  const server = {
    async call(method, params, timeout) {
      calls.push({ method, params, timeout })
      if (method === 'account/rateLimitResetCredit/consume') {
        return { ok: true, result: { outcome: 'reset' } }
      }
      if (method === 'account/read') {
        return { ok: true, result: { account: { planType: 'plus' } } }
      }
      if (method === 'account/rateLimits/read') {
        return { ok: true, result: { rateLimits: null, rateLimitResetCredits: { availableCount: 0, credits: [] } } }
      }
      throw new Error(`unexpected method: ${method}`)
    },
  }
  const result = await consumeResetCredit(server, { creditId: ' credit-two ', idempotencyKey: 'idem-1' })
  assert.equal(result.ok, true)
  assert.equal(result.outcome, 'reset')
  assert.deepEqual(calls[0], {
    method: 'account/rateLimitResetCredit/consume',
    params: { idempotencyKey: 'idem-1', creditId: 'credit-two' },
    timeout: 60000,
  })
}

console.log('unit tests passed')
