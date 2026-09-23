# Agent Note：画布自己接管那一排标签，阶段 ⑧ 的 dock 标签收回来

Status: implemented

## Problem

阶段 ⑧ 把一张卡的详情做成了**宿主**右栏 dock 里的一张标签，这修好了一件真问题：改卡的时候板面的滚动位置和筛选都还在，两张卡是两张标签而不是板面翻过去的一屏。但它把「打开着的东西那一排」挪到了离你正在看的东西隔一层 chrome 的地方。用户那次验收说得很直白：「打开卡片怎么变成新增 sidebar 标签，我们讨论的不是在画布内部有多个标签吗」——从一开始讨论的就是画布**内部**的标签，其中一些标签是画布、一些是卡片。（验收那份 note 把它列成第七条发现，而用户的消息里它编号是 6，因为 note 把一条反馈里的两件事拆成了两条；它就是那轮验收留下来的那一条。）

还有两件事往同一个方向推。宿主的标签芯片对那一张张标签全都写着「画布」，dock 因此答不出你看的是哪张卡；而且宿主只按 tab id 关闭、不给拦截，带草稿的标签被 × 掉，字就静默没了——这一条阶段 ⑧ 的 note 已经当场记成「插件侧修不了」。

## Decision

`packages/canvas` 重新只注册**一个**右栏 tab 类型。它内部 `tab/TabStrip.tsx` 是这块画布自己的一排标签，`CanvasTab` 是「显示中那一行」的路由器：板行 = 板页面（它自己的顶栏 + `BoardView`/`LinkView`），卡行与草稿行 = `CanvasDetailView`——就是阶段 ⑧ 那套阅读器，一行不改，只是搬到这里挂载。画布切换器变成标签条行尾的那个 ＋，只负责往这排里加行；板面顶栏里的画布名是文字，不再是门。

- **行的 id 由主体推出**（`b:<canvas>` / `c:<canvas>:<card>` / `d:<canvas>`），于是去重是 id 的性质：同一张卡点两次坐不出第二行，一块画布也就恰好只有一行草稿。于是在「＋新卡」菜单里再选一个分类，改的是这张已开着的草稿的**分类**（它在标签条里的位置保留，负载换掉），而不是又开一张空白。
- **store 存的是行，不是一个指针。** `space/selection.ts` 从 `{canvasId, cardId, rev}` 变成 `{tabs, active, rev}`，`canvasId` 从「显示中那一行」推出来——所以一张卡的标签仍然把主会话工具指向它所属的那块画布，`focusCanvas` 上报的就是这个。
- **这一排活过刷新**：行走 `sessionStorage`，读回来时逐行过形状检查，代码认不出的 payload 整条丢掉（外面塞进来的一个字都不认）。上限 16 行，挤出顺序是 卡 → 板 → 刚加的那行永远不被挤：重开一张卡只要再点它一次，丢一块板要花一次 ＋ 菜单，丢一张草稿丢的是用户写的字。
- **草稿的字住在 `CanvasTab` 里，按行 id 存**——不在 store，也不在阅读器里。这才让「切走再切回来字还在」成立，也才让 × 有可能先问一句。阅读器的 textarea 是不受控的，所以那一行挂在 `key={row.id}` 下：一个编辑框的 DOM 值不能从你刚看的那张卡带进这张卡。
- **× 是我们自己画的，所以那次确认问得出去**——Esc 和草稿自己的离开手势也一样，而宿主芯片上那个 × 从来做不到。
- **dock 芯片仍然显示活标题**，走 `sidebar.right.pane.tab.title` 那个 inject 槽（`tab/CanvasTabTitle.tsx`）：宿主只在打开时捕获一次 `title`、之后从不刷新，所以标题由注册方自己读 store。这行得通是因为槽 inject 的 `ComposedProps` 会和注册方自己的 `InjectFace` 求交集——一个标题注册方既能发布 `hooks.selection`，又照样收到 `useTabInfo`。

## Alternatives considered

