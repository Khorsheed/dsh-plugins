# @khorsheed/dsh-sidechat

[English](README.en.md) | 中文

**侧边对话** —— 一个全 preset 常驻的「随身 Agent」：右栏里的轻量聊天，围绕「当前上下文」对话。普通会话里引用几条消息问两句；装了其他内容插件（如画布）时，它们的「就此提问」也由它承接。它一次建设、处处受益，且**不知道任何具体插件的存在**。

## 客户端（M2 起）

- **ref chip 内联展开**：composer 上方的待发送引用、以及 transcript 里用户消息携带的引用，都可点击展开为完整引用块（label + 全文，可收起）——引用内容随对话走，不用回来源 tab 查看。transcript 的引用是从持久消息文本里按我们自己的折叠格式解析回来的（重启后依然在）。
- **浮动 dock 模式**：tab 头部「弹出为浮层」把整个聊天面板变成一个可拖动的浮层（注册在官方 `shell.overlay` 帧层，worktrees badge 先例）——在自定义 main 面板（如画布空间）上边看内容边聊天，详情 tab 不用让位。浮层可拖动、位置记忆（框架 client store 持久化），关闭即回到侧栏 tab 同上下文；发送搭当前选中会话（无选中时只读）。无 overlay 座位或窄屏时降级为只 tab。
- **多 context 切换**：tab 顶部标题即上下文选择器（listContexts），切换即换 transcript；非当前上下文有新 assistant 回复时显示未读点（宿主侧投影给出每个上下文的最新 assistant 时间，客户端按 last-seen 标记比对，标记持久在 localStorage）。
- **openWith 自我浮出水面（M3）**：消费方一调 `openWith`，side-chat 客户端自己决定在哪里出现——消费方不用再（也无法可靠地）唤起右栏。机制：宿主给每个上下文维护 openWith 修订号（`rev`，仅 openWith 递增、持久化），客户端经轻量 Remote 动词 `surfaceHints` 轮询并比对；呈现规则是——会话面板激活（`usePanelInfo().activePanelId === null`）→ 右栏 tab；自定义 main 面板（如画布空间）→ 浮层 dock 并切到对应 contextKey；dock 座位缺席或窄屏 → 仍 `openTab`（导航被记录，回到会话面板即见）。**根因**：官方 `RightbarRoot` 只在会话面板激活时渲染右栏，所以消费方在自定义面板里 `openTab` 按构造静默失效——呈现决策必须内化在 side-chat 客户端。
- **选区引用（探针结论）**：会话区"任意文本选区 → ref"没有官方 seam（见 Known Limitations），M2 未实现；composer 照常接受粘贴纯文本。

## 会话模型

- **每个 contextKey 绑定一个持久 agent 会话**。普通会话里 contextKey = 来源会话 id——在任意会话打开右栏「侧边对话」tab，就是在围绕这个会话提问。首次发送时才创建会话（懒创建，组合默认 agent preset，继承来源会话的 cwd，文件工具照常可用）；重启后首次手势经 `ctx.agents.resume` 冷恢复，**历史从 session journal 投影，重启后完整**。
- **引用（ref）是不透明文本块**：`{ label, text }`。渲染为输入框上方的 chip，发送时以 `<quoted_context>` 块拼进用户消息。插件不解析、不分类任何引用——「卡片」「消息」这些词在包里一个都不出现。
- **消息动作「引用到侧边对话」**：助手消息的动作行里多一个按钮，一键把这条消息落成当前会话侧边对话的待发送引用，并把 tab 切到对应上下文。（座位是官方 `conversation.chat.assistant-actions` 列表槽；用户消息侧暂无官方动作槽，差距已记为 upstream 候选。）

## 宿主服务 API（插件间协作 seam）

其他插件经宿主服务 `ctx.sideChat.openWith(...)` 供给上下文——**同进程对象传递，不过 Remote**，这是刻意的（跨进程才有类型/安全问题）：

```ts
await ctx.sideChat.openWith({
  contextKey: 'canvas:<id>',      // 消费方自选，建议带前缀；side-chat 只按 key 隔离
  label: '画布：为什么人们不愿表达异议',
  systemPrompt: '主题与板摘要……', // 追加段：重复调用即更新，每轮组装都读最新值
  tools: [/* ToolDefinition */],  // 挂到该 context 的 agent 上；origin tag 由调用方负责
  refs: [{ label: '卡 1', text: '……' }],
})
```

