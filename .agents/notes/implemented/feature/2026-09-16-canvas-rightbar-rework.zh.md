# Agent Note: 画布 M3 —— 回到右栏，因为 main 面板路线在构造上是死的

Status: implemented

[English](2026-09-16-canvas-rightbar-rework.md) | 中文

## Problem

M1–M2.5 的画布活在自定义 main 面板上：左导轨 `sidebar.panellist` 行、keyed `main` 空间页，以及（M2.5 之后）空间内详情 pane。用户在 3080 上拍板放弃这条路线，把画布搬回右栏做宽模式 tab——与 side-chat、引用插件组成三件套。

结构性证据一路累积、此时已是决定性的：宿主 `RightbarRoot.tsx` **只在会话面板激活时**渲染右栏（`activePanelId === null`，否则 `return null`）。自定义 main 面板（`activePanelId === 'canvas'`）因此让一切右栏表面按构造失效——M1.5 的详情 tab 与它的 `openTab` 激活（死了，被 M2.5 的空间内 pane 绕行）、M2 的 `openTab('sidechat')` 唤起（在空间里同样死）、以及三件套想摆在会话旁边的任何东西。main 面板路线废掉的不止一个入口：它把画布本想加入的整个右栏生态截肢了。回到右栏是与宿主布局同构的答案：画布住在会话旁边，「在当前会话里改画布」是零成本路径。

随之而来三个设计问题。**「宽模式」该多宽、谁来主张？** presentation 是 ui-sidebar-right 自己的事实（它的 store 向框架 `syncPresentation`），插件每渲染强制一次就是在和用户抢。**切换器/卡板/详情/成稿如何收进一个 tab？** M1–M2.5 分开的空间页、空间内 pane、tab 阅读器必须汇成一条钻取导航，且不丢任何组件。**主会话的 Agent 怎样改画布？** side-chat 的 `openWith` 路径只到画布自己的侧边上下文；当前会话需要自己的入口，且必须门控到绝不可能瞎改。

## Decision

**main 面板路线整体退役；tab 是唯一座位。** 删除：`main` + `sidebar.panellist` 注册、`CanvasSpacePage` 空间页及其 spec、空间内详情 pane、`ui-sidebar` 依赖（peer/dev/`dsh.client.inject`）。原样沿用的：全部数据模型、板服务、每一个 Remote 动词、`BoardView`、`CanvasDetailView`、selection store、side-chat 接缝、v1 导入——提案修订后的 §0.1 就是这么写的：数据模型、host store、Remote、卡板/详情组件、openWith 集成、v1 导入全部沿用。

**tab 是一条顶栏 + 三页钻取。** 顶栏持有画布切换器下拉（`tab/CanvasSwitcher.tsx`：新建/切换/归档/v1 导入，移植自退役空间页的左列）、挂载 chip、`[卡板|成稿]` 视图切换、新卡菜单。卡板页是交互不动的 M1 `BoardView`（它原来的页内顶栏上移）。详情页点正文钻入、返回键回来，复用 `CanvasDetailView`——编辑 toggle 升级为**渲染 / 源码 / 并列**三态（`MarkdownText` 全文渲染、源码编辑走 v1 编辑器三件套经 `patchCard`、宽度允许时并列）。成稿页（`tab/DraftView.tsx`）是**真实**的成稿编辑器，由新动词 `readDraft`/`writeDraft` 驱动：`canvas.json` 旁的 `draft.md`，v1 稿纸编辑器的原合同（按载入 token 重挂的非受控 textarea、IME 组合对保存与预览双硬停、防抖自动保存带版本守卫、冲突停下绝不覆盖、每 pane 单滚动容器）。打开的画布与钻中的卡走共享 selection store，并为钻取语义增 `openCanvas`/`clearCard`。

