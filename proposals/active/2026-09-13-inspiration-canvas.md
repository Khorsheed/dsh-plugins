# 灵感画布（inspiration-canvas）

- **分类**：plugin
- **状态**：planned（v2 重设计已立项为 [2026-09-16-canvas-space](2026-09-16-canvas-space.md)；本文件 M2–M4 路线以新提案为准，M1 已交付能力由 v2 继承或替代，逐项对照见新提案 §0.2）
- **最后更新**：2026-09-16（2026-09-13 立项：v1 范围与界面定稿，见「方案」）
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived），关键词「灵感 / 画布 / canvas / 写作 / novel / 编辑器 / 草稿 / draft」——**无重复提案**。命中三处**相关**而非重复：
  - [mode-switcher](2026-08-26-mode-switcher.md)：已规划「novel 新建写作 preset」「内容以 novel pack 定义为准」。本提案是该 pack 的**第一个领域插件**，M2 起接入它的自隐约定。
  - [package-management](2026-08-21-package-management.md)：`dsh-novel` 整合包「等 1–2 个小说领域插件」——本插件是第一个。
  - [local-files-browser](../closed/2026-08-26-local-files-browser.md)（done，`@khorsheed/dsh-local-files`）：右栏 tab 注册、会话 cwd 解析、`writeClipboard` 用法的**实现先例**，本提案直接复用其惯例。
- **官方依赖**：纯插件。仅一处需要说明：官方无删除文件的 seam（v1 用「归档」绕开，见「风险 / 放弃的东西」①），不构成契约扩展需求。

## 目标

写作场景里，用户需要一块**属于自己作品、能被模型读到的稿纸**：写第一版、堆碎片、把素材整理成段落，然后让模型参考它继续写。

它不是一个聊天框旁边的文本框，而是三件事合成的一个面：

1. **工作区级的灵感正本**——一个灵感 = 一个 markdown 文件，落在作品目录里，是普通文本文件，随时可以用别的软件打开、备份、拷走。
2. **一块好用的写作区**——右栏全屏，左侧灵感列表，右侧编辑/预览/并排；从 Excel 或网页粘表格进去要变成真表格。
3. **一条通往模型的路径**——写完复制路径，粘进对话，模型自己读。v1 **只做复制路径**，不做任何自动注入。

## 现状（官方契约实测 / 已有实现）

立项前逐条实测过，结论决定了方案的形状：

**① 写文件有官方 seam，且比预期省事。**
`ctx.fs.writeText(target, content, expected?)`，`expected` 是 `FsWriteIntent = { kind: 'createIfAbsent' } | { kind: 'replaceIfVersion', version }`（`packages/fs/fs/src/types.ts`）。版本不符抛 `FS_STALE_VERSION`；返回值 `FsWriteOutcome` 直接带 **`before` / `after`**（LF 归一化的 diff 基准）。另外 `writeFileAtomic` 内部 `mkdir(directory, { recursive: true })`（`packages/fs/fs-local/src/fsio.ts:581`）——**建目录不用自己写**。

即：新建、覆盖保护、diff 基准，官方全给了，插件只需要把 `version` 串下去。

**② 删除/重命名没有任何官方路由。**
`FileSystem` 抽象类共 13 个方法（resolve / processPath / fileUrl / contains / stat / lstat / readText / streamText / readBytes / readByteRange / listDir / writeText / editText），**没有 `remove`，也没有 `rename`**；`rm` 只出现在 `writeFileAtomic` 内部的临时目录清理。`workspace-controller` 的 `@Remote('delete')` 删的是**工作区注册**（"Remove one Workspace registration **while retaining files and Sessions**"），不是文件。`SandboxedFileSystem` 只 override `writeText` / `editText`——**沙箱围栏也只挂在这两个口上**，裸 `node:fs.rm` 会绕过它。

**③ 会话归档是语义先例，不是文件操作。**
`WorkspaceRegistry.archiveSession` 把一个 id 追加进 `archivedSessionIds: SessionId[]`（随 registry state 持久化），Remote 上的语义只有一句："**Hide one known Session from Workspace grouping surfaces**"；注释明确"Archiving never touches workspace accounting"。补充实测：官方**没有 unarchive 路由**，客户端也**还没有归档 UI**（只有 `connection/src/client/fixture.ts` 在模拟）。

