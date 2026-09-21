# dsh-codex-plus

**用途：把你本机已经登录的 Codex（ChatGPT Plus/Pro）订阅接入 DeepSeek Harness。**
它显示 5 小时窗口与一周窗口的剩余额度、重置时间与剩余重置券数量，支持一键消耗一张重置券重置额度；
读取额度时自动把订阅线路注册进 DSH，使 Codex 模型出现在模型选择器中；并在 access token 到期前
自动续期。**无需填写任何 API key**，使用的是你本机 Codex 登录已有的凭证。

> English: [use your Codex (ChatGPT Plus/Pro) subscription inside DeepSeek Harness](#english)

## 用途

1. **看得见订阅额度** —— 侧边栏 `Codex` 胶囊与面板显示两个窗口的剩余额度与重置券；
2. **能用订阅的模型** —— 读额度时自动注册 `openai-codex` 路由，模型出现在模型选择器；
3. **能一键重置额度** —— 面板按钮消耗 1 张重置券，重置 5 小时 + 一周窗口；
4. **凭证自动续期** —— token 剩余不足 24 小时时自动续期并原子写回。

中文详解（功能明细、面板路由、安装与配置、安全边界）见 [README.zh.md](./README.zh.md)。

---

## English

Use your **Codex (ChatGPT Plus/Pro) subscription** inside DeepSeek Harness.

It reads the quota of the Codex account you are already signed in to on this machine,
shows it in the UI, exposes the subscription's models to DSH's model picker, and can spend
a rate-limit reset credit with one click.

## What it does

**Quota panel**

- A `Codex` chip in the sidebar footer: remaining 5-hour window, remaining weekly window,
  and how many reset credits are left (collapses to the percentage when the sidebar is in rail mode).
- Click it for a panel with both windows (used %, reset time) and every reset credit with its
  expiry date.
- **One-click reset** spends one reset credit and resets the 5-hour + weekly windows.
  The button is disabled when no credit is available, and the outcome is reported
  (`reset` / `nothingToReset` / `noCredit` / `alreadyRedeemed`). This consumes a real credit
  and cannot be undone.

**Model routing**

Reading the quota also registers the subscription route in the `llm-pi-ai` settings namespace,
so the Codex models appear in DSH's model picker:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_API_KEY
      displayName: Codex (ChatGPT Plus/Pro)
      baseURL: https://chatgpt.com/backend-api
```

Only that one provider entry is touched — the merge is line-based and idempotent, so your
other providers and the file's formatting are preserved.

**Token upkeep**

The access token is refreshed against `auth.openai.com` when it has less than 24 hours left,
and the rotated `access_token` / `refresh_token` / `id_token` triple is written back to
`auth.json` atomically with mode `0600`. The current access token is stored in DSH's
credential store under the reference name above, so `settings.yaml` never holds a secret.

**Panel transport**

The browser half talks to the host half over this plugin's own same-origin routes —
`GET /codex-plus/status`, `POST /codex-plus/sync`, `POST /codex-plus/reset` — which the DSH web
server already protects with its browser-session policy. No new RPC channel and no token in the
page are involved.

**Delegation tool**

`codex` hands a self-contained task to the local Codex agent and returns its final answer —
useful for a second opinion, a fresh-context review, or an independent subtask.

| Tool | Purpose |
| --- | --- |
| `codex` | Run a task through `codex exec` and return the answer |
| `codex_quota` | Read the quota and re-sync the provider route |
| `codex_models_sync` | Refresh the token and re-register the models now |
| `codexprobe` | Diagnostics: resolved CLI, Codex home, cached catalog, quota read |

## Requirements

- A Codex CLI on this machine that is already signed in with a ChatGPT account
  (`codex login`); its login lives in `<codexHome>/auth.json`.
- The CLI is looked up in `DSH_CODEX_BIN`, then `/usr/lib/chatgpt/resources/codex`,
  `/usr/local/bin/codex`, `/usr/bin/codex`, `~/.codex/bin/codex`, `~/.local/bin/codex`.
- The Codex home is `DSH_CODEX_HOME`, else `~/.codex`.
- Node 20 or newer. No Python, no extra npm dependency.

## Install

```sh
dsh plugin --profile web add dsh-codex-plus
```

Then restart the profile and refresh the page. Switch the conversation's model to
**Codex (ChatGPT Plus/Pro)** to use the subscription for that session.

## Configuration

All keys are optional.

```yaml
- id: codex-plus
  name: 'dsh-codex-plus'
  config:
    codexBin: /usr/local/bin/codex        # explicit CLI path
    codexHome: ~/.codex                   # explicit CODEX_HOME
    workspace: /path/to/workspace         # shell sandbox root (default: process cwd)
    providerRoute: openai-codex           # pi-ai catalog route to configure
    providerDisplayName: Codex (ChatGPT Plus/Pro)
    credentialRef: OPENAI_CODEX_API_KEY   # credential-store reference name
    syncProviders: true                   # set false to skip the settings write entirely
    sandboxPolicy: true                   # false disables the workspace-write policy
```

Set `syncProviders: false` if you only want the quota panel and would rather wire the
provider yourself.

## Security

- No credentials are bundled, and none are logged. The plugin reads the token your own
  Codex login already wrote to `auth.json`.
- The token value goes to DSH's credential store; `settings.yaml` only carries the
  reference name `OPENAI_CODEX_API_KEY`.
- `auth.json` is only ever written with the refreshed triple, atomically, at mode `0600`.
- The reset action requires an explicit confirmation argument and an available credit.
- The panel routes are readable by any caller that already holds a valid DSH web session
  (they are behind the same browser-session policy as the rest of the web UI); they expose the
  quota, the plan type, and the account email, not the token.
- `codex exec` runs with the sandbox you pass to the `codex` tool (`read-only` by default).
  Note that running Codex inside a sandbox that already blocks user namespaces can make
  Codex's own workspace-write sandbox fail; `danger-full-access` then defers to DSH's own
  sandbox, which is the safer pairing.

## Licence

MIT
