/**
 * Client half — the Codex quota chip in the sidebar footer, its overlay panel, and the
 * one-click reset / model-resync actions that call the host half.
 *
 * This file is the SHIPPED bundle, not ESM source: the DSH browser runtime consumes
 * `window.__ModuleLoader__.load({ id, factory })` with a CommonJS-style factory, so the package
 * publishes that form directly. Consequences of the factory form: `ctx.slots` is available
 * directly (the entry declares `inject: ['timer', 'slots']`), and plugin CSS is injected with a
 * `<style>` element owned by a `ctx.effect` disposer instead of `ctx.styles`.
 * @module dsh-codex-plus/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-codex-plus',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

const CSS = [
  '.cdxp-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border-radius:8px;',
  'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
  'color:var(--dsw-alias-label-primary);font-size:11px;line-height:1;cursor:pointer;white-space:nowrap;}',
  '.cdxp-chip:hover{background:var(--dsw-alias-bg-layer-1);}',
  '.cdxp-chip i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:0 0 auto;}',
  '.cdxp-chip b{font-weight:600;font-variant-numeric:tabular-nums;}',
  '.cdxp-chip em{font-style:normal;color:var(--dsw-alias-label-secondary);}',
  '.cdxp-ovl{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.34);pointer-events:auto;display:flex;justify-content:flex-end;}',
  '.cdxp-panel{width:min(420px,94vw);height:100%;overflow:auto;background:var(--dsw-alias-bg-overlay);',
  'border-left:1px solid var(--dsw-alias-border-l1);padding:14px 16px 28px;color:var(--dsw-alias-label-primary);',
  'font-size:13px;box-shadow:-12px 0 32px rgba(0,0,0,.18);}',
  '.cdxp-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px;}',
  '.cdxp-hd h3{margin:0;font-size:14px;font-weight:600;}',
  '.cdxp-sub{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:12px;}',
  '.cdxp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1);}',
  '.cdxp-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}',
  '.cdxp-title{font-weight:600;font-size:12px;}',
  '.cdxp-pct{font-variant-numeric:tabular-nums;font-weight:600;}',
  '.cdxp-meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px;}',
  '.cdxp-bar{height:6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);margin-top:8px;overflow:hidden;}',
  '.cdxp-bar i{display:block;height:100%;background:var(--dsw-alias-brand-primary);}',
  '.cdxp-bar.warn i{background:var(--dsw-alias-state-warn-primary);}',
  '.cdxp-bar.err i{background:var(--dsw-alias-state-error-primary);}',
  '.cdxp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
  'color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;}',
  '.cdxp-btn:hover{background:var(--dsw-alias-bg-layer-1);}',
  '.cdxp-btn[disabled]{opacity:.5;cursor:default;}',
  '.cdxp-btn.primary{border-color:var(--dsw-alias-brand-primary);}',
  '.cdxp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
  '.cdxp-err{color:var(--dsw-alias-state-error-primary);font-size:11px;margin-top:6px;word-break:break-word;}',
  '.cdxp-ok{color:var(--dsw-alias-state-success-primary);font-size:11px;margin-top:6px;}',
  '.cdxp-credit{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;margin-top:8px;cursor:pointer;}',
  '.cdxp-credit.selected{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
  '.cdxp-credit.disabled{opacity:.55;cursor:not-allowed;}',
  '.cdxp-credit input{margin-top:2px;accent-color:var(--dsw-alias-brand-primary);}',
  '.cdxp-credit-body{min-width:0;flex:1;}',
  '.cdxp-empty{color:var(--dsw-alias-label-secondary);font-size:11px;}',
  '.cdxp-list{max-height:180px;overflow:auto;margin-top:6px;}',
].join('\n')

const inject = ['timer', 'slots']

/**
 * Read JSON from this plugin's own same-origin routes. The web server applies its browser
 * session policy to these paths, so no token or custom channel is involved.
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function requestJson(path, init) {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  if (!response.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await response.json()).slice(0, 300)
    } catch {
      /* body was not JSON */
    }
    throw new Error(`HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  return await response.json()
}

function fmtRemain(value) {
  if (typeof value !== 'number' || !isFinite(value)) return '—'
  return `${Math.max(0, Math.round(100 - value))}%`
}

function fmtWhen(epochSeconds) {
  if (typeof epochSeconds !== 'number' || !isFinite(epochSeconds)) return '未知'
  const delta = epochSeconds * 1000 - Date.now()
  const minutes = Math.round(Math.abs(delta) / 60000)
  let relative
  if (minutes < 1) relative = '不到 1 分钟'
  else if (minutes < 60) relative = `${minutes} 分钟`
  else if (minutes < 2880) relative = `${Math.round(minutes / 60)} 小时`
  else relative = `${Math.round(minutes / 1440)} 天`
  const date = new Date(epochSeconds * 1000)
  const pad = (n) => (n < 10 ? `0${n}` : String(n))
  const stamp = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${stamp}（${delta >= 0 ? `${relative}后` : `${relative}前`}）`
}

