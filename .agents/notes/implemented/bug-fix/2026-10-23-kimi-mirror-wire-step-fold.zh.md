# Agent Note: kimi 镜像按 wire step 折叠——一次 LLM 请求折成一个 dsh step

Status: implemented

## Problem

kimi 子会话把每个 wire part 显示成独立的请求记录：思考 fold 没有 usage、耗时 0.0s，一轮读作两条记录（先是光秃秃的 `#1 · —`，昨天修复后是 `#1 · 思考`，再是正文）。Context Lens 的标签修复（见 [usage 桶 note](2026-10-23-context-lens-usage-buckets-and-no-usage-rows.md)）让这行记录不再撒谎，但形态仍然不对——一次 LLM 请求，两条记录。

读真实 wire(tests/fixtures/two-round-resume.wire.jsonl）证明拆分是我们自己做的，不是 kimi 传的：一个 wire step——由 `step.begin`/`step.end` 包裹、一条 `llm.request` 发起、一条 `usage.record` 记账——同时携带 think part、text part 与工具调用。是我们的 transcript 读取器把每个 part 拆成行、镜像再逐行折叠。宿主自己的会话每次 LLM 调用写一条 `assistant/message`(`[reasoning, text, tool-call…]` 块加该次调用的 usage)——kimi 子会话现在与之同形。

## Decision

**镜像的折叠粒度是 wire step。** 一个 wire step 折成一个 dsh step:assistant 消息同时携带 reasoning、回复文本与 tool-call 块，tool/call + tool/result 对跟在同一边界内，该 step 自己的 `usage.record` 挂在这条消息上。

- transcript 读取器给内容/工具行打上 wire 自己的 `step` 号（`wireStep`)，并记录 wire 已闭合的 step(`closedSteps`，来自 `step.end`)。无标记的行（旧 wire）逐行折叠，行为不变。
- 增量 pass 挂起还可能增长的单元：未闭合的 wire step，或结果未记录的tool 调用。offset 停在它之前；settle pass 把余下部分以中断占位收尾。
- usage 跨 pass 仍然恰好一次，但按单元挂载：带 step 标记的单元认领自己行区间内的 record；无标记区间与边界竞态的 record 汇总挂到本 pass 最后一条折叠的内容单元——打标记之前的旧形态。
- live driver 的 stream 账本按 fold 配对而非按行：`completeStreams(turn, kinds)` 一次性消费该轮在飞的 think/text 流，fold 落在最早被消费的预约坐标，其余被消费的预约随之释放，供后续 fold 复用。工具预约只释放不落盘（组的 step 承载完整生命周期）。
- 所有落盘写入——fold、gap fill、settle 收尾——都取当前无人占用的最小 step(first-free，不再是 max+1)，被释放的坐标绝不留下空洞；`finalizeBefore` 仍在 fold 落笔前把低于目标的开放预约按各自预约坐标先行封口。released-log 读取端要求的稠密顺序契约由构造保证，并在测试中回放验证。

## Alternatives considered

- **在 Context Lens 读取侧合并**（把纯思考 fold 与同轮后一条 fold 合并显示）。日志里仍是两条消息，lens 还得在其上再叠一层推断出来的编号——而子会话的其他消费方看到的仍是拆分形态。在源头折对，消除的是分歧本身，而不是补偿它。
- **启发式配对 think 与 text**（压住 think fold 等 text 行）。不需要 wire step 标记也能工作，但 wire 本就权威地声明了边界（`step.begin`/`step.end`)——启发式恰恰在 wire 最清楚的地方配错（回复只有工具的 step、被中断的纯思考 step)。
- **标签修复后维持逐行折叠。** 行是诚实了，但请求数、耗时与用量仍拆在两条记录里——每个 kimi 轮次读起来都像发了两次模型调用，而它没发。

## Consequences

- kimi 子会话读起来与主会话一致：一次 LLM 调用一条请求记录，思考是响应内的一个块，逐请求用量挂在自己的消息上。Context Lens 不需要任何 kimi 特例。
- 增量落盘以 wire step 为粒度：未闭合 step 的内容在 step 闭合时持久化，不再随 part 到达即落。实时渲染不受影响——ACP 增量仍走 `local-agent/stream` 通道。
- 跨本次升级镜像的会话可能把一个组拆一次：旧 offset 停在某 step 的 think 与 text 之间时，续镜像会把该组折成纯 text。只在升级时在飞的运行上发生一次。
- plan 流与 settle 时的孤儿收尾仍产生独立的纯思考 step——那是真正无处依附的内容，独立的「思考」汇总保持其意义。
- claude-code/codex 镜像维持按 kind 拆分的现状（一轮带思考时同样是两条记录）；按响应聚合是它们各自 wire 形态上的同类跟进，本次未做。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test`(22 个文件，284 个测试）：新增覆盖——聚合折叠（think+回复+工具同 step 并带其 usage)、未闭合 step 的挂起与闭合后整步落盘、工具结果缺失的整组挂起与 settle 中断收尾、wire step/闭合 step 解析、live driver 单 durable step 配对且被释放预约不留痕——全部经 `expectValidReleasedLog` 回放；真实 fixture 的 resume 用例现在断言逐 step 用量与聚合消息形态。
