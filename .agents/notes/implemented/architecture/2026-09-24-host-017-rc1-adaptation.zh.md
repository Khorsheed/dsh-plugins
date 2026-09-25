# Agent Note: 宿主 0.1.7-rc.1 适配波——V4 生产者 source、settings 重写、schemastery 3.18.4、图标换代

Status: implemented

[English](2026-09-24-host-017-rc1-adaptation.md) | [中文](2026-09-24-host-017-rc1-adaptation.zh.md)

## Problem

宿主跳过 0.1.6 rc、直发 0.1.7-rc.1(2026-09-23;距 wave 的 0.1.6-alpha.2 基线 1617 commits / 5142 文件)。用户当日拍板启动既定 rc 适配。三路契约审计(preset·bundle·兼容 / Remote·agent·session / UI·槽位·预览,证据全部 rc.1 tag 上 file:line)确认 alpha.1/alpha.2 全部适配继续沿用,但新增一批 breaking:宿主/客户端双侧 settings 重写、Session 日志 V4 生产者归属消息源、peerDependencies 兼容闸门强制化、dsh-agent-presets 拆包、jobs 契约重写、conversation.chat.node 契约形状变化、schemastery 3.18.4 variance 收紧,以及一类 tsc 看不见的全仓图标后缀换代。

## Decision

全部适配维持 probe+degrade 双线契约(0.1.5 继续工作;严禁版本嗅探;跨包槽位注册只走 `slots.inject`)。定案模式:

- **V4 生产者归属 source**。原生 V4 准入在**落盘 flush** 时拒收退役的 `kind: 'plugin'` 包装(`encodeEventBatch` → V4 codec `assertV4SourceRowAdmission`)——内存态 `Session.append` 不拦,这正是 tsc 失明、每包必须配运行时持久化探针的原因。各包经模块增强在 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap` 声明自有 kind(官方 model-selection 范式),写侧改 `source: { kind: '<包短名>', ... }`;读侧三形态兼容——新 kind、V3→V4 迁移来的 `plugin:<原名>`、0.1.5 原位 V3 包装。0.1.5 的 `assertMessageEventShape` 对 `user/message` 只查 `source.kind` 非空,故单一新写形双线安全。tool/result 同步升级为一等 tool-role 消息(toolCallId/isError 扁平到消息层),台账型读取方(kimi session-mirror、sidechat journal)兼读消息层与 V3 块包装两形。
- **settings 重写**——详见专项 note `2026-09-24-settings-config-forms-dual-line`:宿主侧 `ctx.settings.register` → 插件 Config 的 `.volatile()` 字段 + `SettingsForms.update/replace` + `settings/document-updated`;客户端 `ctx.settingsScope` → `ctx.configForms`;`.volatile()` 本身按能力探测(0.1.5 的 schemastery 无此方法);catalog 的机器态块用 wholesale `replace`,因为 `update` 的递归合并会让已删键残留回环复活。
- **schemastery 3.18.4 注解**。`Config: z<T>` 在新 variance 下 TS2375;去注解又在 .pnpm 布局下 TS2742/TS2883。仓内定案为**裸 `z` 注解**(`export const Config: z = z.object({...})`),接口保留作 apply 参数型。共 8 包命中。
- **图标后缀换代**。rc.1 删除像素后缀导出(`IconXOutline14/16/20`),各族只出 `Medium`/`Regular`。被删导出的命名导入在运行时是 undefined、崩组件树而 tsc 不报,故权威扫法是全仓 grep 一刀切到 `Medium`(~200 处),复验零残留。
- **cordis 单实例**。rc.1 官方线 peer `~4.0.4`,override 4.0.2 → 4.0.4;新增 `@deepseek-ai/cordis-plugin-loader@1.0.5` override 消除 1.0.3/1.0.5 双例——双例会 Fork cordis 成两个 peer 后缀实例,`ctx.agents` 这类模块增强挂到消费方没 import 的那个实例上(taskpilot prepare 红单的根因)。
- **peer 兼容闸门**。安装拒绝 + 启动禁用行现在把每个 `@deepseek-ai/dsh*` peer range 当作对宿主运行时的约束(`includePrerelease`)。仓内通行的 `^0.1.0-rc.6` 对 0.1.7-rc.1 通过;精确钉与非字符串判负。
- **dsh-agent-presets 拆名**。import 层换 `@deepseek-ai/dsh-agent-preset-registry`;`resolve`/`mount`/`livePresetMounts`/`agentPresetProjectionDefinition` 面原样沿用。
- **preflight-runner 第四代际**。rc.1 删光三个旧 app-boot 标记(`healProfilesModuleFallback`、`createProfileResolutionGeneration`、`DEFAULT_PROFILE_PATCH_RELOAD`);runner 按 newest-first 探测 `createRuntimeResolution`,照 `apps/cli composeProfile` 的双参形调用。

## Alternatives considered

- **维持写 `kind: 'plugin'`,让 V3 历史自带兼容。** 原生 V4 准入在落盘时拒收该包装,rc.1 线上这类事件会全部丢失——不是降级,是数据丢失路径。
- **按版本嗅探双写形(0.1.5 写 `plugin`、0.1.7 写生产者 kind)。** 违背本波自身规则;而 0.1.5 的准入对 `user/message` 只查 `source.kind` 非空,单一生产者 kind 写形两线通吃。
- **保留类型化 `z<T>` Config 注解。** 3.18.4 下两个方向都报错(带注解 TS2375;.pnpm 布局下去注解 TS2742/TS2883);裸 `z` 注解是我们封装下唯一能编译的形态。
- **按发现顺序逐包修图标。** 被删导出的命名导入运行时崩而 tsc 不报,发现顺序修会把运行时炸弹留在编译绿的包里(canvas 已实证);全仓 grep 一刀切是唯一彻底的扫法。

## Consequences

- wave 状态(`feat/host-016-adaptation`):合 main(28 冲突消解——dual-arm × renderModelPicker 并集、eval openSession 地址逻辑 × 双线并集、datasets chip 随 T73 移除、room inbox × coordinator 并集)→ 重钉 rc.1(38 文件)→ ~30 包逐包修复。ankh-guard 212、capability-catalog 226(含 β 的 wholesale-replace 修复)、批 δ 689、批 α 1375、批 β 1718 测试绿;全仓图标清扫与两轮全量包级 tsc 普扫确认无一漏网——包括编译绿但运行时崩的(canvas)。
- 2026-09-18 遗留「ankh-guard preflight PluginPackages」**实测关闭**:rc.1 试启动把裸 specifier 失败判为可选(22 个官方行 failed to import 仅因 prod profile 仍装 rc.3 代模块)并报 PASS,闸门方向安全。同一实测坐实新的硬前置:**preset 迁移必须先于 3080 升 rc.1**——目录预设(`.agent-presets`)已无代码路径,升线即丢 prod 四个预设。
- npm `latest`/`next` 仍 0.1.5-rc.3,minHost 不动;npm 波(0.1.5 欠发 + 本波)等 3080 验收与账号解封。
- 编译绿不等于运行时绿,本波新增三条实证:V4 写路径(flush 才拒)、kimi 镜像台账双形读、session-title-edit 的 locale 夹具(rc.1 把 locale inject 面迁到 configForms)、图标整树崩。经验法则:跨宿主线时,tsc 绿之后还要 grep 被删的名字。