function windowLabel(window, fallback) {
  const minutes = window && window.windowDurationMins
  if (typeof minutes !== 'number' || !isFinite(minutes)) return fallback
  if (minutes === 300) return '5 小时额度'
  if (minutes === 10080) return '一周额度'
  if (minutes % 1440 === 0) return `${Math.round(minutes / 1440)} 天额度`
  if (minutes % 60 === 0) return `${Math.round(minutes / 60)} 小时额度`
  return `${minutes} 分钟额度`
}

function barClass(percent) {
  if (typeof percent === 'number' && percent >= 90) return 'cdxp-bar err'
  if (typeof percent === 'number' && percent >= 70) return 'cdxp-bar warn'
  return 'cdxp-bar'
}

function WindowCard({ win, fallback }) {
  if (!win) {
    return React.createElement('div', { className: 'cdxp-card' },
      React.createElement('div', { className: 'cdxp-row' },
        React.createElement('span', { className: 'cdxp-title' }, fallback),
        React.createElement('span', { className: 'cdxp-pct' }, '—')),
      React.createElement('div', { className: 'cdxp-meta' }, '后端未返回该窗口'))
  }
  const used = win.usedPercent
  const width = `${Math.max(0, Math.min(100, typeof used === 'number' ? used : 0))}%`
  return React.createElement('div', { className: 'cdxp-card' },
    React.createElement('div', { className: 'cdxp-row' },
      React.createElement('span', { className: 'cdxp-title' }, windowLabel(win, fallback)),
      React.createElement('span', { className: 'cdxp-pct' }, `剩余 ${fmtRemain(used)}`)),
    React.createElement('div', { className: barClass(used) }, React.createElement('i', { style: { width } })),
    React.createElement('div', { className: 'cdxp-meta' },
      `已用 ${typeof used === 'number' ? `${Math.round(used)}%` : '—'} · 重置时间 ${fmtWhen(win.resetsAt)}`))
}

