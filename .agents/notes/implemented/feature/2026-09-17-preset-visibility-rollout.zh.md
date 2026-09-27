# Agent Note：preset 可见性收口实施——sidebar tab 自隐（单查/双查）与 slash 命令搬伴生行

Status: implemented

[English](2026-09-17-preset-visibility-rollout.md) | 中文

## 问题

2026-09-17 的规范文档（docs/plugin-visibility.md）画出判据轴后，全仓矩阵找到了缺口：worktrees 右栏 tab 无条件注册而自家徽标早已自隐（自相矛盾）；canvas tab 没有门，尽管 3080 已把它的工具收敛进 writing preset；`/eval` `/datasets` `/mission` 在 profile 根注册，所有会话的补全列表都出现，尽管它们的工具只在 preset 授予的会话里存在。本 note 记录收口实施（提案：`proposals/active/2026-09-17-preset-visibility-rollout.md`）。

## 决定

**A1——worktrees 右栏 tab 注册级自隐**（`packages/worktrees/src/client/preset-visibility.ts`）。判据与徽标逐字一致（`visiblePresets` 非空则 override；否则官方 `pluginInventory` 组合数据；一切读不到 fail-open，含无会话首页）。隐藏 = 不注册：guide 枚举注册表，已打开 tab 按会话存储（未授予会话的布局里本就没有它），未注册 kind 渲染 host 设计好的 `tab.unavailable` fallback。徽标保持组件级门；行常量移到新模块、徽标改引用。

**A2——canvas 右栏 tab 按双查判据自隐**（`packages/canvas/src/client/preset-visibility.ts`）。`./agent` 入口有两种合法挂载形态——profile 根挂（包自带 patch 的默认：全会话生效）或 preset 挂（writing 配方：根行停用、preset 指名）。判据因此先查 inventory `entries` 里 enabled 的 `@khorsheed/dsh-canvas/agent` 行（部署级常量授予），再查当前会话的 preset 组。只查 preset 组会让社区默认形态永隐——这正是 2026-09-16 事故的完整教训：错的从来不是「入口按 preset 自隐」，而是「判据没枚举全部授予路径」（当时任何 preset 里都没有行，判据恒假）。

**A3——slash 命令搬进伴生包**。host 的 `CommandDefinition` 没有可见性谓词、client 补全列表也没有过滤缝，但官方先例就是答案：`/goal` `/plan` `/compact` 靠「注册进 preset 挂载行、落进 preset scope 层」实现条件显隐（`web-app/cordis.patch.yml` 停用根行）。所以 `/eval` `/datasets` `/mission` 改由 eval-tool / datasets-tool / mission-tool 经 `ctx.inject(['commands'], …)` 注册，handler 用 `ctx.get` 探测 core 服务委托，并带 roster 兜底守卫（`agentPresets.composedPreset` + `compositionInventory()`，fail-open）接住绕过补全的直接调用。零上游改动；client 的按会话目录与 `agent-preset/selected` 刷新自动完成其余。

**刻意不做**：local-agent 家族的 4 张 provider 设置卡与 member composer 保持常驻——设置卡内容绑定**实例**（provider 凭据），设置页没有当前会话，composer 的 select 本就只命中家族委派会话（A4 定性修正，已记入规范文档）。`/<harness>` `/local-agent` 不动（运行时动态注册，搬家牵连 harness 回调——单列）。helper 包仍不抽取：本轮后内联拷贝达七份（eval/mission/datasets/room + worktrees 徽标变体 + worktrees tab + canvas tab），**已触发** mode-switcher M3' 的「第 5 个消费者」决策点——helper 归属欠一个拍板，单列改动。

## 放弃的替代方案

- **client 侧补全过滤器**——否决：`ui-commands` 的 `candidates()` 无条件入列 host 行，没有缝。scope 层搬家是官方机制，不需要缝。
- **「preset → 可见性」注册表/配置中心**——否决（mode-switcher C 节）：preset 组合文件是唯一事实源。
- **等上游 `available?(agent)` 谓词**——上游诉求留在 mode-switcher 提案的增强清单；scope 层搬家今天就能发，谓词落地后它依然正确。
- **canvas 只查 preset 组**——事故重演，见 A2。

## 影响

- 行为：dev 里 standard preset 会话不再见 worktrees tab（徽标早已隐）；3080 上只有 dsh-writing 会话见 canvas tab；web-eval 里 `/eval` `/datasets` `/mission` 只在 eval preset 会话出现。无会话首页一律 fail-open（入口可见）。
- breaking：slash 离开 profile 根——未授予会话失去补全项（目的本身），直接执行得到守卫的错误文案。
- canvas client 的 `inject` 加回 `sessions`；`@deepseek-ai/dsh-api-session-controller` 回到 devDependencies（回滚时摘掉的两样）。
- docs/plugin-visibility.md：速查表增 slash/设置卡行；判据轴改「每条授予路径都有真值 + 隐藏语义自洽」；反模式钉死「不枚举全部授予路径」。
- 测试：worktrees 84 绿（+12 判据/toggle）、canvas 177 绿（+10，含社区默认形态回归守卫）、slash 六包套件绿。

## 验证

worktree 内各包 `pnpm run build && pnpm run test` 绿；判据测试钉死每条 fail-open 路径、override、旧版顶层 preset key、toggle 注册/注销翻转。3080 真机验收随 deploy 流程（canvas：仅 writing 会话见 tab；根挂部署到处可见）。

## 相关

- [规范文档](../../../docs/plugin-visibility.md)与[其 process note](../process/2026-09-17-plugin-visibility-convention.md)。
- [canvas 自隐回滚](2026-09-16-canvas-preset-self-hide-reverted.md)——A2 的双查补完的那次事故。
- [worktrees 徽标门](2026-09-10-worktrees-badge-preset-gate.md)——A1 复用的判据。
- [mode-switcher 提案](../../../proposals/active/2026-08-26-mode-switcher.md)（C 节；M3' 持有本轮触发的 helper 决策）。
