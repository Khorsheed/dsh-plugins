# Agent Note: Codex harness —— 作用域目录下的一次性 `codex exec` 委派

Status: implemented

[English](2026-08-16-local-agent-codex-harness.md) | 中文

## Problem

[local-agent 家族](2026-08-14-local-agent-family.md)只有一个 harness 样本（Kimi Code）。从该样本归纳出的家族契约——每个 harness 一个作用域目录、device-code 登录、记录适配器、一次性 CLI 委派——在冻结前需要第二个样本，Codex 就是点名的候选。官方 `subagent-codex` bundle 已经通过 `codex app-server --stdio`（ephemeral thread：磁盘上不落任何会话文件）委派，因此无法满足家族基于文件的记录面；在不自写 provider 的前提下，基于文件的镜像不可能实现。

Codex 与 Kimi 还有三处具体差异，harness 形状必须吸收或钉死：

1. **登录提示走 stdout**——`codex login --device-auth` 把 device-code URL 打到 stdout 而非 stderr；框架登录流原先只捕获 stderr。
2. **默认凭据存储是系统 keychain**——`cli_auth_credentials_store` 默认为 `auto`，在 macOS 上解析为 keychain。不钉死 `file` 的话，凭据会泄漏到作用域目录之外，`auth.json` 存在性检查也永远看不到它们。
3. **会话文件是 rollout JSONL**——每个会话一个 `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`，首行为 `session_meta`；与 Kimi 的 `session_index.jsonl` 不同，列表必须遍历按日期分层的目录、且每个文件只读头部。

## Decision

`@deepseek-ai/dsh-local-agent-codex`（`packages/bundle/local-agent-codex/`）是第二个 harness bundle，与 kimi 采用相同的 seam 形状：

- **Harness** `codex`：`CODEX_HOME` 作用域目录，`login: { command: 'codex', args: ['login', '--device-auth'], capture: 'stdout' }`（框架新增的 `capture` 字段），记录来自 rollout 文件，`isAuthenticated` = `auth.json` 存在，`logout` 删除作用域内的 `auth.json`（不调用 CLI 自带的 `codex logout`；文件删除就是 harness 契约的函数形态）。
- **预置**：首次启动写入一份最小 scoped `config.toml`，钉死 `cli_auth_credentials_store = "file"`（已有 config 保持原样），让 device-code 凭据落进作用域目录的 `auth.json`。
- **Provider** `codex-local`：作用域目录下的一次性 `codex exec --sandbox <mode> --json "<task>"`；stdout 上的 NDJSON 事件流同时给出最终回答与回合用量（stderr 仅作诊断管道）。`--sandbox` 策略由本包的 `sandbox` 插件 config 选择（默认 `workspace-write`）。
- **Patch** `cordis.patch.yml` 只插入 `local-agent-codex` + `tool-subagent-codex-local`（provider `codex-local`、toolName `subagent_codex_local`、`enableRunInBackground: false`、`maxDepth: provider-managed`）到 profile 根——沿用 [profile 根委派决策](2026-08-15-profile-root-delegation-tools.md)。家族 core 行（`local-agent`，共享作用域目录根）**刻意不**重复插入：kimi 包的 patch 拥有它，重复 id 会把 core 挂载两次。没有家族 core 的 codex-only 组合会在启动时响亮失败。
- **v1 输出**：委派的打印响应以单条 assistant 消息追加进 dsh 子代理会话（user/message + assistant/message + 持久化），运行因此在子代理面上可见最终文本；完整的事件流镜像（推理、工具调用、diff）留待 v2。镜像还携带真实耗时与 token 用量——见 [2026-08-16-delegation-accounting.md](./2026-08-16-delegation-accounting.md)。

Provider 与工具名（`codex-local` / `subagent_codex_local`）避免与官方 `subagent-codex` provider（`codex`）及 preset 中禁用的 `subagent_codex` 行发生 DUPLICATE_PROVIDER 冲突。

## Alternatives considered

- **复用官方 `subagent-codex` provider**（`codex app-server --stdio`，ephemeral thread）。拒绝：它不写会话文件，家族的基于文件记录面（会话列表、按项目收窄）无法工作；kimi 家族的参谋反馈正是把官方 provider 的 ephemeral thread 作为必须自写 provider + 流追加的原因。
- **凭据存储保持 `auto`，改查 keychain**。拒绝：家族的隔离契约基于目录——每条凭据都必须活在作用域目录里；keychain 存储破坏隔离与认证检查，`/codex logout` 的文件删除也够不到它。
- **把 `local-agent` 家族 core 行加进 codex patch**，让本包可独立安装。拒绝：两个 bundle 挂在同一个 profile 里，两条同 id 的顶层 `insert` 行会把 core 挂载两次。前置依赖（与 kimi bundle 一起安装）写进 README。

## Consequences

- Codex 委派现在对每个 agent preset 都是环境性的（`subagent_codex_local` 在 profile 根），隔离在 `$DSH_HOME/local-agent/codex` 下，由 `/codex sessions` 和家族设置分区列出（按 `workDir` 逐项目收窄）。
- harness 形状新增了 `login.capture` 字段（stdout vs stderr 提示捕获）——这是第二个样本真实吸收进框架契约的增量。
- 家族的基于文件记录面现在有第二个适配器（rollout 文件），用另一种磁盘格式验证了目录遍历 + 头部读取的模式。
- v1 委派一次性运行、只镜像最终回答；模型可见文本是从 `--json` 流解析出的 codex 响应，子上下文永不进入父级。沙箱策略默认 `workspace-write`；需要审批的动作被拒绝（非交互）而非弹提示。
- 只对作用域目录自身的登录绕开 macOS keychain；用户本机 `~/.codex` 不被触碰。

## Verification

- 单元测试：rollout 头部解析与列表（跳过损坏/撕裂文件、`auth.json` 存在性）、运行结算（完成时把响应追加进子会话；非零退出结算为 error）、带解析后 descriptor 的子会话记录创建、apply 注册 + 预置、patch 行、invariant 的 home env 检查、provision/logout 文件行为。
- `sandbox` config 通过 provider spec 覆盖；`cli_auth_credentials_store = "file"` 预置在 apply spec 中断言。
- oxlint、typecheck、翻译配对（963 对）、doc budgets、README limitations 门禁在本变更面上通过。