**宽模式是一次性建议，绝不是主张。** 审计钉死了机制：不存在 per-tab presentation seam（tab 定义没有 presentation 字段、`openTab` 只收 placement+params、fullscreen dock 模式是 ui-sidebar-right 的 store 内部事实——它的 `syncPresentation` 在每次外壳状态变化时都会重新主张）。所以 tab 在每会话首次可见时，经探测的 layout 面**建议一次**：`openRightbar(track, fullscreen)`——在外壳下一次同步前写入，因此一直保持到用户自己的控制重新主张（正是「建议后放手」的语义）——外加 `toggleSidebar()`，以框架自己的 `data-sidebar-collapsed` DOM 标记为门（标记缺失则静默跳过——约定许可的带兜底 DOM 兜底）。去重是 apply 层的 per-session 集合，重挂载绝不重复强制。兜底成立：用户可手动全屏，布局有记忆；程序化的「永远宽模式」登记为上游 seam 候选。

**主会话拿到两个工具，focus 定位、围栏供电。** `canvasMainSessionToolDefinitions` 经 profile 根级 `ctx.inject(['tools'])` 注册（datasets-tool 的 deferred 模式，capability-catalog 已在根级证明），origin tag 走文档认可的免导入 `Symbol.for('dsh.tool.origin')` 路径、owner 为 `@khorsheed/dsh-canvas`，附 `canvas:tools` 提示段。目标画布按调用从 `ctx.canvasBoard.focusedCanvasId(session)` 解析——右栏 tab 经新动词 `focusCanvas`（agent 优先，进程内按会话的 map；重启即「未打开」）最后一次上报的打开画布。无 focus 时工具回答「没有打开的画布」说明文本，而不是报错或乱猜。执行以 `exec.agent.session` 供电围栏——主会话自己的模式，与其他写入同一条重定界围栏。side-chat 的 `openWith` 注入路径原样不动：当前会话还是侧边会话，用户自选。

**成稿拿到真实存储，不是骨架。** `readDraft`（缺失的成稿读为空、token 为 null）与 `writeDraft`（null token 经 `createIfAbsent` 创建；否则 `replaceIfVersion`——成稿绝不被静默覆盖），走同一条重定界围栏，成稿视图今天就是能用的编辑器，而不是带 M4 注脚的假骨架。

## Alternatives considered

### 为什么不保留 main 面板和右栏 tab 双入口？

一个 store 两个入口正是 M1–M2.5 的形态，也正是它坏的形态：main 面板的表面装不下**任何**右栏件（详情、side-chat、引用）。保留两个意味着永远留着一个构造上聊天失明、一个不失明的表面，并永远向用户解释为什么入口只在一个里出现。提案修订后的 §1.1 说座位是 tab；空间的独有价值（大页面）由宽模式找回。

### 为什么不经 `openTab` params 或 tab 定义的 presentation 字段驱动 fullscreen？

宿主契约里两者都不存在——那是第一探针。`SidebarRightTabDefinition` 只有 identity/kind/patterns/priority/veto；`openTab` 选项是 placement 加导航 params。加这样一条 seam 正是下面登记的上游候选，不是插件能伪造的。

### 为什么不在每次 tab 激活时调 `openRightbar(track, fullscreen)`（直到用户反对）？

那是和外壳抢它自己的事实。ui-sidebar-right 在每次状态变化时从它的 store 重新主张 `syncPresentation({shown, track, fullscreen})`；画布每次激活都重新主张，就是两个写者抢一个布尔，用户得同时打赢两个才算赢。一次写入、在每会话一次、在外壳下一次同步之前，是建议；之后的每一次都是抢。

### 为什么主会话工具不显式收 `canvasId` 参数，而用 focus 模型？

显式 id 让每次调用都背着模型会搞错的簿记（id 是不透明的 `canvas_…` 字符串，模型得先 list 才能知道），并且悄悄邀请模型去改一块用户**没有在看**的画布——这正是门控要防的「瞎改」。focus 模型让自然的读法成为唯一的读法：工具改用户正看着的，没有看着的就明说。未来的 `canvas_search`（M4）可以刻意再加显式寻址的工具。

### 为什么不把 `draft.md` 留到 M4、随提案的完整成稿流？

提案 §2 的布局一直有 `canvas.json` 旁的 `draft.md`；没有存储的视图是一个会吃掉用户文字的 textarea——不诚实的骨架。两个动词只花一条版本围栏路径（板自己的模式），让视图今天就是真的；M4 的候选 diff 流在同一个文件上继续，不动它。

