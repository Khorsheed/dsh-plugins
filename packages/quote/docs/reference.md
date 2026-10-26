# @khorsheed/dsh-quote 完整参考

> 面向开发者的完整说明：选区浮层、投递目标、向菜单贡献动作的契约、兼容细节与实现原理。2026-10-26 前它是本包的 README；面向用户的简介见 [README](../README.md)。

[English](reference.en.md) | 中文

## 概览

想把助手回复里的一段话、文件预览里的一段内容拿来追问，以前只能手动复制、切换、粘贴。这个插件在应用内任何选区旁浮出动作菜单：**引用到当前会话**（选中文本作为带来源标注的引用块进 composer，待编辑，绝不替你发送）、**引用到侧边对话**（排成 side-chat 的待发送 ref）、**复制**；其他插件可经 `ctx.quoteActions` 注册表往菜单里加自己的动作行（见[向菜单贡献动作](#向菜单贡献动作其他插件)）。引用 = 选中的纯文本 + 来源标签，是不透明文本块：本插件不认识任何具体插件的类型，side-chat 缺席时对应菜单项自动隐藏，插件独立可装卸。

## 特性

- **选中即出菜单**——应用内任意非输入区域选中文本，选区旁浮出小工具条；输入框、菜单自身内的选区不触发，滚动或缩放即隐藏。
- **引用到当前会话**——选中文本在支持引用 chip 的宿主线上变成 composer 草稿里的结构化引用 chip（行内标签带来源，发送时由本插件注册的 codec 序列化回带来源标注的 `> 引用块`；无此缝的宿主或插入被拒时回退纯文本块）：空白草稿直接填入，已有内容空一行后追加——绝不覆盖、绝不发送。**点击 chip 在点击处浮出全文预览卡**（×、Esc、点外部关闭），随时核对引了什么。房间会话同样生效（房间作曲器的草稿即官方输入机草稿）。
- **发出后渲染为引用卡片**——发出的消息里，引用块由本插件的 `quote-block` 用户文本规则匹配，经 keyed 槽位渲染为带来源行的卡片（两种语言的署名都能匹配，卡片来源行跟随当前语言）；宿主没有 user-text 缝时保持原始文本。
- **引用到侧边对话**——选中内容排成绑定当前会话的 side-chat 待发送 ref（contextKey = 会话 id），成功后右侧栏的 side-chat 标签页自动浮现。
- **复制**——原文经官方 `writeClipboard` 助手进剪贴板。
- **菜单行可扩展**——其他插件经 `ctx.quoteActions` 注册表注册自己的动作行（比如画布插件注册「存为画布卡片」），收到同样的 `{ text, label, sessionId }` 不透明载荷；菜单不知道任何动作把内容投递到哪里。
- **全程探测降级**——overlay 座位、当前会话、side-chat、两个 Remote 命名空间逐项探测：缺席即隐藏对应菜单项（或整体不出现），任何组合都能正常启动。

## 选区浮层

- 根级组件挂在帧级 `shell.overlay` 座位（`ctx.slots.inject` 注册），监听应用级选区。
- 只读 `window.getSelection()` 的**选中纯文本**与其包围矩形——不抓取宿主 DOM 结构、不依赖类名。唯一的结构判定是手势本身要求的排除：选区在 input / textarea / contenteditable 内（编辑行为，不是引用源）或在菜单自身内 → 不出现。
- 选中为空 → 不出现；滚动 / 缩放 → 隐藏（缓存的视口坐标已过期）。
- **兜底语义**：宿主改版让读取失效时，浮层安静不出现——功能缺失但零破坏（AGENTS.md last-resort 条款），每次 host 适配人工复验一次。
- 结构化内容（表格/代码块）按纯文本引用，不做结构还原。

## 两个投递目标

| 目标 | 机制 | 形态 |
| --- | --- | --- |
| 引用到当前会话 | 官方输入机：`slash/input-insert-reference` 作用域事件插入结构化引用 chip（本插件注册的 codec 在发送时序列化回引用块；缝缺席或插入被拒时回退 `setDraft` 合并纯文本）——绝不覆盖、绝不发送 | 引用 chip（回退时 `> 引用块`）+ 来源标注，进 composer 待编辑 |
| 引用到侧边对话 | 本包自带的薄 typert Remote（namespace `quote`，verb `addRef`）→ 宿主半探测 `ctx.get('sideChat')` → `openWith`（宿主到宿主的正当 seam，结构镜像，绝不 import sidechat） | ref chip 落在绑定当前会话的 context（contextKey = 会话 id）上，成功后经官方 `sidebarRight.openTab` 导航面浮现 tab（探测，无座位则静默） |
| 复制 | 官方 `writeClipboard` 助手 | 原文进剪贴板 |

为什么不用 side-chat 自己的 Remote：M2 探针结论是其对外 verb（`send` 直接发一整轮、`quoteMessage` 按消息 id 引用助手消息）没有「只排队一条 pending ref」的客户端可达入口，所以本插件带了自己的薄 Remote 适配那一调用。

**来源标签**：内容自己声明的出处——选区外层元素带 `data-quote-source`（文件预览写文件名、灵感空间写文章名）就用它；同一元素再带 `data-quote-ref`（绝对路径、链接）时，发给模型的署名行附上这个位置（`—— 引用自「README.md」（/abs/path/README.md）`），chip 上仍只显示短名字，点 chip 的预览卡底部列出位置。没有声明出处的选区（对话本身）不写来源：chip 显示引用内容的摘录，模型收到不带出处的引用块（`—— 引用`），发出后的卡片只显示正文。

**降级矩阵**：无当前会话 → 两个引用项都隐藏（只剩复制）；`remote.sidechat` 或 `remote.quote` 缺席 → 「引用到侧边对话」隐藏；点击仍赶上 side-chat 服务缺席 → verb 拒绝 `unavailable`，静默无操作。

## 向菜单贡献动作（其他插件）

菜单行是可扩展的：本插件的浏览器半在 apply 最顶部 `ctx.provide` 一个动作注册表 **`ctx.quoteActions`**（ui-shortcuts 的 `ctx.shortcuts` 先例），任何插件都可以往选区菜单里注册自己的动作行——比如画布注册「存为画布卡片」：

```ts
// 仓内消费方：ctx.get 探测 + 结构镜像 + 在 manifest 的 dsh.references 声明
// '@khorsheed/dsh-quote'（数据引用，非依赖）；仓外 npm 消费者可以直接
// import 类型（'@khorsheed/dsh-quote/client' 导出 QuoteActionContribution 等）。
const registry = ctx.get('quoteActions')
if (registry !== undefined) {
  ctx.effect(() => registry.registerAction({
    id: 'my-plugin.save',                              // 约定 <plugin>.<action>；重复 id 注册即抛错
    label: () => t('menu.save'),                       // 每次菜单打开重新求值——闭上你自己的 locale 面
    // icon: <MyIcon />,                               // 可选；缺省由菜单补一个通用图标
    available: target => target.sessionId !== undefined, // 可选显隐闸；每次打开重新求值
    run: (target) => { void save(target.text) },        // 菜单先关闭再执行
  }), 'my-plugin: quote action')
}
```

- **target 是不透明载荷**：`{ text, label, sessionId, ref? }`——选中的纯文本、best-effort 来源标签（内容声明的出处，否则当前会话显示名，否则引用摘录）、位置（内容声明了 `data-quote-ref` 时才有）、当前会话 id（无当前会话时为 `undefined`，动作要自己经 `available` 隐藏）。注册表不知道任何动作把内容投递到哪里，正如本插件不知道任何引用来源的类型。
- **顺序**：内置三行（引用到当前会话 / 引用到侧边对话 / 复制）恒在前，贡献行按注册顺序追加在后。
- **降级**：quote 缺席 → 探测落空、动作永不出现（静默，不要 inject 本服务）；你的插件缺席 → 它的行不出现。两侧都不炸。
- **时序**：注册发生在 boot 期；apply 时探测不到就说明 quote 未装或晚于你的插件加载——按降级处理即可。
- **健壮性**：贡献的 `label` / `available` / `run` 抛错只进日志——label 降级为 id、available 降级为隐藏、run 静默，绝不拖垮菜单。
- 契约全文见 `src/client/registry.ts`。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——`shell.overlay` 座位（ui-layout 帧）与会话输入机（`conversation.input.for`）在该线均在，`minHost` 钉在 0.1.5-rc.1。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。
- **座位探测降级**：唯一表面走 `ctx.slots.inject` 注册——宿主不声明 overlay 座位时浮层整体静默缺席，不影响启动；headless profile 没有浏览器消费者，本插件在那里不贡献任何东西（宿主半边照常提供 Remote，verb 按探测结果拒绝或受理）。
- **选区读取是 last-resort DOM anchor**：只读 `window.getSelection()` 的纯文本与矩形；读取本身抛错时按「安静消失」兜底，绝不拖垮启动。
- **side-chat 是声明式可选协作**：`dsh.references` 声明 `@khorsheed/dsh-sidechat`（数据引用，非依赖）；side-chat 缺席时对应菜单项隐藏，其余照常。
- **引用 chip 是探测降级**：`ctx.inputTriggers` 服务缺席（codec 无载体）或插入被宿主拒绝（旧宿主无监听、草稿修订号竞争、相位锁定）→ 自动回退纯文本 `> 引用块`，行为与旧版一致；`minHost` 不动。
- **发出后的引用卡片**：`uiConversation.userText` 注册表与 `conversation.user.text.node` keyed 槽位同在 0.2.x 线；缺缝的旧宿主上消息保持原始 wire 文本（纯 `> ` 引用块），不影响发送。
- **房间会话**：房间插件的作曲器草稿即官方输入机草稿（2026-10 起），引用直接落在房间输入框——chip 在房间 textarea 投影为其文本形态，编辑即摊平（刻意降级）；旧版房间插件下引用写进不可见的官方草稿（看似没反应），升级房间插件即修复。

## 已知限制

- **DOM anchor 的脆弱性**：宿主改版可能让浮层判定失效——兜底是安静消失；上游 seam（选区动作位）才是正解，已起草上游提案（`docs/upstream-proposals/2026-09-16-selection-actions.md`），落地后本路径按区域退役。
- **引用是纯文本快照**：不回链原文位置（v1 无锚点 seam）；来源标注只到「会话」粒度（选中自画布卡/文件预览时同样标注当前会话名，是 best-effort 的刻意取舍）。
- **输入框内选区不触发**（避免和编辑行为打架）；代码块/表格选区按纯文本处理；滚动或缩放时浮层隐藏而不是跟随（v1 从简）。
- **菜单不含键盘导航**：浮层是不占焦点的工具条（`role="toolbar"`），键盘流留待 M2 随上游 seam 一起评估。
- **chip 是整块的**：引用正文在 composer 里不可逐字编辑（纯文本回退路径可以），退格整块删除；卸载本插件后草稿里残留的 chip 按宿主设计阻塞发送（删掉该 chip 即恢复，不会静默丢文本）。
- **房间里的 chip 摊平**：房间作曲器是纯 textarea，chip 投影为其剪贴板文本，一旦编辑即摊平为纯文本。

## 工作原理

**选区 seam（可注入）**：`src/client/selection.ts` 把「应用级选区 → 快照」收敛成一个 `SelectionSource` 小接口——真实实现监听 `selectionchange`（拖拽中挂起、mouseup 即时评估、键盘路径 120ms 防抖）与 scroll/resize（隐藏）；组件测试用手动 source 驱动，从不触碰真实 `window.getSelection()`。分类是纯函数（空/可编辑/自身菜单 → null）。

**消费语义**：动作发生在捕获的快照上，与活选区无竞态。动作后菜单关闭；点击自身 mouseup 会让 source 重报同一选区，这一声「回声」被消费标记忽略，下一个不同选区正常唤起。

**路由：当前会话**：`formatQuoteBlock`（每行 `> ` 前缀 + 块尾来源标注行）是先行的文本形态。有引用缝的宿主上，插入走 `slash/input-insert-reference` 作用域 bail 事件：chip 的 `ref` 编码完整剪贴板文本（含空行前缀），codec 的 `serialize`/`clipboardText` 都解码同一份载荷，模型收到的与用户看到的逐字一致；span 坐标用 detect 投影（已有 chip 折叠为单字符），草稿修订号 CAS 被拒时重读快照重试一次。缝缺席或两度被拒时回退 `mergedQuoteDraft` 纯文本合并——空白草稿直接填入，已有草稿空一行后追加，绝不覆盖用户正在输入的内容（message-tools backfill 先例）。

**发出后的卡片**：`quote-block` 用户文本规则（`src/client/usertext.ts`）按行首锚点匹配 `> ` 行串 + 双语署名行，payload 只带 `{ label, text }` 纯 JSON；keyed 渲染器（`QuoteTextNode`）去掉 wire 前缀、按当前语言重渲染来源行。规则顺序 20 排在官方内置之后，与 @ 会话引用无同起点竞争。

**chip 点击预览**：chip 的单击走宿主 `openReference` 手势（`reference-activation`：折叠选区、左键、非双击才路由），本插件的触发源解码 ref、把全文推给 `shell.overlay` 上的预览卡；预览卡锚定点击位置（`openReference` 不带坐标，apply 里 capture 相位的 pointerdown 记录供其锚定），无坐标时居中于 composer 上方。ref 载荷自含 `{ text, label }`，旧格式（无 label）照解。

**路由：侧边对话**：`remote.quote.addRef({ contextKey, label, ref })` → 宿主半 `openWith`（side-chat 记录 pending refs，下一条发送折叠进消息并清空）。verb 不带 calling agent：`openWith` 不持有会话域写入，side-chat store 对宿主侧调用按部署默认模式落围栏（canvas askAgent 先例）。

**动作注册表**：`ctx.quoteActions`（`src/client/registry.ts`）在 client apply 最顶部 provide；注册即追加、dispose 即移除，菜单经 `useSyncExternalStore` 订阅，热增删同帧反映。`list()` 的引用在两次变更间保持稳定，直接充当 getSnapshot。

**主会话判定（跨宿主形状）**：宿主 0.1.6-alpha.2 起 `SessionListState.current` 退役，主视图会话改由每个 summary 的 `retainedBy.mainView` 计数表达；菜单先探计数、再回退旧字段，npm 线与源码线共用同一份代码。

**身份同名**：cordis 行 id `quote` 与 `clientBundle('@khorsheed/dsh-quote')` 同名。

**导出**：`/client` 导出插件本体（`apply`/`inject`）、`SelectionQuoteMenu`、`QuoteActionRegistryRuntime` 与注册表/选区 seam 的类型；host 侧导出 `QuoteRemoteService`，`/types` 子路径提供线上载荷类型。
