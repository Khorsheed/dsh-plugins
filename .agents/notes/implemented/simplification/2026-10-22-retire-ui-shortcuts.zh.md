# Agent Note: 退役 dsh-ui-shortcuts——快捷键设置归宿主

Status: implemented

## Problem

`@khorsheed/dsh-ui-shortcuts`(`packages/ui-shortcuts`)提供社区快捷键动作注册表(`ctx.shortcuts`)、五个默认动作和一张可逐动作改键的设置卡。宿主 0.1.7-rc.2 起官方客户端内置了可改键的快捷键设置:驻留在 web-app bundle 里的官方 `shortcuts` 服务占用同一个 `shortcuts` cordis 键,于是在现行宿主上这个包自己的 provide、设置卡和 keydown 层全部自闭,剩下的职能只是往官方注册表里塞两条命令默认值(`ui-shortcuts.steerSend` / `ui-shortcuts.compact`)。为两条命令默认值养一整个包——测试、locale、每一波的宿主 API 适配——是纯粹的成本;它未发布的 0.2.5 增量也只是 host-021 适配杂务,退役没有任何损失。

## Decision

整包退役——删目录,不设继任包:

- `scripts/retired-packages.ts` 增加登记条目(replacement:宿主内置可改键快捷键设置,≥ 0.1.7-rc.1 线;npm 名在 0.2.4 上 deprecated),此后 `check:profiles` 会拦下任何再点名它的组合。
- `profiles/basic` 与 `profiles/eval` 删掉依赖项与 bundles 行。eval 套的 `install.sh` 把该成员移出 `UNPUBLISHED_DIRS`,三处计数注释同步减一(22 个 tarball / 18 个直接 @khorsheed 依赖 / dump 23 个去重名字);两份 eval README 同步同一批数字(21 个成员 / 18 个直接依赖,基础体验组 12 → 11),两份 dev README 从 dsh-basic 推荐清单里删掉「快捷键」。
- `COMMUNITY_SERVICE_INJECTORS` 删掉 `shortcuts: /^ui-shortcuts$/` 一行——这个键现在是官方宿主服务,不再有社区属主。
- install-spec-floor 规格的解析 fixture 改用 `@khorsheed/dsh-whalesong`(原来拿退役包名当示例文本)。
- `docs/packages.md` 重新生成(49 → 48 个包);`docs/release-status.md` 沿用 typesafe-tool 折叠时的做法手工删单行(整体重新生成会搅动无关的 npm 列)。

未发布的 0.2.5 仓内线(host-021 适配)不再发出;npm 上 0.2.4 是最终发布版,registry 侧的 deprecate 在本改动之外处理。

## Alternatives considered

- **为旧宿主(0.1.2 – 0.1.7-rc.1 线)继续发布这个包。** 不取:已发布的 0.2.4 留在 npm 上,在旧宿主上照常可用——退役停的是开发,不是产物。为一个只剩冻结旧线受众的包持续做 host-021+ 适配,是没有用户的杂务空转。
- **作为可选增强留在 profiles/basic。** 不取:≥ 0.1.7-rc.2 宿主上这个包已经自我降级成往官方注册表塞两条命令默认值——为这点职能占一个套件席位是有重量无功能,而且 basic README 的成员叙事早已把它摘掉了。
- **把多出的两条命令默认值折进别的社区包。** 不取:快捷键目录与改键面板已是官方表面;社区包再提供命令默认值会跟宿主自己的注册表语义打架。改键去宿主设置面板做。

## Consequences

- 旧宿主(0.1.2 – 0.1.7-rc.1)的安装路径保留:`@khorsheed/dsh-ui-shortcuts@^0.2.4` 仍在 npm 上,deprecated 但可装;仓库只是不再开发它。
- `shortcuts` 服务名从此独属宿主;今后任何社区侧的 `inject: ['shortcuts']` 在 check-plugin-independence 眼里都是官方服务注入。
- packages/quote 保留三处「ui-shortcuts 的 `ctx.shortcuts` 先例」的散文引用(源码注释、README、compat notes)——它们引的是设计脉络,不是可安装的边;本次改动不动其他包的源码。
- 此处不修的既有歪斜:basic profile README 承诺 14 个成员(含 context-lens),而 `profiles/basic/package.json` 从未带过 context-lens——本次改动后 profile 是 13 个依赖,README 仍写 14。补 context-lens 归 basic 套件化那次改动自己。