- **单向边**：消费方探测 `ctx.get('sideChat')`，在自己的 manifest `dsh.references` 登记服务名；side-chat 永不提及消费方。消费方缺席=它自己降级；side-chat 独立装卸。
- **回合级新鲜度**：`openWith` 重复调用同一 contextKey **更新** systemPrompt 段（agent 作用域的 prompt section 在每次组装时重读记录，绝非创建时快照），同名工具在 live agent 上热替换，**绝不重建会话**。

## 工作区接入接缝（服务端消费）

把本包挂到**隔离 Context + 独立 stateRoot** 上是受支持的消费方式：挂载方在自己的 Context 上以本包的 `apply` + `config.stateRoot` 起一份独立实例——业务状态全部按实例绑定（`contexts.json` 落在实例自己的 state root 下），读取动词（`getState` / `listContexts` / `surfaceHints`）不需要任何会话。包的 inject 是 `agents` 与 `sessions`，挂载侧的 Context 必须提供（注入自定义执行后端时 `agents` 永不被动用，空桩即可）；`fs` 缺席时状态退化为纯内存（不阻塞任何手势）。

```ts
import { apply } from '@khorsheed/dsh-sidechat'

apply(isolatedCtx, {
  stateRoot: '/path/to/instance-state/sidechat',
  agentRoute: { provider: '…', model: '…' }, // 可选：显式执行路由
  cwd: '/path/to/workdir',                   // 可选：显式 cwd 锚点
  executionBackend: myBackend,               // 可选：自定义执行后端端口
})
```

挂载侧的义务与语义：

- **执行落点由执行后端端口决定**：一切触达执行目标的环节都走 `SideChatExecutionBackend`——懒打开（create）与冷恢复（resume，一个 `open(init)`，`init.resume` 区分）、发送（`session.send({ text, source })`，refs 已由服务折进正文）、读取（live `status` + `events()` 快照；冷读 `readCold(sessionId)` 走持久侧、绝不 resume）、取消（`session.cancel()`，停止手势）、释放（`session.release()`，句柄 dispose，会话本身保持持久化）。默认后端（`SideChatDefaultExecutionBackend`）就是既有 `ctx.agents` 行为原样抽出；**注入自定义后端时服务绝不回退到部署默认**——路由链的 `agentDefaultModel` 探测只对默认后端运行，无调用方且解析不到路由的 `agent-unavailable` 拒绝同理只适用于默认后端（自定义后端自己拥有路由）。挂载是否正确必须**以观察为准**（核对后端实际打开的会话），不能靠假设。
- **open 载荷带解析结果**：`{ contextKey, sessionId, resume, route?, presetId?, cwd?, segmentText(), tools() }`。`route`/`presetId`/`cwd` 是服务按链解析好的——路由：**显式 `agentRoute` > 调用会话折叠请求头**（默认后端再 + `agentDefaultModel` 探测）；preset：调用请求头 > 记录 > 插件配置（后端再解析自己的默认）；cwd：**显式 `cwd` > 来源会话 > 调用会话**，只在首次打开携带（resume 重放创建时的一切）。`segmentText`/`tools` 是**活读取器**（进程内 thunk，永不上线）：后端每轮组装重读它们——回合级新鲜度对任何后端成立。引用（refs，即附件语义）永不到达后端：服务在发送前已折成 `<quoted_context>` 正文块，transcript 投影时再按同一格式解析回来。
- **能力声明 + 逐项降级**：`capabilities: { presets, promptContext, callerTools, cancel, coldRead }`，缺一项降一项，绝不崩。`callerTools: false` → openWith 的工具同步静默跳过；`cancel: false` → 停止手势带码拒绝 `cancel-unsupported`；`coldRead: false` → 冷上下文诚实回答未知（transcript 空、`lastError` null、时间 null、status 仍 `cold`）；`presets` / `promptContext` 由后端自己兑现——服务照传 `presetId` 与 `segmentText` 读取器，能力标志不改写 open 载荷。
- **停止手势（宿主侧）**：`ctx.sideChat.stop(contextKey)`——运行中的 turn 经后端 `cancel()` 取消（默认后端走 agent 自带的 `cancel({ kind: 'user' })`；老宿主线上 agent 无此能力时按 `cancel-unsupported` 拒绝）。带码拒绝三分：`not-found`（无此上下文）/ `not-running`（当前没有 live 运行）/ `cancel-unsupported`（后端或会话无取消能力）。线上 Remote 无此动词。
- **调用 agent 可选**：`ctx.sideChat.send(undefined, …)` 是无会话服务端调用方的形态——写入围栏按部署默认模式、不带 session id，路由/cwd 走显式配置或（默认后端）部署默认。`quoteMessage` 仍要求强制 calling（它引用的就是调用会话里的消息）。
- **dispose 终态 + 同根重建**：`disposeAgents()` 幂等且终态——之后每个公开动词（含读取）都以带码的包名错误 `SideChatDisposedError`（`code: 'disposed'`）拒绝；与 dispose 竞态的 in-flight open 在落地时被当即 release——句柄不泄漏，调用方收到同一个 disposed 错误。同根重建合法：同一 `stateRoot` 上新建服务实例照常工作（自定义后端也一样——resume 经后端的 `open({ resume: true })` 落到后端自己的持久日志），死掉的只是旧实例。
- **本地行为零变化**：不注入后端、不配新键、照常传 calling 时，语义与之前逐字节一致（既有测试套件原样全绿即为钉）；线上 Remote 面逐字节不变。

