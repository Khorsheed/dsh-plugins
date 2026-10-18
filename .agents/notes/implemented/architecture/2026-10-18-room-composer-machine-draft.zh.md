# Agent Note: the room composer's draft lives in the official input machine

Status: implemented

[English](2026-10-18-room-composer-machine-draft.md) | 中文

## Problem

房间作曲器接管（`conversation.composer` 链式槽位，优先级 -10）把草稿存在组件本地 `useState` 里，而其它所有作曲器表面——以及所有外部草稿写入方——都对接会话的官方 input machine。由此产生三个可观测缺陷：

1. **引用插件在房间里看似失效。**「引用到当前会话」写的是机器草稿（`input.setDraft`），写入确实成功——但渲染那份草稿的只有 display:none 的官方回退输入条，用户看不到任何反应。文本并没有丢：它会在接管失效的瞬间（审批弹窗、首次拉取窗口期）突然冒出来，读起来像第二个 bug。
2. **房间草稿易失。**离开会话再回来会重挂组件，写到一半的文本丢失；官方输入条的草稿在同样的导航下由机器持久化存活。
3. **选举窗口期搁浅文本。**首次拉取缓存未命中时显示的是官方输入条；在那里打的字在接管当选后不可见。

## Decision

接管的草稿存储就是官方 input machine：`RoomComposer` 通过 `useInput(s => s.draft)` 读、`inputActions.setDraft(...)` 写——两者都是每个 `conversation.composer` 链式槽位当选组件天然收到的会话标准套件成员（`SessionStandardProps`，宿主 ≥0.1.5）。组件自己的 `useState` 草稿已删除。

**发送路径不变**：每条消息——包括裸文本——都走房间自己的 `remote.room.postMessage` 派发（宿主把裸文本路由给当前协调者），`inputActions.submit()` 永不调用。机器的忙碌准入会在协调者运行中把消息入队，把派发引擎刻意并行执行的东西串行化（见[房间路由台账笔记](2026-09-15-room-routing-journal.md)）。发送成功后清空机器草稿，并尽力调用 `persistDraft?.()`（0.2.1+，结构化探测），因为绕过机器自身 submit 也就跳过了它的提交时落盘。

机器里的引用 chip（quote 的 chip 路径及其它触发源）在这个纯 textarea 里投影为其剪贴板文本；在那里编辑会经由 `setDraft` 把 chip 摊平回文本——这是 chip 表面在房间侧被接受的降级。

同一改动顺带修正了两处仍在描述 2026-09-15 之前"裸消息释放给官方提交路径"设计的过时注释（`RoomComposer.tsx` 头注、`slots.ts` 的 `RoomComposerInjected.submit`）。

## Alternatives considered

- **`roomComposer` 服务 + pending-insert 缓冲，quote 探测**（原方案）：否决——它保留两套并行的草稿真相（缓冲与机器），让 quote 长出房间专属代码，且房间草稿依旧易失。机器绑定用更少的代码修好全部三个缺陷。
- **完全统一作曲器**（room 渲染官方 InputBar；发送走官方 submit，经 `agent/pre-step` 在宿主侧重路由，成员扇出通过观察 `session/event` 实现）：已验证在已发布的 0.2.x 线上零宿主改动可行，但本次否决——机器的忙碌准入会把今天并行的 @派发串行化；房间发送路径不接收附件（pre-step 守卫对非文本块硬报错）；native 协调者的 prompt envelope 需要重新注入。若真要做，是一个独立的路由重构，而不是引用修复。
- **不动，quote 特判房间**：否决——草稿状态被复制，且持久化/选举窗口缺陷原样保留。

## Consequences

- quote（及任何其它机器草稿写入方）在房间里零房间专属代码生效；房间作曲器与隐藏的回退输入条共享一份草稿，选举窗口期的携带随之而来。
- 房间草稿经由机器自身的持久化跨导航、跨重载存活——用户会注意到的行为变化（此前会丢）。
- `RoomComposer` 现在硬依赖链式槽位的会话标准套件（`useInput`/`inputActions`）——所有在范围内的宿主线上都存在（2026-09-15 之前的设计就已经消费它们），`minHost` 不动。
- 作曲器测试台改为伪造有状态的输入机（快照 store + 响应式 `useInput`）；断言从"setDraft 从未调用"翻转为"submit 从未调用、setDraft 最后一次以 '' 调用"，并新增两个钉：外部写入（引用路径）与重挂后草稿存活。`pnpm --filter @khorsheed/dsh-room run build && pnpm --filter @khorsheed/dsh-room test` 全绿（315 个测试）。
