# @khorsheed/dsh-canvas

[English](README.en.md) | 中文

**灵感画布** —— v2 起是**与工作区平级的主题画布空间**：左导轨一个「画布」入口，整页承载「左列画布列表 + 卡片板」。一块画布 = 一个主题 = 部署级实体，上面积累碎片、问题、依据（共同认识）、资料、文档五种卡；模型的提议以幽灵卡落板，你 ✓/✗ 决定它的去留。

**摘要与详情分工**（M1.5）：板上卡片一律摘要态（clamp ~6 行 + 渐隐 + 长文字数标），点正文在右栏「画布详情」tab 读全文——`MarkdownText` 渲染、评论线程、附件预览、编辑保存，跟随卡板选中。

v1 的工作区级灵感稿纸**存储原样保留**（右栏 tab 已改为详情阅读器，不再是稿纸编辑器），检测到 v1 目录时可以在空间里一次性「导入为画布」（只读复制，原文件不动）。

## 画布空间（v2，M1 + M1.5）

- **左导轨整页入口**（`sidebar.panellist` + keyed `main`）：从左导轨切进画布空间，再点一下会话区切回。空间不绑定任何工作区；通过「挂载工作区」关联 0..n 个目录。
- **部署级存储**：每块画布是 `$DSH_HOME/state/canvas/<canvasId>/canvas.json` 一个文件（元信息 + 全部卡 + 计数），纯 JSON，任何编辑器都能打开。卸载插件不会删除它。
- **五种内容卡**：碎片（灵感）/ 问题（open → exploring → answered 生命周期）/ 依据（共同认识）/ 资料（带出处）/ 文档。建卡行内编辑，⌘⏎ 确认。
- **摘要与详情分工**（M1.5）：板上卡片一律摘要——clamp ~6 行、底部渐隐，长文显示字数标；document 卡用启发式标题（首个 markdown 标题或首行），不再把原文从 `#` 糊上去。**点正文在右栏「画布详情」tab 打开详情**（官方 `openTab` 激活，同一 bundle 共享 store 跟随选中）；多选改由卡片右上角的**悬停勾选框**，与打开详情互不干扰。
- **右栏「画布详情」阅读器**（M1.5）：kind 图标 + 状态 + 来源 + 时间、`MarkdownText` 渲染**全文**、评论线程（可读可发）、幽灵卡 ✓/✗、附件区（url 链接；文件附件一键调官方文档预览）。**编辑 toggle** 复用 v1 编辑器三件套（非受控 textarea、IME 硬停、⌘⏎ 保存走 `patchCard`），保存后回到阅读态。
- **幽灵提议卡**：`proposed` 状态的卡以虚线幽灵态内联在板上，「收下」转为正式卡、「拒绝」归档（**不做删除**）；接受率计入 `stats`，供后续自调整规则使用。
- **筛选、多选、归档**：按 kind 的筛选 chips（全部/碎片/问题/依据/资料/文档）；勾选框多选，选择条上可批量归档；已归档的卡进「归档井」，随时恢复。
- **评论挂卡上**：角标展开线程，评论即数据（后续里程碑里 Agent 的评论会把 open 问题卡自动推进到 exploring）。
- **v1 一次性导入**：列表底部「导入 v1 灵感画布」——选中一个工作区，探测到 `<工作区>/灵感画布/` 后一键复制成新画布（v1 卡片 → 碎片卡、v1 文章 → 文档卡，来源回指原文件绝对路径；**只读，原目录一个字节不动**；v1 已归档的条目留在原地）。
- **编辑器三件套沿用 v1**：非受控 textarea（光标不跳）、输入法组合期间硬停（候选窗绝不被打断）、板区单滚动容器（卡内编辑框自动增高、绝不自滚动）。
- **暗色自动跟随**：所有颜色都走官方 `--dsw-*` 主题 token，kind 只靠图标 + 文字区分，不用彩色。

## v1 灵感稿纸（存储保留，编辑器已退役）

