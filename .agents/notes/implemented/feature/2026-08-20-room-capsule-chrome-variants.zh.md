# Agent Note: room — dock capsule chrome variants (A chip register / B text row)

Status: implemented

[English](2026-08-20-room-capsule-chrome-variants.md) | 中文

## Problem

dock 双胶囊（目标 + 任务）的第一位评审者给出了"设计感差"。折叠行是一套一次性的造型语言——tip 面药丸配 unicode ◐/▦ 字符，没有任何官方对应物——展开卡片则是旧条带的 TodoPanel 移植，是官方 Menu 之外的第三种表面材质（room 自己的 @ 补全卡早已用 Menu）。修复需要一次视觉决策，而这个决策属于用户：两个候选造型必须并存，能在运行中的产品里对比。

## Decision

两个变体打进同一个 bundle，由根 section 的 `data-variant` 属性切换（`RoomDockCapsules.tsx` 导出的 `CAPSULE_VARIANT` 常量选定默认值——抉择待定期间为 `'a'`；在 DevTools 里实时改属性即可做 A/B 截图）。一份 DOM，行为零改动：筛选、添加、编辑、完成全部原样。

**变体 A——官方 chip 体系。** 胶囊采用模型选择器 trigger 的语言（ui-model-selection `ModelSelect.module.css`）：28px 圆角（r24）chip，静止透明，标准 interactive hover 底色，13/20/500 secondary 标签，caption 色 chevron 展开时旋转 180°。◐/▦ 前导图标在此变体中充当 chip 的图标位。

**变体 B——轻文本行。** 完全没有 chip 外壳：compaction/dim 行语域的 tertiary 12/18 文本，以 6px 色点起头（胶囊所关切的事项活跃时——目标已设定/任务进行中——取 business-primary，静止时取 caption 色），chevron 相同；仅 hover 才浮现底色。前导图标在此变体中隐藏。

**共享一个面板。** 两个变体都展开进官方 Menu 表面——`--dsw-specific-menu` 底、r12、inverted 发丝边、shadow-lv3——与 room 的 @ 补全卡和模型选择器下拉同一材质，取代 TodoPanel 移植的 tip 卡。

**克制的进行中动效。** 有任务在跑时，任务胶囊扫过一条定宽眩光带（60% 主题底色，`color-mix`），从左界外滑到右界外，2.6s ease-out 循环、末尾 10% 停顿——逐字沿用 ToolRow 的模式——并带 `prefers-reduced-motion` 兜底：停掉扫光和 chevron 过渡。

## Alternatives considered

- **只上变体 A**（官方语域，单方拍板）——否决：这个反馈是口味层面的，而平息口味分歧最便宜的方式是在产品里做一次真 A/B；`data-variant` 开关只要一个属性，就能让两个候选都可构建，直到用户挑选。
- **prop 切换的两套组件树**——否决：重复的 JSX 会在下一次行为改动时在变体间漂移；一份 DOM 加按变体分键的 CSS 让行为保持单源（胶囊 spec 的结构断言原样通过）。
- **自创进行中动效**（脉冲点、进度条微光）——否决：harness 已有 running-glare 惯用语（ToolRow）；借用它让 room 留在产品的动效词汇表里，而不是另造一套。

## Consequences

- 默认造型是变体 A；切到 B 只改一个常量（或实时改属性），日后删除落选者就是纯 CSS 删除加常量移除。
- 展开卡片的材质更换对两个变体同时生效——无论哪个胶囊造型胜出，Menu 表面的面板都保留。
- unicode ◐/▦ 图标只在变体 A 中存活；若 B 胜出，它们随变体块一起删除。
- 143 测试的套件无需改任何断言：变体系统只加属性和装饰性 span，所有现存查询（角色、文本、`[class*=_glyph] svg` 计数）都照常读到。

## Testing

现有胶囊客户端 spec（`room-dock-capsules.client.spec.tsx`，10 个测试）对新 DOM 钉住不变的行为。视觉验证是手动的：在 scratch 实例上对两个变体的折叠/展开做 Playwright 截图（scratch-screenshots/variant-a-*.png / variant-b-*.png），对象是 :3199 的活 room 会话。
