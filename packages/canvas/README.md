# @khorsheed/dsh-canvas

[English](README.en.md) | 中文

**灵感画布** —— **右栏里的写作工作台**：右栏一个「画布」tab，普通右栏宽度自调（拖拽把手 + 一次性收会话列表建议），顶栏切换画布，卡板 ↔ 详情钻取导航，成稿编辑器同页切换。一块画布 = 一个主题 = 部署级实体，上面积累碎片、问题、依据（共同认识）、资料、文档五种卡；模型的提议以幽灵卡落板，你 ✓/✗ 决定它的去留。

**对话双入口**（M2–M3）：**当前会话**——两个画布工具（`canvas_propose_card` / `canvas_comment`）注册到主会话 Agent，你直接让 Agent 改当前打开的画布；**side-chat 插件**——透镜「就此提问」/评论「追问」走第二意见（独立上下文，side-chat 未安装时这些入口全部隐藏、卡板完整可用）。文本选区交互由引用插件（@khorsheed/dsh-quote）在应用级统一承接（引用到当前会话 / 引用到侧边对话 / 复制）。

v1 的工作区级灵感稿纸**存储原样保留**（编辑器已退役）——原文件仍在磁盘上，任何编辑器都能打开；v1 五个 Remote 动词在线上不动。

> 路线注记：M1–M2.5 曾走过 main 面板空间路线，已退役——宿主 `RightbarRoot` 只在会话面板渲染右栏，自定义 main 面板让一切右栏承接按构造失效；回到右栏是与宿主布局同构的答案。数据模型、Remote、卡板/详情组件、side-chat 集成全部沿用。

## 功能

- **右栏普通宽 + 收列表建议**（M3.1 修正）：打开画布 tab 时每会话一次性建议收起左侧会话列表（DOM 门控，绝不盲 toggle、绝不反复强制）；右栏保持普通 track 模式——拖拽把手可用、宽度你自调、布局有记忆（曾建议 fullscreen，因宿主 fullscreen 隐藏拖拽把手而撤销）。唯一座位 = 右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`），天然 session 作用域。
- **顶栏一屏切换**：画布切换器下拉（活跃画布行 → 已归档井 → 底部「+ 新画布」内联创建）+ 挂载工作区 chip + [卡板|成稿] 视图切换 + 新卡菜单。不再有独立左列导航。
- **部署级存储**：每块画布是 `$DSH_HOME/state/canvas/<canvasId>/` 一个目录——`canvas.json`（元信息 + 全部卡 + 计数）与 `draft.md`（成稿正本），纯文本，任何编辑器都能打开。卸载插件不会删除它。
- **五种内容卡**：碎片（灵感）/ 问题（open → exploring → answered 生命周期）/ 依据（共同认识）/ 资料（带出处）/ 文档。建卡行内编辑，⌘⏎ 确认。
- **摘要与详情分工**（M1.5）：板上卡片一律摘要——clamp ~6 行、底部渐隐，长文显示字数标；document 卡用启发式标题（首个 markdown 标题或首行），不再把原文从 `#` 糊上去。多选改由卡片右上角的**悬停勾选框**。
- **钻取详情页**（M3）：点卡片正文钻入详情（返回键回卡板）——kind 图标 + 状态 + 来源 + 时间、**渲染 / 源码 / 并列**三态（`MarkdownText` 全文渲染、v1 编辑器三件套源码编辑、宽度允许时并列）、评论线程（可读可发）、幽灵卡 ✓/✗、附件区（url 链接；文件附件一键调官方文档预览）。
- **成稿视图**（M3）：顶栏切到成稿——`draft.md` 的 edit / preview / split 编辑器，防抖自动保存带版本守卫（别处改过就停下，绝不静默覆盖），输入法组合期间硬停。
- **聊天集成**（M2，经 side-chat 插件）：选中卡后**透镜条**出现——挑战假设 / 找反例 / 找证据 / 追问原因 / 换个视角 / 升一层 / 降一层，外加「就此提问」；Agent 评论旁「追问」；文本选区交给引用插件统一处理。一块画布 = 一个 side-chat 上下文（`canvas:<id>`）= 一个持久 Agent 会话，系统提示每轮新鲜（主题 + 板摘要 + 工具契约 + 透镜语义 + grounding 护栏 + stats 回授）。**side-chat 缺席时聊天入口全部隐藏，卡板完整可用。**
- **主会话工具**（M3）：`canvas_propose_card`（提议卡，proposed 待你 ✓/✗）与 `canvas_comment`（评论挂卡，指出假设/张力并以追问收尾）注册进主会话 Agent——打开的画布就是目标（tab 切换即上报 focus）；没打开任何画布时工具如实说明而不是乱改。
- **幽灵提议卡**：`proposed` 状态的卡以虚线幽灵态内联在板上，「收下」转为正式卡、「拒绝」归档（**不做删除**）；接受率计入 `stats`，供后续自调整规则使用。
- **筛选、多选、归档**：按 kind 的筛选 chips（全部/碎片/问题/依据/资料/文档）；勾选框多选，选择条上可批量归档；已归档的卡进「归档井」，随时恢复。
- **评论挂卡上**：角标展开线程，评论即数据（Agent 的评论会把 open 问题卡自动推进到 exploring）。
- **编辑器三件套沿用 v1**：非受控 textarea（光标不跳）、输入法组合期间硬停（候选窗绝不被打断）、单滚动容器。
- **暗色自动跟随**：所有颜色都走官方 `--dsw-*` 主题 token，kind 只靠图标 + 文字区分，不用彩色。

