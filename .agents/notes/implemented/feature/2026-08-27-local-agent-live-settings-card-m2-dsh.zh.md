# Agent Note: local-agent live 设置卡片 M2 —— dsh 复制（enabled × live 组合 + row-action 迁移）

Status: implemented

[English](2026-08-27-local-agent-live-settings-card-m2-dsh.md) | 中文

## Problem

[live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)的里程碑 M2：把 M1 kimi 样板（[M1 note](2026-08-27-local-agent-live-settings-card-m1.md)）复制到 local-agent-dsh。dsh 与另外三家有两点不同：它已有自己的 settings 命名空间（`local-agent-dsh`，schema `{ enabled }`），其 generation+sync 控制器整组注册/注销 harness+provider+tool；它的 DeepSeek 委派开关住在家族 core 的「本地 Agent」section 里、走 `local-agent.settings.row-action` 子槽——两者都要保留/组合，不能被 kimi 形态直接压过去。

## Decision

**一个命名空间三个字段，composition base 形态不变。** `local-agent-dsh` 的 schema 扩为 `{ enabled, live, liveMirrorGranularity }`；YAML config 的 `live`/`liveMirrorGranularity` 照 kimi 进注册时的 `base` 层（解析顺序 = schema 默认 ← YAML ← user 层）。`enabled` 没有 YAML 对应项、纯 settings，所以卡片的覆盖徽标与「恢复默认」只覆盖 live 字段。

**`enabled` 管存在性，`live` 管模式——按包含关系组合。** `LiveDriverSwitch`（`packages/local-agent-dsh/src/live-switch.ts`）构造在一个 enabled 代际**内部**（index.ts 只在 harness/provider/tool 注册期间建它，并随它们一起 dispose）：

- `enabled` 翻转保持历史硬语义：整组注销，switch 的 `dispose()` 走 `disposeAll()`——属卸载，可以打断。sync watcher 现在在 `enabled` 未变时提前返回，live/粒度写入不再触发 provider 重注册（此前命名空间只有 `enabled` 一个字段，任何写入都重注册）。
- enabled 代际内的 `live` 翻转走 kimi 语义：退役驱动代际被 DRAIN（新轮拒绝 → provider 回退 exec；in-flight 轮不受打扰跑完；空闲 runtime 立即回收），新一代惰性拉起。provider 注册保持稳定——它吃 switch 的每成员解析器 `(childSessionId) => driver | undefined`（直传 driver 的旧用法仍兼容）。
- 粒度翻转不换代：`setLiveMirrorGranularity` 同代生效，驱动每轮读粒度。
- `enabled` 关着时 live 值是惰性的（没有 provider 去解析它），开关重新打开时生效——卡片在此状态下刻意保持 live 控件可编辑：它们编辑的是长期偏好，不是运行中的进程。

**卡片：row-action 席位腾空。** dsh 的 client 半不再向 `local-agent.settings.row-action` 贡献；改为注册一张 `settings.plugin.item` 卡片（key = `local-agent-dsh`），承载三个区块：core 共享的 `ProviderAuthBlock`（harness id `dsh`——gateway 对无 login/logout 的 harness 报 `loginable/logoutable: false`，区块只渲染状态，外加一行「凭据走宿主」提示）、DeepSeek 委派开关（原 row-action 功能逐字平移）、kimi 形态的 live 区块（开关、粒度单选、覆盖徽标 + 恢复默认、ⓘ 悬浮说明）。core 的 section 留到 M3 才撤，本次只迁走 dsh 的贡献。`DeepSeekSettingsAction.tsx` 及其 spec 删除——卡片已取代它们。

**镜像修复，与 kimi 同一 bug 类。** `mirrorDshSession` 和 live driver 的逐消息 `persist()` 都向 `sessionPersistence` 全量重放事件列表——对存活中的 child session 这违反存储的连续 seq 契约（'append seq mismatch'），且在 live driver 里被拒绝的 persist 队列会把 settle pass 杀死在权威 mirror 报告之前。新导出的 `persistIfStandalone`（session-mirror.ts）只在 session 不在 `sessions` 服务里时才 append；存活 session 的耐久性由它自己的 write-behind 管线负责。

