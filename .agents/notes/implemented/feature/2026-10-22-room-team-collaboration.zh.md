# Agent Note: Room team collaboration — lean member prompts and honest removal

Status: implemented

## Problem

room 给成员的提示词是一条用户消息，什么都往里堆：角色指令、每次派发都带的房间目标，以及只要有人加入、改名或改角色就整段重发的成员名册。名册把其他成员角色指令的第一行当成「职责」；协调者写的指令通常只有一段，于是成员会读到别人的整段简报（「被要求打招呼时……」），像是在给自己下指令。名册还在教「回复末尾独占一行 `@名字 <内容>`、需房间主人确认」的协议，而每个 provider 其实都已经挂了 `member_message` 桥工具。另外，移除成员用的是浏览器原生 `confirm`，文案说「其运行将被中断」，但 `removeMember` 只记一条 `room/member-removed`：运行中的成员继续跑，排队的活还在排队，等它回报的协调者会一直等下去。

## Decision

按负责人 2026-10-22 批准的计划分步交付（团队视图、成员自由通信、preset 与权限在同一条线的后续提交里）。

**提示词瘦身。** 成员的「第一次」派发以一段【房间简报】开头：它的名字和公开职责、它自己的私有指令、房间目标、其他成员（名字 + 公开职责 + provider，绝不带他们的指令），以及工具约定（CLI 成员用 `member_message`，房间自己的 agent 用 `room_message`，看实时名册用 `room_read`；回复里写 `@名字` 不会转交给任何人）。协调者职责随简报或交接说明一次，不再每次派发都带。之后每次派发只带它上次以来的变化：指令改动、协调者交接，以及 `roomChangesSince` 产出的一行行【房间变动】（加入及其职责/provider、离开、改名、职责变化、目标变化）。目标不再每次都带。行尾 `@名字` 的兜底解析整个删除：已经没有地方教它，回复末尾的普通提及也不该变成转交。

**公开职责。** `role`（≤ 30 字，`ROOM_ROLE_MAX`，超长返回 `role-too-long`）加入邀请请求、`room/member-added`、`room/member-updated`（null 为清除）、`room_invite` 工具以及 local-agent 桥的 `room_invite` schema。卡片以标签显示它；对话框把指令标为「只给它自己」。

**移除。** `removeMember` 现在真的按确认层说的做，顺序是：用现有 `cancel` 停掉运行中的一轮；取消排队中的投递（`room/delivery-state` cancelled）；未完成的看板任务关闭为已取消，或经新增的 `room/task-edited.member` 把待开始的任务转给 `transferPendingTo`；离开名册；再把每条被取消的投递报告给等它的人（`DispatchEngine.reportOutcome` 改为公开；已移除的发送方从它最后一条 `room/member-added` 取名字）。返回 `RoomRemoval` 摘要。`restoreMember` 以原 id、职责、指令和子会话重新加入，记忆延续；被取消的活保持取消，引擎会跳过排队期间已结算的投递，撤销不会让它复活。客户端用卡片内的确认层（`RemoveMemberConfirm`）取代 `window.confirm`：按 room 状态列出实际后果（`removalImpact`），可选待开始任务的接手人，默认焦点在「取消」，Esc 和点外部关闭，当前协调者给出说明而不是失败，移除后显示 5 秒撤销条并写明做了什么。`RoomDelivery` 增加 `replyTo`，客户端据此说出谁在等。

## Alternatives considered

**名册变化时照旧重发，只是精简一下。** 不采用：成员自己的会话已经保存了它看过的名册；增量更省，读起来也像新消息，要看全貌的调 `room_read`。

**为没有桥的 provider 保留行尾 `@名字` 兜底。** 不采用：四个 provider 都有桥，而这个解析会把回复末尾的普通提及变成转交。

**按 provider 把简报放进会话级系统提示词。** 暂缓而非否决：首次派发的简报已经消除重复，不用动四个 provider；改用 `--append-system-prompt` 等通道是之后可单独做的改进。

**确认层承诺「回收常驻进程」。** 删掉：门面没有回收入口，常驻运行时本来就按空闲超时回收，所以确认层不写这一条。

## Consequences

- 暂停中的云端协作线（`codex/room-*` 分支）也改了 `assemblePrompt`（每轮加【本轮来源】）和邀请对话框；负责人决定本地这条线先合入，那条线之后基于它适配。它的来源标签可以自然地映射到下一步的消息信封。
- 旧日志照常回放：没有 `role` 即视为无职责；旧房间只是不再重发名册。
- 测试覆盖：简报内容（不含他人指令）、之后的提示只带增量、职责校验、以 `@名字` 结尾的回复仍是普通发言、`roomChangesSince`、移除忙碌成员（停止、取消排队、报告协调者、转交任务）及撤销，以及确认层的后果、协调者和键盘路径。
