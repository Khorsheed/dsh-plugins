# Agent Note: Room 运行行原地隐藏——assembler 禁止 null 撤回

Status: implemented

[English](2026-08-19-room-run-hidden-not-withdrawn.md) | 中文

## Problem

一次真机报告：派发的 CLI 成员（ada）已经完全回复——`room/speech` 投影已出现在聊天流、子会话里能看到完整回复——但"ada 正在工作…"运行中行（`room-run`）始终不收敛、一直挂在界面上。重新加载 room 后该行消失，这把嫌疑从 journal（`done` 边已落盘，且与 `running` 边共享同一个 `startedAt` 折叠键）引向 client 的 live 路径。

根因在 assembler 契约而非 journal：`ConversationNodeAssembler.flush()` 的*增量*路径在某个 Definition 的 `buildViewNode` 对已物化的 context 返回 `null` 时会抛出 `conversation Definition "room-run" withdrew materialized target "chat"; return the same key with hidden visibility instead`。`roomRunDefinition.buildViewNode` 对 `done`/`cancelled` 正是这么做的。该异常在 `Notifier` 的 microtask/frame flush 中未被捕获地抛出（dirty 位已被清掉），而 assembler 自己的 dirty 集合停在循环中途——于是从终态边落达起，该会话聊天管线的每次 flush 都会重抛：运行中行被冻结，之后所有聊天更新同样被冻结。`replaceWindow`（打开/重同步/重载）没有这条规则，这正是重载能掩盖 bug、而修复前的单测（手工驱动 `buildViewNode` 并断言 `null`）反而把违约行为固化下来的原因。

## Decision

终态运行边把行**原地隐藏**：`roomRunDefinition.buildViewNode` 对 `done`/`cancelled` 返回同一个节点（同 key）但 `visibility: 'hidden'`，对 `running`/`failed` 保持 `visible`。`null` 只保留给无 state 的 context（从未物化——那里撤回合法）。共享的 `viewNode` helper 增加了 `visibility` 参数；chat 快照构建器本就会把 hidden 节点过滤出可见列表，因此渲染行为——settle 后行消失——不变。host 侧无需修复：引擎把同一个 `startedAt` 从 `running` 边一路穿到 `settle`，并新增了一条 host 回归测试钉住这个键上的 `running`→`done` 配对。

## Alternatives considered

- **继续返回 null，在上游接住 assembler 的异常**——否决：该 throw 是 host 刻意的契约强制（被撤回的节点会让增量视图构建器收不到移除信号），不是可以糊弄过去的意外；违约的 Definition 必须改为翻转 visibility。
- **改 assembler 容忍 null 撤回**——否决：那是我们跟踪但不修改的上游 harness 代码，且该契约的存在是为了让视图构建器无需全量重建即可对 upsert 做 diff。
- **用不同 key 物化一个 hidden 节点来顶替**——否决：`buildNode` 强制 `node.key === context.key`；唯一合法形态是同 key + `visibility: 'hidden'`。

## Consequences

- `RoomRunView` 自带的 done/cancelled 守卫现在永不触发（hidden 节点不会渲染），仅作为防御保留。
- client 测试套件新增一条驱动真实 `ConversationNodeAssembler` 的回归测试（`replaceWindow` 喂 running 边，live `append` done 边，`flush()`）：修复前抛出撤回错误，修复后行折叠为 hidden。手工驱动 Definition 的断言改为期望 hidden 节点而非 null。
- host 测试钉住了折叠键：一次运行的 `done` 边携带与其 `running` 边相同的 `startedAt`（client 的 `member:startedAt` 匹配 id）。
