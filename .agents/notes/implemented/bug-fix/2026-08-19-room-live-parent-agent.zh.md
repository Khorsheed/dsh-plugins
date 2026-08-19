# Agent Note: Room——父 agent 缺位与 room_invite 注册时序修复

Status: implemented

[English](2026-08-19-room-live-parent-agent.md) | 中文

## 问题

room 插件的端到端验收（scratch profile、真实 kimi CLI 派发）暴露了两个单元 bench 看不到的缺陷——bench 在挂载服务前就 stub 好了 `agents`/`tools`：

1. **room 出生时没有自己的 agent，CLI 派发永远无法成功。** `createRoom` 用裸 `ctx.sessions.create` 建会话；而 local-agent 委派门面经 `ctx.agents.get` 解析派发父对象（只返回存活 agent——宿主硬约束），room 链路里没有任何环节让 room 会话的 agent 存活：web 客户端只在 `session.prompt` 时 resume agent，而 room composer 接管了全部发送。每次 `@ada` 都在几毫秒内落定 `failed`。宿主重启后缺口更大：会话整个离开 live store，所有 Remote 都答 `session-not-found`，名册/黑板根本读不回来。

2. **`room_invite` 在真实组合树上从未注册成功。** 构造函数在 apply 时用 `ctx.get('tools')` 探测工具注册表——这与注册表自身的挂载顺序赛跑，在真实树上必输（树里只有经静态 `inject` 注册的 `subagent_kimi`）。单元 bench 通过是因为它在 `ctx.plugin(RoomService)` 之前就 provide 了 stub。

## 决策

1. **room 经 agent 工厂创建**（`ctx.agents.create`，preset 组合从 `agentPresets` 探测，镜像 apiproxy 的 `session.create`：解析出的 preset id 记进会话头，挂载发生在工厂 `setup` 里）。新建 room 因此自带存活的 main agent——与 UI 创建的会话完全一致——成为每个 CLI 成员派发的锚点。

2. **冷 room 上的首个变更型 Remote 先冷恢复其 agent**（`ctx.agents.resume`，preset 经 `resolveSessionPreset` 从会话*日志*解析——空白期切换优先于创建头），按会话去重（`resumes` 映射），失败以新的封闭联合成员 `resume-failed` 暴露。resume 会重新发布 session + agent，变更随后对存活会话进行。只读 Remote（`isRoom`/`getState`）保持零副作用：冷 room 从 `sessionPersistence.inspect` 读持久化日志作答（不 attach、不 resume），所以在 UI 里打开任何会话都不会拉起 agent。

3. **工具注册改用延迟注入**（`ctx.inject(['tools'], …)`，即 `SessionStore`/`typert` 先例）：注册表出现时回调才触发，没有该注册表的组合里永不触发——只失去模型侧邀请路径，永远不影响启动。

## 否决的替代方案

- **只在 DispatchEngine 内保证存活**（`createRoom` 保持裸建）——否决：往 store 仍持有的会话上冷恢复 agent 会与工厂的发布路径冲突（`session already exists`）；经工厂创建让 live-agent 不变量从出生即成立，resume 路径因而只面对真正冷的会话。
- **冷 room 用 enter-only 重挂（`sessions.enter`，local-agent 子会话配方）**——对 room 自己的会话否决：后续 `agents.resume` 必须自己发布会话，enter-only 挂载会挡住它。enter-only 对 CLI 子会话仍然正确（它们上面永远没有 agent）；room 会话拥有一个真 agent。
- **静态 `inject = ['tools']`**——否决：无 tools 的组合会让 room 挂载直接失败；延迟注入保住了「降级而非爆炸」的性质。

## 后果

- `RoomFailure` 新增 `resume-failed`（携带 message）；客户端 `failureText` 的 default 分支已能渲染。
- room 会话 id 变为 `session-<uuid>`（调用方铸造，apiproxy 形态），不再是 store 的顺序 `session-<n>`。
- 新增官方 peer 依赖：`@deepseek-ai/dsh-agent-presets`（preset 解析/挂载、`resolveSessionPreset`）与 `@deepseek-ai/dsh-session-persistence`（`inspect` 探测）；两者都在服务层探测，缺席时降级为修复前行为。
- 修复前创建的 room（存活会话、无 agent、同一 boot）派发仍会响亮失败——journal 已携带那些 `failed` 运行；本修复不做原地补救。
- 本修复未覆盖：侧栏「+ 新 room」流程不传 `cwd`，而 kimi provider 要求父会话带 `cwd`——浏览器里创建的 room 要等客户端补上 workspace/cwd 继承（NewRoomAction 注释已标注）后才能派发 CLI 成员。
