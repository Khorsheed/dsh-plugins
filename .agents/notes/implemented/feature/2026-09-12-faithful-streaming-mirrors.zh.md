# Agent Note: 忠实流式镜像——全量折叠每个 item，增量以节流快照落日志

Status: implemented

## Problem

live 驱动的 token 粒度（"逐字流式"）是一种伪装成更高档位的降级：think/text 行从不折叠进子会话日志（`skipAssistantContent`——宿主 0.1.5 删除持久化逐 chunk 事件后的权宜之计），轮次进行中只有工具卡片可见，整轮文字在 settle 时才以**一条**合并消息落定。选"流式"的用户看到的反而比 event 档更少，日志也没有可供事后定位问题的忠实转写。真·逐 token 流式根本没有通道：durable `assistant/live-chunk` 插件写不了，瞬态 `agent/assistant-stream` 总线要求持有会话的 Agent 句柄——镜像会话永远没有。

## Decision

当前通道：已安装 core 提供能力时，provider 使用[共用瞬时输出通道](../architecture/2026-09-15-member-transient-output.zh.md)。下述快照设计保留为旧 core 兼容路径，原生最终折叠与 step 预留规则继续适用。

实时驱动现在 1:1 全量镜像每个 item（reasoning/text → `assistant/message`，工具 item → `tool/call`+`tool/result`）；`skipAssistantContent` 彻底删除。唯一实时路径在其上叠加增量层：item 流式期间，delta 累积成**节流的增量快照 `assistant/message`**（每 item 待发布更新默认最多合并 50ms，`snapshotMinIntervalMs` 可配；旧 `snapshotMinChars` 字段忽略），追加到该 item 预留的 `(turn, step)`。宿主 ui-chat 把同一坐标的重复 settle 折叠成一个实时更新的聊天节点（`settleMessage` 整体替换并立即发布——两条宿主线都核实存在），UI 呈现为一条持续增长的消息；item 完成的正式折叠落在同一坐标收尾，usage 由最终载体携带（最后一个非 tool 折叠行，或没有折叠行携带时由 settle 的最终快照携带）。

step 账本保证工具卡片的时间序：`reservedSteps` 永久记录每个流式预留 step（预留时 `step = lines.length + reservedSteps.length + 1`），顺序折叠跳过所有在它之前的预留值；逐 item 的 `streams` 状态（CLI 提供 itemId 时按 itemId——codex 的 app-server 有；kimi 的 ACP 与 claude 的 stream-json 用 per-kind 合成 key）把完成 item 配对到它的预留 step。完成 item 即使中途插进了别的流也折叠到自己的预留 step；切换 item 时补一条新鲜快照（文本未增长则跳过）；settle 在 turn 窗口内强制收尾所有未完成 stream（非 completed 带 interrupted，最后一条携带 usage）。同一坐标绝不写第二个 `step/start`（live assembler 对重复 start 抛错）——step 在首个快照时打开，在完成折叠或 settle 收尾时关闭。

core 共用 `LiveFlush` 调度器保留首个待发布更新的截止时间并合并后续更新；稀疏末段不再等下一个 delta 或字符门槛。最终折叠取消待执行定时器，轮次结束先释放调度器再收尾部分内容。这些快照仍走持久事件镜像；此步骤尚未证明 room 协调者提案的端到端 P95 或日志体积目标。

## Alternatives considered

- **旧的合并消息设计**——把所有 think/text 扣到 settle；可见性严格劣于 event 档，日志不忠实。整体替换而非修补。
- **发射 `agent/assistant-stream` 帧**——宿主原生瞬态通道能渲染真·逐 token，但它按持有会话 Agent 句柄的一方路由；镜像会话没有 Agent，为解锁它给每个子会话造 Agent 是远比快照大的结构改动。
- **每批快照一个独立 step**——会把几十条部分消息堆成一面墙，而不是一条增长中的消息；单坐标的重复 settle 合并正是聊天汇编器原生支持的形态。
- **delta 只走 run-progress（原状）**——`localAgent/run-progress` 今天没有 UI 消费者，delta 在那里不可见；快照把同样的文字放进了已有渲染的地方。

## Consequences

- event/token 运行时分支已退役。旧配置键与 driver setter 仅作兼容空操作，schema 默认 token；exec 保留。Claude 始终把 `--include-partial-messages` 放在成员桥可变参数 `--allowedTools` 的终止符前。Kimi 始终在轮次边界内对账，保留没有 wire 副本的部分输出。DSH 同样兼容旧配置键，并通过共用瞬时桥转发原生帧。

- 实时输出显示工具、reasoning 与文本，包括 item 内增长。子会话日志成为忠实转写（可事后定位问题），abort 轮保留带 interrupted 标记的部分文本。
- 快照使日志量上升（节流快照；长轮次多几十条事件）。`tokenUsage` 投影的 (turn, step) last-wins 去重保持记账精确。
- Claude 从 result 事件记录 usage；kimi 的中途 pass 丢 usage 由 `usageAttached` 窗口 + 余量累加器修复。
- 已知边界：已持有但未折叠的流式行与后续预留并存时坐标可能稀疏（预留公式双计——无害空洞）；kimi/claude 的 per-kind 合成 key 在同 kind 多 item 时共享一条流（它们的 wire 不带 item id）。
- `localAgent/run-progress` delta 通道仍无 UI 消费者——快照让显示不再依赖它；它留给程序化调用方。

## Testing

各 provider 的 token 粒度套件按新契约改写（节流快照以增长文本落在预留 step；每个流式 item 在各自 step 收尾、带 usage、无 interrupted；tool-first 轮保持时间序；无流式轮全量折叠；abort 轮收尾为 interrupted 快照）。codex 166、kimi 187、claude-code 154 全绿。

## Related

- [Local-agent 子会话镜像补写 step 边界](2026-09-12-local-agent-mirror-step-boundaries.md)——快照依赖的实时渲染契约。
- [委派子会话在工具路径上可 reattach，并显式持久化](2026-09-12-local-agent-child-session-durability.md)——快照经同一 sync 路径落盘。
