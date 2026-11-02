# 上游提案：在工具结果中记录真实执行区间

- **状态**：提案（待上游评估）
- **提出方**：dsh-plugins 社区仓（local-agent 家族、context-lens）
- **目标读者**：deepseek-harness 上游维护者（`core/session`、`core/agent-loop`、`session/session-stats`）
- **核对版本**：harness `b830ec950f`
- **日期**：2026-11-02

## 一句话

`tool/call.time` 与 `tool/result.time` 目前只能表示事件何时写入会话，无法表示工具何时实际执行；建议为 `tool/result` 增加标准的可选执行区间，让原生工具与外部 CLI 镜像共用一份事实，供会话统计和观测插件读取。

## 现象与实证

local-agent 把 Kimi、Claude Code、Codex 的过程镜像成子会话。为保持 released-log 的原子步骤关系，镜像在工具结果已知后连续写入 assistant/message、`tool/call`、`tool/result`。`Session.append()` 在 `packages/core/session/src/index.ts` 固定以 `Date.now()` 生成事件时间，因此两个工具事件的时间差通常只有几毫秒，而不是真实执行耗时。

真实会话对照：

- Kimi 第 90 轮：48 次调用，原始 wire 的执行区间并集为 1.579 秒，Context Lens 显示 0.1 秒；
- Claude Code：51 次调用的原始起止时间累计 58.620 秒，宿主镜像 `toolMs` 为 5ms；
- Codex：两次调用在 rollout 中分别为 489ms、63ms，宿主镜像 `toolMs` 合计 1ms。

这不仅影响 Context Lens。`session/session-stats/src/projection.ts` 同样按 `tool/call → tool/result` 的 envelope 时间差累计 `toolMs`，所以宿主统计也失真。

## 建议的契约

在 `SessionEventMap['tool/result']` 增加可选字段，例如：

```ts
execution?: {
  /** Epoch milliseconds when the tool actually started. */
  startedAt: number
  /** Epoch milliseconds when the tool finished. */
  endedAt: number
  /** `provider`: CLI/provider timestamp; `observed`: driver notification time. */
  source: 'provider' | 'observed'
}
```

语义要求：

1. **写入时间与执行时间分离。** 事件 envelope 的 `time` 继续表示日志追加时间，不改写、不回填；`execution` 只描述这次工具调用本身。
2. **完整区间才可被消费。** `startedAt` 与 `endedAt` 必须有限、非负且 `endedAt >= startedAt`；没有可靠起点或终点时省略字段，不用 0ms 冒充测量结果。
3. **原生与镜像共用。** 宿主原生工具在真正开始/结束执行时填充；local-agent 等外部驱动可以把自己掌握的真实区间写入同一字段。并行调用仍由消费者按区间去重或分摊，而不是由生产者预合计。
4. **消费者优先采用执行区间。** `sessionStats` 的 `toolMs`、Context Lens 及其他观测方优先使用 `execution`，缺失时保留现有 envelope 时间差作为旧日志回退。

只保存 `durationMs` 不足以替代该字段：时间线定位、跨请求归属及并行区间去重都需要绝对起止时间。

## 兼容性

字段可选，旧日志与未改造工具保持原行为。新读者必须对缺失字段回退，不应要求所有生产者同时升级。无需改变会话格式版本、事件顺序、步骤原子性或模型可见消息。

## 社区侧过渡方案与退役条件

社区已在 `tool/result.meta.localAgentTiming` 写入版本化的同类区间，并由 Context Lens 的实时与回填通道优先读取；宿主自身 `sessionStats.toolMs` 暂未改变。该方案只使用现有 `meta`，不需要上游改动。

上游落地后按以下顺序退役：

1. 三家 local-agent provider 改为写标准 `execution`（可在一个兼容窗口内双写）；
2. Context Lens 优先读标准字段，`meta` 降为旧版本回退；
3. `sessionStats` 使用同一标准字段，验证原生与外部工具两种路径；
4. 停止写 `meta.localAgentTiming`，删除专用构造与文档中的绕行登记（S23），旧数据读取回退可继续保留一个兼容周期。

## 宿主升级时的能力核对清单

- `core/session` 的 `tool/result` 类型是否提供标准执行区间，且持久化往返保留；
- 原生工具执行路径是否实际产生该区间，或是否已公开供外部驱动填写的稳定字段；
- `session-stats` 是否优先按该区间累计 `toolMs`；
- 旧日志缺失字段时是否仍安全回退，且没有通过篡改 envelope `time` 实现兼容。
