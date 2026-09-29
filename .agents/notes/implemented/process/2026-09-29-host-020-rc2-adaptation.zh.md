# Agent Note: 宿主 0.2.0-rc.2 适配——四类盘点与唯一的硬 break

Status: implemented

[English](2026-09-29-host-020-rc2-adaptation.md) | 中文

## Problem

宿主从 0.1.7-rc.2（`477b4f42`）升到 0.2.0-rc.1（`dsh-v0.2.0-rc.1`，261 个提交），当天又升到 0.2.0-rc.2（再约 150 个提交，现为 `dist-tags.next`)。迁移 playbook 的侦察阶段要求在动代码前给出逐包的四类判定——结合（用官方新能力增强）、开做（此前不可能、现在可能）、换接口（自有绕行 → 官方 API)、退役（官方原生覆盖）。

## Decision

采用 0.2.0-rc.2 作为本仓基线：钉只读检出于 `~/code/deepseek-harness-0.2.0`（3080 的被守护检出不碰）,devDependencies + `minimumReleaseAgeExclude` + `overrides` + CI workflow 钉子全部移到 0.2.0-rc.2 线，peer range 追加 `|| ^0.2.0-rc.1`(caret 覆盖 rc.2),minHost 下限不动、待运行时验收。盘点判定：**换接口**——唯一硬 break(`runNativeCommand` 新增必填第四参 `window: 'hidden' | 'visible'`;file-preview 五处调用点 GUI 启动器传 `'visible'`,wslpath 转换工具传 `'hidden'`)，外加一处类型级涟漪：schemastery 解析到 3.18.4，其 `Schema` 声明了带类型的 `volatile()`，于是 context-guard、ui-shortcuts、capability-catalog 里手搓的 `VolatileCapable` 强转探针不再通过编译（TS2352)，简化为直调带类型的方法——运行时双线行为（探测 → 0.1.5 的 3.18.2 回落为普通字段）不变；**结合**——无紧急项，新的 `ctx.otel` 服务与 `Volatile<T>` 可实时编辑配置模式记下待后用；**开做**——无（所有在册缝的退役条件均未满足）;**退役**——无包（官方鲸鱼尾运行状态与 whalesong 的侧边栏 logo 叠加层分属不同表面，共存），唯一的台账动作是缝 S11（会话日志崩溃恢复 + 单文件损坏降级）确认在 0.1.7-rc.2 或更早落地，已在 registry 标退役。

## The inventory (0.1.7-rc.2 → 0.2.0-rc.2)

**插件面契约不变。** 客户端 slot 键（62 个声明）、模块加载器、`dsh.client`/`dsh.bundle` 处理、typert/Remote 模式、`ctx.tools`、`ToolSchema`、`registerMessageProjection` 及 fold 语义、`pluginInventory`、`chatFileMentions`、`api-session/*` 转发事件、vendored cordis 4.0.4：全部逐字节不变或仅版本号。区间内无 `BREAKING` 提交。

