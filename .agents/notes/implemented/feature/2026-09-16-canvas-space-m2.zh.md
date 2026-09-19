# Agent Note: 画布 M2 —— 经 side-chat 接缝的聊天集成

Status: implemented

[English](2026-09-16-canvas-space-m2.md) | 中文

## Problem

M1/M1.5 交付了带幽灵提议与评论的卡板，却没有*触达* Agent 的路：提案的「板主聊辅」需要一个聊天，让 Agent 评论、提议卡、把思考推深。朴素路径——画布自建聊天 UI 与 Agent 会话（提案原 §6）——在 M2 开工前已被超越：`@khorsheed/dsh-sidechat` 0.1.0 落地，带着画布正需要的接缝（`ctx.sideChat.openWith` 按上下文预备 Agent、右栏 tab 承接对话、回合级提示新鲜度、调用方工具注入）。于是 M2 的问题是三块，且每块都关于*不重造*现已存在的东西。

**画布如何借 side-chat 提问而不依赖它？** side-chat 缺席时板必须完整可用，边必须单向（side-chat 永不提及画布）。

**画布的工具如何只到达画布自己的 Agent？** 全局 `ctx.tools.register` 会把画布工具塞进每个普通会话；正确的作用域是画布自己的 side-chat 上下文——而它懒创建，首次发送前不存在。

**板如何看见 Agent 做了什么？** 工具调用在宿主侧、在客户端并未发起的回合里落板；幽灵卡出现时板必须刷新，又不能常驻轮询。

还有提案 M2 行里正交的一条：**空间应在不含它的 preset 里自隐**（写作模式可见），同时绝不在无 preset 的 profile（如 3080 的 web）里消失。

## Decision

**接缝是一个动词，探测接入，客户端以状态探测门控。** `askAgent`（agent 优先，调用会话预备上下文）探测 `ctx.get('sideChat')`——结构镜像接口，sidechat 包零 import，服务名在 manifest `dsh.references` 登记（仓里的数据引用机制；`pnpm check:plugins` 无需 sanction 条目、保持零发现）。命中则 `openWith({ contextKey: 'canvas:<id>', label: 主题, systemPrompt, tools, refs })`；未命中答 `unavailable`，另设只读动词 `chatStatus` 让客户端从首帧起隐藏全部聊天入口（透镜条、评论「追问」、详情「问 Agent」）——没有聊天，板完整可用。

**系统提示是纯渲染器，每次提问新鲜。** `prompt.ts` 从板渲染该段：主题与目标 / 板摘要（各 kind 计数、kept 卡一句话、open 问题列表）/ grounding 护栏（kept 依据卡是用户确认过的立场，Agent 不可违背）/ 工具契约（提议走工具、评论走工具、绝不在正文贴卡；Agent 评论把 open 问题推进到 exploring；answered 永远用户沉淀）/ 透镜语义（点名当前透镜）/ stats 回授段（§4：≥5 次裁决且接受率 <30% → 收紧提议）。side-chat 的回合级契约在每次组装时读取最近一次 `openWith` 的段，所以每次提问即刷新。选中卡以**不透明 ref**（`{ label, text }`）跨界——聊天上下文不知道「卡片」是什么（提案的选区即上下文协议）。

**两个工具随 `openWith` 注入，以免导入路径打标。** `canvas_propose_card(kind, text, source?, comment?)` 与 `canvas_comment(cardId, text)` 是每次提问时用 `defineTool` 构建、由 side-chat 附到画布上下文 Agent 上的定义——绝不全局注册，普通会话永远见不到画布占位。origin tag 直接写 `Symbol.for('dsh.tool.origin')` 属性：capability-catalog 的 tool-origin 模块自带文档写明插件「may tag without importing anything」，这让跨插件边保持恰好一条（sidechat）。两者都委托板服务自身路径——新的 `proposeCard`（proposed、createdBy agent、理由以 Agent 评论挂卡；提议问题卡从 open 开始——§4 的 exploring 规则针对板上已有卡的评论，不针对提议的到来）与 M1 的 `addComment`（author: 'agent'）。执行时优先以 `exec.agent.session`（画布 Agent 自己的会话）供电围栏，否则用发起提问的会话——与其他写入同一条重定界围栏。

