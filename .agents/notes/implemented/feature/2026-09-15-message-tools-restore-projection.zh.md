# Agent Note：message-tools 恢复投影——以 fold 语义探针为闸交付（S12）

Status: implemented

[English](2026-09-15-message-tools-restore-projection.md) | 中文

## 问题

撤回后恢复（restore）把被撤回的助手回复重放为 plugin-sourced `user/message`，正文带 `RESTORED_ASSISTANT_NOTICE` 框架（op 标记 `restore-assistant`）：模型以 user role 读到一段历史助手文本，可能误当新指令执行（seam registry S12）。宿主 0.1.6 新增 `ctx.sessions.registerMessageProjection()`——一个事件类型一个纯解释器，对派生消息做不可变改写且不校验 role——提案 `proposals/active/2026-09-15-message-tools-projection-restore.md` 据此定形：注册在共享的 `user/message` 类型上，只把 restore 标记事件改写为 assistant role，其余一律返回空 Map 透传。

## 探针发现（与提案 M0 结论相左）

**0.1.6-alpha.1 的 surface fold 无法承载「surface 产出型事件」的投影。** `planSurfaceEvent`（`packages/core/session/src/surface.ts`）把「类型已注册投影」的事件全部路由进 `project` 计划，而 `applySurfacePlan` 对该计划**不会**把事件 seq 推入 `surface.nodes`——设计假设投影路径是在正常 append/replace 之上*附加*改写，实际是*取代*。已对照锁定的 alpha 检出实证两次（`DSH_HARNESS=$HOME/code/deepseek-harness-alpha`，detached 于 0.1.6-alpha.1 合并后再两个 commit）：注册 `user/message` 投影后，普通用户消息与 restore 标记消息折叠结果都是 `surface.nodes: []`、`deriveMessages(): []`。照设计注册会在 0.1.6 上把**每一条用户消息**从模型上下文静默抹掉——比它要修的 seam 更严重。该机制目前的实现只服务 log-only 的*决策*事件（唯一一方实例 `image/offload` 正是从 log-only 记录改写既有节点）。

## 决策

- **投影按设计原样交付，注册改为行为探针把闸。** `src/restore-projection.ts` 承载 `restoreAssistantProjection`（纯函数，`type: 'user/message'`）：restore 标记事件派生为 assistant-role 的不可变副本，逐文本块剥框架（非文本块按引用保留、`id` 保留）；其余——普通用户消息、其他 plugin op、畸形 payload——一律返回空 Map。它绝不 throw：fold 在 append 校验内同步调用 `project`，抛错会原子拒绝该候选 append，投影一旦 throw 会让全实例的普通用户消息遭殃。
- **三道降级闸，按序**（`registerRestoreProjection`，由 `MessageToolsService` 构造函数调用）：`typeof ctx.sessions.registerMessageProjection === 'function'`（0.1.6 之前的宿主）；`restoreProjectionFoldSupported()`——行为探针，把两个合成事件（一普通、一 restore 标记）折过真实的 `foldSurface`，只接受设计所需的组合语义（普通消息保节点；restore 保节点且派生为 assistant-role、框架已剥）；注册本体 try/catch（投影位全实例每类型一个——未来官方占用 `user/message` 会冲突抛错，插件绝不能拖垮实例）。每道闸都回落到带框架的 user-role 通道，而持久化事件本来就带着框架——降级即现状，永远不是行为变化。
- **该通道今天在所有宿主上休眠，且自愈式激活。** 没有任何已发布宿主能过 fold 探针（0.1.5 没有 API；0.1.6-alpha.1 的 fold 不过），两条发布线的运行时行为逐字节不变。未来某个 fold 能组合「投影 + surface 成员」的宿主会自然过探针，功能零改动点亮——探针测的是语义，不是版本号。
- **存储与 append 路径不动。** restore append 保留 `restore-assistant` source 标记与框架前缀；两通道共享同一份持久化形态，插件缺席时会话照常可读，`user/message` 是官方词汇，持久化零风险。
- **dispose 双接线但安全。** 宿主返回的 disposer 由 fiber 持有（上游测试：注销注册方 fiber 即注销投影），且 cordis 的 effect 注销幂等，因此 `ctx.effect(() => () => dispose())` 补一条精确的卸载注销，无双 splice 隐患。

## Alternatives considered

- **API 存在即无条件注册**——在 0.1.6-alpha.1 上会把每条用户消息从模型上下文静默抹掉。这是确定的灾难，不是风险。
- **自定义 log-only 决策事件**承载改写（fold 真正支持的形态）——第三方事件类型无法安全持久化：`Session.append` 无法写 `ignorable: true`，持久化读路径对未知必需类型读回即抛。提案 M0 已否掉它，本次 fold 探针只是把注册侧再确认了一遍。
- **劫持官方 log-only 词汇**（`session/title`、`hook/result`……）当决策事件——可持久化、fold 兼容，但这是与词汇所有者抢事件流；且每个见到该类事件的会话都会把我们的投影标记为「已使用」（热卸载时*每个*会话都会拒绝派生）；提案也明确不做。
- **用版本嗅探代替行为探针**——组合式 fold 尚未在任何发布宿主存在，没有版本可键；探针键在所需语义上，自己会翻转。

## Consequences

- **所有已发布宿主的运行时行为不变。** 今天可能触发的两道降级闸（0.1.5 缺 API、0.1.6-alpha.1 的 fold 不组合）都让带框架的 user-role 通道逐字节保持现状；本次改动的可观察面只有投影模块及其测试，外加降级宿主上每次启动的一行日志。
- **通道激活不需要代码变更**——首个 fold 能组合「投影 + surface 成员」的宿主会自动点亮它；这同时也是激活的危险点：探针是「该宿主」与「provider 适配器从未见过的 role 改写」之间唯一的闸（即提案 M2 验收风险）。
- **上游**：fold 必须为 surface 产出型事件把 `project` 计划与 surface 成员组合（先入节点，再应用返回的改写），通道才能激活。在此之前 S12 精神上仍是「待实施」——seam registry 条目与提案 M0 节高估了该机制的就绪度，应由波次文档负责人修正。
- **探针翻绿时**：`tests/restore-projection.host.spec.ts` 的宿主现实钉（`reports false on the 0.1.6-alpha.1 fold`）会按设计转红——翻转前须端到端复验（撤回→恢复→派生 assistant-role；撤回→恢复→再撤回往返；会话重开再派生；provider 适配器对相邻 assistant role 的容忍度）。
- **README / `dsh.compat` notes** 对新降级项的标注，有意留给波次的兼容性标注流程。