**唯一的硬 break。** `packages/util/native-command`:`NativeCommandRunner` / `runNativeCommand` 新增必填第四参 `window: 'hidden' | 'visible'`(Windows 启动可见性；其他平台忽略）。三参形态直接类型报错。本仓仅 `packages/file-preview`(`src/open-external.ts`、`src/reveal.ts`）消费；rc.2 的 sidebar-right 内部重构还把 `SidebarRightBinding` 移出导出（契约未动）——本仓零引用。

**官方新能力。** `ctx.otel`(`@deepseek-ai/dsh-otel`)：共享 `createEventReporter` / `createSessionLogReporter` 工厂——官方对"插件要 OTLP"的答案（当前无需求）。`ctx.productAnalytics`（仅 desktop 行）。`deepseekAccount.getDeviceIdentity()`。`ISessions.fork` 新增 `onCreated` 回调（纯增量；本仓未用）。`Volatile<T>` 配置模式（`session-log-deepseek` 的 `enabled`）让插件配置项可被设置表单实时编辑——context-guard / capture / eval / local-agent 的候选用法，待维护者在 3080 上看过再定。Schedule 转为可选 bundle(`@deepseek-ai/dsh-experimental-schedule-bundle`):`time-context`/`schedule`/`ui-schedule` 三行退出 web 默认组合，以这些 id 为目标的 patch 会落空。rc.2 另增：带超时的用户提问与迟到回复、gateway `hasLiveClient()`、官方"从侧边栏文件树打开工作区"动作。

**需运行时验证的行为变化。** 聊天 transcript 默认 `'standard'` → `'detailed'`（遗留的 `'normal'` 映射到 `detailed'`);`ToolCallRecovery` 会在失败 step 的 `step/end` 前补发合成错误 `tool/result` 事件——事件流消费方（file-preview fold、message-tools、taskpilot）必须容忍；config-editor：自有配置键显式 `undefined` 现在替换继承配置而非合并；`ChatSettings.transcriptView` 变为可选/可空；`SessionRowOwnerProps.displayTitle` 现在可为 `''`（我们只消费 `SessionSummary.displayTitle`，未变）。

**preset 自隐探针。** 官方名册变了（schedule 三行出；`product-analytics`、`ui-settings-session-log` 进）。我们的自隐探针键在自家伴生行上、不碰被移除的 id——无需改代码，活体实例上复核即可。

**whalesong 共存。** ui-chat 现在运行时会在 transcript 下方渲染鲸鱼尾 + "Deep diving…" shimmer（写死在 `ChatView`，无槽位无开关）。whalesong 的叠加层锚在侧边栏 logo，另有 favicon 与完成音——表面不交叠，不动。

## 缝台账复核

全量核对已记录在 `docs/upstream-seam-registry.md`(2026-09-29 条目）。判定：S11 **退役**（两个条件均 ≤0.1.7-rc.2 落地）;S5 保留——`@deepseek-ai/dsh-typert-generator` 已上 npm 但分析器仍 monorepo 耦合（见 `scripts/gen-typert.mts` 头注）,overlay 绕行保留；S2/S3/S4/S8/S10/S12/S13/S14/S15/S17/S18、meta-pack reconcile、browser-auth(`Secure` cookie、`--host 0.0.0.0`）均未落地。S3/S4 注：派发事件在基线之前已改名 `tool/ptc-dispatch`,payload 未变。

## Alternatives considered

**留在 0.1.7 线等 0.2.0 正式版。** 否决：CI forward lane 已跟随 `dist-tags.next`(0.2.0-rc.2)，旧钉子证明的是昨天的世界；本次适配成本实测只有一个参数。

**新拆一个共享渲染内核包。** 以"无必要"否决：`packages/ui-content-preview` 已经是那个内核——file-preview、local-files、worktrees 以源码面消费它，构建时内联进各自的 `lib/client.js`(`build/tsdown.client.ts` 的 `noExternal`)，不挂载、不发布——单包卸载天然干净。真正残留的重复（两个 `FileTree.tsx` fork、三个 `preview.ts` 适配器标签体）收进现有内核即可，那是独立的清理项，不在本波。

**peer 精确钉 0.2.0-rc.2。** 沿 rc.2 时代先例否决：宽 range + workspace `overrides` 已钉住 dev 图，窄化只会让旧宿主装不了。注意 prerelease tuple 规则使 `^0.1.0-rc.6` 在严格 semver 下连 0.1.7-rc.2 都不满足——range 是文档性的，安装靠 pnpm 的宽松 peer 解析。

## Consequences

main 对 0.2.0-rc.2 构建与测试全绿，源码改动仅两处（file-preview 的 window 参 + context-guard 的 volatile 探针简化）。rc.1→rc.2 的跟随触发了一次 lockfile 全量重解（pnpm 11 的 minimum-release-age 校验还读 `node_modules/.pnpm/lock.yaml` 的影子副本），顺带重解了约 140 条积压的第三方条目（rolldown、yaml、hono、MCP SDK——全为区间内 minor/patch，且都过了 24h 门槛）；这部分随同一 commit 落地并在其中说明。`@deepseek-ai/dsh-agent-presets@^0.1.0-rc.6` 作为遗留探测目标留在三个包里（该包在 0.1.7 前已下架，无可移动）。后续：集成实例上跑运行时验收清单（ToolCallRecovery 容忍、探针复核、detailed transcript 点检），然后 3080 波次；Volatile 配置是否采用由维护者看过活体效果后定。

## Testing

全仓 `pnpm run build` + `pnpm run test`,`DSH_HARNESS=~/code/deepseek-harness-0.2.0`(tag `dsh-v0.2.0-rc.2`)，全仓 tsbuildinfo 清除后（跨宿主版本缓存规则）：双绿。中间的 rc.1 轮逮到了签名改动波及的唯一测试（`open-external.spec.ts` 的精确参数断言现在期望 `'visible'`)。

## Related

- [宿主 0.1.7-rc.2 适配](../architecture/2026-09-27-host-017-rc2-breaking-changes.md)——上一波的盘点，同一 playbook。
- 缝台账：`docs/upstream-seam-registry.md`(2026-09-29 核对条目）。
