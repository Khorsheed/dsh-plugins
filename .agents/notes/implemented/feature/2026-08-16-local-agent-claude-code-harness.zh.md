# Agent Note: Claude Code harness —— 作用域 config 目录下的一次性 `claude -p` 委派

Status: implemented

[English](2026-08-16-local-agent-claude-code-harness.md) | 中文

## Problem

[local-agent 家族](2026-08-14-local-agent-family.md)已有两个 harness 样本（Kimi、Codex），其形状——每个 harness 一个作用域目录、浏览器/device 登录、记录适配器、一次性 CLI 委派——在冻结前需要第三个样本验证，Claude Code 就是点名的候选。Claude 与两者有三处具体差异：

1. **登录是浏览器 OAuth 流而非 device-code URL**——`claude setup-token` 从 stdin 读 token（TUI/交互式，在框架的 stdin-ignore spawn 下挂起），而 `claude auth login` 把浏览器授权 URL 打到 stdout——与 codex 的 device-code 流同一捕获契约。
2. **凭据存储依赖平台**——macOS 把真实凭据放在系统 keychain 的哈希条目里（以 config 目录路径为键）；Linux 有上游 bug #47661，`CLAUDE_CONFIG_DIR` **不隔离**凭据文件（写作用域、读默认 home）。认证探测必须是轻量文件检查，绝不 spawn CLI。
3. **records 是带损失性目录 slug 的 project 文件**——会话在 `projects/<cwd-slug>/<uuid>.jsonl` 下，slug 有损编码工作区路径（分隔符转连字符、可能撞名），列出的 cwd 必须取自文件**内容**（第一条 `user` 事件的 `cwd`），绝不取自目录名。
4. **子进程需要权限绕过**——不带 `--dangerously-skip-permissions` 的 `claude -p` 在非交互模式下拒绝写动作（没有审批面），一次性子代理无法做实际工作。

## Decision

`@deepseek-ai/dsh-local-agent-claude-code`（`packages/bundle/local-agent-claude-code/`）是第三个 harness bundle，与 kimi/codex 同 seam 形状：

- **Harness** `claude-code`：`CLAUDE_CONFIG_DIR` 作用域目录，`login: { command: 'claude', args: ['auth', 'login'], capture: 'stdout' }`（浏览器 OAuth URL 呈现在会话中、CLI 后台轮询），records 来自 project 文件，`isAuthenticated` = 作用域 `.claude.json` 带 `oauthAccount`（轻量文件检查，绝不 spawn CLI），`logout` 删除作用域配置文件（macOS keychain 条目留给 `claude auth logout`，下次登录重写）。
- **Provider** `claude-local`：作用域目录下的一次性 `claude -p [--dangerously-skip-permissions] --output-format json "<task>"`。JSON 结果行携带 `result`（最终回答）、`usage`（Anthropic 计数：`input_tokens` 未缓存、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`——各桶独立映射，无需减法）与 `session_id`。`--output-format json` 严格优于解析纯 stdout：一行确定性输出同时给出回答与记账。
- **Config**：`permissionMode`（`skip` 默认传权限绕过；`normal` 省略）与 `baseUrl`（为子进程设置 `ANTHROPIC_BASE_URL`；缺省继承宿主环境，例如用户级代理 `https://proxy.example.com/anthropic`）。
- **Patch** `cordis.patch.yml` 只插入 `local-agent-claude-code` + `tool-subagent-claude-code-local`（provider `claude-local`、toolName `subagent_claude_code_local`、`enableRunInBackground: false`、`maxDepth: provider-managed`）到 profile 根——沿用 [profile 根委派决策](2026-08-15-profile-root-delegation-tools.md)。家族 core 行**刻意不**重复插入：框架包自己的 patch 拥有它（共享的耗时/用量 append 纪律见 [delegation-accounting](2026-08-16-delegation-accounting.md)，此处复刻：spawn 时 `turn/start`、每条终止 settle 都以 `completed`/`error`/`aborted` reason 关 `turn/end`、最终 `assistant/message` 带 usage）。
- **v1 输出**：JSON 结果的 `result` 字段以单条 assistant 消息追加（user/message + 带 usage 的 assistant/message + 持久化），子代理面可见；完整的事件流镜像留待 v2。

Provider 与工具名（`claude-local` / `subagent_claude_code_local`）避免与官方 `subagent-claude-code` provider（`claude-code`）及 preset 中禁用的 `subagent_claude_code` 行发生 DUPLICATE_PROVIDER 冲突。

## Alternatives considered

- **`claude setup-token` 作为登录命令**。实测后否决：它从 stdin 读 token（TUI），在框架的 stdin-ignore spawn 下挂起；`claude auth login` 把浏览器 URL 打到 stdout，匹配既有 `login.capture: 'stdout'` 契约。
- **spawn CLI 探测认证**（`claude auth status`）。否决：慢，且 Linux 凭据 bug 下会报告默认 home 的状态而非作用域 home；作用域 `.claude.json` 的 `oauthAccount` 检查是纯文件读取。
- **纯 `claude -p` stdout 作为运行输出**。否决：纯 stdout 是最终回答但不带记账；`--output-format json` 一次解析同时给出回答与用量，与 codex 的 `--json` 决策一致。
- **默认 `permissionMode: 'normal'`**。否决：一次性 CLI 子代理没有审批面，不带绕过就无法做实际工作；`skip` 是可工作的默认，`normal` 是可选受限模式。

## Consequences

- Claude Code 委派现在对每个 agent preset 都是环境性的（`subagent_claude_code_local` 在 profile 根），隔离在 `$DSH_HOME/local-agent/claude-code` 下，由 `/claude-code sessions` 和家族设置分区列出（按内容来源的 `workDir` 逐项目收窄）。
- harness 形状获得第三个样本：浏览器 OAuth 登录（对比 kimi/codex 的 device-code）、JSON 单行委派输出（对比 codex 的 NDJSON 流）、平台相关凭据探测——全部无需框架改动。
- macOS keychain 条目在 `/claude-code logout` 后仍然留存（已文档化）；Linux 凭据与默认 home 不隔离（上游 bug，已文档化）——两者都是已知限制，不是静默行为。
- 耗时与 token 记账与 kimi/codex 共用同一投影（turn 边界 + 最终消息上的 usage），真实委派验证：耗时 ratio 1.00、四桶用量非零（含 cache write——claude 上报而 codex 没有）。

## Verification

- 单元测试：records 解析（跨损失性 slug 的内容来源 cwd、跳过损坏文件、`oauthAccount` 认证探测）、provider 结算（JSON 结果 → 输出 + usage 桶、失败以 error reason 关闭回合）、带解析后 descriptor 的子会话记录创建、apply 注册 + 预置、patch 行、invariant 的 home env 检查、provision/logout 文件行为。
- 真实委派：经 provider 跑一次 `claude -p --output-format json`，折叠出的 `subagentTiming` ≈ 墙钟（ratio 1.00），`tokenUsage` 四桶全部非零。
- oxlint、typecheck、翻译配对、doc budgets、README limitations 门禁在本变更面上通过。