## Remote（`remote.sidechat`）

| 动词 | 说明 |
| --- | --- |
| `getState({ contextKey })` | 读一个上下文的完整状态（label、待发送引用、transcript、状态）。冷上下文走持久化检视，**读不唤醒 agent**。 |
| `listContexts()` | 列出全部已知上下文（最近活跃在前，带 live 状态覆盖与最新 assistant 时间）。 |
| `surfaceHints()` | 每个上下文的 openWith 修订号（`rev`）——客户端浮出水面机制的 diff 基线；最轻的读取（纯内存，无投影无检视）。 |
| `send(agent, { contextKey, text, label?, refs? })` | 发送一条用户消息：待发送引用折叠进消息并清空，agent 懒创建/冷恢复。agent 优先——调用会话供电围栏、捐赠 cwd。 |
| `quoteMessage(agent, { messageId, label? })` | 把调用会话里的一条助手消息落成该会话侧边对话的待发送引用（宿主按 messageId 从会话日志折出文本，线上不传正文）。 |

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-sidechat
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-sidechat
```

装完重启宿主。卸载**不会**删除 `$DSH_HOME/state/sidechat/`（contextKey → 会话映射）或任何侧边会话——它们就是你的普通会话。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`）与助手消息动作槽（`conversation.chat.assistant-actions`）自 0.1.5 起存在，`minHost` 由此钉在 0.1.5-rc.1；旧宿主没有右栏面，本包不向其发布。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。Session V4 适配：send 的 followup source 改为生产者归属 kind `sidechat`（V4 原生准入在落盘写入时拒收退役的 `kind: 'plugin'` 包装；0.1.5 宿主的 `user/message` 准入只查 kind 非空，两条线都能落盘）；transcript 投影在三种来源形态下都把本包发送视为用户发言（新 kind / `plugin:@khorsheed/dsh-sidechat` 迁移形态 / V3 包装存量），tool/result 折叠兼读 V4 消息级 `toolCallId`/`isError` 与 V3 块级包装。
- **座位探测降级**：tab、消息动作与浮层 dock（`shell.overlay`）都走 `ctx.slots.inject` 注册——宿主不声明对应座位时表面静默缺席，不影响启动；无 overlay 座位时「弹出为浮层」按钮直接隐藏，tab 即是全部。右栏导航面 `ctx.sidebarRight` 探测不到时，引用照常落库，只跳过自动展开 tab。
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西；宿主半边照常提供 `ctx.sideChat` 服务与 Remote。
- **状态写入围栏重定界**：contexts 映射是部署级状态（`$DSH_HOME/state/sidechat/contexts.json`），写入沿用挂载的 `ctx.fs`（版本守卫、原子写），调用会话解析出**模式**与 session id（只读部署照样拒绝），可写边界重定界为插件自己的 state 目录——绝不用裸 `node:fs` 绕。宿主侧 `openWith`（无会话）按部署默认模式写入。未挂载 `ctx.fs` 的组合降级为纯内存状态（重启即失，不阻塞任何手势）。`DSH_HOME` 未设置时 state 根退回 `process.cwd()`（datasets 先例）。
- **能力探测**：无 agentPresets 时侧边 agent 裸组合（纯聊天）；无 sessionPersistence 时冷上下文无历史可读；无 agent 工厂（未加载 agent-loop）时发送返回 `agent-unavailable` 而非抛错。三者都不影响启动。
- **工具与提示词是宿主侧对象**：`openWith` 的 `tools`/`systemPrompt` 只在同进程内传递，绝不过 Remote；调用方工具的 origin tag 由**调用方**负责（side-chat 不代标）。