**发送规则刻意小。** 手势自带自由文本优先（评论「追问」），否则是非 `ask` 透镜的模板文本（七个工作透镜），否则只 prime（`ask`，以及详情选区「问 Agent」——选区文字作 ref，问题由用户在 tab 里敲）。宿主的 `sideChat.send` 存在时 askAgent 在 prime 后调用它——「选卡 → 提问 → 幽灵卡落板 → 收下」全环真正跑起来，而不只是预备。

**板经既有 rev 通道获知，由探测式回合监听喂给。** 实发之后，客户端以 `remote.sidechat.getState`（又一个结构镜像，`ctx.get` 探测）在上下文报 `running` 期间每 2s 轮询（上限 60 次），每次 `touch()` 共享 selection store——M1.5 的 rev 通道随即重读两个座位，幽灵卡随 Agent 的工具调用落板即现。无监听、无常驻轮询：外部改动仍靠下一次手势时的版本守卫浮现。

**preset 自隐是 room 的判据，处处 fail-open。** `client/preset-visibility.ts` 读官方 `pluginInventory` Remote（探测，绝不 inject）：空间的四个注册（导轨行、main 面板、tab 类型、tab 体）都挂在 `RegistrationToggle` 下，只在当前会话的 preset 组点名 `@khorsheed/dsh-canvas` 时存在。一切读不到的路径——无命名空间、pending/失败 RPC、缺失或 `broken` 的组、无 preset 的会话——一律 fail OPEN（可见），3080 的 web profile 永不失去空间。隐藏**激活中的** main 面板前先经探测的 layout 面 `selectPanel(null)`，框架绝不搁浅在未注册的 key 上。

## Alternatives considered

### 为什么不每个手势都自动实发（包括「就此提问」与「问 Agent」）？

只 prime 不发送给用户一个就绪的上下文——选中卡已成 chips、提示已新鲜——让他敲真正的问题。自动发一条「用户想问点什么」的罐头文本会为一个非问题烧掉一回合，还训练 Agent 回应噪声。工作透镜自动实发，因为它们的模板**就是**问题；`ask` 存在的意义正是用户自己的话。

### 为什么不 import sidechat 的类型（或包）而非要结构镜像？

跨插件规则：一条边、要登记、可降级——绝不 import。类型 import 也是边（check:plugins 的 `cross-plugin import` 会命中，且没有 sanctioned 的 canvas↔sidechat 对；任务禁止改共享 checker）。结构镜像只带画布真实用到的调用形状（`openWith` 入参、`send`、`getState` 状态），且按构造可降级——不能 send 的接缝照样 prime。

### 为什么不全局注册画布工具、让模型在任何会话里找到？

提案 M2 的契约写得明白：工具经 `openWith` 附到画布上下文的 Agent，普通会话永不背画布占位，而工具自身的生命周期（懒创建、按名热替换）是 side-chat 已测过的机制。全局注册还得自己做 preset 门控才诚实——为更差的结果付出重复。

### 为什么不把画布 Agent 的 cwd 设为首个挂载工作区（提案 §6）？

`inheritCwd` 是 side-chat 包的契约（contextKey 非存活会话时取调用会话的 cwd），画布不越界修改别包的契约。现行规则无害——画布 state 目录由插件自己的边界围栏，Agent 的文件手势留在调用会话的工作区内。记为偏差，不打补丁。

### 为什么不用宿主事件推板更新，而要客户端回合监听？

Remote 协议在此方向上没有画布→客户端的事件通道（线上是请求/响应；side-chat 的事件是它自己的）。监听复用 M1.5 的 rev 通道与探测到的 `getState` 状态，精确限定在用户刚发出的回合，且自行停止。常驻订阅是为同样的可见结果付出更多机制。

