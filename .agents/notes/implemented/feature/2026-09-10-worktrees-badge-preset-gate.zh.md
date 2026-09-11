# Agent Note: worktrees 徽标 preset 闸门（按会话 UI 自隐藏试点）

Status: implemented

[English](2026-09-10-worktrees-badge-preset-gate.md) | 中文

## Problem

[mode-switcher 提案](../../../proposals/active/2026-08-26-mode-switcher.md)希望整套工作模式（一个 profile = 一套插件组合）在会话 chrome 上有所区分。在把整个生态押上这套机制之前，需要先验证其最底层问题的最小形态：一个会话级 UI 表面能否根据当前会话的 agent preset 自我隐藏，且对从未 opted-in 的人保持零行为变化？worktrees 会话头徽标就是这个试点——它是开发铬件，加载期间本就 return null，且 harness 自带的 `ui-agent-preset` 头部标签已经示范了完全相同的会话 preset 读取。

## Decision

worktrees 插件配置新增可选 `visiblePresets?: string[]`（host 侧 schema 默认 `[]`）。缺省或空数组 = 徽标无条件显示——零变化默认值。非空列表把 preset 投影 id 不在列表里的会话的徽标隐藏；**没有 preset 投影的会话保持显示**（fail-open：闸门用于在非开发会话里藏开发铬件，绝不破坏无 preset 的部署）。

配置经插件自己的 Remote 到达浏览器端：host `apply` 把 `visiblePresets` 转发进 `WorktreesRemoteService`，由新增的会话无关 `badgeConfig()` 方法供出。client 半边的 `apply` 永远看不到插件 config——web 引导用 `loader.create({ name })` 组合 client 条目、不带 config（已在 harness 的 `packages/client/web/src/boot.ts` 与 client-modules boot manifest 行形态核实，行只携带 `id`/`inject`/`immediately`），context-guard / message-timeline 的「client apply 第二参数」路径在 web 线上只是名义存在——所以 Remote 是最小且诚实的通道，而不是假装存在的 client-config 通道。徽标每次挂载取一次闸门，把 pending / 失败 / 错误的拉取一律视为无闸门（双向 fail-open），通过 `useSessions` 读 preset（`state.byId[sessionId]?.projectionValues?.agentPreset`，即 ui-agent-preset 的读法），被闸掉时 return null；既有加载中 null 行为原样保留。

## Alternatives considered

**client `apply(ctx, config)` 条目 config（context-guard / message-timeline 的签名）。** 否决：真实 web 线上引导不给 client 条目传 config，该参数恒为 undefined——那些插件 README 里写的 YAML config 实际走 host 侧（settings 基层），经 `settingsScope` 到浏览器。给 worktrees 接这个签名等于文档化一个静默不生效的旋钮。

**改用 settings section（settingsScope）而非裸 config。** 试点阶段否决：注册 settings 命名空间、设置卡片和文案是 context-guard 的全套机械——对一个由部署者在组合里配一次、而非终端用户随时切换的闸门不成比例。若 mode-switcher 日后需要 live 切换，可以补 section 而不改闸门语义。

**把闸门折进 `summary(sessionId)`。** 否决：`SessionSummary` 是徽标与抽屉共享的 git 事实载荷；组合级显示开关不是会话 git 事实，混进去会污染所有 summary 消费方。独立的 `badgeConfig` 方法保持线上词汇诚实。

**连无 preset 会话一起隐藏（fail-closed）。** 否决：没有 agent preset 的部署会在任何人设置列表的瞬间失去徽标——闸门的既定用途是按 preset 说「这不是开发会话」时藏开发铬件，因此信息缺失必须读作「显示」。

## Consequences

对一切既有组合默认行为逐字节不变（空列表 = 无闸门；唯一新增流量是每次徽标挂载的一次 `badgeConfig` RPC，且从内存直接应答）。闸门是组合级而非用户级，改动需重启——对开发铬件试点可接受。覆盖：`tests/badge.client.spec.tsx` 钉死四条闸门语义（无闸门 / preset 在列表 / preset 在列表外 / 投影缺失）外加原样的加载中 null；host 配置归一化由 schemastery schema 默认值承担。若 mode-switcher 验证成立，这套模式（config → Remote → 经 `useSessions` 按会话自隐藏）就是其他会话级 chrome 的模板。

## 附记（2026-09-11）：默认判据已改读官方组合数据

[工具行拆分](2026-09-11-worktrees-tool-split.zh.md)改变了默认形态：`visiblePresets` 为空时徽标不再等于「永远显示」——改读官方 `pluginInventory.list()` 的 preset 组合数据，当前会话的 preset 组合里有 `@khorsheed/dsh-worktrees-tool` 行才显示。`visiblePresets` 保留为手动 override，语义即本 note 所钉；所有 fail-open 路径（无 preset、无 namespace、RPC 失败、组缺席或 broken）不变。
