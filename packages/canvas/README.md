# @khorsheed/dsh-canvas

[English](README.en.md) | 中文

**灵感画布** —— 写作场景的工作区级灵感正本。一个灵感 = 一个 markdown 文件，落在你作品目录里；右栏一个面板：左边灵感列表，右边编辑/预览/并排。写完点「复制路径」，粘进对话，模型自己读。

它不是聊天框旁边的一个文本框：稿子是你的文件，随时可以用别的软件打开、备份、拷走。

## 功能

- **一个灵感 = 一个文件**。正本在 `<工作区>/灵感画布/` 下，`文章/` 与 `卡片/` 两个子目录分别是两种形态，文件名就是标题。没有数据库、没有私有格式。
- **右栏全屏写作区**（`sidebar.right.pane.tab` 页型 tab）：左侧灵感列表（可折叠），右侧编辑 / 预览 / 并排三档。切到「并排」时列表自动收起一次，把宽度让给正文。
- **粘贴表格自动转换**。从 Excel、Numbers、网页、Word 复制表格粘进来，会变成真正的 markdown 表格（预览里就是表格）。识别不了的东西**原样粘贴**，绝不把正常段落改坏。PDF / 纯文本里空格对齐的表格另有「选中转表格」手动入口。
- **复制绝对路径给模型**。状态栏常显相对路径（短、好读），复制按钮给的是绝对路径——因为你要把草稿引用到**别的会话甚至别的工作区**里去。
- **归档而不是删除**。归档只从列表里隐藏，**文件一个字节都不动**（官方会话归档的语义）；已归档区可随时恢复，恢复回到原来的位置。
- **中文写作友好**：输入法组合期间不触发保存也不重渲染，编辑器非受控所以光标不跳，自动保存带版本守卫（别处改过就停下，绝不静默覆盖）。
- **暗色自动跟随**：所有颜色都走官方 `--dsw-*` 主题 token，没有硬编码色值。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

装完重启宿主。卸载**不会**删除 `灵感画布/` 目录——你的稿子是你的。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`）自 0.1.5 起存在，`minHost` 随之抬到 0.1.5-rc.1；旧宿主没有右栏面，请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西。
- 宿主半边不注册模型可见工具、不向提示词注入任何内容（v1 的约定是「自己复制路径」）。
- **写入按「发起这次点击的会话」围栏**。三个写接口（新建/保存/归档）都先取调用会话的沙箱策略再写：围栏挂在会话自己的工作区上，不是宿主的进程目录。所以会话是只读模式时，画布会明确拒绝写入（`这个位置不可写`），而不是悄悄写进去。

## Known Limitations

- **只归档，不删除**。官方 `ctx.fs` 没有删除文件的接口（13 个抽象方法里没有 `remove`/`rename`；沙箱围栏也只挂在 `writeText`/`editText` 上，裸 `node:fs` 会绕过它）。要彻底删掉某个文件，请在文件管理器里删——它只是你的一个 markdown 文件。
- **外部编辑器的改动收不到通知**。官方 `workspaceFiles.changes` 只报被插桩的文件系统操作，**不观察操作系统**；在别的软件里改了稿子，插件只能靠保存时的版本守卫发现冲突。
- **列表顺序存在 `.index.json` 里，不按修改时间**。`ctx.fs` 不上报 mtime，所以顺序由索引维护（新建的排在最前），未在索引里的文件按文件名排在后面。
- **跨工作区只能读、不能写**。模型的 `read` 不受工作区限制，所以你能把 A 工作区的稿子引用到 B 工作区的会话里；但会话 B 的沙箱以 B 为界，模型改不回 A 的文件。
- **中文目录名**：`git status` 里会因 `core.quotepath` 显示成八进制转义（功能正常，观感吓人）。宿主侧一律走 `ctx.fs` 拿绝对路径，不 shell 出去，所以中文与空格都不成问题。
- **HTML 表格的合并单元格降级**为「文本 + 空格子」，不重建跨行列。
- v1 **不做**：模型侧工具、把草稿自动注入上下文、候选稿 diff、卡片的自由画布。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

**磁盘布局**

```
<工作区>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` 的形状照官方 workspace registry：`order` 是显示顺序，`archivedIds` 是归档集——和官方用 `workspaceIds` + `archivedSessionIds` 表达「顺序 + 归档」是同一套。索引缺失或损坏时**降级**为按文件名排序、无归档项，绝不因此打不开画布。

**宿主半边**：`CanvasService`（核心逻辑）+ `CanvasRemoteService`（Typert Remote，namespace `canvas`）。五个方法 `list` / `read` / `create` / `write` / `setArchived`，全部**纯 JSON、绝对路径参数、不做会话查找**（local-files 的惯例）。每次写入都走挂载的 `ctx.fs`，因此部署的沙箱模式会拦下越界写入，观测策略也能看到它；版本守卫由 `writeText` 的 `{ kind: 'replaceIfVersion' }` 提供，冲突返回 `stale` 而不是覆盖。

**客户端半边**：`ctx.remote.$mount` 挂 Remote，注册 tab 类型（`guide` 卡片让它在官方指南页出现；当它是右栏唯一的页面类型时，官方 `defaultSeed` 会直接进入它）+ keyed `sidebar.right.pane.tab` 的 body。宿主半边缺失时（`ctx.get('remote.canvas')` 为 undefined）客户端仍然注册，只是报告缺失——不会把 boot 拖垮。

**编辑器的三条硬约束**（都在 `CanvasView.tsx` 里，因为破坏任何一条都会毁掉写作）：非受控 `<textarea>`、用 load token 作 `key` 重挂载，状态回流永不写回 `value`；输入法组合期间既不保存也不更新预览；外层容器不滚动、只有 textarea 滚动。

**粘贴转换**（`paste-table.ts`，纯函数）：优先读 `text/html` 里的 `<table>`（只抠表格，不转换整篇文档——电子表格的剪贴板 HTML 带着整张表和样式），回退判定制表符分隔；插入用 `document.execCommand('insertText')` 以保留浏览器原生撤销栈。

无配置项。

</details>
