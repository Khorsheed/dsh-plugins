# Agent Note: canvas-novel 无会话写入围栏与 dispose 守卫

Status: implemented

## Problem

消费方把小说引擎按实例挂到隔离 Context + 独立 `stateRoot` 上（README「工作区接入接缝」记载的支持形态）时撞到两个缺口。(1) 每个写动词都为沙箱围栏硬性要求 `Session`（`policyOf(session)` 是必填），没有会话的宿主侧调用方完全无法写入——尽管会话缺席时的围栏语义是明确定义的：部署默认模式（sidechat store 的先例）。(2) 没有 dispose 守卫：服务自身不持状态、只借 Context，一旦实例被动态挂载/卸载，挂载 Context 销毁之后的调用会在死作用域上静默运行——use-after-dispose 必须是带码拒绝，而不是静默操作。

## Decision

全部演进为增量且通用命名（代码、类型与注释里没有任何消费方词汇）；版本保持 0.1.0；客户端 UI 与 `novel_*` 工具授予不动。

- **无会话写入围栏**（`src/store.ts`）：每个写动词的 `session` 参数放宽为 `Session | undefined`——`ensureRefs`、`writeCard`、`writeChapter`、`proposeOutline`、`decideOutline`、`editPlan`、`reviewChapter`、`starForeshadow`、`setCurrentState`、`confirmChapterPlan`、`extractImport`、`decidePending`，以及私有管线（`mutateJson`、`appendJsonl`、`writeRelation`、`materializePending`）。新的 `resolveFence(session)` 是唯一解析点：有会话时是今天的精确行为（`sandboxPolicy.resolve({ session })`，异常照传）；无会话时调用 `resolve({})`——部署默认模式与兜底根、不借 session id（sidechat store 的先例；main 线上真实的 `SandboxPolicyService` 解析出来的正是这个）——再由 `policyOf` 把可写边界重定界到插件 state 根，正文写重定界到作品的工作区。围栏绝不缺席：只读部署默认照样拒绝。策略服务在无会话解析上抛错时，写在 `mutateJson`/`appendJsonl`/`writeChapter` 三个闸口以 `denied` 编码拒绝，且在任何 fs 调用之前——绝不静默放行。`bindWork` 保持会话必填（它绑定的就是会话本身）。无会话 `writeChapter` 没有可借的 cwd 来补挂缺失的工作区（作品必须自带，否则 `no-workspace`），也不借 id（新建行 `sessionIds: []`）。
- **画布卡动词前传可选会话**（`src/genre.ts` 切片）：`proposeCard`/`patchCard` 接受 `FenceSession | undefined`——引擎照传它拿到的会话，画布自己的围栏仍是画布包的事（真实服务的 `resolve({ session: undefined })` 走的就是同一条部署默认路径）。`canvasBoardOf` 探测保持逐调用探测，永不变成 import 或依赖。
- **dispose 守卫**：`NovelDisposedError`（带码 `'disposed'`、经 `invariant.ts` 新导出的 `PACKAGE_NAME` 带包名，并从包根导出）；`dispose()` 幂等且终态，并经构造器里的 `ctx.effect` 随借入 Context 的销毁自动触发。`assertAlive` 立在每个公开动词上（含读取），挂载方不会无限期消费陈旧实例；写边界——`mutateJson`/`appendJsonl`/`writeChapter` 正文写里、每次 fs 写之前的 `assertAlive`，刻意放在把 fs 错误映射成码的 try 之外——关掉 in-flight 竞态：一次写要么已在边界前完成、要么在边界处带码拒绝，绝不落到重建实例接管的磁盘上。同根重建保持合法（死掉的只是旧实例）。
- **急切 fs 变诚实**：`static inject = ['fs']` 本就意味着 cordis 不会在没有文件系统的组合里挂载本行，但在无 fs 的 Context 上直接 `new NovelService(ctx)` 过去冒出的是属性访问 TypeError（cordis 4 上 `ctx.fs` 返回 undefined）。现在构造时立即抛出指明契约的带包名错误。
- **测试**（`tests/sessionless.spec.ts`，新增 14 个）：手写镜像策略服务（保留为可读的成员清单）钉住默认重定界、不借 id 的形态、只读下两层拒绝（fs 拒绝登记 vs 服务层在任何 fs 写之前拒绝正文）、无法解析时的带码拒绝（零 fs 写）、会话传入侧不变行为，以及急切 fs 构造。真实链路套件（真实 `SessionProjectionRegistry` 喂真实 `SandboxPolicyService`、跑在真实 cordis Context 上，canvas 工作区 spec 的先例）端到端钉住无会话解析——部署默认模式、重定界边界、从无 session id——以及只读拒绝：宿主发布若改变无会话解析，先红的是本套件而不是消费方。dispose 测试钉住每个公开动词带码拒绝、幂等、随 Context 销毁、in-flight 写在边界处拒绝且不留痕迹，以及同根重建。

## Alternatives considered

- **放宽 Remote 孪生**（`remote.novel.*` 的写动词今天收 `agent: Agent`）：被 sidechat 撞过的同一条 typert 边界规则否决——线上的 agent 查找参数不可选。线上永远有浏览器会话在背后，所以无调用方形态只存在于宿主侧的 `ctx.canvasNovel`；Remote 面保持 agent 必填，生成的 typert 面逐字节不变。
- **用 `'disposed'` 的 `NovelError` 返回码代替抛错**：读取返回的形态没有错误通道（`WorkMeta | undefined`、裸数组），返回式错误码在那里要么不可见、要么逼宽每个签名；抛出带码包名错误是 reader/sidechat 先例，读写通吃。
- **按 sidechat 方式延迟注入 fs**（`ctx.inject(['fs'])` + 纯内存降级）：小说引擎没有值得拥有的纯内存模式——每个动词都是状态操作，静默不持久的引擎会背叛作品记忆的全部承诺。诚实的行为就是急切注入，如今带命名的构造错误。
- **dispose 后只守写入**：卸载后读取仍回答陈旧状态，挂载方会无限期消费死实例；交付条件是每个公开动词都拒绝，含读取。
- **可无会话的 `bindWork`**：这个动词绑定的就是调用会话本身；没有会话就没有可绑之物，参数保持必填，而不是多长一个无意义形态。

## Consequences

- `NovelService` 的写动词接受 `Session | undefined`；`NovelDisposedError` 与 `dispose()` 是新的公开面；`PACKAGE_NAME` 从 `invariant.ts` 导出；体裁切片的 `proposeCard`/`patchCard` 接受可选 fencing 会话。Remote 与工具面不变，162 个既有测试全部原样通过（总计 176，新增 14）。
- 无会话写入严格程度恰等于部署默认的要求（通常是最严的适用模式）；省略会话永远不能跳过围栏——最坏结果是带码 `denied`，绝不静默放行。
- 挂载方拥有实例生命周期：dispose 随借入 Context（或显式 `dispose()`），in-flight 写要么在写边界前完成、要么在边界处拒绝，同根重建是新实例的事。
- 传会话的本地行为逐字节不变；客户端 UI 与 `novel_*` 工具授予未动。