## Consequences

- 退役：`packages/canvas/src/client/space/CanvasSpacePage.tsx`、`src/client/space/definition.tsx`、`tests/space.client.spec.tsx`、`main`/`sidebar.panellist` 注册、空间内详情 pane、`@deepseek-ai/dsh-client-ui-sidebar` 依赖（peer/dev/`dsh.client.inject`）。
- `packages/canvas/src/client/tab/`（新）：`CanvasTab.tsx`（顶栏 + 三页 + 钻取 + focus 上报 + 一次性宽模式建议）、`CanvasSwitcher.tsx`、`DraftView.tsx`、`CanvasTab.module.css`。
- `packages/canvas/src/client/space/CanvasSpacePage.module.css` → `board.module.css`（空间页专用块删除）；`BoardView` 去掉页内顶栏与新卡菜单（都上移到 tab 顶栏）；`selection.ts` 增 `openCanvas`/`clearCard`。
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`：编辑 toggle 变渲染/源码/并列三态。
- `packages/canvas/src/store.ts`：`focusCanvas`/`focusedCanvasId`、`readDraft`/`writeDraft`。`packages/canvas/src/remote.ts`：四个动词（focus agent 优先、draft 写 agent 优先、draft 读无 agent）。`packages/canvas/src/tools.ts`：`canvasMainSessionToolDefinitions`。`packages/canvas/src/index.ts`：profile 根级工具注册 + `canvas:tools` 提示段。
- `packages/canvas/src/client/index.ts`：单座位注册、`suggestWideMode`（per-session 去重、探测 layout 面、DOM 门控收会话列表）、focus 同步与回合监听管线不变。
- `package.json` 0.3.2 → 0.4.0（方向调整，不是 API 破坏：M2 的每一个动词都未动）。
- M2.5 note 的「详情在空间内 pane」由本篇取代（详情在 tab 的钻取页）；两篇交叉链接。M1.5/M2 两篇的共享 store 与接缝决策全部存活。
- 3080 上的画布重新回到会话旁边：右栏 tab 打开工作台，主会话的 Agent 能改它，side-chat 仍是第二意见。

## Testing

- `packages/canvas`：**168 个测试全绿**（客户端换血前 170）：退役空间 spec 的 12 例由 `tab.client.spec.tsx` 的 15 例接替（列表 → 自动打开 → 卡板；切换器新建/归档/导入；顶栏新卡与 IME 硬停；对应用变更的 fake 做幽灵收下/拒绝；勾选框多选 + 批量归档；透镜 → askAgent → openSideChat 与全隐降级；钻入钻出；三态源码保存；成稿载入 + 防抖围栏保存；每挂载一次宽模式建议；打开/切换即 focus 上报；只读降级）。宿主新增：focus/draft 六例、主会话工具三例、remote 四例。
- `rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。
- 未在 3080 复验（部署走协调流程）；RightbarRoot 契约引自宿主源码，宽模式建议的效果在 face 层覆盖。

## Deferred

- `canvas_propose_draft` + 候选 diff 横幅、其余 stats 规则、web 搜索接线（M3 后段）；document 卡 html 渲染（srcdoc 内嵌 + `assets/` 读取动词）、会话侧 `canvas_search`/`canvas_clip` 与「插入当前会话」composer 动作（M4）。
- per-tab presentation seam（定义级或导航级的 fullscreen 请求）——上游候选，落地后 DOM 门控的建议退役。
- 粘贴即建卡、画布改名、建后挂载编辑。

## Related

- [M2.5 note](2026-09-16-canvas-space-m2-5.md)（本篇取代的空间内 pane——以及两度确认的 RightbarRoot 根因）。
- [M2 note](2026-09-16-canvas-space-m2.md)（保留的 side-chat 接缝与两个工具）。
- [M1 note](2026-09-16-canvas-space-m1.md)、[M1.5 note](2026-09-16-canvas-space-m1-5.md)。
- [canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)（按本方向重写的 §0/§1/§3/§7）。
