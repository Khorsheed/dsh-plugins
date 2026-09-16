# @khorsheed/dsh-sidechat

[English](README.en.md) | 中文

**侧边对话** —— 一个全 preset 常驻的「随身 Agent」：右栏里的轻量聊天，围绕「当前上下文」对话。普通会话里引用几条消息问两句；装了其他内容插件（如画布）时，它们的「就此提问」也由它承接。它一次建设、处处受益，且**不知道任何具体插件的存在**。

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

## Remote（`remote.sidechat`）

| 动词 | 说明 |
| --- | --- |
| `getState({ contextKey })` | 读一个上下文的完整状态（label、待发送引用、transcript、状态）。冷上下文走持久化检视，**读不唤醒 agent**。 |
| `listContexts()` | 列出全部已知上下文（最近活跃在前，带 live 状态覆盖）。 |
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
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）
- **座位探测降级**：tab 与消息动作都走 `ctx.slots.inject` 注册——宿主不声明对应座位时表面静默缺席，不影响启动。右栏导航面 `ctx.sidebarRight` 探测不到时，引用照常落库，只跳过自动展开 tab。
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西；宿主半边照常提供 `ctx.sideChat` 服务与 Remote。
- **状态写入围栏重定界**：contexts 映射是部署级状态（`$DSH_HOME/state/sidechat/contexts.json`），写入沿用挂载的 `ctx.fs`（版本守卫、原子写），调用会话解析出**模式**与 session id（只读部署照样拒绝），可写边界重定界为插件自己的 state 目录——绝不用裸 `node:fs` 绕。宿主侧 `openWith`（无会话）按部署默认模式写入。未挂载 `ctx.fs` 的组合降级为纯内存状态（重启即失，不阻塞任何手势）。`DSH_HOME` 未设置时 state 根退回 `process.cwd()`（datasets 先例）。
- **能力探测**：无 agentPresets 时侧边 agent 裸组合（纯聊天）；无 sessionPersistence 时冷上下文无历史可读；无 agent 工厂（未加载 agent-loop）时发送返回 `agent-unavailable` 而非抛错。三者都不影响启动。
- **工具与提示词是宿主侧对象**：`openWith` 的 `tools`/`systemPrompt` 只在同进程内传递，绝不过 Remote；调用方工具的 origin tag 由**调用方**负责（side-chat 不代标）。

## Known Limitations

- **用户消息没有「引用到侧边对话」动作**。助手消息动作槽（`conversation.chat.assistant-actions`）是官方 seam；用户消息侧的动作行（`MessageIconActions`）上游不接受扩展，唯一先例是 message-tools 的整节点 shadow——与它自己的 shadow 冲突。差距已记为 upstream 候选（见 Agent Note）。
- **侧边会话出现在会话列表里**。它们是普通会话（首个消息自动得题），`agents.create` 没有「隐藏会话」开关；是否该有展示层面的归属（如 subagent 式折叠）记为 upstream 候选。
- **composer 不做官方输入机对齐**。撤回回填/斜杠/图片等官方 composer 生态在侧边对话里不可用（轻量优先的刻意取舍，与 room-composer-parity 同源）。
- **更新是拉取式的**：挂载与手势后取一次，agent 运行期间 1.2s 轮询；M2 才做实时推送、多上下文切换列表与未读标。
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

**客户端**：右栏页型 tab（kind `sidechat`，key = 包名）。默认显示当前会话的上下文（contextKey = sessionId）；`openTab('sidechat', { params: { contextKey } })` 可程序化切换（引用动作即走此路）。composer 三件套沿用画布先例：非受控 textarea、IME 组合期间硬停、单滚动容器；⌘⏎/Ctrl+⏎ 或按钮发送。助手消息经官方 `MarkdownText` 渲染，颜色全部走 `--dsw-*` token。

</details>
