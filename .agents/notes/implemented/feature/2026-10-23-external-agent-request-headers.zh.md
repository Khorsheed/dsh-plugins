# Agent Note: 外部 agent 子会话记录 request/header，带上请求的真实配置

Status: implemented

## Problem

Context Lens 里外部 agent(kimi / claude-code / codex）子会话的配置卡片整卡「未记录」：请求发生在成员自己的 CLI 里，子会话日志没有 `request/header` 事件，log 车道的回退只能从消息 source 读到 `provider`/`model`。「上游没给所以给不了」的直觉判断，经查证并不成立：

- kimi 的 wire 每次请求都声明全量配置：每个 `llm.request` 事件带 `model`、`thinkingEffort`、`maxTokens`（真实 fixture 实证）。
- claude-code 的 wire 带 model(init/result 事件）但从无 effort/maxTokens;effort 的权威事实是 provider 启动时自己设置的 `CLAUDE_CODE_EFFORT_LEVEL` env。
- codex 的流两者都不带；权威事实是 provider 自己的启动参数（exec argv 的 `-m` / `-c model_reasoning_effort=…`,live 路 `turn/start` 的 `{model, effort}`)。

我们自己设置的参数，是可以照实记录的事实，无需编造。

## Decision

每个外部 agent 子会话现在记录宿主原生的 `request/header` 事件（`header.config`:`provider` + `model`，已知时附 `reasoningEffort` / `maxTokens`),Context Lens 的 log 车道由此像读主会话一样读子会话配置。

- **kimi**(`session-view.ts` + `session-mirror.ts`):transcript 读取器把每条 `llm.request` 声明的配置快照到它所记账的行上；wire step 折叠按 wire 自己的措辞写出 header。
- **claude-code**:exec 路的 live 镜像在首次折叠时写入（init 事件的观测 model，回退到启动 `--model`，附启动时的 effort env);live driver 在开 turn 时按会话配置写入。
- **codex**:exec 路在开 turn 时按 spawn argv 写入；live 路按 `turn/start` 请求参数写入。
- 统一只在变化时记录：首个 header 记 `initial`，不同记 `change`，相同跳过（宿主记的是变化快照，不是逐次重复）。header 契约要求 provider 和 model 同在：model 确实未知的轮次整条不写，绝不编造。
- 消息的 `source.provider/model` 占位值（`claude`、`codex`）本轮不动；把占位换成观测 model 是另一项清理，header 先行落地。

## Alternatives considered

- **以「上游没给」为由不做**：对 kimi 是错的（wire 全量声明）,对 claude/codex 是放弃过早（启动参数是我们自己的事实）。记录下来，免得下一位逐条 wire 重新考证。
- **只写 `reasoningEffort` 不带 `model`**：会话格式的 `LlmCallConfig` 要求 `model`（关系校验器要求 `provider`)，缺 model 的 header 不合法——model 未知的轮次跳过写入，而不是放宽契约。
- **家族共享 helper**：三包按规矩各自独立；这个 fifteen-line 的变化即写 helper 每包复制一份，比引一条跨包依赖便宜。

## Consequences

- 新子会话在 Context Lens 里显示真实的 provider/model/思考强度/输出上限。旧日志不变（没有 header;lane 的 source 回退继续兜底）。
- kimi 的 header 按 wire step 记（它的配置确实可能逐请求变）;claude/codex 按轮记（配置启动时固定）。会话中途改配置会记一条 `change`,lane 随之更新。
- `reasoningEffort` 以带品牌的 `ReasoningEffortId` 越过会话边界；cast 发生在提取点（wire 原文 / 启动配置），下游不再重复校验。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test`(284)、`--filter @khorsheed/dsh-local-agent-claude-code test`(262)、`--filter @khorsheed/dsh-local-agent-codex test`(247):kimi 的 wire-step 折叠用例断言 header 事件及其 `initial` reason;claude/codex 的 exec settle 用例断言启动事实 header。含 `request/header` 的日志全部通过 released-log 校验器回放。
