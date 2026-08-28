# Agent Note: headless bundle 被自动挂进 web profile(2026-08-23 P0)

Status: implemented

[English](2026-08-23-headless-bundle-web-mount-collision.md) | 中文

## Problem

prod 3080 全实例 boot 失败:`@khorsheed/dsh-local-agent-dsh-headless` 是 web profile 的直接依赖,而 `dsh plugin` 的 reconcilePlugins 会把声明 `dsh.bundle` 的直接依赖自动挂进组合 layer 栈——于是这个子 profile 专属 patch(其 `code-runtime` insert 行只在 dsh-base 之上合法)被组合到 web-app 之上,web-app 自己的 `code-runtime` 行使它成为 duplicate entry id。loader 让整个实例 fail loud,但报错隐晦。该行自 bundle 创建提交(`1964e7f`)起未变;缺陷在声明绑定:"要被安装"和"要被挂载"是同一个 `dsh.bundle` 声明,而 layer 列表侧又**需要**它(app-boot 对不声明的 layer 项 fail loud),插件侧无法让包"可装但不挂"(上游接缝登记处 S9)。

## Decision

部署纪律 + 响亮哨兵;刻意**不做**幂等 insert。

- **ops 规则**(docs/ops.md、双语 README):家族内部 bundle 绝不作为任何 profile 的直接依赖——经父包(`@khorsheed/dsh-local-agent-dsh`)传递安装就够子 profile 符号链接解析,而 reconcile 只读**直接**依赖,传递安装的 bundle 永远不会被挂进交互式组合。
- **不变量**(`src/invariant.ts`):组合携带 web 层的 `webStartup` 服务时,伴随件以清晰报错 fail(`mounted into a web composition — this bundle is sub-profile-only…`)。内置 bundle 先于依赖管理的 bundle 挂载,所以本伴随件 apply 时标记已在。它兜住**不撞 id** 的情形——上游哪天改了行名,persona/`hmr`/`tools` 覆盖会静默泄漏进真实用户会话。
- **patch 钉**(`tests/patch.spec.ts`):钉住 `code-runtime` insert 行的 id,改名或删除必须是重访 S9 的自觉行为。
- `code-runtime` 行保持无条件 insert:applyEntryPatches 的按 id 替换语义会让幂等防护在 bundle **自己的**组合里静默丢掉这行(dsh-base 不带 code-runtime)。撞 id fail loud 是 loader 的正确行为;错在被挂进去,不在挂了没拦住。
- 上游诉求(S9):拆分声明(`dsh.bundle.autoMount: false` 或 `profileOnly`),让 reconcilePlugins 跳过 profile 内部 bundle。

## Alternatives considered

- **幂等/存在即替换的 insert**——放弃:它修 web 撞车的代价是在 bundle 自己的组合里静默丢行(dsh-base 没有 code-runtime);loader 对 duplicate id fail loud 是正确语义。
- **从 headless 包删掉 `dsh.bundle` 声明**——放弃:app-boot 对 bundle-less 的 layer 项 fail loud,子 profile 的 `dsh.profile.bundles` 列着它;该声明在那条路径上是必需的。拆声明是上游答案(S9)。
- **插件侧的组合期拦截**——不可能:duplicate id 失败发生在 patch 组合期,任何插件代码都还没跑;运行时不变量拦不住事故的确切失败点——这正是部署规则是主修的原因。

## Consequences

- 事故的直接路径由纪律关闭(prod profile 事故时已手工摘除);不变量 + 钉让下一次错误以清晰信息失败,测试套件钉住危害机制。
- 不变量的 `fail` 在伴随件 apply 时执行;不撞 id 的 web 组合挂进本 bundle 现在以可读信息 fail boot,而不是静默泄漏覆盖。
- bundle 自己的子 profile 零变化:patch、boot、一次性/serve 双模式均未动(包内 36 测试绿)。

## Testing

- `tests/invariant.spec.ts`:接受自家 headless 组合;带 `webStartup` 标记的组合以清晰信息拒绝。
- `tests/patch.spec.ts`:在原 entry-list 方言守卫旁钉住 `code-runtime` insert 行的 id。