function StatusBody(props) {
  const status = props.status
  if (!status) {
    return React.createElement('div', { className: 'cdxp-empty' }, props.error ? String(props.error) : '尚未获取额度信息')
  }
  const snapshot = status.rateLimits || null
  const credits = status.resetCredits || null
  const account = status.account || {}
  const children = []
  if (!status.ok) {
    children.push(React.createElement('div', { className: 'cdxp-err', key: 'err' }, `读取失败：${String(status.error || 'unknown')}`))
  }
  if (snapshot) {
    children.push(React.createElement(WindowCard, { key: 'p', win: snapshot.primary, fallback: '5 小时额度' }))
    children.push(React.createElement(WindowCard, { key: 's', win: snapshot.secondary, fallback: '一周额度' }))
  } else {
    children.push(React.createElement('div', { className: 'cdxp-err', key: 'no' }, String(status.rateLimitsError || '未返回额度快照')))
  }
  const creditRows = []
  if (credits && Array.isArray(credits.credits)) {
    for (let index = 0; index < credits.credits.length; index += 1) {
      const credit = credits.credits[index] || {}
      const available = !credit.status || credit.status === 'available'
      const selected = available && String(credit.id) === props.selectedCreditId
      creditRows.push(React.createElement('label', {
        className: `cdxp-credit${selected ? ' selected' : ''}${available ? '' : ' disabled'}`,
        key: String(credit.id || index),
      },
        React.createElement('input', {
          type: 'radio',
          name: 'codex-reset-credit',
          value: String(credit.id || ''),
          checked: selected,
          disabled: !available || props.busy,
          onChange: () => props.onSelectCredit(String(credit.id || '')),
        }),
        React.createElement('div', { className: 'cdxp-credit-body' },
          React.createElement('div', { className: 'cdxp-title' }, String(credit.title || 'Full reset')),
          React.createElement('div', { className: 'cdxp-meta' },
            `${credit.status ? `状态 ${String(credit.status)} · ` : ''}过期 ${fmtWhen(credit.expiresAt)}${credit.description ? ` · ${String(credit.description)}` : ''}`))))
    }
  }
  children.push(React.createElement('div', { className: 'cdxp-card', key: 'credits' },
    React.createElement('div', { className: 'cdxp-row' },
      React.createElement('span', { className: 'cdxp-title' }, '重置次数（重置券）'),
      React.createElement('span', { className: 'cdxp-pct' },
        credits && typeof credits.availableCount === 'number' ? `${credits.availableCount} 次` : '—')),
    React.createElement('div', { className: 'cdxp-meta' },
      `计划 ${String(account.planType || (snapshot && snapshot.planType) || '未知')}${account.email ? ` · ${String(account.email)}` : ''}`),
    creditRows.length > 0
      ? React.createElement('div', { className: 'cdxp-list' }, creditRows)
      : React.createElement('div', { className: 'cdxp-empty', style: { marginTop: '6px' } }, '没有可用的重置券'),
    React.createElement('div', { className: 'cdxp-actions' },
      React.createElement('button', {
        className: 'cdxp-btn primary',
        disabled: props.busy || !(credits && credits.availableCount > 0) || !props.selectedCreditId,
        onClick: props.onReset,
      }, props.busy ? '处理中…' : '使用所选重置券'),
      React.createElement('button', { className: 'cdxp-btn', disabled: props.busy, onClick: props.onRefresh }, '刷新'))))
  const provider = status.provider || null
  const modelNames = provider && Array.isArray(provider.models) ? provider.models.slice(0, 8).join(', ') : ''
  children.push(React.createElement('div', { className: 'cdxp-card', key: 'provider' },
    React.createElement('div', { className: 'cdxp-row' },
      React.createElement('span', { className: 'cdxp-title' }, 'DSH 模型提供方'),
      React.createElement('span', { className: 'cdxp-pct' }, provider && provider.ok ? '已接入' : '未接入')),
    React.createElement('div', { className: 'cdxp-meta' },
      `${String((provider && provider.registeredAs) || 'openai-codex')} · ${provider && Array.isArray(provider.models) ? provider.models.length : 0} 个模型 · ${provider && provider.tokenExpiresAt ? `token 到期 ${fmtWhen(provider.tokenExpiresAt)}` : 'token 未知'}`),
    modelNames ? React.createElement('div', { className: 'cdxp-meta' }, `模型：${modelNames}`) : null,
    provider && provider.error ? React.createElement('div', { className: 'cdxp-err' }, String(provider.error)) : null,
    React.createElement('div', { className: 'cdxp-actions' },
      React.createElement('button', { className: 'cdxp-btn', disabled: props.busy, onClick: props.onSyncModels }, '同步/续期 Codex 模型'))))
  if (props.syncMessage) children.push(React.createElement('div', { className: 'cdxp-ok', key: 'sync' }, props.syncMessage))
  if (props.resetMessage) children.push(React.createElement('div', { className: 'cdxp-ok', key: 'reset' }, props.resetMessage))
  if (status.fetchedAt) {
    children.push(React.createElement('div', { className: 'cdxp-empty', key: 'fetched', style: { marginTop: '6px' } },
      `更新于 ${new Date(status.fetchedAt * 1000).toLocaleTimeString()} · ${String(status.codexHome || '')}`))
  }
  return React.createElement('div', null, children)
}

function createController() {
  let status = null
  let error = null
  let busy = false
  let open = false
  let resetMessage = ''
  let syncMessage = ''
  let selectedCreditId = ''
  const listeners = new Set()
  const availableCredits = (nextStatus) => {
    const rows = nextStatus && nextStatus.resetCredits && Array.isArray(nextStatus.resetCredits.credits)
      ? nextStatus.resetCredits.credits
      : []
    return rows.filter((credit) => credit && credit.id && (!credit.status || credit.status === 'available'))
  }
  const reconcileCredit = () => {
    const rows = availableCredits(status)
    if (!rows.some((credit) => String(credit.id) === selectedCreditId)) selectedCreditId = rows[0] ? String(rows[0].id) : ''
  }
  const emit = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get() {
      return { status, error, busy, open, resetMessage, syncMessage, selectedCreditId }
    },
    selectCredit(id) {
      if (availableCredits(status).some((credit) => String(credit.id) === id)) selectedCreditId = id
      emit()
    },
    setOpen(next) {
      open = next
      emit()
    },
    async refresh() {
      if (busy) return
      busy = true
      error = null
      emit()
      try {
        status = await requestJson('/codex-plus/status')
        reconcileCredit()
      } catch (cause) {
        error = String((cause && cause.message) || cause)
      }
      busy = false
      emit()
    },
    async reset() {
      if (busy) return
      const creditId = selectedCreditId
      if (!availableCredits(status).some((credit) => String(credit.id) === creditId)) {
        resetMessage = '请先选择一张可用的重置券'
        emit()
        return
      }
      busy = true
      resetMessage = ''
      emit()
      try {
        const result = await requestJson('/codex-plus/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ creditId }),
        })
        if (result && result.ok) {
          const outcomes = {
            reset: '已消耗 1 张重置券，5 小时与一周额度已重置',
            nothingToReset: '当前没有可重置的额度窗口',
            noCredit: '没有可用的重置券',
            alreadyRedeemed: '该重置已执行过（幂等命中）',
          }
          resetMessage = outcomes[result.outcome] || `结果：${String(result.outcome)}`
          if (result.status) {
            status = result.status
            reconcileCredit()
          }
        } else {
          resetMessage = `重置失败：${String((result && result.error) || 'unknown')}`
        }
      } catch (cause) {
        resetMessage = `重置失败：${String((cause && cause.message) || cause)}`
      }
      busy = false
      emit()
    },
    async syncModels() {
      if (busy) return
      busy = true
      syncMessage = ''
      emit()
      try {
        const result = await requestJson('/codex-plus/sync', { method: 'POST' })
        if (result && result.ok) {
          const count = Array.isArray(result.models) ? result.models.length : 0
          syncMessage = `已同步 ${String(result.registeredAs || 'openai-codex')}：${count} 个模型${result.tokenRefreshed ? '（已续期 token）' : ''}`
        } else {
          syncMessage = `同步失败：${String((result && result.error) || 'unknown')}`
        }
      } catch (cause) {
        syncMessage = `同步失败：${String((cause && cause.message) || cause)}`
      }
      busy = false
      emit()
    },
  }
}

