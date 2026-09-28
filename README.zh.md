# dsh-codex-plus

**用途：把你本机已经登录的 Codex（ChatGPT Plus/Pro）订阅接进 DeepSeek Harness。**

装好之后 DSH 能做三件它原本做不到的事：

1. **看得见订阅额度** —— 侧边栏显示 5 小时窗口、一周窗口的剩余额度与剩余重置券数量，
   点开有详细面板；
2. **能用订阅的模型** —— 读取额度时自动把订阅线路注册进 DSH，Codex 模型随即出现在
   模型选择器里（完整 8 模型目录，含 `gpt-6-luna`、`gpt-6-sol`）；
3. **能指定重置券** —— 面板逐张提供单选项，按钮只消耗所选的 1 张重置券，重置 5 小时 + 一周窗口；
4. **凭证自动续期** —— access token 快过期时自动续期并写回，不用你手动换 key。

不需要你提供任何 API key：插件读取的是你自己 Codex 登录已经写在 `~/.codex/auth.json`
里的凭证。

> **平台支持说明：当前版本仅支持 Linux。Windows 版本尚未适配，需针对 CLI 路径、凭证目录及进程调用方式进行额外适配后方可使用。**

中文版本更新记录见 [CHANGELOG.zh.md](./CHANGELOG.zh.md)。

## 功能明细

### 额度面板

- 侧边栏底部一枚 `Codex` 胶囊：`5h` 剩余、`周` 剩余、`重置` 券数量；
  侧边栏收起成窄轨道时自动折叠为百分比。
- 点击打开右侧面板：
  - **5 小时额度** 与 **一周额度**：已用百分比、进度条、重置时间（含「还有多久」）；
  - **重置次数（重置券）**：剩余张数，以及每张券的标题、说明与过期时间；
  - **使用所选重置券**：每张可用券都有单选项，只消耗当前选中的券。未选择或没有券时按钮禁用；结果会分别提示
    「已重置」/「当前没有可重置的窗口」/「没有可用重置券」/「该重置已执行过」。
    **这会真实消耗一张券且不可撤销。**
  - **DSH 模型提供方** 卡片：是否已接入、当前几个模型、token 到期时间；
    以及 **同步/续期 Codex 模型** 按钮（立即续期并重写配置，不必等自动节流）。
  - **刷新** 按钮；面板每 60 秒自动刷新一次。

### 模型接入（读额度时自动完成）

每次读取额度都会通过 `settingsController.mutate()` 精确设置 `llm-pi-ai.providers.openai-codex`（不假定任何固定 settings 文件路径）：

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_API_KEY
      displayName: Codex (ChatGPT Plus/Pro)
      baseURL: https://chatgpt.com/backend-api
```

- 只改动 `providers.openai-codex` 这一个条目：合并按行进行、幂等，
  **你已有的其他 provider（例如 `local`）与文件格式都保持原样**；
- 已有的 provider 块会被原样保留，不会重复插入；
- 只要额度面板、想自己接 provider 的，把 `syncProviders` 设为 `false` 即可完全跳过写配置。

### 凭证续期

- access token 剩余寿命不足 **24 小时**时，用 refresh_token 向 `auth.openai.com` 换新；
- 轮换后的 `access_token` / `refresh_token` / `id_token` **原子写回** `auth.json`（权限 0600）；
- 当前 token 存入 DSH 凭证库（引用名 `OPENAI_CODEX_API_KEY`），
  因此 `settings.yaml` 里**不会出现明文密钥**；
- 续期失败但旧 token 仍有效时会继续沿用旧 token，并在面板里说明。

### 面板通信

前端半通过本插件自己的同源路由与宿主通信：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/codex-plus/status` | GET | 额度 + 账号 + 提供方同步状态 |
| `/codex-plus/sync` | POST | 立即续期 token 并重写提供方配置 |
| `/codex-plus/reset` | POST | 接收 JSON `{ "creditId": "…" }`，消耗指定重置券 |

这些路径由 DSH web server 自身的浏览器会话策略保护，没有额外 RPC 通道，页面里也不携带 token。

### 模型可见工具

| 工具 | 作用 |
| --- | --- |
| `codex` | 把自包含任务交给本机 Codex agent（`codex exec`）并返回最终回答 |
| `codex_quota` | 读取额度，并重新同步提供方路由 |
| `codex_models_sync` | 立即续期 token、重新注册模型，并回报 DSH 现在服务的模型清单 |
| `codexprobe` | 诊断：解析到的 CLI、Codex home、缓存的模型目录、额度读取结果 |

## 要求

- **操作系统：仅支持 Linux。Windows 暂不支持，需要额外适配。**
- 本机有**已用 ChatGPT 账号登录**的 Codex CLI（`codex login`），登录态在 `<codexHome>/auth.json`。
- CLI 查找顺序：`DSH_CODEX_BIN` → `/usr/lib/chatgpt/resources/codex` → `/usr/local/bin/codex`
  → `/usr/bin/codex` → `~/.codex/bin/codex` → `~/.local/bin/codex`。
- Codex home：`DSH_CODEX_HOME`，否则 `~/.codex`。
- **Node 20+**。不需要 Python，无额外 npm 依赖（只用 Node 内置模块）。

## 安装

```sh
dsh plugin --profile web add dsh-codex-plus
```

**装完必须重启一次 `dsh web`**（bundle 组成在启动时装载），然后刷新页面。
把会话模型切到 **Codex (ChatGPT Plus/Pro)** 即可让该会话使用订阅。

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

## 安全说明

- **不打包任何凭证，也不记录 token。** 读取的是你自己 Codex 登录写入的 `auth.json`。
- token 明文只进 DSH 凭证库；`settings.yaml` 里只有引用名 `OPENAI_CODEX_API_KEY`。
- 对 `auth.json` 的唯一写入是续期后的三元组，原子替换、权限 0600。
- 重置操作需要显式确认参数，且必须有可用重置券。
- 面板路由对**已持有有效 DSH web 会话**的调用方可读（与 web UI 其余部分同一套会话策略）；
  它们暴露的是额度、计划类型与账号邮箱，不包含 token。
- `codex exec` 使用你传给 `codex` 工具的沙箱（默认 `read-only`）。注意：若外层沙箱已禁用
  user namespace，Codex 自带的 workspace-write 沙箱会失败；此时用 `danger-full-access`
  交给 DSH 自己的沙箱约束反而更稳妥。

## 许可

MIT
