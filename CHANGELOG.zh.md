# 中文更新说明

本文件记录 `dsh-codex-plus` 的版本更新内容。

## 未发布

### 平台支持

- 新增 Windows 支持：从 PATH、OpenAI Codex 官方安装目录与 npm 命令垫片定位 CLI。
- Windows 上支持直接启动 `codex.exe`，并通过 shell 兼容 `.cmd` / `.bat` 垫片。
- Windows 写回 `auth.json` 时保留用户目录 ACL，不再调用仅适用于 POSIX 权限位的 `chmod(0600)`。
- 将 `@deepseek-ai/dsh-tools` peer 范围扩展至已验证兼容的 0.2.x 版本线。

## 0.1.6（2026-09-28）

### 变更

- 将插件版本由 `0.1.5` 更新至 `0.1.6`。
- 新增中文本地更新说明，并将其纳入 npm 发布包。
- 明确声明当前版本仅支持 Linux，并通过 npm 的 `os` 字段限制支持平台。
- 在中英文 README 中补充平台兼容性提示。

### 平台支持

> **本版本插件只支持 Linux。Windows 版本需要针对 Codex CLI 路径、凭证目录以及进程调用方式进行额外适配，目前暂不支持。**
