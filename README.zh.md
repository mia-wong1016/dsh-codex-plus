# dsh-codex-plus

在 DeepSeek Harness 里直接使用你的 **Codex（ChatGPT Plus/Pro）订阅**。

读取你本机已登录的 Codex 账号额度并显示在界面上，把该订阅的模型接入 DSH 的模型选择器，
并支持一键消耗一张重置券重置额度。

## 功能

**额度面板**

- 侧边栏底部 `Codex` 胶囊：5 小时窗口剩余、一周窗口剩余、剩余重置券数量
  （侧边栏收起为窄轨道时自动折叠为百分比）。
- 点击打开面板：两个窗口的已用百分比与重置时间，以及每张重置券的过期时间。
- **一键重置**：消耗 1 张重置券，重置 5 小时 + 一周窗口。无券时按钮禁用，结果会分别提示
  `reset` / `nothingToReset` / `noCredit` / `alreadyRedeemed`。**这会真实消耗一张券且不可撤销。**

**模型接入**

每次读取额度时，会在 `llm-pi-ai` 配置命名空间里注册订阅路由，模型随即出现在 DSH 模型选择器中：

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_API_KEY
      displayName: Codex (ChatGPT Plus/Pro)
      baseURL: https://chatgpt.com/backend-api
```

只改动这一个 provider 条目：合并是按行、幂等的，你已有的其他 provider 与文件格式都保留。

**凭证续期**

access token 剩余寿命不足 24 小时时向 `auth.openai.com` 续期，并把轮换后的
`access_token` / `refresh_token` / `id_token` **原子写回** `auth.json`（权限 0600）。
当前 token 存入 DSH 凭证库（引用名见上），因此 `settings.yaml` 里不会出现明文密钥。

**面板通信**

前端半通过本插件自己的同源路由与宿主通信——`GET /codex-plus/status`、`POST /codex-plus/sync`、
`POST /codex-plus/reset`，这些路径由 DSH web server 自身的浏览器会话策略保护。
没有额外 RPC 通道，页面里也不携带 token。

**委派工具**

`codex` 把自包含任务交给本机 Codex agent 并返回最终回答——适合做第二意见、独立复核或并行子任务。

| 工具 | 作用 |
| --- | --- |
| `codex` | 通过 `codex exec` 执行任务并返回回答 |
| `codex_quota` | 读取额度并重新同步 provider 路由 |
| `codex_models_sync` | 立即续期 token 并重新注册模型 |
| `codexprobe` | 诊断：解析到的 CLI、Codex home、缓存的模型目录、额度读取结果 |

## 要求

- 本机有已用 ChatGPT 账号登录的 Codex CLI（`codex login`），登录态位于 `<codexHome>/auth.json`。
- CLI 查找顺序：`DSH_CODEX_BIN` → `/usr/lib/chatgpt/resources/codex` → `/usr/local/bin/codex`
  → `/usr/bin/codex` → `~/.codex/bin/codex` → `~/.local/bin/codex`。
- Codex home：`DSH_CODEX_HOME`，否则 `~/.codex`。
- Node 20+。不需要 Python，无额外 npm 依赖。

## 安装

```sh
dsh plugin --profile web add dsh-codex-plus
```

重启该 profile 后刷新页面。把会话模型切到 **Codex (ChatGPT Plus/Pro)** 即可让该会话使用订阅。

## 配置

以下键全部可选。

```yaml
- id: codex-plus
  name: 'dsh-codex-plus'
  config:
    codexBin: /usr/local/bin/codex        # 显式指定 CLI 路径
    codexHome: ~/.codex                   # 显式指定 CODEX_HOME
    workspace: /path/to/workspace         # shell 沙箱根目录（默认取进程 cwd）
    providerRoute: openai-codex           # 要配置的 pi-ai 目录路由
    providerDisplayName: Codex (ChatGPT Plus/Pro)
    credentialRef: OPENAI_CODEX_API_KEY   # 凭证库引用名
    syncProviders: true                   # 设为 false 则完全跳过写配置
    sandboxPolicy: true                   # 设为 false 关闭 workspace-write 策略
```

只要额度面板、想自己接 provider 时，把 `syncProviders` 设为 `false`。

## 安全说明

- **不打包任何凭证，也不记录 token。** 插件读取的是你自己 Codex 登录已经写入 `auth.json` 的凭证。
- token 明文只进 DSH 凭证库；`settings.yaml` 里只有引用名 `OPENAI_CODEX_API_KEY`。
- 对 `auth.json` 的唯一写入是续期后的三元组，原子替换、权限 0600。
- 重置操作需要显式确认参数，且必须有可用重置券。
- 面板路由对**已持有有效 DSH web 会话**的调用方可读（与 web UI 其余部分同一套浏览器会话策略）；
  它们暴露的是额度、计划类型与账号邮箱，不包含 token。
- `codex exec` 使用你传给 `codex` 工具的沙箱（默认 `read-only`）。注意：若外层沙箱已禁用
  user namespace，Codex 自带的 workspace-write 沙箱会失败；此时用 `danger-full-access`
  交给 DSH 自己的沙箱约束反而更稳妥。

## 许可

MIT
