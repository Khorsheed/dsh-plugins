# Agent Note: 产物面二期——无头内核、turnTail 遮蔽与产物薄壳（宿主 0.1.7-rc.1）

Status: implemented

## Problem

方案 B（2026-09-24，提交 `2fdc81ad`）把 ui-file-preview 的内容面板注册进官方
document tab 作为默认渲染器，并退役了自建 FilePreviewTab 内容页。在 rc.1 实例上
实测暴露了第一版接受的三个问题：

1. **三重 chrome 叠加。** 官方 document tab 已画路径行、「打开方式」渲染器下拉、
   重新读取与原生打开 actions——而我们嵌入的面板重复了同样的行（自己的标题/路径
   栏、自己的内容搜索行、自己的预览/源码切换）。两条工具栏叠在一起，读作一个坏掉
   的面。
2. **每回合两张产物表。** 官方 `DeliverablesTail` 条目渲染模型策展的 present 卡
   （持久）加 workspace-changes 卡（内存态、宿主重启即失）；我们的 TurnFileRow 在
   正下方渲染持久、全量的每回合清单。用户拍板（2026-09-24）：只留我们的。但
   present 卡同时是二进制（图片、Office）的打开入口——压制它必须先证明不断这条
   链，且仓规禁止 DOM 隐藏/注入 hack（DOM 锚只是必须带 fallback 的最后手段——本任
   务不允许走这条路）。
3. **会话产物入口没了。** 被退役的页是列出一个会话写过的所有文件的唯一位置。这个
   功能需要回来，但不能复活自建内容视图。

## Decision

三招，全部只落在 rc.1 臂；0.1.5 臂不动。

**A. 共享内核长出显式 `headless` 模式**（opt-in prop，永不探测）：
`packages/ui-content-preview` 的 ContentPane 只压制宿主框架已携带的 chrome——
标题/路径栏与视图切换——渲染内容区（外加截断提示与渲染超时提示）。两个手势
**保留**，因为 rc.1 官方 document tab 对两者都没有等价物：内容搜索行（已核实：
ui-sidebar-documentpreview 的 rc.1 源码与产物包里都没有任何搜索输入框——保留是
独有贡献，不是去重对象；headless 首版曾压掉它，同日被仓主纠正）与内容区右上角的
浮动复制路径钮（官方 `sidebar.right.tab.document.actions` 的贡献——ui-open-in-app
的 OpenPathAction——只有原生打开，官方 TextPreview 头部没有复制手段）。只有
ui-file-preview 的 FileContentBody（官方 document tab 的默认渲染器）用它；
local-files 与 worktrees 没有宿主框架可借，继续完整 chrome。

**B. 官方产物卡被遮蔽，而非删除。** 机制评估按任务顺序走完：

1. *Config 开关*——不存在。`tool-present` 的 Config 只有 `maxFiles`
  （harness `packages/deliverables/tool-present/src/index.ts:15-23`）；
  `workspace-changes` 的 Config 只有限额
  （`packages/deliverables/workspace-changes/src/index.ts:33-51`）；ui-deliverables
  client 根本没有导出 Config——它唯一的闸是面向用户的
  `configForms.developerTools.enabled` 偏好（只闸 changes 卡，
  `packages/client/ui-deliverables/src/client/Deliverables.tsx:70,79`），语义无关且
  不由我们翻。
2. *slot 遮蔽*——一等且有文档。`conversation.chat.turnTail` 是 list 槽
  （`packages/client/ui-chat/src/client/contract/slots.ts:265`）。slot core 对同 cell
  条目按 priority 升序排、渲染最低的在册条目：`packages/client/ui-slots/src/index.ts:778`
  （list 的 KindOptions 文档：「lowest renders；same id + same priority throws」）、
  `:1229-1235`（register() 抛出的提示原文就是遮蔽指引）、`:1352-1368`
  （`entriesOfSlot` 把每个 cell 投影到赢家），list 出口消费的正是这个投影
  （`packages/client/ui-renderer/src/client/scoped-slots.tsx:1220`）。遮蔽自
  0.1.0-rc.8 起存在（`0367506471`），所以凡 turnTail 是 list 语义（0.1.6-alpha.2+）
  的宿主都有它。

  于是 list 臂在官方卡片的 cell id `@deepseek-ai/dsh-client-ui-deliverables` 下注册
  第二条 `priority: -1`、渲染 null 的条目。官方注册仍在册——它声明的
  `deliverables.file.actions` 子槽不塌，ui-open-in-app 对它的贡献照常注册；mention
  打开包装（`chatFileMentions`）是 provided 服务，不受影响。全程零 DOM 触碰；卸载本
  插件 fiber 即精确恢复官方卡。

  二进制打开链落地前已验证：present 卡（Deliverables.tsx:111）与我们 TurnFileRow 点
  击走的是**同一个** owner `openFile`，ui-chat 的实现是
  `sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))`
  （`packages/client/ui-chat/src/client/apply.ts:184`）。官方 text tab 类型以 fallback
  档认领一切会话文件地址；渲染器选择按后缀匹配，而我们的内容渲染器只认领文本集加
  avif——图片（png/jpg/…）落官方 image 渲染器，Office 落官方 office/excel 渲染器，未
  知二进制落官方 unpreviewable 态加原生打开 actions。这条链没有一环经过被压制的卡。