## v1 灵感稿纸（存储保留，编辑器已退役）

- **一个灵感 = 一个文件**。正本在 `<工作区>/灵感画布/` 下，`文章/` 与 `卡片/` 两个子目录分别是两种形态，文件名就是标题。没有数据库、没有私有格式。
- **M1.5 起右栏 tab 不再是稿纸编辑器**（现为画布工作台）：原文件仍在磁盘上，任何编辑器都能打开；v1 的五个 Remote 动词（`list` / `read` / `create` / `write` / `setArchived`）在线上不动。
- **归档而不是删除**（画布与稿纸同义）：归档只从列表里隐藏，**文件一个字节都不动**；已归档区可随时恢复。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

装完重启宿主。卸载**不会**删除 `$DSH_HOME/state/canvas/` 或任何 `灵感画布/` 目录——你的稿子和画布是你的。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`）自 0.1.5 起存在，`minHost` 随之抬到 0.1.5-rc.1；旧宿主没有右栏面，请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西。
- **主会话画布工具**注册进 profile 根级工具表（origin tag 自带）；目标画布按会话 focus 解析（右栏 tab 当前打开的画布），无打开画布时工具返回明确说明文本。**聊天依赖 side-chat 插件但缺席不致命**：探测 `ctx.get('sideChat')`（单向边，manifest `dsh.references` 登记），缺席时聊天入口全部隐藏、卡板完整可用。
- **v1 写入按「发起这次点击的会话」围栏**。三个写接口（新建/保存/归档）都先取调用会话的沙箱策略再写：围栏挂在会话自己的工作区上，不是宿主的进程目录。所以会话是只读模式时，画布会明确拒绝写入（`这个位置不可写`），而不是悄悄写进去。
- **v2 板与成稿写入围栏重定界到 state 目录**。画布是部署级状态，任何会话的工作区都装不下它：写入沿用挂载的 `ctx.fs`（版本守卫、原子写、观测轨迹），会话解析出**模式**与 session id（只读部署照样拒绝），但可写边界重定界为插件自己的 `$DSH_HOME/state/canvas`——一个正好围住 state 目录的 workspace-write 围栏，绝不用裸 `node:fs` 绕。`DSH_HOME` 未设置时 state 根退回 `process.cwd()`（datasets 先例）。画布工具的写入走同一条围栏（优先执行 Agent 自己的会话）。

## Known Limitations

- **只归档，不删除**。官方 `ctx.fs` 没有删除文件的接口（13 个抽象方法里没有 `remove`/`rename`；沙箱围栏也只挂在 `writeText`/`editText` 上，裸 `node:fs` 会绕过它）。要彻底删掉某个文件，请在文件管理器里删——它只是你的一个 markdown 文件。画布同理：归档的画布与卡都留在 `canvas.json` 里。
- **外部编辑器的改动收不到通知**。官方 `workspaceFiles.changes` 只报被插桩的文件系统操作，**不观察操作系统**；在别的软件里改了稿子或 `canvas.json`/`draft.md`，插件只能靠保存时的版本守卫发现冲突；本页不轮询。
- **列表顺序存在 `.index.json` 里，不按修改时间**。`ctx.fs` 不上报 mtime，所以顺序由索引维护（新建的排在最前），未在索引里的文件按文件名排在后面。
- **跨工作区只能读、不能写**。模型的 `read` 不受工作区限制，所以你能把 A 工作区的稿子引用到 B 工作区的会话里；但会话 B 的沙箱以 B 为界，模型改不回 A 的文件。
- **中文目录名**：`git status` 里会因 `core.quotepath` 显示成八进制转义（功能正常，观感吓人）。宿主侧一律走 `ctx.fs` 拿绝对路径，不 shell 出去，所以中文与空格都不成问题。
- **HTML 表格的合并单元格降级**为「文本 + 空格子」，不重建跨行列。
- **M3 之后仍不做**（后续里程碑）：`canvas_propose_draft` 与候选 diff 接受流、stats 自适应规则、web 搜索接线（M3 后段）；document 卡的 html 内嵌渲染（srcdoc 内嵌版与 `assets/` 读取动词）、会话侧检索工具（M4）。也没有「粘贴即建卡」与画布标题改名。
- **画布 Agent 的 cwd 由 side-chat 的继承规则决定**（调用会话的 cwd），不是提案 §6 设想的「首个挂载工作区或画布目录」——那是 side-chat 包的契约，画布不越界修改。
- **幽灵卡落板的可见性**靠客户端的回合监听（发送后轮询 side-chat 状态并触发重读）；轮询停止后、或别的浏览器标签页的改动，仍靠下一次手势时的版本守卫浮现，板不常驻轮询。
- **收列表是一次性建议**：tab 首次可见时每会话建议一次收起会话列表（`toggleSidebar()`，DOM 探测 gated），此后布局由你接管；fullscreen 不作建议（宿主 fullscreen 隐藏右栏拖拽把手，per-tab presentation seam 是上游候选）。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

**磁盘布局（v2）**

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # { id, title, attachedWorkspaces, chat, cards[], stats, archivedAt, … }
  draft.md         # 成稿正本（纯 markdown）
```