- **一个灵感 = 一个文件**。正本在 `<工作区>/灵感画布/` 下，`文章/` 与 `卡片/` 两个子目录分别是两种形态，文件名就是标题。没有数据库、没有私有格式。
- **M1.5 起右栏 tab 是「画布详情」阅读器**（§上），v1 稿纸编辑器从 tab 退役：稿子的归宿是「导入为画布」（上条）；原文件仍在磁盘上，任何编辑器都能打开；v1 的五个 Remote 动词（`list` / `read` / `create` / `write` / `setArchived`）在线上不动。
- **归档而不是删除**（空间与稿纸同义）：归档只从列表里隐藏，**文件一个字节都不动**；已归档区可随时恢复。

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
- **空间座位探测降级**：v2 空间的 `main` / `sidebar.panellist` 注册走 `ctx.slots.inject`——宿主不声明这两个座位时空间静默缺席，v1 右栏 tab 不受影响。
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西。
- 宿主半边不注册模型可见工具、不向提示词注入任何内容（聊天 dock 与画布工具在后续里程碑）。
- **v1 写入按「发起这次点击的会话」围栏**。三个写接口（新建/保存/归档）都先取调用会话的沙箱策略再写：围栏挂在会话自己的工作区上，不是宿主的进程目录。所以会话是只读模式时，画布会明确拒绝写入（`这个位置不可写`），而不是悄悄写进去。
- **v2 板写入围栏重定界到 state 目录**。画布是部署级状态，任何会话的工作区都装不下它：板写入沿用挂载的 `ctx.fs`（版本守卫、原子写、观测轨迹），会话解析出**模式**与 session id（只读部署照样拒绝），但可写边界重定界为插件自己的 `$DSH_HOME/state/canvas`——一个正好围住 state 目录的 workspace-write 围栏，绝不用裸 `node:fs` 绕。`DSH_HOME` 未设置时 state 根退回 `process.cwd()`（datasets 先例）。

## Known Limitations

- **只归档，不删除**。官方 `ctx.fs` 没有删除文件的接口（13 个抽象方法里没有 `remove`/`rename`；沙箱围栏也只挂在 `writeText`/`editText` 上，裸 `node:fs` 会绕过它）。要彻底删掉某个文件，请在文件管理器里删——它只是你的一个 markdown 文件。画布同理：归档的画布与卡都留在 `canvas.json` 里。
- **外部编辑器的改动收不到通知**。官方 `workspaceFiles.changes` 只报被插桩的文件系统操作，**不观察操作系统**；在别的软件里改了稿子，插件只能靠保存时的版本守卫发现冲突。`canvas.json` 也一样：另一个浏览器标签页的改动要等下次操作（服务侧读到最新版再重放一次），本页不轮询。
- **列表顺序存在 `.index.json` 里，不按修改时间**。`ctx.fs` 不上报 mtime，所以顺序由索引维护（新建的排在最前），未在索引里的文件按文件名排在后面。
- **跨工作区只能读、不能写**。模型的 `read` 不受工作区限制，所以你能把 A 工作区的稿子引用到 B 工作区的会话里；但会话 B 的沙箱以 B 为界，模型改不回 A 的文件。
- **中文目录名**：`git status` 里会因 `core.quotepath` 显示成八进制转义（功能正常，观感吓人）。宿主侧一律走 `ctx.fs` 拿绝对路径，不 shell 出去，所以中文与空格都不成问题。
- **HTML 表格的合并单元格降级**为「文本 + 空格子」，不重建跨行列。
- **M1.5 之后的画布空间仍不做**（后续里程碑）：聊天 dock 与画布 Agent 会话（M2）、模型工具与 stats 自适应规则（M3）、成稿视图与 document 卡的 html 内嵌渲染（文件附件目前调官方文档预览，iframe srcdoc 内嵌版在 M4）、会话侧检索工具（M4）。也没有「粘贴即建卡」与画布标题改名。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

**画布空间（v2）磁盘布局**

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # { id, title, attachedWorkspaces, chat, cards[], stats, archivedAt, … }
```

`cards[]` 每张卡：`{ id, kind, text, source?, status: proposed|kept|archived, question?, comments[], createdBy, createdAt, updatedAt }`。`stats` 记提议接受/拒绝计数、各 kind 可见卡计数、最后活跃时间（列表排序与后续自调整规则的数据源）。文件损坏或 id 对不上目录时：**列表跳过、读写报错**，绝不重写一个读不懂的文件。

**板服务**：`CanvasBoardService`（`ctx.canvasBoard`）整板版本围栏读写——读取 → 应用纯函数修改 → `replaceIfVersion` 写回；版本冲突**重读重放一次**再报 `stale`（两个浏览器标签页同时操作不丢卡）。写入围栏见 Compatibility 的「重定界」条。

**Remote**：namespace `canvas` 在 v1 五动词（`list` / `read` / `create` / `write` / `setArchived`）之外加空间八动词：`listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `importV1`。变更类全部 agent 优先（调用会话供电围栏），读取类不带 agent——v1 的线上约定原样延续。

