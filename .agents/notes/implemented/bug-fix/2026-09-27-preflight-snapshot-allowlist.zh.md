# Agent Note: preflight 快照改为只复制启动输入（白名单），store 链接按包锚定

Status: implemented

## Problem

2026-09-27 一次 `reconfigure`（移动端隧道 `--trusted-host` 切换）全程 1062 秒中有 848 秒（约 80%）花在准备隔离预检 home 上。当时的快照会复制整个 live dsh home（仅排除顶层 `scratch/`),两个机制叠加放大了它:(1) 组合启动根本不读的插件数据目录——`sessions/`(331 MB)、`state/`(584 MB，内含一整棵 Chrome for Testing)、`local-agent/` 子 home 等——被整树复制;(2) 这些树里（以及 `profiles/` 自身：pnpm store 链接和 launcher 愈合的 fallback 链接）的绝对软链解析到 home 之外，而 `externalMaterializationAnchor`(transition.ts）对含 `node_modules` 的目标锚定**第一个** `node_modules` 段——宿主检出的整个根 `node_modules`(2.1 GB）被 32 个 profile 链接拖进了快照。在真实 home 上实测：约 4 GB、234 个外部锚点。复制过程没有任何输出，prepare 看起来像挂死；而且 848 秒超过了 10 分钟的 credential 保鲜窗口——代码注释里早已警告过的失败形态。

这已经是同类问题的第二次事故：黑名单（`SNAPSHOT_SKIPPED_TOP_LEVEL = ['scratch']`）只在事故后增长，而任何新插件往 home 顶层写一个数据目录都会悄悄进入复制范围。

## Decision

`createPreflightSnapshot`(packages/ankh-guard/src/transition.ts）改为复制白名单启动输入——`SNAPSHOT_INCLUDED_TOP_LEVEL = ['profiles', 'settings.yaml', 'cordis.patch.yml', '.credentials.yaml', '.anonymous-user-id']`——取代原来的"全部减 scratch"。插件数据目录默认被排除，插件增长从此不影响快照；名单只在宿主启动开始读取新的 home 输入时才需要动，漏项会以预检 FAIL 的形式响亮显形并指名缺失路径。已在宿主 0.1.7-rc.2 上实证：只带 `profiles/` 的快照就能把真实 web profile 启动到 `preflight PASS`（该 runtime-resolution 线路在内存里挂载包解析；凭据/设置文件为跨线路的启动保真而保留）。

`externalMaterializationAnchor` 改为锚定**最后一个** `node_modules` 段——已解析包自身的父级(`…/.pnpm/<name>@<version>/node_modules`)，该父级本身已持有这个包的依赖兄弟项，Node 的祖先查找语义在最小范围得以保留。store 根中未被链接的部分不再进入复制。

两个快照工厂都接受 `{ includeTopLevel, onProgress }`;transition 计划会把自己的操作路径的顶层根并入复制名单，演练仍然观察到精确路径。工厂返回 `copiedFiles`/`copiedBytes`,`reconfigure` 在复制期间打印节流进度，完成时输出一行摘要（文件数 / MB / 秒）。

修复后在真实 home 上实测：1141 MB / 8.1 万文件 / 43 秒（原约 4 GB / 848 秒），且生成的快照 home 通过真实组合预检（`preflight PASS: profile "web" boots clean`)。

## Alternatives considered

**扩黑名单（把 state/sessions/local-agent 等加到 scratch 旁边）。** 否决：那样每来一个写 home 目录的新插件都要维护一次——靠事故驱动的维护，且失败模式是静默的（复制只是越来越慢）。用户提出的正是这个担忧，白名单翻转是答案。

**在 runtime-resolution 宿主线路上彻底放弃外部链接物化。** 否决：快照与宿主线路无关，"可写链接不逃出快照"的containment保证是结构性的，而且 heal 线路仍然要经物化链接启动。按包锚定已经把成本压到位，再按线路特判只会平白增加漂移面。

**跨 reconfigure 复用校验过的依赖物化缓存。** 暂缓：复制已降到 43 秒，缓存失效的复杂度换不来多少收益。如果 profile 增长再次把复制时间逼近 credential 窗口，再回头评估。

## Consequences

- `reconfigure` 的 prepare 回到几十秒量级且自带进度输出；848 秒的 prepare 不再可能悄悄吃掉 credential 窗口。
- gate 语义从"复刻 live home 的数据"变为"组合带着这个部署的启动输入能启动"——如果某个插件的 apply 依赖此前写入的数据才能启动，现在会在预检失败；这是真阳性（生产首启同样会失败）。
- `tests/transition.spec.ts` 钉住了：默认白名单（插件数据不会悄悄进入）、按包锚定（未链接的 store 内容不进快照）、进度回报，以及运行条目/链接夹具改为显式 include 名单。
- 两个 README 的快照段落在同一变更中同步更新。

## Testing

`pnpm --filter @khorsheed/dsh-ankh-guard test`（构建 + 全部 lane)，加上述真实 home 端到端（快照 → preflight PASS → 清理）。