`cards[]` 每张卡：`{ id, kind, text, source?, status: proposed|kept|archived, question?, comments[], createdBy, createdAt, updatedAt }`。`stats` 记提议接受/拒绝计数、各 kind 可见卡计数、最后活跃时间（列表排序与后续自调整规则的数据源）。文件损坏或 id 对不上目录时：**列表跳过、读写报错**，绝不重写一个读不懂的文件。

**板服务**：`CanvasBoardService`（`ctx.canvasBoard`）整板版本围栏读写——读取 → 应用纯函数修改 → `replaceIfVersion` 写回；版本冲突**重读重放一次**再报 `stale`（两个浏览器标签页同时操作不丢卡）。写入围栏见 Compatibility 的「重定界」条。

**Remote**：namespace `canvas` 在 v1 五动词（`list` / `read` / `create` / `write` / `setArchived`）之外的空间动词：`listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `askAgent` / `chatStatus` / `focusCanvas` / `readDraft` / `writeDraft`。变更类全部 agent 优先（调用会话供电围栏），读取类不带 agent——v1 的线上约定原样延续。

**右栏 tab（M3）**：`ctx.sidebarRightTabs.register` 类型 + keyed `sidebar.right.pane.tab` 的 body（`tab/CanvasTab.tsx`）。顶栏 = 切换器（`tab/CanvasSwitcher.tsx`）+ 挂载 chip + [卡板|成稿] 切换 + 新卡菜单；卡板页 = `space/BoardView.tsx`；详情页钻入复用 `detail/CanvasDetailView.tsx`（渲染/源码/并列三态）；成稿页 = `tab/DraftView.tsx`（readDraft/writeDraft 驱动）。打开的画布与钻中的卡都走共享 selection store（`space/selection.ts` 的 `{ canvasId, cardId, rev }`）；tab 打开/切换即 `focusCanvas` 上报宿主（主会话工具的目标）；收列表建议（DOM 探测 `data-sidebar-collapsed` 后 `toggleSidebar()`）每会话一次（fullscreen 建议已随 M3.1 撤销：宿主 fullscreen 隐藏右栏拖拽把手）。任一侧的变更动词在 apply 层包装里统一 `touch()` 推 rev，读者重读跟随。

**聊天集成（M2）**：`askAgent` 动词（agent 优先）探测 `ctx.get('sideChat')`，命中则 `openWith({ contextKey: canvas:<id>, label: 主题, systemPrompt, tools, refs })`——`prompt.ts` 纯函数渲染系统提示段（主题与目标 / 板摘要 / grounding 护栏 / 工具契约 / 透镜语义 / stats 回授段），`tools.ts` 出两个 `defineTool` 定义（origin tag 走 `Symbol.for('dsh.tool.origin')` 免导入路径）。发送规则：自由文本优先，否则非 `ask` 透镜的模板文本，都没有则只 prime。客户端两处发起（透镜条 / 评论「追问」；选区交互归引用插件），`chatStatus` 探测门控制全部聊天入口的显隐；发送成功后监听 `remote.sidechat.getState`（结构镜像），running 期间定期 `touch()` 共享 rev，幽灵卡随工具调用落板即现。

**主会话工具（M3）**：`tools.ts` 的 `canvasMainSessionToolDefinitions` 经 profile 根级 `ctx.inject(['tools'])` 注册（deferred，datasets-tool 先例），附 `canvas:tools` 系统提示段；目标画布 = `ctx.canvasBoard.focusedCanvasId(session)`（tab 经 `focusCanvas` 上报），无 focus 返回「没有打开的画布」说明文本。origin tag 同免导入路径。画布不做会话 preset 自隐（preset 绑定会话创建、画布是跨会话空间，自隐=永隐）；可见性由 profile / 整合包的安装层决定。

**v1 磁盘布局**

```
<工作区>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` 的形状照官方 workspace registry：`order` 是显示顺序，`archivedIds` 是归档集——和官方用 `workspaceIds` + `archivedSessionIds` 表达「顺序 + 归档」是同一套。索引缺失或损坏时**降级**为按文件名排序、无归档项，绝不因此打不开画布。

**v1 宿主半边**：`CanvasService`（核心逻辑）+ `CanvasRemoteService`（Typert Remote）。五动词全部**纯 JSON、绝对路径参数、不做会话查找**（local-files 的惯例）。每次写入都走挂载的 `ctx.fs`，因此部署的沙箱模式会拦下越界写入，观测策略也能看到它；版本守卫由 `writeText` 的 `{ kind: 'replaceIfVersion' }` 提供，冲突返回 `stale` 而不是覆盖。

**编辑器的三条硬约束**（`space/CardTextarea.tsx` 与 `tab/DraftView.tsx` 各处实现，因为破坏任何一条都会毁掉写作）：非受控 `<textarea>`，状态回流永不写回 `value`；输入法组合期间既不保存也不提交；单滚动容器（编辑器自己滚动）。

**粘贴转换**（`paste-table.ts`，纯函数）：优先读 `text/html` 里的 `<table>`（只抠表格，不转换整篇文档——电子表格的剪贴板 HTML 带着整张表和样式），回退判定制表符分隔；插入用 `document.execCommand('insertText')` 以保留浏览器原生撤销栈。

配置项：插件行可配 `stateRoot`（画布 state 根覆盖；默认 `$DSH_HOME/state/canvas`，`DSH_HOME` 未设置时 `<cwd>/.dsh-canvas`）。

</details>
