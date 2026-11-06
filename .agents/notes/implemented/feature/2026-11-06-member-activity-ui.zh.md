# Agent Note: 成员后台活动：房间托盘、成员页一行与会话卡片

Status: implemented

## Problem

设计 `2026-11-06-member-self-started-rounds.md` 的 M2 步（在 `proposals/active/` 下，不进仓库）。用户 2026-11-06 决定全部按建议。Kimi 成员可以把命令放到后台跑，然后结束这一轮。房间里此前完全看不到：没有计数，没有列表，成员自己的会话里也没有。核心读取在 M1 已经落地（`memberBackgroundTasks`，见 `2026-11-06-member-activity-core-types`），但还没有调用方。

界面以交互稿 `proposals/prototypes/member-activity.html` 为准。本步覆盖其中的状态 1–3（胶囊、托盘、失去联系）、8–9 与 15（后台命令卡片、展开、失去联系）、16（不支持的成员），以及成员页那一行。

## Decision

**一个纯状态模块** `packages/room/src/client/member-activity-view.ts`，后台命令和以后的后台子智能体共用。

- 五种状态：运行中、完成、失败、失去联系、已取消。Kimi 的 `timed-out` 归为失败（胶囊写「超时」），`stopped` 归为已取消。
- `activityGroups` 组托盘：按名册顺序每个成员一组，带它的任务和进程保留时间。进程保留时间只在进程还在时显示。
- `activityStrip` 给胶囊用：数在跑的；有失去联系的就变警示色。只有刚结束的任务时不出胶囊。
- `memberActivityLine` 给成员页那一行用：数在跑的命令和在跑的后台子智能体，或者显示失去联系的个数。
- `sessionActivityItems` 给某一轮的命令卡片用。
- `dispatcherOf` 只凭房间自己的记录说出是谁启动的：任务的 `startedBy` 执行 → 房间的执行记录 → 那次投递 → 你，或发出那次投递的成员。缺一环就不写名字。
- harness 答 `supported: false`、会话不是成员、读取失败或没有读取，一律什么都不显示。房间里永远不出现「0」。

**组件**（`MemberActivity.tsx`）：

- `ActivityCapsule` 放在任务胶囊那一排：「◔ 后台 N」，或者警示色的「⚠ 后台 · N 失去联系」。
- `ActivityTray` 在这一排上方展开。每项写状态胶囊、用时、由谁启动；失去联系的写我们确知的事实。每项只有一个跳转：查看输出、打开、查看或去看。托盘只跳转，不停止也不重跑。
- `MemberActivityLine` 是成员页那一行，放在成员卡片的头部下面，弹窗预览里不出现。
- `ActivityCardShell` 是共用的卡片外壳：图标、类型、说明、状态与用时、动作，可选的一行 `now`，以及展开后的内容。`CommandCard` 是后台命令对它的使用：那一行显示最后一行输出；展开后显示命令、最后几行输出、开始时间、由谁启动、进程最晚保留到几点。任务结束后，退出码代替用时。

**数据与轮询。**

- `MemberActivityStore` 在房间客户端里只建一个。它读 local-agent 的 `memberBackgroundTasks`，走和其他家族读取一样的鸭子类型网关探测。
- 每个成员会话沿用房间已有的 4 秒间隔轮询，而且只在有界面显示这个成员时才轮询。这些界面是：输入框、成员页签、含 `Bash` 调用的那一轮的尾部。
- 读到 null 或 `supported: false` 就停掉这个成员的轮询。没有家族或没有这个读取时，什么都不渲染，也不发出任何请求。
- 不涉及宿主重启，也不加新事件类型。

**会话卡片放在哪。** 卡片放在发起调用的那一轮的 `conversation.chat.turnTail` 里，不替换工具行。

- 一个小的 Conversation Definition（`room/activity-calls`）把每一轮的 `Bash` 调用 id 记成 Turn 数据。
- 尾部条目拿这些 id 去匹配任务的 `callId`。
- 托盘的跳转会打开成员会话。`ActivityReveals` 负责交接：被点名的卡片自己滚进视野；如果点的是「查看输出」或「查看」，还会展开卡片。

