# Agent Note: sidechat execution-route config, optional calling, terminal dispose

Status: implemented

## Problem

按实例把侧边对话挂到隔离 Context + 独立 `stateRoot` 的消费方（受支持的服务端消费形态）撞上三个缺口。（1）无法钉住侧边 agent 的执行落点：route/cwd 解析链只从调用会话的折叠请求头 / cwd 继承，然后落到探测的 `agentDefaultModel` 部署默认——没有调用会话的挂载完全无法掌控执行目标，「可选调用 agent」本身绝不等于隔离。（2）`send` 硬要求一个活着的调用 Agent：一处未放宽的直接访问（`await this.persist(calling.session)`）会让无调用方的 send 直接崩掉，尽管围栏本身早已容忍 undefined 会话。（3）`disposeAgents()` 没有 dispose 后使用守卫，也没有 spawn/dispose 竞态保护：dispose 之后创建的句柄会泄漏进持有集，被 dispose 的实例还照常应答各个动词。

## Decision

全部演进都是增量式、通用命名（代码、类型、注释里不出现任何消费方词汇）；版本保持 0.2.3。

- **`SideChatConfig` 上的显式执行路由与 cwd 锚点**（`agentRoute?: AgentOptions`、`cwd?: string`，`src/service.ts`）。路由链：显式路由 > 调用会话折叠请求头 > 探测的 `agentDefaultModel` 部署默认；cwd 链：显式锚点 > 来源会话 > 调用会话。设了但不可用的路由（provider/model 为空——一对无法路由的组合）按未设置处理，与解析链自身施加的可用性检验一致。两个键都不设时，本地行为逐字节不变。
- **服务核心的调用 agent 可选**：`send(calling: Agent | undefined, …)`；那一处直接访问修成了 `persist(calling?.session)`，无调用方的 send 于是按部署默认模式、不带 session id 写入围栏。无调用方且解析不到任何路由时，`send` 拒绝 `agent-unavailable`，绝不创建「聋」agent——没有面向用户的会话，无路由 turn 的 `lastError` 无人可看。有调用方时无路由路径不变（照常创建，turn 错误经 `lastError` 浮现，即 3080 修复语义）。`quoteMessage` 保持强制 calling：它引用的就是调用会话里的消息。
- **Remote 孪生刻意不放宽**：typert 边界拒绝可选的 agent lookup 参数——`agent?: Agent` 报 "lookup parameter for agent cannot be optional"，`Agent | undefined` 报 "Remote boundary contains class instance Session"（union 节点不带 symbol，分析器于是把该参数当 JSON 载荷而非 agent lookup）。无调用方形态只存在于宿主侧 `ctx.sideChat`；线上永远有一个浏览器会话在背后。生成的 typert 面与之前逐字节一致，Remote 动词的 TSDoc 记录了这条边界规则。
- **终态 dispose 守卫**（reader 的 disposed 旗标先例，加固版）：`disposeAgents()` 置 `disposed` 旗标，保持幂等，之后每个公开动词（`openWith` / `getState` / `listContexts` / `surfaceHints` / `send` / `quoteMessage`）都以 `SideChatDisposedError` 拒绝——带码的包名错误（`code: 'disposed'`，仿 `SideChatStoreError`），绝非裸抛。`refuseLateHandle` 在 create 与 resume 两条路径上闭合 spawn/dispose 竞态：dispose 之后落地的句柄当场被 dispose（绝不泄漏进持有集），其调用方收到同一个带码错误；resume 路径的兜底 catch 把它原样重抛而不是落入 create，`send` 的 catch 也把它原样重抛而不是映射成 `agent-unavailable`。同根重建保持合法——死掉的只是被 dispose 的实例。

## Alternatives considered

- **把 Remote 孪生（`remote.sidechat.send`）放宽到 `Agent | undefined`**：被 typert 边界拒绝，分析器证据如上——线上模型无法表达「缺席的 agent」。先试后撤，转而记录在动词文档里，不与生成器对抗。
- **为无调用方 send 单开一个线上动词**（例如不带 agent 参数的 `sendDetached(request)`）：为一个纯宿主侧场景增加线上表面；浏览器调用方永远持有会话，挂载方在同进程内消费 `ctx.sideChat`。
- **设了但不可用的显式路由也算赢（大声失败）**：空对会让每次 send 都注定 `agent-unavailable`。按未设置处理符合本包「降级不炸」的约定，也与继承链对调用请求头和部署默认施加的非空检验一致。
- **dispose 后只守卫写动词**：读取在卸载后继续回答陈旧状态，等于让挂载方无限期消费一个死实例；交付条件是每个公开动词都拒绝，读取也不例外。
- **让 `disposeAgents` 走变更队列**（从而不与 in-flight spawn 交错）：dispose 就得排在队列工作之后——卸载卡在一个卡死的 create 后面是更糟的失败。迟来句柄守卫不引入队列耦合就闭合了竞态。

## Consequences

- `SideChatConfig` 增加两个可选键；`SideChatDisposedError` 从包根导出；`send` 的服务核心签名放宽（对所有现存调用方后向兼容）。线上表面未动——生成的 typert host 面与 remote-client 面逐字节一致。
- 十个新契约测试钉住这条接缝：显式路由同时压过调用请求头与部署默认探测、不可用显式路由落回继承链、显式 cwd 获胜、无调用方 send 在显式路由下工作、无调用方 send 走部署默认路由、无调用方且无路由时拒绝 `agent-unavailable`；dispose 后每个动词拒绝带码错误、dispose 幂等、in-flight spawn 与 dispose 的竞态把迟来句柄恰好 dispose 一次并拒绝调用方、同根重建可用。全部 86 个既有测试原样通过（总计 96）；`remote.spec.ts`、`journal.spec.ts`、`vocabulary.spec.ts`、`client.spec.tsx`、`persistence-probe.host.spec.ts` 零预期变更。
- 隔离结论仍归挂载侧所有：Context 的 `agents` 服务决定侧边 agent 在哪里执行，显式配置钉住 route/cwd，README 的「工作区接入接缝」一节要求以观察验证挂载（核对实际创建出的侧边会话的 route 与 cwd），绝不靠假设。
- 无调用方 send 按构造只是宿主侧形态；若将来需要线上携带「缺席 agent」的 send，那是 typert 边界的能力（可选 lookup 参数），不是 sidechat 的改动。
- 后续（同日）：[执行后端端口](2026-10-10-sidechat-execution-backend.md)取代了本笔记「`agentRoute`/`cwd` 对非本地目标够用」的隐含假设——这两个配置键只参数化「经 Context 的 `agents` 服务的创建」，而在按目标隔离的拓扑里那个服务就是管理宿主的注册表。两键保留，现经后端 open 载荷消费；默认后端的行为即本笔记所交付内容的原样抽出。
