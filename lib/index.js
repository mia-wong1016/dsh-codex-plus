/**
 * dsh-codex-plus — host entry.
 *
 * `apply` / `inject` / `name` mirror the plugin row in `cordis.patch.yml`, and the
 * named bridge exports exist so the plugin can be driven programmatically (see
 * `test/smoke.mjs`).
 * @module dsh-codex-plus
 */

import { apply, inject, name } from './host.js'

export { apply, inject, name }
export {
  AppServer,
  consumeResetCredit,
  ensureAccessToken,
  readAuth,
  readModelCatalog,
  readStatus,
  resolveCli,
  resolveCodexHome,
  runTask,
  tokenAccountId,
  tokenExpiry,
} from './bridge.js'

export default { name, inject, apply }
