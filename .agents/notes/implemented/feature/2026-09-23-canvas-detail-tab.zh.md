# Agent Note：卡片详情是 dock 里的一张标签

Status: implemented

## Problem

`proposals/active/2026-09-16-canvas-space.md` §11.2 第 7 行（阶段 ⑧）与 2026-09-22 那一轮的第 ① 条诉求要的是同一件事：点卡片进详情，新增也一样，不要在板面上就地改。M3 的钻取照字面做到了——`CanvasTab` 持一个 `drilled` 卡 id，在自己的页里于板面和详情之间翻转，顶上放一个「返回卡板」。

用起来付了三笔代价：

- **一次只能看一张。** 写作就是比对。要把两张卡摆在一起，读者只能开一张、读完、返回、再开另一张——而返回这一下把第一张的阅读位置丢掉了，因为滚动容器是板面页的。
- **tab 里又造了一个 tab。** 宿主右栏本来就是 dock（`PaneNode.tabs`、`openTab` / `openResource`、每会话记住布局）。把「换一张卡，还在原地」重新实现成页面状态，等于把 dock 最差的那几件复制了一份：没有第二张标签、宽度不能单独调、切视图还要拿板面状态陪葬。
- **草稿住在板面里。** 「＋新卡」把编辑器塞进板面页的 React 状态，于是这一页有了两个身份（列表 + 编辑器），任何板面操作都可能撞在一张写了一半的卡上。

这条 note 真正要记的问题比「用标签」更窄：**卡片详情是一页，还是一个资源？** dock 对资源按 `(kind, contentId)` 去重——那正是钻取缺的语义。

## Decision

**详情是本协议 `canvas` 类型下的一个资源。** tab kind 叫 `canvasDetail`，地址是 `dsh-resource://canvas/<canvasId>/<cardId>`（`src/client/detail/detail-address.ts`），一块画布的未存草稿占 `…/_draft` 这一条。整个阶段要的那个结果于是变成免费的：再点同一张卡只是聚焦已经在的那张标签，点两张卡就在同一 pane 里开两张，插件自己不再记任何标签账。

- **`_draft` 落在卡 id 语法之外是构造出来的，不是约定。** `CARD_SEGMENT` 照着 `makeBoardId('c', …)` 的形状（`c_` + 9 位 base36 时间 + base36 随机），一个不以 `c_` 开头的哨兵永远不可能被铸出来——所以没有哪张卡能拿到草稿的地址；并且这一段只是形状校验、从不查盘，地址因此能在不碰磁盘的情况下解析。
- **草稿的分类走 `navigation.params`，不进地址。** 一块画布只有一条草稿地址，这正是「＋新卡」菜单永远堆不出第二张空白草稿的原因：换一种分类再点，只是把 params 重发一遍、把开着的那张重新归件。（这里就是阶段 ⑤ 的目录与 dock 相接的那道缝——id 是板内字符串，客户端才允许把它带在 params 里。）
- **`openResource` 在 `dsh-resource://` 之外会抛。** 两个 face 成员（`openCardDetail`、`openCardDraft`）都把它包进 try/catch 并 `ctx.logger.warn`，于是一个没有挂载会话的座位点了也只是不响应，板面完好——而不是在点击里抛出异常。
- **`selectCard` / `clearCard` 删了，store 也交出 `cardId`。** `space/selection.ts` 现在只剩 `{ canvasId, rev }`：一张标签显示哪张卡是它自己的地址，不是板面的选中态。「先留着当兼容」是这个写法的另一个选项，也正是 AGENTS.md 禁的那个——没人读的成员就是没人维护的契约。
- **芯片上的活标题走 params，经 `sidebar.right.pane.tab.title` 这个 inject 槽。** 宿主只在打开那一刻捕获一次 `title`，之后从不刷新；而重开同一张卡会重发 params 并推 `revision`。所以 `CanvasDetailTitle` 渲染 `title · params.heading`，而 `revision` 一变就是重读这张卡的信号。标题在点击处算，也是这个原因。
- **标题规则只有一处。** `cardTitleOf`（`src/card-format.ts`）先取 html 的 `<title>`，取不到就用首行明文并截到 36 字符；`prompt.ts` 里那两份私有副本删掉了，芯片的 heading 也来自同一个函数——模型读到的字和芯片上的字不会再各说各话。
- **关闭走座位自己的 `tab.actions.close()`。** 顺手的写法是加一个 face 成员 `closeDetail(tabId: string)`，而它不可能成立：`TabId` 是带 brand 的类型（`ui-dockkit` 的 `Branded<'TabId'>`），`(tabId: string)` 永远满足不了 `ISidebarRight.close`。标签自己已经握着一个类型正确的关闭器，而且不需要动宿主。
- **两个 kind 共用同一个 `RegistrationToggle`。** 可见性判据讲的是「这个会话能不能触达画布工具」，而一块没有板面的详情标签谁都不该被递到。
- **每次重读板面都把自己的摘要折回切换器那一行。** `CanvasTab` 的加载 effect 现在会把 `summarizeBoard(board)` 写回刚读的那一行。这修掉了一个真 bug，是新座位把它暴露出来的：切换器上的卡数过去只在板面自己的写入时刷新，于是一张从详情标签（或被 agent 工具）加进去的卡，会让切换器一直报一个没人挣来的数字。
- **图片订阅归会画图的那张标签。** `useImageRev` 从板面（它不渲染图片）挪进 `CanvasDetailTab`，每张开着的标签各订一份——被 memo 掉的 `MarkdownText` 要的正是这个：字节到了得有新的对象身份才会重绘。
- **没解决、照实记**：芯片上那个 × 是这一页拦不住的第二个出口。`ISidebarRight.close` 只认 tab id、不提供拦截，所以手工关掉一张草稿标签会静默丢掉草稿。提案里把它记成这个阶段的唯一开口。