**④ 复制的用法已有先例。**
`writeClipboard`（`@deepseek-ai/dsh-client-ui-primitives`）优先 async Clipboard API、回退 `execCommand`，**只在宿主真接受时返回 true**。产物 tab 的复制路径是 `writeClipboard(resolveWorkspacePath(sessionCwd(sessionId), path))`（`packages/ui-file-preview/src/client/index.ts:210`），`resolveWorkspacePath` 来自 `@deepseek-ai/dsh-util-workspace-path`。

**⑤ 产物 tab 只读，跨工作区引用可行。**
官方 `workspaceFiles` Remote（`packages/api/workspace-files/src/index.ts`）只有 read / readBytes / readAll / readRelated / stat / list / changes，**没有写**。而 `tool-fs` 里 `applyReadTool(ctx, …)` **没有接沙箱控制器**，沙箱只给了 `applyWriteTool` / `applyEditTool`（`packages/fs/tool-fs/src/index.ts`）——所以模型的 `read` 不受工作区限制，**绝对路径可以跨工作区读**。

**⑥ 右栏入口是白送的。**
`ctx.sidebarRightTabs.register(definition)`，`definition.guide` 里的条目会自动成为指南页卡片（`GuideBody.tsx`：*"a muted compass over the entry capsules every registered type contributed"*）；而 `contract/seed.ts` 的 `defaultSeed` 只在"零个或多个"注册类型时显示指南页，**只有一个类型时直接进入它**。

**⑦ 编辑器本身没有官方组件。**
`ui-primitives` 的 `Input` 源码注明"Composer textareas are NOT this atom"。编辑器要自己写。但周边全有：`MarkdownText`（GFM 表格、CJK 加粗、shiki、KaTeX，`ui-primitives/src/markdown/parse.ts:28`）、`Button` / `Menu` / `Modal` / `Tooltip` / `Toast`、`FileTypeIcon`、`relativeTime`、全套 icon（`icons/index.tsx`）、以及 `--dsw-*` 主题 token 体系（`ui-theme/src/styles/design-platform.css`）——**暗色适配靠只用 token 白送**。

## 方案

### 0. 命名与定位

- 显示名 **灵感画布**；包名 `@khorsheed/dsh-canvas`，目录 `packages/canvas`（npm 未占用，2026-09-13 查）。
- 一切条目统称**灵感**，长短不限。v1 有两种 kind：**文章**（长文）与**灵感卡片**（碎片），二者在同一个列表里混排。

### 1. 数据模型

```
<workspace>/灵感画布/
  文章/第一章 雨夜.md          # 一个灵感 = 一个 md 文件，文件名即 id
  卡片/雨伞的意象.md
  .index.json                 # { order: [...], archivedIds: [...] }
```

- **子目录即 kind**，前端从路径判断，不依赖 frontmatter——非技术用户会在别的编辑器里把 frontmatter 改坏，而目录和文件名他们本来就会用。
- **`.index.json` 存两样东西**，形状照官方 registry state（`workspaceIds` 是显示顺序、`archivedSessionIds` 是归档集）：`order` 是列表顺序，`archivedIds` 是归档集。走 `ctx.fs.writeText` 写，**全程在官方 seam 内**。
- 索引缺失/损坏时**降级**：按文件 mtime 排序、无归档项——不报错。
- 工作区内**可见的中文目录名**，不是隐藏目录。理由：目标用户是写作者不是工程师，`.dsh/` 对他们等于"文件丢了"；他们需要用别的软件打开、备份、发给别人。

### 2. 宿主半边：一个 Typert Remote，三个方法

```
list({ dir })                          -> [{ name, kind, updatedAt, version, words }]
read({ dir, name })                    -> { content, version }
write({ dir, name, content, version }) -> { ok: true, version, before, after }
                                       |  { ok: false, error: 'FS_STALE_VERSION' }
```

照 `packages/local-files/src/remote.ts` 的惯例：**纯 JSON、绝对路径参数、不做会话查找**。新建 = `write` 带 `{ kind: 'createIfAbsent' }`，同名拒绝（这就是"灵感重名"的判据）。归档/恢复 = 改 `.index.json`。

**不用官方 `workspaceFiles` 来省掉读取**：它的 `read` 是带行窗口和上限的分页接口、`readAll` 返回 base64 字节，都不是"给我一篇完整文本"；而写盘那一个方法照样要 gen-typert，**链路省不掉，只会多一层适配**，读写都放自己服务里更整齐。

**分层**：`CanvasStore`（纯核心逻辑，基于 `ctx.fs`）+ `CanvasRemote`（薄适配层，只校验参数与转发，注释里照 local-files 写明 "no logic is copied"）。