- **dock 那种标签留着，内层这排并排再长一套。** Rejected：两套标签系统管同一批对象，结果就是 dock 里开着一张卡、内层显示着另一张卡，而没有任何东西告诉你哪个是哪个。用户的裁决是「卡片只有一个家」。
- **拿 dock 的地址当行 id**（`dsh-resource://canvas/<canvas>/<card>`）。Rejected：那条地址存在的理由就是换宿主帮忙去重，而从主体推 id 买到同样的东西，还不需要一套要校验的语法——所以 `detail/detail-address.ts`、`_draft` 那个哨兵、`SidebarRightResourceParamsMap` 的类型增补是**删掉**而不是改用了。草稿的 id 是 `d:<canvas>` 之后，存进来的卡 id 再怎么也不会撞上它。
- **草稿的字也放进 store**，让它连刷新都活得过。Rejected：store 是这套 composition 里每个座位共享的，每一次按键都过一遍共享快照，为一件只有一个读者的东西付出的是全场重渲染 fan-out。刷新可以丢一张草稿的字；切标签不丢。
- **板行也带 heading，好让芯片读出画布的名字。** Rejected，理由在涟漪：`openCanvas` 的签名、stash 的形状校验、换行的守卫、标签解析、切换器的 prop 加三份 spec 全都要动，就为了把一个本来就正确写着「画布」的芯片改写成「为什么人们不愿表达异议」。板行显示的就是这个 surface 自己的名字，有歧义的是卡行——而它带着自己的 heading。
- **让芯片自己去解析画布标题。** 同一个拒绝往下一层：画布列表是一次异步读取，等于为一根标签条上本来就摆在那儿的字符串，把整个列表 feed 拉进芯片。

## Consequences

- **宿主白给的那些也没了**：dock 自己的标签上限、中键关闭/一键关全、芯片条的横向滚动、按会话存的标签。我们这排是按浏览器标签页存、自带上限；而宿主关整个画布 tab 的那个 × 依旧拦不住——里面还有一张草稿时关掉整个 surface 是静默的，和以前一样。会问一句的只有内层那个 ×。
- **存回来的行可以指向已经不在的东西。** 这个降级是设计过也测过的：卡不见了的那一行读作「这张卡已不在板上」；用户把每行都关掉之后的空标签条读作「没有打开的标签了，点上面的「＋ 画布」…」，而不是账号级的「还没有画布」。这是三种不同的沉默，这个 surface 现在分别点名。
- **板面的筛选仍然一次只属于一块画布**，推出来的 `openId` 一动就重置——阶段 ⑧ 那个优点（同一块画布的卡不动它）保住了，因为对它来说 `openId` 根本没动。
- **体积：504.48 kB → 514.20 kB，gzip 111.78 → 114.21 kB** —— 十 kB 买到这条排、行列表和 stash，而 ⑧ 那三个座位模块（`CanvasDetailTab`、`CanvasDetailTitle`、`detail-address` 和它的 CSS module）已经不在包里。**零新依赖。**
- **布局在这里依然没有测试。** 这一排是横向滚动而不是压缩行，＋ 是粘住的，因为一个能被滚走的控件不算控件；jsdom 从不排版，所以这两条都不在测试里。核对它们的地方是 3080 那次验收。
- **`strip.canvases` / `space.new` / `tab.label` 全都读作「画布」或「新画布」**，这让 ＋ 触发器在一排写满画布名字的标签旁边不产生歧义——也让「＋ 画布」成为 spec 点得动的那个字符串。改其中任何一个名字，会同时动三份 spec 里的选择器。

## Testing

- `pnpm --filter @khorsheed/dsh-canvas test` —— **23 文件 / 461 绿**（本次之前 454；`tests/strip.client.spec.tsx` +18，`tests/detail-tab.client.spec.tsx` 删除 −11，切换器那两份 spec 里重述 +2）。
- `tests/strip.client.spec.tsx` 装了渲染够不着的规则（id 推导的去重、草稿改分类、关闭后激活左邻居、挤出顺序、stash 往返与它认不出的 payload），加上被路由的标签条和芯片。它的 bench 接的是**真**动词——`openCardDetail` 在这里不是记录器，因为这份 spec 断言的就是行去了哪儿。
- `tests/tab.client.spec.tsx` 与 `tests/link.client.spec.tsx` 保留只记录的 `openCardDetail` mock：那两份 spec 断言一次手势**传了什么**（哪张卡、哪个标题），阅读器自己的行为仍归 `tests/detail.client.spec.tsx`。它们的切换器选择器现在点「画布」（＋ 触发器），不再点那个已经消失的画布名 pill；并且每个 bench 在建 store 之前先清 `sessionStorage`——这一排故意是粘的，不清的 bench 会继承上一个 bench 留下的行。
- 本 worktree 内仓库级 `pnpm run build && pnpm run test` 全绿；`pnpm run verify-agent-note-format`、`verify-agent-note-classification` 与翻译配对闸门在本 note 的三元组上通过。

## Related

- [详情是一张标签](../feature/2026-09-23-canvas-detail-tab.md) —— 阶段 ⑧，本次收回它的 dock 标签、保留它的阅读器。
- [对已上线画布的一次验收](../bug-fix/2026-09-23-canvas-acceptance-round3-fixes.md) —— 那轮修掉六条表面反馈，把这一条留成一次裁决。
- [连线视图是一块板的两张面之一](../feature/2026-09-23-canvas-link-view.md) —— 一行标签如今在两张面之间切换。
