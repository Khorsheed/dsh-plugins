# Agent Note: capability-catalog 经租约式 roster 面解析 rc.1 的 preset scope（双线探测，调用方持有释放）

Status: implemented

## Problem

rc.1 的 `@deepseek-ai/dsh-agent-preset-registry` 删除了 `standingKeyFor(id)`，替换为 `acquireScope(id?)`——一个**租约式**读取：promise 解出 `{ key } & AsyncDisposable`，其内部的 `retain()` 给 preset generation 的用户计数加一；租约不释放就钉住这个计数，preset 被卸载后其 scope 永不回收。未知 preset 抛 `agent-preset/not-found`；坏 preset 抛 `agent-preset/invalid` 并带挂载诊断。`list()`（含 `broken` 行）与 `defaultId` getter 不变。

capability-catalog 的 `resolvePresetScope` 只探 `standingKeyFor`。于是在 rc.1 上每次探测都落进「无 roster」分支，静默回退全局层：`snapshotAt('standard')` 回的是全局面、不带 `preset` 戳，`snapshotFor` / `modeFaces` / 按 preset 的技能投递同此。3093 实例实测：roster 七个 preset、无一 broken，而每个按模式读取都是全局层。降级分支本是无 roster 组合的诚实行为——正因如此，探错面的探测藏在里面一声不响。

## Decision

`packages/capability-catalog/src/preset-scope.ts` 把两条 roster 面收进一次归一化读取。`PresetRosterSlice` 新增可选 `acquireScope(id?)`，租约按 `unknown` 收：key 对目录而言不透明，且 `Symbol.asyncDispose` 在仓库的 es2024 target 下无类型，所以释放经 cast 结构式读取——任何能宿主 rc.1 roster 的运行时都定义该 symbol，因为 roster 自己的租约字面量就以它为键。新导出的 `acquireStandingScope(roster, id)` 优先 0.1.5 的无租约 `standingKeyFor`，缺失时经 `acquireScope` 租取，返回 `{ key, dispose? }`。

`resolvePresetScope` 的签名与 strict/降级契约在两条面上逐字不变——listing 仍降级为不带标签的全局层，fingerprint 仍抛错并点名 preset 与原因（`agent-preset/not-found` / `agent-preset/invalid` 的 message 直接进既有措辞）——其返回值新增可选 `dispose`。三条规则让租约不失守：

- 无 key 的读取（roster 未解出 standing scope）由解析器自己释放；任何调用方都见不到那份租约。
- 持有 key 跨多次读取的调用方在最后一次读之后用 `finally` 释放。`collect` 把整个 body 包进一个 try，并对 `catalogSnapshot` 改 `return await`，释放不可能抢在指纹的正文加载之前。`catalogScope` 获取即放：roster 只在 preset 已卸载**且**零占用时回收 generation，所以释放不会卸下活 preset 的 scope——与 0.1.5 无租约键的语义相同。scoped-delivery 的 `resolveKey` 读完 key 即放；投递条目用 key 自铸 scope，那条生命周期归它自己。
- 释放失败只记日志，绝不砸进它跟随的那次读取。

## Alternatives considered

**先探 `acquireScope`。** 否决：在同时提供两面的 roster 上，租约式读取要为旧面免费回答的事情付出一对 retain/release；优先无租约面让 0.1.5 线在两面同在时逐字节不变。

**获取一次、持有租约到插件卸载。** 否决：这正是 rc.1 引用计数要抓的泄漏——运行时被卸载的 preset 永远收不回它的 scope——而且把宿主刚删掉的「standing mount 免费」假设又请了回来。

**把租约类型写成 `AsyncDisposable` 并给共享 tsconfig 的 lib 加 `esnext.disposable`。** 否决：为一个 symbol 加宽 lib 会改变每个包的类型环境；经 cast 的结构式读取把爆炸半径收在一个模块里。

## Consequences

买到：按模式的能力面读取在 rc.1 上恢复——模式下拉、`snapshotAt` / `snapshotFor`、`modeFaces` 与按 preset 投递都解析到真实的 preset scope——0.1.5 线不受影响（其面在同在时优先），两条面都不泄漏 generation 用户。strict/降级措辞共享，所以指纹拒绝在两条宿主线上读起来一样。

代价：探测顺序里多了一条要跟踪的宿主 API 面，且 `dispose` 契约是可选属性——未来的消费方无视它也能编译通过、然后泄漏。现有三个消费方就是执行点；任何新消费方必须照同样的 try/finally 形态。

## Testing

`packages/capability-catalog` 现有 232 个测试（+6）。新用例钉住 rc.1 臂：只有 acquireScope 的 roster 下的解析与 preset 盖戳、调用方读完恰好释放一次、无 key 租约由解析器自放、broken 与未知 preset 的 listing 降级与 fingerprint strict 抛错（措辞同 0.1.5）、两面同在时 0.1.5 臂胜出。scoped-delivery 规格在真组合上起租约面 roster：投递落在具名 preset 层、每个被解析的 preset 恰好释放一次；broken preset 记成按 preset 的状态错误而非投递失败。

## Related

- [能力指纹——让条件的 `preset` 可核查](../../implemented/feature/2026-09-11-capability-hash-and-sub-dsh-preset.md)——本修复在 rc.1 上守住的那条清单/指纹分界。
- [能力目录的模式视图](../../implemented/feature/2026-09-20-capability-catalog-mode-view.md)——按模式读取曾静默回退全局层的那张面。
- [社区 agent preset 以声明式 bundle 交付（宿主 0.1.7-rc.1）](../../implemented/feature/2026-09-24-community-presets-declarative-bundle.md)——同一套 rc.1 preset 机制的声明侧。
