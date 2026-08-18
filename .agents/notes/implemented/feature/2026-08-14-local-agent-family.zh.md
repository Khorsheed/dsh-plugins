# Agent Note: 本地代码 agent 家族

Status: implemented

[English](2026-08-14-local-agent-family.md) | 中文

## 问题

dsh agent 无法把工作委派给本机安装的编码 agent CLI（Kimi Code、Codex、Claude Code），也看不到其委派产生的会话。把每个 CLI 直接接进 core 会重复委派 seam；让子进程指向用户原生 home（如 Kimi Code 的 `~/.kimi-code`）则会让 agent 读写用户的私人会话与凭据。

## 决策

家族由三个包 + 每个 harness 一个 bundle 组成，边界严格：

- `@khorsheed/dsh-local-agent`（`packages/local-agent/`）只拥有 harness 身份与生命周期：`ctx.localAgent` 注册表、共享 homes 根下每个 harness 一个 0700 作用域目录、`/<harness> login|sessions` 命令族，以及启动时交叉校验每个 harness `delegationProvider` 与已挂载 subagent provider 的不变式。委派刻意不属于本 seam。
- 每个 harness bundle（首个：`packages/local-agent-kimi/` 的 `@khorsheed/dsh-local-agent-kimi`）向 core 注册一个 harness（作用域 env 名、device-code 登录调用、records 适配器），并向既有 `subagent` 能力挂载自己的 subagent-provider 行（讲 stdio ACP 的 CLI 用 subagent-acp），经 `localAgent.homeDir(name)` 读取作用域目录。两次注册、两个 seam、一份经交叉校验的契约。
- `@deepseek-ai/dsh-client-ui-local-agent` 是共享浏览器半身：每个配置的 harness 一个会话标题栏下拉，经既有 commands Remote 拉取 `/<harness> sessions` 列表——零核心 RPC 新增。

隔离基于目录：每个子进程都带着指向其作用域目录的 harness env 变量运行，凭据与会话绝不触碰用户原生安装。登录只走 device-code；URL 呈现在命令回复中、CLI 在后台轮询。委派产生的会话从作用域目录列出（Kimi 是 `session_index.jsonl`），因此"agent 能看到的会话"等于"它自己目录里的会话"。

harness 形状只记录真实安装差异（`homeEnvVar`、`login`、`records`、可选 `delegationProvider`）——由 Kimi 单样本归纳，并经 Codex 样本（[2026-08-16-local-agent-codex-harness.md](./2026-08-16-local-agent-codex-harness.md)）验证，后者新增了面向 stdout 登录提示的 `login.capture` 字段；Claude Code 作为第三个样本落地（[2026-08-16-local-agent-claude-code-harness.md](./2026-08-16-local-agent-claude-code-harness.md)）。

## Alternatives considered

- 一个同时携带 node glue 与浏览器半身的合并包（类似 `dsh-session-log-export`）。否决：glue 需要 `node:child_process` 与 `node:fs`，浏览器安全的 client face 无法编译；单包双编译面只是 `api/remotes` 的例外。
- harness 上带 delegation 字段、由 core 代注册 subagent provider。否决：委派属于既有 `subagent` seam；harness bundle 自己挂载 provider 行，启动不变式交叉校验配对，记录点名未挂载 provider 时 fail loud，无需第二条注册路径。
- 通过终端会话承载登录流程。暂缓：web GUI 没有交互式终端面，device-code URL 通过命令回复呈现、CLI 在后台轮询；同一 harness `login` 契约之后仍可替换为终端式登录。

## Consequences

> 2026-08：委派工具行从逐 preset 变体迁到 profile root（见 [2026-08-15-profile-root-delegation-tools.md](./2026-08-15-profile-root-delegation-tools.md)）；下面的 seam 与隔离决策仍然有效。

用户原生 harness 安装保持原样：每个子进程都针对其作用域目录运行。一个 harness 是两次注册（身份进 `ctx.localAgent`、委派进 `subagents`），配对经不变式校验，任一侧拼写错误都在加载时 fail loud。浏览器以零核心 RPC 新增获得记录下拉。harness 形状由 Kimi 单样本归纳；Codex 作为第二个样本落地（[2026-08-16-local-agent-codex-harness.md](./2026-08-16-local-agent-codex-harness.md)），随后契约冻结。

## 验证

- 单元测试覆盖注册表生命周期、登录分支（prompt 抓取、spawn 失败、超时、进行中守卫）、records 解析与委派交叉校验不变式。
- Loader 组合 e2e 以 `PATH: ''` 启动家族 + kimi harness，断言 provider、工具、注册表与零进程启动。
- oxlint、`verify-cordis-config`、typecheck 与 doc-sync 门（catalog 重生成、翻译配对、类型等价）在本改动面上通过。