## Consequences

- `packages/canvas/src/types.ts`：透镜词表（`CANVAS_LENS_IDS`）、`BoardRef`、`BoardAskAgentRequest/Outcome`、`BoardChatStatusResult`、`BoardProposeCardRequest`。
- `packages/canvas/src/prompt.ts`（新）：`renderCanvasPrompt`、`cardToRef`、`lensSendText`、`CANVAS_LENS_LABELS`——全纯函数，全部有测试。
- `packages/canvas/src/tools.ts`（新）：`canvasToolDefinitions`（两个打标工具）；peerDep `@deepseek-ai/dsh-tools`（宽程 optional）+ devDep。
- `packages/canvas/src/store.ts`：`proposeCard`、`askAgent`、`chatAvailable`，以及 `SideChatMirror` 结构接缝。
- `packages/canvas/src/remote.ts`：`askAgent`（agent 优先）+ `chatStatus`（无 agent）。**M1 的动词一律未动。**
- `packages/canvas/src/client/preset-visibility.ts`（新）：`CanvasPresetVisibility` + `RegistrationToggle`（+8 个 spec 例）。
- `packages/canvas/src/client/index.ts`：聊天面（带回合监听的 `askAgent`、`chatStatus`、经结构镜像 `openTab('sidechat', { params: { contextKey } })` 的 `openSideChat`）、四个可见性 toggle、`inject` 增 `sessions`。
- `BoardView`：选择条内的透镜条 + Agent 评论「追问」。`CanvasDetailView`：选区浮动「问 Agent」+「追问」+ 聊天门。`CanvasSpacePage`：探测 + 提问流。
- `package.json` 0.2.0 → 0.3.0；`dsh.references: ['@khorsheed/dsh-sidechat']`；compat notes 记录接缝。devDep `@deepseek-ai/dsh-api-session-controller`（`ctx.sessions` 类型合并）。
- 画布 Agent 的 cwd 随 side-chat 的 `inheritCwd`（调用会话的 cwd）——记为对提案 §6 的偏差。
- `canvas.json` 仍不存任何聊天信息：contextKey 由画布 id 派生，context→session 映射归 side-chat 所有（`chat.sessionId` 字段保持 null）。

## Testing

- `packages/canvas`：**166 个测试全绿**（M1.5 合并时 134）：`ask.spec.ts` 13（prime 契约——key/label/段内容/打标工具/refs；三条发送规则；unavailable/io/invalid/missing；stats 回授；`proposeCard`）、`tools.spec.ts` 5（名称、描述、origin tag、propose/comment 委托含 exploring 规则、失败即文本、围栏会话优先级）、`remote.spec.ts` +2 动词、`space.client.spec.tsx` 15（透镜条 → askAgent → openSideChat；追问；全隐降级）、`detail.client.spec.tsx` 13（问 Agent 选区 ref；追问；全隐）、`preset-visibility.spec.ts` 8（fail-open 矩阵 + toggle 生命周期）。
- `pnpm --filter @khorsheed/dsh-canvas build`（gen-typert → tsc → tsdown）、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。
- 未做：3080 上的真实模型回合（部署走协调流程；工具执行路径已对真服务覆盖，接缝契约已对录制型 fake 覆盖）。

## Deferred

- `canvas_propose_draft` + 候选 diff 接受流、prompt 回授段之外的 stats 规则、web 搜索接线（M3）；成稿视图、html 资产渲染 + assets 读取动词、会话侧 `canvas_search`/`canvas_clip`（M4）。
- 回合监听是客户端轮询而非推送通道；换成宿主事件是上游要给的 seam，不是画布要造的。
- 粘贴即建卡、画布改名、建后挂载编辑。

## Related

- [M1 note](2026-09-16-canvas-space-m1.md)、[M1.5 note](2026-09-16-canvas-space-m1-5.md)。
- [side-chat M1 note](2026-09-16-side-chat-m1.md)（本集成消费的接缝）。
- [canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)（§3/§6/§7、里程碑 M2）。