**空间客户端**：`ctx.slots.inject('main')` 注册 `{ key: 'canvas' }` 的整页面板，`ctx.slots.inject('sidebar.panellist')` 注册同 id、order 100 的导轨行（宿主侧栏负责行按钮与激活态，插件只给图标与标签）。页面是 root 作用域、没有自己的会话：工作区上下文读全局 `useWorkspaces`，写入围栏搭当前选中会话（`useSessions`）；两者都带常量回退，最小组合（无 ui-session / ui-workspace）里空间照开、只读。

**摘要/详情分工（M1.5）**：板卡一律摘要（CSS clamp ~6 行；`isLongCardText` 判定渐隐与字数标；document 卡标题走 `documentHeadingOf` 纯函数启发式）。点正文写共享 store（`space/selection.ts`，`createSnapshotStore`，`{ canvasId, cardId, rev }`）并经官方 `ctx.sidebarRight.openTab('canvas')` 激活右栏 tab（无挂载会话时 try/catch 降级为只写 store）。右栏 tab 的详情阅读器（`detail/CanvasDetailView.tsx`，session 作用域）经 `hooks.selection` 跟随选中；任一侧的变更动词在 apply 层包装里统一 `touch()` 推 rev，对侧重读跟随。附件区：url 直接链接；文件附件 `fileAddressFor` 组 `dsh-resource://file` 地址，`ctx.sidebarRight.openResource` 调官方文档预览（html 也走它；srcdoc 内嵌版与 `assets/` 读取动词留 M4）。

**v1 磁盘布局**

```
<工作区>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` 的形状照官方 workspace registry：`order` 是显示顺序，`archivedIds` 是归档集——和官方用 `workspaceIds` + `archivedSessionIds` 表达「顺序 + 归档」是同一套。索引缺失或损坏时**降级**为按文件名排序、无归档项，绝不因此打不开画布。

**v1 宿主半边**：`CanvasService`（核心逻辑）+ `CanvasRemoteService`（Typert Remote）。五动词全部**纯 JSON、绝对路径参数、不做会话查找**（local-files 的惯例）。每次写入都走挂载的 `ctx.fs`，因此部署的沙箱模式会拦下越界写入，观测策略也能看到它；版本守卫由 `writeText` 的 `{ kind: 'replaceIfVersion' }` 提供，冲突返回 `stale` 而不是覆盖。

**v1 客户端半边**（M1.5 起为详情阅读器）：`ctx.remote.$mount` 挂 Remote，注册 tab 类型（`guide` 卡片让它在官方指南页出现；当它是右栏唯一的页面类型时，官方 `defaultSeed` 会直接进入它）+ keyed `sidebar.right.pane.tab` 的 body（现为 `CanvasDetailView`）。宿主半边缺失时（`ctx.get('remote.canvas')` 为 undefined）客户端仍然注册，只是报告缺失——不会把 boot 拖垮。

**编辑器的三条硬约束**（`space/CardTextarea.tsx` 一处实现、板与详情共用，因为破坏任何一条都会毁掉写作）：非受控 `<textarea>`，状态回流永不写回 `value`；输入法组合期间既不保存也不提交；外层容器不滚动、只有板区（或详情根）一个滚动容器。

**粘贴转换**（`paste-table.ts`，纯函数）：优先读 `text/html` 里的 `<table>`（只抠表格，不转换整篇文档——电子表格的剪贴板 HTML 带着整张表和样式），回退判定制表符分隔；插入用 `document.execCommand('insertText')` 以保留浏览器原生撤销栈。

配置项：插件行可配 `stateRoot`（画布 state 根覆盖；默认 `$DSH_HOME/state/canvas`，`DSH_HOME` 未设置时 `<cwd>/.dsh-canvas`）。

</details>