### 3. 客户端半边

- **右栏页型 tab**：`ctx.sidebarRightTabs.register({ id, kind: 'canvas', title, guide: [{ icon, title, description }] })` + body 注册进 `sidebar.right.pane.tab`（keyed，key = 包名）。**不接管 `sidebar.right.tab.guide`**——保持官方入口行为（只有我们一个类型时直接进入，有多个类型时显示指南页卡片）。
- **布局**：左列表（可折叠）＋ 右区（编辑 / 预览 / 并排）。
- **列表可折叠**；切到「并排」时若列表展开则**自动收起并提示一次**，用户手动展开后不再强制收起（不跟用户抢控制权）。
- **新建**在列表顶部：`＋ 新建` → 菜单选**文章 / 灵感卡片**。做成类型选择器以便后续加形态。不用 `sidebar.footer.action`。
- **归档**：行内动作，**无确认**（可逆、文件未动），移入列表底部「已归档 (N)」折叠区，可恢复；操作后给一条可撤销提示。
- **状态栏**：左边保存态（保存中… / 已保存），右边显示**相对路径** `灵感画布/文章/第一章 雨夜.md`。
- **复制路径按钮复制绝对路径**（`writeClipboard(resolveWorkspacePath(sessionCwd(sessionId), relPath))`）。理由：用户会把草稿引用到**其他工作区**的会话里，相对路径在那里解析不到；状态栏显示相对路径是因为它短、可读、截图不泄露本机目录——**显示与复制分工**。
- **入口图标**：`IconLightOutline16`（灯泡 = 灵感）或 `IconListPenOutline16`；折叠用 `IconChevronLeftOutline14` / `IconChevronRightOutline14` 或 `IconPanelLeftOutline16`；归档 `IconArchiveOutline20`、恢复 `IconRefreshOutline14`、新建 `IconPlusOutline16`、复制 `IconCopyOutline16`。全部走官方 icon 集，不自绘。

### 4. 编辑器的实现约束（这几条是"好用"的全部）

- **非受控 `<textarea>` + ref**，状态回流时**绝不重设 `value`**——受控组件每次保存回流都会把光标打到开头，写长文直接不可用。
- **`compositionstart` → `compositionend` 期间暂停保存与重渲染**。中文输入法候选框被重渲染打断是这类插件的头号崩溃点。
- 自动保存 debounce 800ms；保存带 `replaceIfVersion`。
- **样式只用 `--dsw-*` token**，不写任何硬编码色值（暗色因此是自动跟随，不是"适配"）。
- 预览用官方 `MarkdownText`，不自写渲染器。
- **滚动容器只能有一个**：外层 wrapper 不得同时设 `overflow: auto` 与 textarea 自身滚动（首版原型踩过，并排时出现两根滚动条）。

### 5. 粘贴表格

拦截 textarea 的 `paste`：

1. 优先读 `clipboardData.getData('text/html')`，用 `DOMParser` 取 `<table>` 转 markdown（处理 `colspan` 降级、单元格内 `|` 转义、`\s+` 归一）；
2. 回退 `text/plain`：判定"制表符分隔且多行列数一致"才转，**不可靠就放行按原样粘**（绝不把正常段落文字弄坏）；
3. 插入用 `document.execCommand('insertText', false, md)` 而非 `ta.value = …`——**后者会清掉浏览器原生撤销栈**。

另提供**「选中转表格」兜底动作**：选中文字后按制表符或连续 2+ 空格切列。PDF / 纯文本里空格对齐的表格没有制表符也没有 `<table>`，任何自动检测都会拒绝，必须有人工出口。

### 6. 与 mode-switcher 的关系（M2 起）

本插件 provide 了服务（`TypertRemoteService`），**不属于** mode-switcher 的「会话插件化」清单（那条判据是"不 `ctx.provide` 任何服务"）。因此走**全局常驻 + 自隐**：照 `packages/room/src/client/preset-visibility.ts` 的约定，读官方 `pluginInventory` 判断当前会话 preset 组合里有没有我们，没有则隐藏右栏入口；**一切读不到的情况 fail OPEN（可见）**，绝不因为判据读不到就把写作入口锁死。

## 里程碑

