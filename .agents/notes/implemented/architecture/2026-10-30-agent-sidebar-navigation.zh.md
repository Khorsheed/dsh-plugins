# Agent Note: 把人带到模型刚写的东西那里——一个契约

Status: implemented

## Problem

几个模式插件把人带到模型刚建或刚写的东西时，各有各的做法：

- **library**：每 5 秒轮询一次 `latestActivity`，打开的是项目页，每个会话、每次页面加载只做一次。
- **game**：在宿主内存里记一个揭示请求，浏览器每 6 秒轮询。
- **video**：只有在房间里才跟随。
- **canvas**：靠工具行打开画布，而且只有这一行自己看见调用在跑时才打开；位置是用正则解析中文回答得到的。
- **房间桌面行**：用四份拷贝的 `shouldFollow` 判断跟不跟。

去向经由五种私有通道传递：

- 模块全局变量（`parkedNav`、`requestPanelProject`）；
- 一次性的类（`RevealedProject`）；
- 直写面板的 store；
- 宿主侧重新绑定；
- 类型化的 `navigation.params`（只有 room 在用）。

能表达的位置也偏粗：一个项目、一块画布、一个独立的章节页。用户看到的症状是：「创建了某一章，却没有跳到那一章，而是到了章节详情页。」

canvas-novel 里这个症状有四个原因：

- 只写正文、或不带计划新建一章时，侧栏什么都不开，回答却告诉模型「正文在右栏章节页能读」。
- 写计划时打开的是独立的 `novel:chapter` 页，不是「章节」页签；「章节」页签当前读到哪一章是组件局部状态，外部无法寻址。
- 房间里，桌面条目不带章号，它的门只能退回 `openCanvas`，停在这一行上次停的地方。
- 在章节页里翻到别的章之后，再用同一个参数打开不生效，因为 `samePlace` 提前返回了。

用户在 2026-10-30 定下了规则（提案 agent-sidebar-navigation，存在本地 `proposals/active/`）。

## Decision

**每一层都只有一种做法。** 契约写在 `docs/agent-nav.md`。共享代码是源码面库 `packages/client-ui-agent-nav`，内联进各插件的客户端包，没有运行时耦合，并像 ui-panel-kit 一样在 `check:plugins` 里列入名单。

- **地址。** 面板里的每个位置都是类型化的 navigation params（`SidebarRightTabParamsMap`）。每个面板只有一个 `go(params)`，所有从外面进来的路都走它。
  - 画布声明 `'canvas': CanvasNavParams` = `{ canvasId, card?, manuscript?, type?, face?, scope?, item?, focus?, heading? }`。
  - `client/index.ts` 里的 `goTo` 按最具体的字段落位标签条；`go` 先打开页签，再调用 `goTo`。
  - 现有的门都改成调用 `go`：类型提议、canvas_open 行、桌面行、收件箱、绑定标签，以及 `canvasNav.go/openFace/openPage`。
  - 页签本体每个导航 revision 应用一次 `tab.navigation.params`。
  - `openBoardFace` 带上 `item`/`focus`；画布把 `manuscripts` 的请求以 `target` 交给体裁的成稿挂载位。
- **信号。** 写入类工具在回答末尾加一行：

  ```
  ⟦dsh-nav⟧{"id","kind","params","label"}
  ```

  - 工具结果只有内容块，这一行是能到达浏览器的唯一通道。如果改用自造的会话事件类型，登记它的包一卸载，带这种事件的历史就打不开。
  - 宿主侧不打包，所以各包用一个小的内联 `src/nav-line.ts` 来写这一行，并用测试把它钉在库的 `readDestinations` 上。
  - 去向就是刚写的那件事：
    - `canvas_write`：前后对比只改了一张卡或一篇成稿，就指向它；否则指向卡板；归档不写去向。
    - `canvas_open`：指向这块画布。
    - `canvas_propose_type`：指向类型页。
    - `novel_write`：章节（计划、仅新建、正文）为 `{ face: 'manuscripts', item: N, focus: 'plan' | 'body' }`，大纲为 `{ face: 'lead' }`。
    - `novel_extract`：`{ face: 'board', scope: 'recent' }`。
  - 回答不再声称「已在右栏打开」，而是写东西在哪（「在画布『章节』页签的第 N 章（会话里有卡片直达）」）。
  - 带房间桌面标记的调用不写这一行：画布按 `deskOf` 判断，canvas-novel 在 `told()` 里删掉。房间里仍然只由桌面行移动侧栏。