## Known Limitations

- **用户消息没有「引用到侧边对话」动作**。助手消息动作槽（`conversation.chat.assistant-actions`）是官方 seam；用户消息侧的动作行（`MessageIconActions`）上游不接受扩展，唯一先例是 message-tools 的整节点 shadow——与它自己的 shadow 冲突。差距已记为 upstream 候选（见 Agent Note）。
- **任意文本选区 → ref 没有官方 seam**（M2 探针结论）：`conversation.*`/`conversation.chat.*` 槽目录里没有选区/摘录座位，ui-conversation 的 selection API 都是 composer 输入机（Lexical）内部件，message-tools 亦无此功能；DOM anchor hack 按设计红线不做。已登记 upstream 候选；兜底不变：composer 接受粘贴纯文本。
- **侧边会话出现在会话列表里**。它们是普通会话（首个消息自动得题），`agents.create` 没有「隐藏会话」开关；是否该有展示层面的归属（如 subagent 式折叠）记为 upstream 候选。
- **composer 不做官方输入机对齐**。撤回回填/斜杠/图片等官方 composer 生态在侧边对话里不可用（轻量优先的刻意取舍，与 room-composer-parity 同源）。
- **更新是拉取式的**：挂载与手势后取一次，agent 运行期间 1.2s 轮询；实时推送留待后续。
- **重启后消费方的工具/提示词需重新供给**：映射与提示词段持久化，但 `tools` 是同进程对象——重启后的冷恢复只带映射里的内容，消费方下次 `openWith` 时热补上。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

**磁盘布局**

```
$DSH_HOME/state/sidechat/
  contexts.json    # { version: 1, contexts: [{ contextKey, label, sessionId?, segment?, agentPreset?, refs[], createdAt, updatedAt }] }
```

文件损坏时：读取报错、写入拒绝，绝不重写一个读不懂的文件（画布先例）。卸载插件不删除它。

**会话生命周期**：contextKey → 记录。首次 `send` 时 `ctx.agents.create({ sessionId: randomUUID(), meta: { cwd, agentPreset }, setup })`——cwd 继承自 contextKey 指向的 live 会话（普通会话场景=来源会话），否则继承发送手势所在会话；preset 缺省沿用 profile 默认（探测 agentPresets，经 mount 挂进 agent 作用域）。重启后 `ctx.agents.resume({ resumeSessionId, setup })` 冷恢复；恢复失败（日志残破）退回新建并更正映射。

**回合级新鲜度**：创建/恢复时在该 agent 的作用域注册一个 prompt section（`sidechat:context`，order 10300，跟随在部署人格后缀之后），其文本提供器**每次组装都重读记录的最新段**——内置定向段（「你是用户的侧边对话 agent……」）+ 消费方段。transcript 永远从 session journal 投影（user/assistant 文本、tool 调用折叠为一行状态），不写影子副本。

**客户端**：右栏页型 tab（kind `sidechat`，key = 包名）。默认显示当前会话的上下文（contextKey = sessionId）；`openTab('sidechat', { params: { contextKey } })` 可程序化切换（引用动作即走此路）。M2 起面板组件（`SideChatPanel`）同时挂在 `shell.overlay` 浮层 dock（root 作用域，框架 client store 持久化位置，发送搭当前选中会话）；上下文选择器读 listContexts（宿主按 journal 投影给出每个上下文的最新 assistant 时间），未读按 localStorage 的 last-seen 标记比对。composer 三件套沿用画布先例：非受控 textarea、IME 组合期间硬停、单滚动容器；⌘⏎/Ctrl+⏎ 或按钮发送。助手消息经官方 `MarkdownText` 渲染，颜色全部走 `--dsw-*` token。

</details>