**核心改动（只加可选字段）。** `LocalAgentBackgroundTask` 加 `callId?` 和 `outputTail?`。

- Kimi 读取器本来就为了 `startedBy` 解析出了调用 id，现在把它一并返回。
- 它最多读任务自己的 `tasks/<id>/output.log` 的最后 4 KiB，保留最后 6 行非空行。被截断的第一行丢掉；回车重绘只保留最后一帧。
- `live-driver.ts` 没有改动。

## Alternatives considered

**替换 `Bash` 工具行（`tool.call.toolview`，键 `Bash`）。** 这样卡片能正好落在调用的位置。可是这个槽位按工具名做键：占了 `Bash`，也就占了所有 Kimi 和 Claude Code 成员前台的 Bash 行，而宿主的通用行没法委托回去。一轮结束后工具行会折叠起来，卡片放在折叠里，偏偏在最需要看的时候被藏住。放在轮次尾部，卡片就一直留在发起它的那条回复下面。

**单独加一个读输出的 Remote。** 每张展开的卡片再调一次 `memberBackgroundTaskOutput`，只为几行文字就多一个接缝。在列表里带一个有上限的尾部，每次轮询每个任务只多一次小读取，而且只在有界面跟着这个成员时才读。

**把那一行放到团队图（TeamView）上。** 交互稿里，这一行在成员页的那张卡上：头像、名字、角色、provider、状态。这张卡就是成员页签里的 `MemberCard`。编辑弹窗和卡片上的配置部分不变。

## Consequences

- 和交互稿的出入：
  - 卡片在发起它的那一轮的尾部，不在工具行上。那一轮还在跑时没有卡片，等这一轮结束后才出现。
  - 「去看」打开成员会话、定位到这个任务的卡片，而不是定位到「拿到结果的那条回复」。房间要到 M5 才显示自开轮，所以「结果在 HH:MM 那条回复」只在房间有那次执行的记录时出现。
  - 后台子智能体会进托盘和计数，但还没有会话卡片。那张卡片归 CLI 子智能体设计，届时复用 `ActivityCardShell`。
  - 托盘头部加了一个关闭按钮（×）。
- 派活人的名字和进程保留时间依赖 M3/M5 才填上的事实（`keepAliveUntil`，以及 `resultIn` 对应到房间里的某次执行）。在那之前，这两部分不显示。
- 直接从链接打开的成员会话，要等它所在的房间被拉进房间缓存（`RoomStore.memberRoom`）之后，才写得出派活人。
- 聊天列表可能没有挂载长会话里很靠上的卡片。这时跳转只打开会话。

## Testing

- `packages/room/tests/member-activity.client.spec.tsx`（26 个用例）覆盖：
  - 状态映射；不支持、null、没读到时一律不显示；
  - 胶囊在跑与失去联系；空闲或不支持时没有胶囊；
  - 分组与进程保留时间；
  - 派活人的事实链；
  - 成员页那一行：计数、失去联系、不显示、英文；
  - 用时与时长拆分；每项只有一个跳转；
  - 托盘：在跑、已结束、失去联系，失去联系的措辞里没有「已终止」；胶囊那一排能打开和收起托盘；
  - 命令卡片：在跑、展开、结束后显示退出码、失去联系、从托盘跳来时展开；
  - Turn 数据定义与轮次尾部：不支持的成员没有卡片，没有 `Bash` 的那一轮完全不读；
  - store 的 4 秒轮询、取消订阅、读到不支持或不是成员时停止轮询。
- `packages/local-agent-kimi/tests/background-tasks.spec.ts` 覆盖 `callId`（来自状态文件，也来自 wire）和输出尾部（最后几行、进度重绘、被截断的第一行、空文件、agent 任务没有尾部）。
- 预览页 `packages/room/tests/preview/activity.html?state=<strip|tray|lost|cmdrun|cmdout|cmdlost|unsupported|members>` 用真实组件加脚本化的读取渲染。在 1280 和 390、浅色和深色下截图，与交互稿对照过。
