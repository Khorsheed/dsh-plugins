# Agent Note: local-agent live 设置卡片 M1 —— kimi 样板（热切驱动换代 + 每 provider 设置卡片）

Status: implemented

[English](2026-08-27-local-agent-live-settings-card-m1.md) | 中文

## Problem

live driver 的配置（`live`、`liveMirrorGranularity`）此前只有 Cordis loader config 一层：改它要编辑 profile YAML 并重载插件——最终用户根本碰不到。官方设置页的 Plugins → 可配置插件 tab 有 keyed 卡片槽（`settings.plugin.item`）和家族先例（ui-shortcuts、context-guard），而 live-driver 提案刻意把配置面留出了范围。本 note 记录[live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)的里程碑 M1（kimi 样板）。

## Decision

**三层配置，settings 服务原生支持。** 每个 provider 注册自己的 settings 命名空间（此处 `local-agent-kimi`），Cordis config 作为 composition `base` 层传入（`ctx.settings.register(ns, schema, { base })`）：解析顺序 = schema 默认 ← YAML ← user 层，卡片只存用户显式覆盖，「恢复默认」就是清掉 user 层字段（`scope.unset`）。没有任何手写合并。

**热切按驱动换代，绝不打断进行中的工作。** `packages/local-agent-kimi/src/live-switch.ts`（`LiveDriverSwitch`）watch scope，把解析值镜像成驱动代际：

- 开 → 惰性建新一代（首轮之前不起进程）。关 → 旧代走新增的 `driver.drain()`：新轮以 `LiveChannelUnavailableError` 拒绝（provider 既有 catch 回退 exec），in-flight 轮在原 runtime 上不受打扰地跑完，空闲 runtime 立即回收。`drain()` 刻意不是 `disposeAll()`——卸载仍是 dispose（打断），设置切换是 drain（绝不打断）。
- 粒度切换不换代（`setLiveMirrorGranularity`——驱动每轮读粒度），所以切「按消息折叠/逐字流式」永不回收进程。
- 交接门闩：provider 现在吃每成员解析器 `(childSessionId) => driver | undefined`（直传 driver 的旧用法仍兼容）。旧代还持有某成员 runtime 期间，该成员的下一轮解析为 undefined → 走 exec，同一 kimi 会话绝不会被两个进程加载。同子会话并发本来就被 resume 锁挡住；门闩补上的是 spawn 在途的角落。

**client：每 provider 一张卡，认证区块由 core 共享。** kimi 包长出浏览器半（`settings.plugin.item` 卡片，key = `local-agent-kimi`）：家族 core 新抽的共享 `ProviderAuthBlock`（从 `LocalAgentSettingsSection` 逐字搬迁，section 内部改为组合它——section 留到 M3 才撤）+ 常驻模式区块（开关、粒度单选、覆盖徽标 + 恢复默认）。说明文字收在 ⓘ 悬浮/聚焦浮层里（官方 `Tooltip`），卡片每行保持一行。卡片经 `ctx.get('remote.localAgentGateway')` 惰性读 core 的 gateway Remote，两个 client 插件的启动顺序永远不构成依赖。

## Alternatives considered

- **设置变化时整体重注册 provider（dsh `enabled` 开关的换代模式）**——否决：dsh 的开关切的是存在性所以整体换代；live 开关切的是模式，in-flight 中重注册 provider 会把进行中的 run 簿记吊死。drain 驱动让 provider 注册保持稳定。
- **手写 `settings ?? yaml ?? default` 合并读取**——否决：settings 服务的 composition base 逐字就是这个语义，还自带覆盖徽标需要的 user 层在场信号；重复实现只会漂移。
- **粒度变化时重建驱动**——否决：粒度是每轮读取的；重建会为纯展示偏好杀掉常驻 runtime。
- **ⓘ 说明默认展开（提案第一版草图）**——按评审否决：卡片每行保持一行，说明文字进悬浮浮层。

## Consequences

- `KimiAcpLiveDriver` 新增 `drain()`、`hasRuntime(key)`、`setLiveMirrorGranularity()`；M2（codex/claude-code/dsh）必须逐家复制这三件套——drain 语义是要做对的部分（轮在 `startRound` 同步入链，所以 drain 快照能看见每一个已接受的轮）。
- kimi 包有了 client 面（`dsh.client`、`clientBundle('@khorsheed/dsh-local-agent-kimi')`——身份三角一致）；tsconfig 拆成 host/client 双 project，host project 用 include 自动收进 `live-switch.ts` 这类新 host 源文件。
- core client 类型的下游消费方必须自己 `import type {} from '@khorsheed/dsh-local-agent/remote'`：declaration emit 会擦掉 core 自己的空 type-only import，否则 gateway 类型在 skipLibCheck 下静默降级为 any。M2 每个 client 都要带这一行（kimi client 头部注释有说明）。
- 认证区块是纯 UI 搬迁：host 侧鉴权/凭证代码零改动（评审红线——claude-code 授权当前不通，全程未触碰）。

## Testing

- kimi host：`apply.spec.ts` 围绕 fake settings 服务重写（命名空间注册、base 承载 YAML、off/on/热切/粒度同代）；`live-driver.spec.ts` +6（drain 立即拒新轮、in-flight 轮跑完再回收、排队轮出队即拒、粒度切换不重建、resolver 门控回退 exec、resolver 向后兼容）。全包 105 绿。
- client：core `provider-auth-block.client.spec.tsx`（9 个，含两个 section-vs-block 平价套件——既有 14 个 section 测试一行未改全绿），kimi `settings-card.client.spec.tsx`（9 个：三态渲染、写回走 scope、徽标出现/消失、恢复默认、unavailable 禁用控件、卡片内登录流）。
- 全仓：`pnpm run build`、`pnpm run test` 退出码双 0（22 包）；`check:plugins` 0 findings；`check:hygiene --all` 0 findings。
- 真机验收（3080：卡片开 live → 委派一轮看增量 → 关 → 回退 exec；卡片内走一遍重新授权）待做——只跑 kimi + codex；claude-code 按提案豁免（授权当前不通）。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——本 note 实现的里程碑计划（M1）。
- [live-driver 提案](../../../proposals/closed/2026-08-20-local-agent-live-driver.md)——本开关热切的四个驱动。
