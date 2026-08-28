# Agent Note: local-agent live 设置卡片 M2 —— codex 复制（设置驱动换代 + 设置卡片）

Status: implemented

[English](2026-08-27-local-agent-live-settings-card-m2-codex.md) | 中文

## Problem

M1 在 kimi 上验证了 live 设置卡片模式（settings 命名空间以 YAML config 作 composition base、`LiveDriverSwitch` 热切驱动换代、共享 `ProviderAuthBlock` 卡片）。codex provider 的 live driver 此前仍是 apply 时按 Cordis config 一次性冻结——切 `live` 要编辑 profile YAML 并重载。本 note 记录[live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)的里程碑 M2（codex 复制）；模式本身的取舍由 [M1 note](2026-08-27-local-agent-live-settings-card-m1.md) 承载。

## Decision

codex 包逐文件复制 M1 样板，仅换成 codex 形态的名字和一处结构差异（驱动配置带 sandbox 策略）：

- **host**：`src/index.ts` 注册 `local-agent-codex` settings 命名空间（`live` / `liveMirrorGranularity`；`liveIdleMs` 留 YAML 不进卡片），Cordis config 作为 composition `base` 传入，inject 加 `settings`，provider 改吃 `liveSwitch.resolve`。新增 `src/live-switch.ts` 是 kimi `LiveDriverSwitch` 的逐字复制，唯一差别是换代构造时多传 `sandbox`（codex 驱动配置需要，kimi 的没有）。`CodexLiveDriver` 补齐 drain 三件套——`draining` 标志加两处拒新轮检查（`startRound` 入口和 `startRoundLocked` 出队点，排队轮出队即拒、不会触线）、`hasRuntime(key)`、`setLiveMirrorGranularity()`——`CodexCliProvider` 两个调用点（fresh/resume）改吃每成员解析器 `(childSessionId) => driver | undefined`，直传 driver 的旧用法仍兼容。
- **镜像持久化修复（M2 必做镜像检查）**：codex 的折叠路径有 kimi M1 镜像修复所根治的同款缺陷——三处对存活会话的全量事件列表 `sessionPersistence.append(id, session.events)` 调用（live driver 的 `persist()`、exec 路径 live mirror 的落盘、`appendCodexResponse` 的结算落盘）。三处全部改走 `codex-cli-provider.ts` 里共享的 `persistIfStandalone(ctx, childSession)`（导出供 live driver 使用）：在 sessions 服务里注册的存活会话由自己的 write-behind 管道持久化，再全量 append 违反存储的连续 seq 契约。live driver 轮开始自写 `user/message` 本已存在——确认即可，未动。token 粒度的「流/折叠重复渲染」不在本期范围（提案已记录 follow-up）。
- **client**：codex 包长出与 kimi 相同的浏览器半——`settings.plugin.item` 卡片（key = `local-agent-codex`，标题 `Local Agent · Codex`），core 共享的 `ProviderAuthBlock`（`harness={{ id: 'codex', label: 'Codex' }}`），常驻模式区块（开关、粒度单选、覆盖徽标 + 恢复默认、ⓘ 悬浮说明），含那行必须的 `import type {} from '@khorsheed/dsh-local-agent/remote'`。构建面：`dsh.client` + `./client` export、`clientBundle('@khorsheed/dsh-local-agent-codex', ...)`、tsconfig 拆 host/client 双 project、`src/css-modules.d.ts`。CSS module 是 kimi 卡片样式的逐字拷贝（仅注释头改名）——卡片外壳在家族内刻意保持一致。

## Alternatives considered

- **把 kimi 的 `LiveDriverSwitch` 提成家族共享模块而不是复制**——否决：这个开关是 90 行、类型绑死在各家自己的 driver 类上；共享抽象要为每包一个调用点引入驱动工厂参数，而 M1 已刻意把共享范围定在 client 认证区块（唯一逐字相同的部分）。host 半保持每 provider 一份拷贝，并排审计成本最低。
- **codex 的持久化 append 维持原样**——否决：kimi 的根因（'append seq mismatch' 的 throw 在 offset 推进前杀死镜像 pass，后续 pass 重复折叠）逐字适用于 codex 的同款全量 append；提案的 M2  brief 把这个镜像检查列为必做。

## Consequences

- 四家 provider 已有两家可从设置页热切 live；claude-code 与 dsh 留给 M2 余下部分（同一模板；dsh 扩现有命名空间并把 `enabled` 开关收进自己的卡片）。
- `persistIfStandalone` 落在 `codex-cli-provider.ts`（codex 没有 `session-mirror.ts`——折叠代码在 provider/live-driver 两处），导出供 live driver 共享；kimi 原版仍是 `session-mirror.ts` 的模块私有函数。
- codex 包有了 client 面（身份三角一致：`cordis.patch.yml` 行 id、`clientBundle` id、`invariant.ts` 的 PACKAGE_NAME 全是 `local-agent-codex` / `@khorsheed/dsh-local-agent-codex`）。
- 真机验收（3080：卡片开 live → 委派一轮 → 关 → drain 回退 exec；卡片内走一遍重新授权）待做——按提案只跑 kimi + codex；claude-code 豁免。

## Testing

- codex host：`apply.spec.ts` 围绕 fake settings 服务重写（命名空间注册、base 承载 YAML、off/on/热切/粒度同代——保留既有的 provisioning 断言）；`live-driver.spec.ts` +6（drain 立即拒新轮、in-flight 轮跑完再回收、排队轮出队即拒、粒度切换不重建、resolver 门控回退 exec、resolver 向后兼容——kimi 套件移植到既有 FakeAppServer 夹具，悬挂轮用 `fake.runTurn` 驱动）。
- codex client：`settings-card.client.spec.tsx`（9 个：三态渲染、写回走 scope、徽标出现/消失、恢复默认、unavailable 禁用控件、卡片内登录流）与 `locales.client.spec.ts`（2 个：命名空间归属、zh/en 键平价）。全包 90 绿（此前 69）。
- 门禁：`pnpm --filter @khorsheed/dsh-local-agent-codex build` 与 `test` 退出码双 0；`check:plugins` 0 findings；`check:hygiene --all` 0 findings。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——本 note 实现的里程碑计划（M2，codex 半）。
- [M1 kimi 样板 note](2026-08-27-local-agent-live-settings-card-m1.md)——本 note 复制的模式及其被否决的备选。
- [live-driver 提案](../../../proposals/closed/2026-08-20-local-agent-live-driver.md)——本开关热切的四个驱动。
