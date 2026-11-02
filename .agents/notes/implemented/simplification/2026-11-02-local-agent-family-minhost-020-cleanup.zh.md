# Agent Note：local-agent 家族最低宿主升到 0.2.0，删除旧宿主分支

Status: implemented

## Problem

local-agent 家族（核心、四个 provider、`local-agent-dsh-headless`、`bundle-local-agent`）仍声明 `engines.dsh >=0.1.5-rc.1`。为了守住这个下限，代码里留着已经没人在跑的宿主路径（生产跑的是 0.2.1-rc.5）：

- 第二条设置路径：宿主侧 0.1.5 的 `settings.register(namespace, schema, { base })`，客户端的 `settingsScope.bind`；每个 provider 还为它准备了 `legacySchema`/`legacyBase`、`*_SETTINGS_SCHEMA`、导出的 `*_SETTINGS_NAMESPACE` 常量，以及只在 schemastery 有 `.volatile()` 时才调用的 `volatilize` 辅助函数；
- 针对旧宿主形状的客户端探测：`typeof configForms.whileServed !== 'function'`、`mainSessionId` 里对 `SessionListState.current` 的回退、`selectCliMember` 里的 `interactions` 数组（注释把新旧形状写反了）；
- 对 `interruptedTurnClosers` 的可选探测，而 `@deepseek-ai/dsh-session` 从 0.1.5-rc.1 起就导出它；
- 家族内部“核心太旧”的鸭子类型探测（`ensureChildLive`、`trackDelegationRun`、`syncChildSession`、`reportAuthFailure`、`recordRoundSettled`、`activeDelegations`）。pack-dist 发布时把 `workspace:*` 改写成 `^<version>`，provider 不可能跑在更旧的核心上；
- `local-agent-dsh` 里已删除的 DeepSeek 委派开关的残留：配置、schema 和解析后设置里的 `enabled`，只写不读的 `generation`，`currentEnabled`，一个空的 `unwatch`，以及仍提到开关的卡片描述；
- 四个 0.1.5 时代、已无人注册的 `XxxSettingsCard` 组件，和只有测试在用的导出（`assertModelExecOnly`、`assertScopeExecOnly`、`listDelegations`）。

## Decision

- 下限改为宿主 0.2.0：`engines.dsh` 为 `>=0.2.0-rc.1 <0.3.0-0`，`dsh.compat.minHost` 为 `0.2.0-rc.1`（宿主按 `includePrerelease` 判断范围）。compat 说明和 README 的 Compatibility 段删掉 0.1.5 / 0.1.7-alpha 相关句子。
- `settingsFace` 只保留行配置路径（`read` 加 `settings/document-updated`）。`bindSettingsScope` 只保留延迟的 `configForms` 探测；没有设置客户端时仍降级为不可用的 scope。
- provider 直接给设置字段加 `.volatile()`。schemastery 依赖下限提到 `^3.18.4`：这是宿主 0.2.0-rc.1 内置的版本，也是第一个带 `.volatile()` 的版本。
- 家族内部调用直接调用核心方法。防“核心根本没提供”的探测保留（`persistChildSession` 和各 live driver 里 `ctx.get('localAgent')` 为 undefined 的情况）。
- `local-agent-dsh` 启动时注册一次，不再持有开关状态。仍带 `enabled: false` 的 profile 行照常接受：schemastery 对象不严格校验，real-composition spec 现在就带着这个键启动。
- 删除四个独立的 `XxxSettingsCard` 组件、它们的 props 类型和外框 CSS。原有的行为测试改为渲染 `XxxCardSection`。kimi 有两条测折叠头部认证圆点的用例，随头部一起删除。没有引用方的生成文件 `icons.tsx` 一并删除。
- 删除 `assertModelExecOnly`、`assertScopeExecOnly`、`listDelegations`，相关测试改用 `getDelegation` 或删除。`readSubProfilePreset` 和 `readSubProfilePermissions` 保留，因为 `docs/reference.md` 把它们写成了 `./provision` 的公开 API。

## Alternatives considered

**双线代码保留到 0.3.0。** 否决：没有部署低于 0.2.0，这些分支也从没在真实旧宿主上测过。它们让 0.1.5 设置服务的测试替身一直存在，还可能掩盖实际运行路径上的回归。

**顺带删掉模型 broker 的 `setMemberModel` 探测。** 推迟：核心没有 `setMemberModel` 时，这个探测会回退到 broker 自己的一整套覆盖存储和运行时退役逻辑，还有配套测试。删它属于行为决定，不是清理探测。

**删除核心缺 `registerHarnessCard` 时的独立 `plugins.item` 卡片回退（B7）。** 本次只调查不改，见 Consequences。

## Consequences

- 低于 0.2.0 的宿主在安装阶段就会拒绝这些包，不会半工作。
- provider 的 `apply` spec 改成按宿主的真实方式驱动设置：volatile `{ get() }` 引用加 `settings/document-updated` 事件，取代伪造的 `settings.register` 服务。
- 保留未动、仍有守卫的：broker 的 `setMemberModel` 探测；claude-code `live-driver.ts` 里的 `recordRoundSettled` 探测（该文件有并行工作）；`child-log-guard.ts` 里的 `interruptedTurnClosers` 探测（不在本次清单内）；独立 `plugins.item` 卡片回退。`registerHarnessCard` 是同版本核心的 API，所以这个回退现在只在核心客户端没被组合进来时触发，可以留给后续一轮清理。
