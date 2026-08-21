# `@khorsheed/dsh-local-agent-tool-subagent`

[English](README.md) | 中文

[local-agent 家族](../../local-agent/local-agent/README.zh.md)的家族自有委派工具。各 harness bundle 的 patch 用本工具替换官方 `@deepseek-ai/dsh-tool-subagent` 行，`toolName` 保持不变（`subagent_kimi`、`subagent_codex_local`、`subagent_claude_code_local`），因此 preset 和 prompt 照常工作，同时工具新增家族自有的续聊能力。

## 工具做什么

工具 schema 是官方子集（`description`/`prompt`）加上一个可选参数：

- `resume?: string` —— 首次委派结果文本返回的 dsh 子会话 id，用于在后续轮次继续同一个 CLI 会话。

首次调用（不带 `resume`）与官方工具完全一致：stage 一个 fresh intent 并启动一次性委派。续聊调用（带 `resume`）在任何 CLI 进程启动前先通过 `localAgent` 服务解析句柄，然后在**同一个** dsh 子会话里执行提供方的续聊命令（`kimi -S session_<id> -p`、`claude -p --resume <id>`、`codex exec --json resume <thread_id>`），并以独立的 turn（`turn/start`/`turn/end` 成对、usage 挂当轮 assistant 消息）追加新一轮。续聊轮仍走 `ctx.subagents.start()`，因此 `subagent/start`/`subagent/end` 生命周期事件与标准子代理展示不变。

## 安全：句柄绝不进 prompt

续聊句柄只作为 `resume` 参数传递——**绝不**放进 `prompt`。任务文本不可信：模型把句柄塞进 prompt 会被忽略（工具只读参数），伪造的 `resume` 值也会被 registry 拒绝——registry 只对记录该委派的同一 parent 会话和提供方解析句柄。把句柄塞进 prompt 会让任务文本劫持他人会话的上下文；工具从构造上拒绝这种形态。

## 载体：localAgent 服务，而非 descriptor

subagent 请求 descriptor schema（`subagent/descriptor`）是严格的：one-shot 键只有 `version`/`mode`/`provider`/`label`，未知字段直接抛错，因此 resume 目标无法搭 descriptor 的便车。家族改经 `localAgent` 服务的委派 registry（子会话 id → CLI 会话 id）及其按 (parent, provider) 分组的 intent 队列传递已解析目标——这与未来 stop registry 共用同一套基础设施。

## 安装

不单独安装：各 harness bundle（`@khorsheed/dsh-local-agent-kimi`、`-codex`、`-claude-code`）把本包声明为依赖，并在各自的 patch 里挂载工具行。安装任一 harness bundle 即带上本工具行；家族核心（`@khorsheed/dsh-local-agent`）也须一并安装（见该 bundle 的 README）。

## 卸载

移除 harness bundles 即注销各自的工具行。单独移除本包是不受支持的配置——harness bundles 依赖它。

## 范围隔离

工具自身不 spawn 任何进程；它只通过 `localAgent` 服务解析和 stage，并把委派交给 harness provider，由后者在 harness 的 scoped home 下运行 CLI。因此工具继承 harness bundle 的 `KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 隔离。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线（deepseek-harness master）：✅
