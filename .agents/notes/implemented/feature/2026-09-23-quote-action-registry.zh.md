# Agent Note: quote —— 选区菜单的动作成为贡献注册表（ctx.quoteActions）

Status: implemented

## Problem

quote 插件的选区菜单 M1 上线时动作列表是硬编码的：组件内部组装的 `'conversation' | 'sidechat' | 'copy'` 闭合联合（`packages/quote/src/client/SelectionMenu.tsx`）。每加一个新的投递目标——存为画布卡片、引用进新会话——都要改 quote 包自己，菜单也不可能在运行时认识其他插件的动作行。问题以「quote 是不是耦合太深、该不该拆成一个供其他插件注册的桥接包」的形式被提了出来。实测事实给出的答案相反：quote 的入边为零，仓里真正的重复是「薄 side-chat 桥」被实现了三份——quote 的 `quote.addRef` verb、dsh-reader 的 `reader.quoteToSideChat`、canvas 的 `SideChatMirror`——那是刻意重复惯例的产物，不是 quote 耦合的错。

## Decision

**一个独立包、内置默认动作、注册表作为生长缝。** quote 保留三行内置动作，并新增一个 client 侧贡献注册表，provide 为 `ctx.quoteActions`（ui-shortcuts 的 `ctx.shortcuts` 先例：`packages/ui-shortcuts/src/client/contract.ts`），其他插件借此贡献菜单行，而 quote 对它们一无所知。

- **契约**（`packages/quote/src/client/registry.ts`，经 `@khorsheed/dsh-quote/client` 导出）：`registerAction({ id, label, icon?, available?, run }) → disposer`。id 约定 `<plugin>.<action>`，重复 id 注册即抛错。`label` 与 `available` 在每次菜单打开时重新求值（不缓存），贡献方的语言切换或状态变化下一次打开即生效。
- **target 保持不透明**：`{ text, label, sessionId }`——选中的纯文本、best-effort 来源标签、当前会话 id（可能为 `undefined`）。注册表永不认识动作的投递目的地——与引用载荷自身的不透明规则同一条。
- **内置动作不走注册表（不 dogfood）**。三个内置动作留在组件里：它们绑定组件级状态（`useSessions` 的会话 store、`PropsLocale` 的 quote locale 命名空间），apply 期闭包够不到。ui-shortcuts 能 dogfood 是因为它的 Settings 面自己解析 locale seat；我们的菜单 locale 绑定在组件级。贡献行排在内置三行之后，按注册顺序。
- **最先 provide。** 注册表在 client apply 的最顶部 `ctx.provide`，先于 Remote 挂载，紧随其后的消费方探测即成。注册发生在 boot 期：apply 早于 quote 的消费方探测到 `undefined` 并保持静默——标准降级，已写进 README。
- **失败在注册时被包裹**：`label` 抛错降级为 id、`available` 抛错降级为隐藏、`run` 抛错被吞——三者都经 provide 方的 logger 上报，没有一个能到达菜单。
- **菜单经 `useSyncExternalStore` 订阅**；运行时的 `list()` 在两次变更间保持引用稳定，可直接充当 getSnapshot，热加行同帧出现。
- **消费方纪律**（README 已写明）：仓内消费方 `ctx.get` 探测 + 结构镜像 + 在 `dsh.references` 声明 `@khorsheed/dsh-quote`，永不 import、永不 inject；仓外 npm 消费者可以直接 import 契约类型。`QuoteMenuInjected` 面携带订阅源（`actions: QuoteActionFeed`），composed-props 测试经真实运行时驱动贡献行。

## Alternatives considered

**把 quote 拆成桥接包（注册表内核 + 单独的默认动作包）。** 没有默认动作的桥是空壳——装不出任何用户可见的东西——而且仓里有现成的反面先例：`ctx.shortcuts` 带着「任何插件都能贡献」发布，至今零消费方。拆包还要在 `check-plugin-independence` 的白名单里新增一条受准边、引入 core/companion 安装叙事，买来的东西包内注册表全都有。
**注册表空着发布（社区注册一切）。** 内置三行就是产品本身：引用到当前会话加复制只依赖官方宿主，验收流程验的正是它们（「选中 → 菜单 → 引用落进 composer」）。空注册表装出来是一个没有内容的菜单，重蹈死注册表覆辙。
**内置动作也走注册表（dogfood）。** 上文已拒——内置动作的输入住在组件里，为了纯粹性把它们塞进 apply 期闭包要重排 `t` 和会话状态，换来的不是能力是仪式。
**消费方等待注册表出现（cordis `internal/service` 钩子或 inject）。** 跨家族 inject 社区服务正是 `check-plugin-independence` 禁止的东西，`internal/*` 事件也不是仓里认可的 seam；apply 时探测、缺席即关，让每个消费方都诚实。

## Consequences

- 画布（「存为画布卡片」）、dsh-reader 或任何社区插件都可以在 quote 零改动的前提下往选区菜单加行；README 的「向菜单贡献动作」一节是契约的公开文档。
- 代价是时序敏感：注册在 boot 期，apply 早于 quote 的消费方本次 boot 探测不到注册表（静默降级）。仓内暂时还没有消费方；第一个落地的（画布存卡片是点名候选）必须在真实组合里验证加载顺序。
- 菜单内部存在两条动作路径（内置 + 贡献）——刻意的，见 dogfood 的拒绝理由。
- 三份复制的 side-chat 桥继续保持复制；注册表不吸收它们（它们是宿主到宿主的 seam，不是菜单行），刻意重复惯例早已认领这笔账。

## Testing

`packages/quote`——44 个测试全绿（原 32 + 新增 12）。新增的 `tests/registry.spec.ts` 钉住顺序、重复 id 抛错、幂等 dispose 与通知、list 引用稳定性、三条包裹规则。`tests/client.spec.tsx` 新增贡献行矩阵：按 `data-action` 验证排在内置之后、run 收到 `{ text, label, sessionId }` 载荷且菜单关闭、有无会话两种 `available` 门控、以及经真实运行时的热增删。
