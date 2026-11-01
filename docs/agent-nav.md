# 模型动作 → 侧栏去向：统一契约

本文回答一个问题：**模型新建或写入了用户看得见的东西之后，用户怎么到那个位置去**。学习、游戏、剪辑、写作、协作间等所有带侧栏的模式插件都按此执行，不要各自发明「自动打开」的判据或私有的跳转通道。

来源：提案 agent-sidebar-navigation（2026-10-30，用户逐条拍板）。共享实现：`packages/client-ui-agent-nav`（源码面库，各插件打包时内联）。

## 三件事，各只有一种做法

| 层 | 唯一做法 | 不要再做 |
|---|---|---|
| 地址 | 每个面板的每个用户可见位置有一个类型化地址（面板的 `navigation.params` 类型，`SidebarRightTabParamsMap` 里声明）；外部只经由它进入 | 模块级全局（`parkedNav`、`requestPanelProject`）、全页单槽（`RevealedProject`）、从外面直写面板内部 store |
| 信号 | 写入类工具在回答末尾加**一行**去向：`⟦dsh-nav⟧{"id","kind","params","label"}` | 浏览器轮询「最近活动」决定跳转；用正则解析中文回答找位置 |
| 呈现 | 跟随器 `startNavFollower` + 唯一规则 `decideFollow`；会话里的卡片只放「查看 →」门 | 工具行自己 `sawRunning` 自动打开；每个包一份 `shouldFollow` |

### 去向行

```
已登记第 3 章《雨夜》（画布 canvas_x）plan：…
⟦dsh-nav⟧{"id":"canvas:canvas_x:chapter:3:plan:1730…","kind":"canvas","params":{"canvasId":"canvas_x","face":"manuscripts","item":"3","focus":"plan"},"label":"第 3 章《雨夜》"}
```

- `kind`：拥有这个位置的右栏 tab kind；`params`：该 kind 的地址；`id`：每次落地唯一（跟随器按 id 只处理一次，日志按 id 关联）；`label`：卡片上给人看的字。
- 为什么是一行文字：工具结果只有内容块，没有不进模型的旁路字段；自造会话事件类型在登记它的包卸载后会让整份历史打不开。一行文字在哪里都无害。
- 宿主侧（工具）不能在运行时 import 源码面库（宿主面不打包），所以各包用一个小的内联 `nav-line.ts` 写这一行，**测试里用 `readDestinations` 钉住格式**（见 `packages/canvas/tests/nav-line.spec.ts`）。
- 落点 = 刚做的那件事：建了第 3 章就是第 3 章，不是章节列表、不是项目页。
- 回答文字不要写「已在右栏打开」——工具执行时并不知道浏览器会不会跟。写「在画布『章节』页签的第 3 章（会话里有卡片直达）」。
- 房间里有桌面行（`room/desk-*`）把东西带进房间时，回答不带去向行（一个来源移动侧栏，不能两个）。

### 跟随规则（U2/U4/U7）

工具回答的去向行之外，跟随器也读各包自己的会话事件（`startNavFollower` 的 `events` 选项，如协作间的 `room/desk-*`）：同样只看实时追加的事件，同一条规则，带上这次是协调者还是成员做的。


`decideFollow` 依次检查，第一条不满足的给出原因：

| 顺序 | 条件 | 不满足时 |
|---|---|---|
| 1 | 这个 id 没处理过 | skip `seen` |
| 2 | 实时：调用的 `tool/call` 和结果都是事件窗口的 `append` | skip `replay`（翻历史、刷新、重连都不跳） |
| 3 | 结果属于屏幕上的会话 | badge `offscreen` |
| 4 | 房间里不是成员的写入 | badge `member` |
| 5 | 窗口宽 ≥ 820px | badge `narrow` |
| 6 | 20 秒内没在面板里操作（`interactionHandlers`） | badge `busy` |
| 7 | 本回合还没跳过 | badge `turn-once` |
| — | 全满足 | follow `watched` |