**C. 会话产物入口以薄列表壳回归。** 新 page-type 右栏 tab 类型 `file-artifacts`
（向导页「会话产物」，沿用退役页的图标与标题）列本会话写过/改过的文件，数据源是现
有宿主 fold（`filePreview.list`——不新造 Remote），名称过滤与刷新原样携带。点行把规
范地址 `dsh-resource://file/session/<id>/<path>` 走 `sidebarRight.openResource`——官
方 document tab 渲染（我们的内容渲染器是默认体；改动记录一个下拉之遥）。壳不认领
任何地址（无 `patterns`）、不画内容。它与渲染器同一个
`inject: ['documentPreviews']` 嵌套 fiber 注册，所以它恰好只存在于 rc.1 线。

## Alternatives considered

- **用 CSS / DOM 删除压卡**——直接违规：仓规只允许 DOM 锚作为带 fallback 的最后手
  段，且任务明确禁止本任务走这条路。它还会随宿主每次渲染改动而失步。
- **包装/猴子补丁官方条目的组件**——slot 系统没有这种钩子；包装必须跨包盯
  DeliverablesTail 的函数身份，正是 slot 机制存在所要避免的脆弱耦合。
- **维持并存（2026-09-18 的决定）**——已试过；用户看到每回合上下两张表，拍板收敛
  （2026-09-24）。
- **壳注册为 `dsh-resource://file/**` 的认领方**（0.1.5 页的形态）——那会重新拆开
  「一个文件一个 tab」：rc.1 上官方 document tab 已认领全部文件地址并承载我们两个渲
  染器。page 类型零认领，路由保持单家。
- **把内容搜索行也压掉（整齐划一的 headless）**——首版正是这样做的，理由是宿主框
  架拥有全部 chrome。但 rc.1 官方 document tab 根本没有内容搜索（源码与产物包双向
  核实），压掉搜索行不是去重而是静默砍功能；仓主同日纠正。留下的规则：headless 只
  压制框架真正携带的东西。
- **把 HTML 脚本档的启动切换器带进 headless**——否决：切换器在形态上就是 chrome
  （视图切换），且同一下拉里的官方 HTML 渲染器已覆盖带脚本文档。

## Consequences

- document tab 只显示一条工具栏（官方的），下面是我们的内容体；回合区只剩一张产物
  卡（我们的，持久且全量）。
- 遮蔽单向且可逆：卸载或停用本插件即恢复官方卡；组合里没有 ui-deliverables 时只是多
  一条无害的空条目。
- rc.1 线上有意放弃的：只有面板在 document tab 内的 HTML 脚本档（其启动切换器属
  chrome；官方 HTML 渲染器一个下拉之遥）。内容搜索保留——见 Decision A。
- turnTail 遮蔽把官方条目 id 钉为数据。上游若改条目 id，遮蔽退化为空转（卡片回
  来）——fail-open，由断言赢家 priority 的 browser-plugin spec 兜底。
- 0.1.5 行为逐字节不变：chain 臂永不注册遮蔽（chain 槽没有遮蔽概念），没有
  `documentPreviews` 时壳永不注册。

## Testing

- `ui-content-preview`——content-pane spec 新增 headless describe:chrome 缺席（标
  题栏、视图切换）、搜索行在场且高亮可用、浮动复制钮（存在/点击/缺席）、diff
  supply 下钉住内容视图、截断提示。
- `ui-file-preview`——browser-plugin spec 断言账册形态（官方条目 + 遮蔽 + 我们的行
  共存）、经 `entriesOfSlot` 的遮蔽赢家、遮蔽体渲染 null、artifacts 类型/本体只在
  rc.1 注册、晚到退役与完全卸载；FileArtifactsTab spec 钉住列表渲染（只产物、最新在
  前）、点行路由、过滤、刷新与空/错态。
- `file-preview`（宿主半）未动且全绿。
