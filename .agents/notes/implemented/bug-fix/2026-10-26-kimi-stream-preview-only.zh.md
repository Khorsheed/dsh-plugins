# Agent Note：Kimi 的实时输出不进日志

状态：已实现

[English](2026-10-26-kimi-stream-preview-only.md) | 中文

## 问题

刷新页面后，Kimi CLI 成员已结束的一轮只剩折叠的「已完成，用时…」，最终回复也和过程一起被折进去了。Claude 和 Codex 成员没有这个问题。

Kimi 驱动用 `LiveStreamPublisher.update` 发布每一份实时快照。这个方法会在该流「预留」的 step 上写一条持久的 `local-agent/stream` 检查点，而那个 step 在日志里还没开始。真正的 `step/start → assistant/message → step/end` 三连要等折叠时才写。结果 step 29 的检查点可能落在 seq 64，比 step 2 的 `step/start`（seq 77）还早。

宿主重建位置索引（冷打开、刷新、向前分页）时，按每个 step 第一次出现的事件给一轮里的 step 排序，任何带 `turn`/`step` 的事件都算。于是 step 29 排到了最前，`turn.steps.at(-1)` 变成了 step 28，而 step 28 是一次工具调用。`latestAnswer`（ui-chat `turn-process.ts`）因此返回 null，整轮都被折叠。实时追加时 step 是按 `step/start` 排的，所以要等刷新后才会出错。我们用宿主的 assembler 在出问题的那份日志上复现过：带着这些早到的检查点时，最终回复为 null；去掉它们后就能找到最后一步。

## 决定

Kimi 改用 `preview` 发布实时快照，只推给浏览器，不写进日志。`live-stream.ts` 的注释写的就是这个约定，Claude 和 Codex 驱动本来也是这么做的。持久内容仍然是折叠时写入的原子三连；`finish` / `dispose` 本来就会清理 preview。

## 考虑过的方案

**等 step 能开始时再写检查点。** 没有采用：折叠时反正会写一遍内容，Kimi 从中途持久化里得不到任何好处。

**让宿主重建时只按 `step/start` 定位 step。** 做不了：宿主对我们只读，要改得走上游流程。

## 后果

- 一轮进行到一半时宿主重启，那些还没折叠的流不会再留下持久的半截内容。
- 已经按旧方式写入的日志里还留着那些检查点，刷新后仍会折叠。
- `nextKimiSessionStep` 会把 stream 事件算作已占用的 step。新日志不再写这些事件，所以这一点已经没有影响。
- 测试改为断言：实时快照按所在的 step 发到实时通道，日志里没有任何 `local-agent/stream` 事件。