## Alternatives considered

- **保留钻取，另加一个「在第二张标签里打开」按钮。** 这个按钮得自己发明资源层已经白给的 `(kind, contentId)` 去重，而且板面页依旧背着两个身份。作为更差的那一份拷贝，否掉。
- **cardId 放 `navigation.params`，`canvasDetail` 仍是一页。** 否掉，理由最硬：params 不属于 `contentId`，宿主会把两张不同的卡折成一张——正好把这个阶段存在的意思弄没了。
- **每种分类一条草稿地址（`…/_draft-question`）。** 否掉：「＋新卡」菜单就会每点一种分类堆出一张空白标签，而这恰是地址模块 docblock 点名要防的「第二张空白草稿」。分类改走 params。
- **给草稿单立一个资源类型。** 否掉：草稿和卡是同一主体的两种状态，拆开只是把 `canOpen` 的语法劈成两半，没有好处。
- **靠重注册定义（或直接改 tab record）来刷新芯片标题。** 前者是每次点击一次全局副作用，后者伸手进别人的状态。`params` + 标题槽才是有文档的路，taskpilot 的任务芯片已经这么在做。
- **详情标签也上报 `focusCanvas`。** 否掉：focus 讲的是「这个会话的工具该打哪块画布」，而选这块画布的表面是板面。两个座位在不同手势上各报一次同一个画布，是工具开始和屏幕吵架的起点。
- **`selectCard` 留成空实现以求兼容。** 否掉——见决定里的对应条；包还在 0.4.x，所有消费者都在本仓库里。

## Consequences

- **板面页只剩「读 + 选」。** `CanvasTab` 不再 import 详情视图、丢弃确认 `Modal` 和 `newCard` 状态；测试把这条断言成性质（板面在的时候 `queryByPlaceholderText(/写点什么/) === null`）。草稿状态搬进标签之后，切画布不可能搁下一张写了一半的卡——而丢掉它的唯一方式就是关掉这张标签不保存（就是上面那个 × 的开口）。
- **同一块画布可以多张标签并存。** 每张各自读板、在版本围栏下写，所以两张标签同时编辑同一块画布的两张卡，正是 `replaceIfVersion` + 「重取根一次」为它而建的那个场景。详情标签永远显示自己地址里那块画布，即使板面已经切到别的画布——资源寻址本身就含这条，而且这正是读者要的（一张卡会待在你放它的地方）。
- **bundle：436.35 kB → 446.00 kB（gzip 96.62 kB）**，为这个座位、地址模块、标题组件和每标签一份订阅付的账。没有新增依赖。
- **文案跟着机制改**：`detail.back` 删了；`detail.tabCard` / `detail.tabDraft` 给芯片命名；guide、`card.enterDetail`、`detail.createHint`、`detail.empty` 现在都讲「标签」，不再讲「返回哪一页」。
- **jsdom 不会排版**，所以绘画测试沿用既有 fixture 套路（在字段上补 `getBoundingClientRect` 和 `setPointerCapture`）。里面有一个坑，见 Testing。

## Testing

- `pnpm --filter @khorsheed/dsh-canvas build` 绿；`pnpm --filter @khorsheed/dsh-canvas test` — **20 文件 / 324 绿**（阶段 ⑤ 时是 19 / 319：新文件加了 11 条，另有六条草稿测试从板面那份搬进来）。
- `tests/detail-tab.client.spec.tsx`（新）：地址那一半（地址点名的那张卡；一句语法之外的字符串换来空态提示且**不发板面读取**；`rev` 一推就重读；渲染/源码/并列经 `patchCard` 保存；指针落进这张自己的标签才会显影；HTML 卡的指针在沙箱 CSP 里内联），草稿那一半（只认 ⌘⏎ 并挡住输入法组字、随 params 来的分类、只有笔画的保存、没动的草稿静默关掉、动过的只问一次、丢掉的问题里报「1 笔」而不报「个字」）。
- 新文件踩到的两个坑，值得复述一遍：`fireEvent.pointerDown` 的 fixture 必须给 **`clientX`/`clientY`**——展开 `{x, y}` 会被读成 (0,0)，采样器认为这一笔没有长度，于是失败在三层之外表现为「spy 调用 0 次」；另一件是笔占着字段时 `Escape` 归笔管，所以想触发标签自己的出口手势得按两下（这条本来就是给用户看的规则，现在是断言而不是假设）。
- `tests/tab.client.spec.tsx`：六条草稿测试搬去标签那份（它们过去算板面测试，只因为草稿住在板面里）；钻取那组换成五处阶段 ⑧ 的打开——点正文和点铅笔都调 `openCardDetail(canvasId, cardId, title)`，HTML 卡的标题是它的 `<title>` 而不是标记原文，归档井里的卡也照样开，「＋新卡」菜单调 `openCardDraft(canvasId, category.id, label)`，以及板面自己绝不变成编辑器。
- `tests/detail.client.spec.tsx`：读取器的 harness 改成地址驱动（一个可变的 target 藏在 getter props 后面），因为 store 不再带卡。
- 仓库闸门：staged 集合上的 `pnpm run check:hygiene`、`pnpm run verify-agent-note-format` / `verify-agent-note-classification`，以及本条 note 自己那份配对的 `pnpm exec tsx scripts/verify-translation-pairing.mts --write`。
