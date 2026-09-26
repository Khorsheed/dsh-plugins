# Agent Note: preflight-runner 挂载它自己算出的 runtime resolution(tarball 形态 profile 的误报 FAIL)

Status: implemented

## Problem

在 runtime-resolution 宿主线上(0.1.6 与 0.1.7),profile 树的插件导入只经由内存拦截解析:`createRuntimeResolution`(0.1.7;0.1.6 为 `createProfileResolutionGeneration`)算出不可变的包表,启动器的 boot prepare 再通过 `hostCtx.plugin(PluginPackages, { resolution })` 把它挂载进进程——profile 的 `node_modules` 里不落任何东西。而 preflight runner 在 compose 阶段算出同一个值之后**把它丢弃了**:它的 `boot()` prepare 从未挂载 `PluginPackages`,条目导入回落到 Node 原生解析。在 tarball 形态 profile 上——每个插件以 `file:` tgz 装进 profile 自己的 pnpm 结构 `node_modules`,其中没有任何 `@deepseek-ai/*` 条目——原生解析什么都找不到,于是 dry-run 对一个实测启动完全干净的 profile 报出约 176 个官方包 "failed to import"(退出码 1)。rc/0.1.2 线不受影响:它们的 `healProfilesModuleFallback` 会物化真实回退链接,原生解析本就可用。[rc.1 适配波次](../architecture/2026-09-24-host-017-rc1-adaptation.md)新增的 0.1.7 探测只镜像了 compose 侧的调用、漏掉了 boot 侧的挂载,因此该缺陷恰好在 compat 实例迁移到 rc 宿主的 tarball profile 时随之发布。

## Decision

runner 按宿主线逐端镜像启动器的 boot prepare:

- `composePreflightPatches` 保留算出的值,作为 `pluginPackagesConfig` 放在 composition 上返回——0.1.7 线为 `{ resolution }`,0.1.6 线为 `{ generation }`(各线 `PluginPackages` 服务实际读取的配置键,已对照两条线的启动器 `runProfile` 核实)。heal 线(rc、0.1.2)不带该字段——它们的启动器不挂载任何东西,解析由物化链接承担。
- `composePreflightPatches` 还在 0.1.6/0.1.7 线上逐字段构建启动器自有的 `profileContext` 服务值(`name`、`dir`、`patchPath`、`installAnchor`、`startedBundles`、`cwd`、`home`、`overlays`、`telemetryDisabledEnv`);启动器自 0.1.6-alpha.2 起提供该服务。缺了它,0.1.7 的 `settings` 服务——`static inject = ['configEditor', 'profileContext']`——永远不会激活,契约承诺要跑到的所有依赖 settings 的 apply 都会一直 pending。
- `runPreflight` 的 boot prepare 遵循 `runProfile` 的顺序:先提供 `profileContext`,再提供启动环境,然后 `await hostCtx.plugin(PluginPackages, composed.pluginPackagesConfig)`,最后 `provideCmdline`——全部在 prepare 内完成,因此拦截在 `boot()` 挂载根 include 之前安装,每个条目导入都经由它路由。若某条线的 compose 产出了挂载配置但宿主却没有导出 `PluginPackages`,直接抛错,以 FAIL 判定浮出水面(下一次真实启动也会同样失败)。
- 提供 `profileContext` 会满足 `hmr` 行的禁用表达式(`!ctx.get('profileContext')`),这会在一次性 dry-run 里启动开发用文件监听——boot 自身的树回写会把一次配置刷新排进 hmr 的操作队列,而 `dispose()` 随后等待一个永远排不净的队列(实测:preflight 在 boot 之后挂起,进程因未决顶层 await 以 13 退出)。runner 的成文契约是"无 HMR、无用户补丁监听",因此在提供 `profileContext` 的线上,当 composition 携带 hmr 行时,compose 追加 dry-run 覆写 `{ id: 'hmr', disabled: true }`。

判定契约不变:0 干净,1 composition 判定,3 基础设施。没有任何诊断被改标签来消除报错——解析现在被真正安装了。

## Alternatives considered

**把导入失败当警告,或以其他方式软化审计。** 否决:退出码 0/1/3 是守卫的门控重启所消费的契约;软化会让真正损坏的树穿过这道唯一的关卡。

**为新线物化回退链接(在 runner 里复活 heal)。** 否决:0.1.7 宿主已整体删除投影函数,runner 得重新实现宿主内部机制,而且——更糟——还要写入被部署 profile 的目录,正是内存化设计要消除的那类副作用。

**提供 `profileContext` 但保持 hmr 行激活。** 已被实测否决:dry-run 随后会在 `dispose()` 挂起(hmr 的操作队列在树拆解时等待一个永远不会落定的刷新),而且 dry-run 无论如何都不该持有文件监听。

**不提供 `profileContext`,接受 pending-`settings` 警告。** 否决:退出码虽为 0,但 settings 服务及其依赖者从未 apply,dry-run 悄悄不再启动模块契约声称要验证的"整棵插件树"——恰好在 settings 变得核心的这条线上留下覆盖空洞。

## Consequences

所得:dry-run 启动的模块图与真实启动器一致——tarball profile 的误报 FAIL 消失(compat017rc2 复现从 177 个失败条目/退出码 1 变为 `preflight PASS`/退出码 0,输出与真实启动逐行一致),settings 子树的 apply 真正在 preflight 下运行。修复搭的是启动器自有服务(`PluginPackages`),未来宿主线路由规则的变更会经由漂移绊线已在监视的同一条接缝抵达。

所费:runner 现在还要多镜像一块启动器状态(逐字段的 `profileContext`)——这是漂移绊线无法完全钉死的又一处手工镜像面(它比对 composition,不比对 boot prepare)。hmr 行在 runtime-resolution 线上的 dry-run 中被禁用,因此 hmr apply 的回归在这些线上会漏过 preflight——已接受,因为此前任何 dry-run 线都从未跑过 hmr(没有 `profileContext` 时它自行禁用)。

## Testing

`tests/preflight-drift.spec.ts` 新增基于夹具的 describe(伪造的 built 宿主面:install anchor 加上桩化的 `dsh-app-boot`/`dsh-home-paths`/`dsh-launch-environment`/`dsh-cmdline` 包),按宿主线钉住:0.1.7 挂载把 compose 产出的对象原样以 `{ resolution}` 传入、0.1.6 以 `{ generation }` 传入、prepare 顺序(profileContext → 启动环境 → PluginPackages → cmdline)、heal 线不挂载任何东西也不构建 `profileContext`、hmr 禁用覆写恰在提供 `profileContext` 时出现,以及挂载就位后启动失败仍退出 1。`scripts/run-test-lane.mjs` 的车道清单计入这五个新测试。

## Related

- [host 0.1.7-rc.1 适配波次](../architecture/2026-09-24-host-017-rc1-adaptation.md)——引入了第四代际探测,其 compose 侧镜像漏掉了 boot 侧挂载。
