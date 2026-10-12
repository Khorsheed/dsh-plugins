# Agent Note: capability-catalog 重构第一批——死代码面、统一的包含性校验、reconcile 闸门、按 mode 读取 bundle 文件

Status: implemented

## 问题

一次对 `@khorsheed/dsh-capability-catalog` 的内部审计发现五个问题：

1. 死代码面。`types.ts` 里手写的 `CapabilityCatalogRemote` 接口与生成的 typert remote 映射早已脱节且无人引用（客户端绑定的是 `TypertRemoteNamespaceMap['capabilityCatalog']`）；`mcps.ts` 的 `hasUnconfiguredCredentials`、`finalizeTools` 与 `_SECRET_REF_PREFIX` 再导出没有调用方；`McpStore.reconnectAll`/`errorOf` 没有调用方，`StoredServer.error` 字段每次 discover 都写入却无人读取；`mcpList` Remote 已注册，而卡片只读 `mcpSnapshot`。
2. 两个 bundle 文件读取器的包含性校验不一致。`readSkillFileContent`（skills.ts）只做 `full.startsWith(bundleDir)`——不解析符号链接，也没有分隔符边界——而 `readBundleFile`（scoped-delivery.ts）内联了更强的 sanitize + realpath 双重包含性校验。
3. `resolveConfigSecrets` 回调在 `McpStore.discover` 与 `McpStore.callTool` 之间逐字重复。
4. `ScopedSkillDelivery.reconcile()` 会被文件系统 watcher、`agent-preset/selected` 事件和管理 Remote 并发触发；两个重叠的 pass 可能都判定某 preset 没有注册，从而各自为它注册一个 provider。
5. 客户端读取 bundle 文件时丢失了打开详情时所在的 mode：卡片把 modal 的 `readSkillFile` prop 定型为 `(name, path)`，从未告知本次详情是在哪个 mode 下读取的，于是在 preset 对比视图里，只有非默认 mode 加载的 skill 的 bundle 文件会被读成不存在（受管 skill 靠回退定义幸存；插件/运行时 skill 则不行）。

## 决策

五个提交，第 1–3 项零行为变化，第 4–5 项是缺陷修复：

1. 全仓库 grep 确认每个符号无人引用后删除死代码面。对 `StoredServer.error` 的选择是删除而非接通：客户端 MCP 模型（`McpGroup`、管理弹窗）没有错误展示面，把该字段送到浏览器要动线上类型、`mcpSnapshot`、分组模型、弹窗和语言包，只为一个无人索要的状态。
2. skills.ts 的 `resolveBundleTarget(bundleDir, safe)` 是两个读取器共享的唯一包含性实现：已通过 sanitize 的 bundle 相对路径先对 bundle 目录的 realpath 解析，必须等于它或落在带分隔符结尾前缀之下。符号链接逃逸与同前缀兄弟路径（`bundle-evil` 对 `bundle`）现在在两条路径上都读作不存在。
3. `McpStore.secretResolver(serverName, server)` 是唯一回调，两条连接路径都绑定它。
4. `reconcile()` 按 `shellEnv.ts` 的形态加闸门——一个在途 promise 加一个排队标志——任一时刻至多一个 pass 在跑，其间到达的触发至多合并成一次补跑。发现在途 pass 的调用方会等它自己的标志所促成的整串跑完，于是一个被 await 的 reconcile 仍然反映触发它的那次写入（pass 从头重读策略与文件，补跑不丢任何更新）。原方法体改名 `reconcileNow()`。
5. 卡片在打开详情时记录 `readModeFor(name)`，modal 把它传给 `readSkillFile(name, path, presetId)`；宿主侧 Remote 本来就接受该参数。

测试：三类包含性拒绝（符号链接逃逸、`..`、同前缀兄弟）在 helper 层和两个读取器上分别钉住；闸门用一个被 roster 闸门扣住的 pass 钉住——三个并发触发恰好产生两个 pass 且从不重叠；客户端修复在两个视图都钉住（preset 视图，以及在真正加载该 skill 的 mode 上读取的对比视图）。测试数从 254 增至 262。

## 考虑过的替代方案

**把 MCP 连接错误接进管理弹窗而不是删除。** 不采用：要动线上类型 + 快照 + 模型 + 弹窗 + 语言包，只为一个无消费者的状态；Discover 按钮已经会通过刷新把失败重新报告出来。真有需要时，`discover` 的 catch 是唯一需要重新加回的地方。

**在途 pass 完成即让后来者返回，而不等排队补跑。** 不采用：`presetScopeSet`/`Adopt`/`Release` 在 await `reconcile()` 之后立刻重读 `presetScopeStatus`；在旧 pass 后就返回可能答出写入前的状态——加闸门之前不存在这种陈旧。

**把包含性 helper 放进一个新模块。** 不采用：skills.ts 已经拥有 `sanitizeBundlePath`/`collectSkillFiles`，scoped-delivery.ts 也已经从那里导入这两个——再加一个导出符合本地惯例。

**在注册处去重 provider，而不是给 reconcile 加闸门。** 不采用：幂等注册会掩盖其他重叠 pass 的交错（drop 与 register 的先后）；闸门消除了整类问题，且与已验证的 shellEnv 形态一致。

## 影响

Remote 命名空间失去 `mcpList`（重新生成的 typert 映射成为 Remote 面的唯一描述）；被删的 helper 收窄了 `./src/*` 导出的公共面——全仓库 grep 显示无消费者，但若存在读取 `./src/mcps.ts` 内部实现的外部读者则会 break。两条路径上的 bundle 读取现在都拒绝此前会被服务的符号链接逃逸。reconcile 闸门把原先并发的触发串行化，一波触发至多花费两个 pass；代价是 Remote 触发的 reconcile 可能排在 watcher 触发的之后等待。每个提交都通过 `pnpm check:hygiene` 与该包的 build+test 闸门。