- **M1（v1，可独立交付）**：`CanvasStore` + 三方法 Remote + 右栏 tab（列表 / 编辑-预览-并排 / 新建文章-卡片 / 归档-恢复 / 复制绝对路径）+ 粘贴表格转换 + 选中转表格 + 自动保存与版本守卫。**零上下文注入**——引用靠用户手动复制路径。
- **M2**：引用通道——`ctx.on('agent/pre-step')` 追加一条一次性 durable 快照（`source: { kind: 'plugin', plugin: 'canvas', form: 'snapshot' }`），内容是指针（路径 + 版本 + 字数 + 前 N 行）而非全文，同版本只注入一次；接入 preset 自隐。
- **M3**：候选稿——模型侧 `canvas_propose` 只写 `.proposals/` 候选稿，正本只有用户「接受」才写；对比用 `FsWriteOutcome` 的 `before`/`after`；接受时存历史，支持回退。
- **M4**：卡片的画布形态（自由摆放 + 模型在对话中投放）、`ui-shortcuts` 快速捕获、跨工作区写回（受沙箱限制，见风险④）。

## 实现记录

（随实施追加：相关 Agent Note / 包名 / 提交）

## 验收标准（done 判定）

以**独立插件包**交付并验收，零官方代码改动：

1. `@khorsheed/dsh-canvas` 可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载；包内 `files` 含 `lib/client.js` 与 `cordis.patch.yml`。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过。
3. 3080 实测：右栏出现灵感画布入口 → 新建文章 → **连续中文输入 30 秒输入法不被打断、光标不跳** → 切并排时列表自动收起 → 粘贴 Excel/网页表格变成真表格且 `Ctrl+Z` 可撤销 → 状态栏显示相对路径、复制得到绝对路径 → 把绝对路径粘进**另一个工作区**的会话、模型 `read` 成功 → 归档后从列表消失、文件未动 → 恢复回原位 → 深色主题正常。
4. 卸载后 `<workspace>/灵感画布/` 下的文件**原样保留**。

## 风险 / 放弃的东西

① **不做删除，只做归档。** 官方没有任何删文件的 seam（证据见「现状②」）；补一个裸 `node:fs.rm` 会绕过 `writeText`/`editText` 上的沙箱围栏，在只读部署下仍会成功——那是破坏安全边界，不是省事。归档与官方会话归档语义一致（隐藏，不动文件），且完全落在 `ctx.fs` 之内。若日后确需真删，走上游提 `FileSystem.remove` / `rename`（可选，不阻塞本提案）。

② **外部编辑器的改动收不到通知。** 官方 `workspaceFiles.changes` 是 `fs/observed` 事件的流，**只报被插桩的文件系统操作，不观察操作系统**。所以外部改文件只能靠保存时的 `replaceIfVersion` 兜底，不能靠推送。

③ **冲突时不静默覆盖。** 撞 `FS_STALE_VERSION` 就停下、进入冲突态并给出选择，绝不用无条件写把用户或外部的改动盖掉。

④ **跨工作区只读不写。** `read` 不受沙箱限制（已实测），但会话 B 的沙箱是 `workspace-write` 且以 B 为界——模型改不回工作区 A 的稿子。v1 只读引用无影响，写回属 M4 且需要设计。

⑤ **中文目录名的副作用。** `git status` 里会因 `core.quotepath` 显示成八进制转义（功能正常，观感吓人），README 需提一句。宿主侧一律走 `ctx.fs.resolve` 拿绝对路径、**不 shell 出去**，中文与空格都不成问题。

⑥ **不替用户改 `.gitignore`。** 目标用户不懂 git。首次写入时若检测到 git 仓库且该目录未被忽略，给一条**可关闭的一次性提示 + 一键加入**，不静默改用户的仓库文件；提示里说明"已被提交过的目录加入 .gitignore 不会移出版本控制"。

⑦ **v1 不引入 `turndown`。** 生态里已有 `turndown` + `@joplin/turndown-plugin-gfm`（宿主侧 `packages/web/tool-web`），但那是整篇 HTML 转换——Excel/Sheets 复制出来的 HTML 里塞满样式和整张表，整篇转换更脏。**只抠 `<table>` 单独转更稳且零依赖**。将来若要保留标题/粗体再评估引入。

⑧ **不做"无缝富文本"。** 正本是 markdown 纯文本，编辑器就是 textarea + 官方预览。上 Lexical 那类富文本会要么牺牲正本的纯文本性，要么引入 dom↔md 双向转换损耗，与「文件是正本」的定位冲突。

⑨ **M1 不做模型侧工具、不做自动注入。** 用户明确要求 v1"写完能复制文件路径给模型就可以"。注入做成默认行为会让草稿每轮烧 token 并污染无关会话，而"默认不发、用户点引用才发"是已定的产品判断。
