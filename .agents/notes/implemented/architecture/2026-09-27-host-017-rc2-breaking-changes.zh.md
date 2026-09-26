# Agent Note:宿主 0.1.7-rc.2 适配——破坏性变更清单与我们实际动了什么

Status: implemented

[English](2026-09-27-host-017-rc2-breaking-changes.md) | 中文

## 问题

宿主从 0.1.7-rc.1(`46a7f68b`)推进到 0.1.7-rc.2(`477b4f42`,346 个 commit)。每条插件线都需要一份核实过的「什么坏了、什么是新的」;评测线协调者点名按类目(typert 形态、preset registry、图标、session/tab API)要这份清单,照着适配,不用自己重摸。

## 决定

就地采纳 rc.2 为本仓基线(版本钉 + CI tag),修掉它唯一打破的类型 stub,所有插件继续保持宽 peer 范围——下面的分类清单就是这个决定的依据。

## 清单(rc.1 → rc.2)

**typert 形态——无变化。** 四个 typert 包只有版本 bump 与 README 重录;vendored schemastery 逐字节一致;重新生成的 Remote 产物与 rc.1 等价。插件侧无动作。

**preset registry——一处删除。** `modeSelectionEnabled` 整个没了(`a44534e27`,PR #5108):`AgentPresetRegistry.Config` 不再声明、roster 不再返回、`remoteExportList()` 只剩 `presets`;`defaultId` 语义变为恒等于 `selectedDefault ?? default`。选择器显隐改由 Developer tools(`configForms.developerTools`)统一控制。旧 patch 里残留的 `modeSelectionEnabled` key 被静默忽略。standing scope 挂载时机与 pending 行激活语义在 rc.1 之后**未再变**。插件动作:读过该字段的删掉;patch 里写过该 key 的可清可不清。本仓:零引用(已 grep 核实)。

**图标——无改名无删除,一个组件被删。** 本轮没有 `Icon*Outline*` 改名。ui-primitives 删了 `OnboardingSurface` 组件(本仓零引用);`IconQueueOutline{Regular,Medium}` 改复用 chat-lines 字形、`IconClockOutline*` 重画——同名不同形,像素级依赖者注意。新增:`IconArchiveOffOutline*`、`MenuSurface`、`ShortcutKeys`、`useModalLayer`、`observeComposition`、`GuideArtwork*`。

**session/tab API——全是 additive,无槽位键或既有 props 变更。** `conversation.view`、`sidebar.workspaces.session.*`、会话头 actions 键均未变。值得知道的新面:`ComposerBarInjected.hooks.stopShortcut`(只有自绘 composer 的插件要接——本仓零自绘);`ConversationBinding.openTurn`;ui-sidebar-right 的 `bindCommands({ refresh })` + `tab.refreshShortcut` + 焦点/命令方法组(`openWithFocus`、`closeTarget`、`openTabFromTarget` 等)——这是「右栏 tab 想要刷新入口」的官方答案,additive、可不接;ui-workspace 新增两个会话行槽位(`sidebar.session.row.leading`、`sidebar.session.row.hover`,owner props `{ sessionId }`);ui-approval 新增 `displayReason`(本地化审批理由)。包内部常量 `DEVELOPER_TOOLS_VIEW_ID` 改名 `TRAJECTORY_VIEW_ID`(值仍为 `'trajectory'`)。

**唯一真正炸到我们编译的**:ui-model-selection 的 `ModelDirectoryState` 新增必需字段 `pending: ModelSelection | null`(`d55f434cf`,目录自己持有进行中的选择)。message-tools 那张从不渲染的 `EMPTY_MODEL_DIRECTORY_STATE` stub 缺了它(TS2741)。修法:去掉 `: ModelDirectoryState` 注解、补上 `pending: null`——非 fresh 绑定走结构化检查,同一份字面量在 rc.1 形态(fresh 字面量多 `pending` 会触发 excess-property 检查)与 rc.2 下都能编译。双线 stub 照这个写法抄。

**新官方能力——`@deepseek-ai/dsh-client-shortcuts`。** 客户端服务名 `shortcuts`:`register(command)`(用户可改键,id/绑定冲突会 throw)、`registerFixed(command)`(只读固定键)、`catalog`/`fixedCatalog` 快照、`edit()`、`recording()`。配套 `@deepseek-ai/dsh-client-ui-shortcuts`:设置页入口行 + `Cmd/Ctrl+/` 快捷键参考面板。两包均已启用进 web 默认组合。我们的 ui-shortcuts 走双路径适配(≤rc.1 用自有注册表,rc.2 向官方目录贡献 steerSend/compact 两条命令)。

**web 默认组合变化。** `time-context`、`schedule`、`ui-schedule` 三行存在但 `disabled: true`(`cad6fef2fd`)——探测时「行在但 disabled」与「未安装」语义不同。`llm-deepseek` 行的包拆成 `dsh-llm-deepseek-api-key` + 新增 `llm-deepseek-account` 行(行 id 不变;在 profile 里给该行写过细粒度 config 的部署要按新包核对字段——我们没写过)。plugin-manager 新增 `ctx.pluginNavigation.openBundle(packageName)`(深链到某 bundle 详情页),以及前一个操作的 pnpm 子树未退干净时的有界等待。app-boot:bundle 加载失败不再当场打 stderr,汇总进 `Profile.skippedBundles` 由启动器每次启动打印一次。

**source.kind / format v4 生产者约束——无变化。** session-format 各包只有版本 bump。

## 本次适配我们做了什么

基线钉(`pnpm-workspace.yaml`,174 处)与 CI/publish workflow 的宿主 tag 升至 rc.2;按「构建卫生」规则清 tsbuildinfo 后全量验收:message-tools 修复后构建全绿,测试全绿。**测试全绿**(015 源码面解析下);对 015 checkout 的 build 失败为**预期且既有**——`eval/src/job.ts` 引用 0.1.7 才有的 `dsh-jobs` 具名导出(`import type`,运行时擦除),capability-catalog 的 `scoped-delivery.ts` 引用 0.1.7 才有的 preset-registry 包。该族的 0.1.5 线从设计上就是运行时探针路径(用新基线构建一次、运行时双形适配);rc.2 没有触碰其中任何一处。

## 备选

**把每个插件的 peer 范围钉死到 rc.2。** 不采纳:宽松的 `^0.1.0-rc.6` peer + workspace `overrides` 已经钉住开发图;收窄 peer 只会让 npm 线在老宿主上装不了,没有收益。

## 影响

main 现在对 rc.2 构建、测试全绿,插件代码改动只有 message-tools 一处 stub。值得做的后续(不阻塞):右栏 tab 可接 `bindCommands({ refresh })`;bundle 卡可用 `pluginNavigation.openBundle` 深链。

## 验证

清 tsbuildinfo 后,`DSH_HARNESS=~/code/deepseek-harness-rc2` 下全量 `pnpm run build` + `pnpm run test` 双绿。eval 族六包对 0.1.5 基线:测试全绿;015-checkout 的 build 挂在既有的 0.1.7 专属类型引用上(见上),与本次升级无关。

## 相关

- [ui-shortcuts 搭乘官方 shortcuts 服务](2026-09-26-ui-shortcuts-official-service-dual-path.zh.md)(双路径细节)。
- [preset 组合的工具行以 inject 声明 core](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.zh.md)——rc.1 时代的挂载序教训,本清单确认 rc.2 未再变。