## Alternatives considered

- **一个融合控制器从 `{enabled, live}` 统一推导一切**——否决：enabled 翻转该 drain 还是 dispose 只能靠 diff 输入区分，等于把 switch 的代际逻辑在 sync 路径里重写一遍。包含式组合（switch 住在 enabled 代际内）让每个开关的语义单一：存在性 = 注销 + disposeAll，模式 = drain。
- **`enabled` 关掉时立即回收 live runtime（现状行为）vs drain**——刻意保留硬 dispose：disabled 期间 provider 已注销，drain 后空闲的 runtime 也永远等不到下一轮，drain 只会推迟回收。打断窗口与 M2 之前完全一致。
- **卡片的 live 控件随 `enabled` 禁用**——否决：live 字段是叠在 YAML base 上的偏好，在委派从未打开前也有意义；禁用它们会暗示一种 host 组合层面刻意不存在的耦合。
- **保留 `DeepSeekSettingsAction` 作为死导出以兼容**——否决：包外无任何引用（全树 grep），且检查器强制的包边界使 client 面本就是卡片内部实现。

## Consequences

- `DshLiveDriver` 新增 `drain()`、`hasRuntime(key)`、`setLiveMirrorGranularity()`；它的 `config.liveMirrorGranularity` 现在按代际被改写，所以 switch 给每一代递自己展开出的 config 对象。
- dsh 包的 client 面形态变化：`dsh.client.inject` 增加 `@deepseek-ai/dsh-api-remotes` 与 `@deepseek-ai/dsh-client-ui-primitives`；peer deps 增加各 client 包 + react（全部 optional）；client 入口携带规定的 `import type {} from '@khorsheed/dsh-local-agent/remote'` 一行（原因见 M1 note 的 Consequences）。
- `persistIfStandalone` 只改变「独立 session vs 存活 session」的持久化行为；exec 路径的 `sessionPersistence.create` 调用未动，host 侧鉴权/凭证代码零改动（提案红线）。
- M2 剩余的 provider（codex、claude-code）直接复制 kimi 形态；dsh 是例外的那家。等 codex/claude-code 落地，M3 即可撤掉 section 的 row-action 子槽——dsh 已不再是消费者。

## Testing

- host：`apply.spec.ts` 围绕 fake settings 服务重写（12 个：命名空间注册 + base 载荷、enabled 开/关、disabled 时 live 惰性、enabled+live 建驱动、enable 时应用已存 live、不重注册 provider 的热切换、粒度同代、enabled 关 dispose / 开重建、两开关独立）。`live-driver.spec.ts` +7（drain 立即拒新轮、in-flight 轮跑完再回收、排队轮出队即拒、粒度切换不建新代、resolver 门控回退 exec、resolver 向后兼容、严格持久化下 live 轮仍只折叠一次且发出 mirror 报告）。
- 镜像：`session-mirror.spec.ts` +1（独立 child 触发 persist，存活 child 不触发）。
- client：`settings-card.client.spec.tsx`（9 个：默认三区块渲染且无登录动作、已认证+开启各态、core 缺席时 unavailable、enabled/live/粒度写回、徽标出现/清除、unavailable 禁用全部控件）与 `locales.client.spec.ts`（键集对齐）。全包 90 绿。
- 门禁：`pnpm --filter @khorsheed/dsh-local-agent-dsh build` 与 `test` 全绿；`pnpm check:plugins` 0 findings；`pnpm check:hygiene --all` 0 findings；全仓 `pnpm run build` / `pnpm run test` 退出码双 0。
- 真机验收走提案共享的 M2 验收（只跑 kimi + codex）；dsh 无登录流程，卡片认证区块按设计只显示状态。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——里程碑计划（M2 的 dsh 半）。
- [M1 kimi 样板 note](2026-08-27-local-agent-live-settings-card-m1.md)——被复制的形态。
- [live-driver 提案](../../../proposals/closed/2026-08-20-local-agent-live-driver.md)——本开关热切的驱动。