function apply(ctx) {
  const slots = ctx.slots
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-codex-plus'
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  })
  const controller = createController()
  const timer = ctx.timer

  function useController() {
    const [, force] = React.useState(0)
    React.useEffect(() => controller.subscribe(() => force((n) => n + 1)), [])
    React.useEffect(() => {
      controller.refresh()
      return timer.interval(() => controller.refresh(), 60000)
    }, [])
    return controller.get()
  }

  function Chip(props) {
    const state = useController()
    const wide = !(props && props.wide === false)
    const snapshot = state.status && state.status.rateLimits ? state.status.rateLimits : null
    const used5 = snapshot && snapshot.primary ? snapshot.primary.usedPercent : null
    const usedWeek = snapshot && snapshot.secondary ? snapshot.secondary.usedPercent : null
    const count = state.status && state.status.resetCredits ? state.status.resetCredits.availableCount : null
    const toggle = () => {
      const next = !state.open
      controller.setOpen(next)
      if (next) controller.refresh()
    }
    if (!wide) {
      return React.createElement('button', { className: 'cdxp-chip', title: 'Codex Plus 订阅额度（点击打开面板）', onClick: toggle },
        React.createElement('i', null),
        React.createElement('b', null, fmtRemain(used5)))
    }
    return React.createElement('button', { className: 'cdxp-chip', title: 'Codex Plus 订阅额度，点击打开面板', onClick: toggle },
      React.createElement('i', null),
      React.createElement('b', null, 'Codex'),
      React.createElement('em', null, '5h'),
      React.createElement('b', null, fmtRemain(used5)),
      React.createElement('em', null, '周'),
      React.createElement('b', null, fmtRemain(usedWeek)),
      React.createElement('em', null, '重置'),
      React.createElement('b', null, count === null || count === undefined ? '—' : String(count)))
  }

  function Panel() {
    const state = useController()
    if (!state.open) return null
    return React.createElement('div', {
      className: 'cdxp-ovl',
      onClick: (event) => {
        if (event.target === event.currentTarget) controller.setOpen(false)
      },
    }, React.createElement('div', { className: 'cdxp-panel' },
      React.createElement('div', { className: 'cdxp-hd' },
        React.createElement('h3', null, 'Codex Plus 订阅'),
        React.createElement('button', { className: 'cdxp-btn', onClick: () => controller.setOpen(false) }, '关闭')),
      React.createElement('div', { className: 'cdxp-sub' },
        '额度 · 重置券 · DSH 模型提供方（使用所选重置券不可撤销）'),
      React.createElement(StatusBody, {
        status: state.status,
        error: state.error,
        busy: state.busy,
        resetMessage: state.resetMessage,
        syncMessage: state.syncMessage,
        selectedCreditId: state.selectedCreditId,
        onSelectCredit: (id) => controller.selectCredit(id),
        onReset: () => controller.reset(),
        onRefresh: () => controller.refresh(),
        onSyncModels: () => controller.syncModels(),
      })))
  }

  slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'codex-plus-chip' }, Chip))
  slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'codex-plus-panel' }, Panel))
}

Object.assign(exports, { name: 'codex-plus', inject, apply, default: { name: 'codex-plus', inject, apply } })
return module.exports
  },
})