「实时」的判据来自宿主：会话事件窗口（`sessions.binding(id).eventSource`）把实时事件发布为 `append`，打开会话 / 重连 / 向前翻页发布为 `replace` / `prepend`。跟随器只看 `append`，所以不依赖工具行是否渲染（回合结束后宿主会把工具行折进「已调用工具」）。

badge 由各包决定样子（画布：标签条小点）。卡片永远在，点了就去。

### 日志与定位

每次判断一行：

```
[nav] dest=<id> kind=<kind> decision=follow|badge|skip reason=<原因> session=<会话>
```

「没跳到」时按顺序查：回答末尾有没有去向行 → 控制台有没有这条 `[nav]` → decision/reason 是什么 → 面板有没有按 params 落位。

## 接入一个模式插件

1. 面板：在 `SidebarRightTabParamsMap` 声明 kind 的地址类型；面板体读 `tab.navigation.params` + `revision`，每个 revision 应用一次。提供一个 `go(params)`（打开 tab + 落位），所有外部入口（卡片、桌面行、跟随器）都走它。
2. 工具：写入类工具回答末尾加去向行（内联 `nav-line.ts` + 钉格式的测试）。
3. 客户端：`startNavFollower(followerHostOf(ctx.get), { kinds, open: go, badge })`；面板根节点 `{...interactionHandlers}`。
4. 卡片：会话里的卡片只放门，门调用同一个 `go`。删掉卡片里的自动打开逻辑。
5. `package.json` devDependencies 加 `"@khorsheed/dsh-client-ui-agent-nav": "workspace:*"`，`scripts/check-plugin-independence.ts` 的 `ALLOWED_EDGES` 加这条边。

## 进度

| 包 | 状态 |
|---|---|
| canvas、canvas-novel | 已接入（P1）。章节一律落在「章节」页签里的第 N 章，独立章节页只做旧行转发 |
| library | 已接入（P2）。项目、书、路线（落到要「采用」的那本书）、讲义、测验、拍页各落确切位置；记卡片不跳（右栏「已记下」提示是入口）；5 秒揭示轮询和 `RevealedProject` 已删；站点页里用户点「开始 / 出题」后的等待保留（刚点过按钮按规则只会亮点，由它把人带进去，落点相同） |
| game | 已接入（P2）。`game_publish` 去掉 `show`，去向按版本改动推出（单个元素 / 元素列表 / 试玩；候选一律试玩）；`game_open` 落试玩；试玩运行中每 5 秒 `markInteraction`，视为面板忙（全页生效，也会挡住其他面板的自动跳）；不设小点（回合卡已列出改动）；旧的 820px 例外取消，统一按窄屏规则 |
| video-studio | 已接入（P2）。工程 / 素材 / 文稿里的提议组（滚动并闪烁）/ 导出 可寻址；去掉 `requestPanelProject`；单会话打开也跟随。没有标签小点、也没有会话卡片，跳不了时只靠回答文字 |
| room 桌面行 | 已接入（P3，11-01）。跟随由跟随器的 `events` 读各包自己的 `room/desk-*` 实时事件（`deskDestinationsOf`），同一条 `decideFollow` 带角色判定：协调者的打开跟随，成员的只亮点（画布：标签条小点）；画布协调者的「写了…」不动（写在房间已经显示的画布上）。四份 `shouldFollow` / 20 秒窗口已删，消息条只放门。画布「写了…」的门按 `deskWritePlace` 落位：写了章节到那一章正文，只动一张卡 / 一篇成稿到那一项，动了多张卡到「设定」并按下临时筛选「本轮改动」（`CanvasNavParams.cards`）；小说桌面条目带章号（旧事件从标题读） |
| reader | 已接入（P3），只给卡片：`reader_note`（结论 / 讨论）落到文章的「笔记」页签，`reader_translate` 落到文章正文；`'reader'` 地址 `{ entryId, tab? }`，面板每个 revision 应用一次；会话里这两个工具的行带「查看 →」；不启动跟随器 |