- **呈现。** `startNavFollower` 订阅屏幕上那个会话（`sidebarRight.mounted`）的事件窗口（`sessions.binding(id).eventSource`），只用一条规则 `decideFollow`。
  - 宿主把实时事件发布为 `append`，把打开会话、重连、往前翻页发布为 `replace` / `prepend`。所以跟随器只处理以 `append` 到达的 `tool/result`，而且它对应的 `tool/call` 也要是以 `append` 到达的。
  - 依次检查：
    - 处理过 → skip；
    - 回放 → skip；
    - 不在屏幕上 → badge；
    - 房间成员的写入 → badge；
    - 窗口窄于 820px → badge；
    - 20 秒内操作过面板（面板根节点挂 `interactionHandlers`）→ badge；
    - 本回合已经移动过侧栏 → badge；
    - 都不是 → follow。
  - 各内联副本之间要共享的状态（处理过的 id、已移动侧栏的回合、上次操作时间）放在 `globalThis` 上的同一个注册表里。
  - 每次判断都打一行 `[nav] dest=… kind=… decision=… reason=… session=…`。
  - 在画布里，follow 就是调用 `go`，badge 就是 `addCanvas`（标签条上的小点）。
  - 会话里的卡片只放门，不再自己打开：`OpenCanvasRow`、`PlanCard`、`OutlineCard`、`BodyCard`、`ExtractCard`、回合尾都去掉了 `sawRunning` 自动打开。行模型展示时会删掉去向行。
- **一章只有一个位置。** 「章节」页签的 `ChapterBook` 接收 `target`，把阅读器打开在第 N 章；要求看计划时聚焦到计划。
  - 每个请求在一次页面加载里只应用一次：页签每次切换都会重新挂载，而画布会保留最后一个请求，所以用一张以画布为键的模块级表来记。
  - 面板内的章节链接（故事日志、规划视图）改为 `navigate.openManuscripts(item)`。
  - `novel:chapter` 页仍然注册，只用来把旧的标签条行转发过来。

## Alternatives considered

**加一个由模型调用的 `open_panel` / `game_show` 工具。** game 试过：两个来源争着移动面板，而且模型常常忘了调用（笔记 2026-10-27-game-autonav）。写东西的那个工具最清楚东西在哪。

**保留轮询，只共享 helper。** 轮询状态在宿主内存里：重启就丢、无法回放、事后也看不到，「没跳过去」难定位正是因为这个。而事件窗口本身就分得清实时和回放。

**由看见调用在跑的工具行来跟随。** 宿主会把跑完的行折进「已调用工具」，也可能只渲染已结束的行，于是跳转会悄悄失效。事件窗口不依赖渲染。

**每个去向登记一个会话事件。** 在线路上更干净，但登记它的包一卸载，所有带这种事件的历史都打不开（记忆：会话事件类型必须登记）。

**保留独立章节页，只修章号。** 这样一章仍有两个位置，用户选了「章节」页签（决定 2）。

**让每个写入工具都接受模型自选的 `show`。** 用户否决（决定 3）：去向由改动推出。game 的 `show` 在 game 接入契约时去掉。

**只写约定、不共享代码。** 跟随规则已经在四份拷贝之间各改各的了。细节多的规则（回放、正在操作、窄屏、每回合一次）只写一次、测一次。

**放进 ui-panel-kit。** panel-kit 只放视觉组件。行为逻辑单独成库，测试和回滚都独立。

## Consequences

- 每次判断都有一行 `[nav]` 日志。「没打开」时依次查：回答最后一行、控制台那一行、decision 和 reason、面板有没有应用 params。
- 每次写入，模型多读一小段 JSON（约 60 token）。没装跟随器时什么都不读；没有这一行的旧历史照样保留门（行模型仍然解析回答文字）。
- 只有用户在屏幕上那个会话里看着调用完成时，才会跟随。后台标签页里的写入、回合中途的重连，都只留卡片和小点，这是有意的。
- 去掉了：画布各行的自动打开，以及小说卡片自动打开独立章节页和「规划」。卡片和回合尾保留门。
- 测试：
  - 规则的机制由 `packages/client-ui-agent-nav/tests` 钉住；
  - 去向行格式由 `packages/canvas/tests/nav-line.spec.ts`、`packages/canvas-novel/tests/nav-line.spec.ts` 钉住；
  - 落点由 `packages/canvas/tests/tools.spec.ts`（「where a canvas write landed」）和 `packages/canvas-novel/tests/tools.spec.ts` 钉住。
- **尚未迁移。** 以下各包在接入契约之前，仍然用各自的通道（docs/agent-nav.md 里的 P2/P3）：
  - library：`latestActivity` 揭示，落在项目一级；
  - game：`liveVersion.show` 轮询、`show`；
  - video-studio：`requestPanelProject`；
  - 房间桌面行：四份 `shouldFollow`，小说桌面条目不带章号；
  - reader：只给卡片。
