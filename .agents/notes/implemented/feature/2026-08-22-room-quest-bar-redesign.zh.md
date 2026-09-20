# Agent Note: room — quest-bar 重设计（goal 进度环胶囊 + Linear 式任务面板）

Status: implemented

[English](2026-08-22-room-quest-bar-redesign.md) | 中文

## Problem

双胶囊 A/B 方案（见 [chrome-variants 笔记](2026-08-20-room-capsule-chrome-variants.zh.md)）没有定案：用户两个候选都不满意。变体 A 的胶囊读起来是两个匿名 chip 配 unicode ◐/▦ 占位符；变体 B 的文本行把 goal——dock 里最重要的信息——扔进了 tertiary 灰。重设计的要求：goal 的进度环必须是折叠行唯一的视觉焦点，任务胶囊必须带真正的 checklist 图标和谁在跑，任务面板必须读起来像 Linear（色点筛选胶囊、small-caps 分组头、着色状态图标、成员 chip、右对齐灰 meta）。

## Decision

只交付一个设计；`data-variant` 开关、`CAPSULE_VARIANT` 和两个 chrome 块全部删除（`RoomDockCapsules.tsx` / `.module.css`）。行为零变化——筛选、添加、编辑、完成、blocked 置灰、推进线、goal 编辑全部保留；只有结构和样式变了。

**折叠行。** goal 胶囊以 SVG 进度环开头（tertiary 底弧 + 品牌色进度弧，`-90°` 旋转从十二点起笔），后接取整百分比和截断的 goal 文本；未设 goal 时渲染「＋ 设定目标」引导态，无环。任务胶囊以官方 primitives 的 `IconChecklistOutline14` 开头（unicode 符号从此绝迹），后接未结计数（pending + in_progress，cancelled 出局）和正在跑的成员（色点 + 名字 + 本地化 在做/doing 后缀）。两个胶囊都沿用官方 chip 体系（28px、r24、hover 浮底、13/20/500），并加可见描边（静止态取 InputBar 卡片的 `l2-darkmode-thin` 对，hover/展开收紧到 `l3`），让折叠行一眼可读为可点胶囊；有任务在跑时保留 ToolRow 扫光。尾部 caption 箭头删除——hover 浮底本身就是可点信号。

**锚定。** 胶囊行锚定在输入卡片正上方：展开面板渲染在胶囊行之上的同一 flex 列里（自上而下：面板 → 胶囊行 → 输入卡片），只向上生长，开合时胶囊行在指针下零位移。

**goal 展开卡。** goal 全文 + 行内 编辑、进度条现在配上 done/total 分数、最近推进列表，表面仍是官方 Menu 材质。

**任务面板。** 筛选行是色点胶囊，选中态取成员自己颜色的 14% 淡填（`--room-chip-color` 行内自定义属性 + `color-mix`——淡填，绝不用描边），＋添加 触发器从面板底部挪到该行右端。分组头是 Linear 的 small-caps 体系（11px、600、加字距、大写、tertiary——大写交给 `text-transform`）。任务行：着色状态图标（进行中=品牌色旋转半环、待办=tertiary 空环、完成=实心成功勾、已取消=caption 环）、省略截断的标题、成员 chip（色点 + 名字，fill-l1 底）、等谁 blocked 标签、右对齐 tertiary 状态 · 相对时间、行尾 完成。行 hover 浮底；负水平外边距让图标与卡片内边距视觉对齐。

**完成动效。** 关闭任务重放一段克制的动画：勾弹出（scale 0.6→1），完成标题的划线沿文本画出同时标题转暗——240ms，在 300ms 约束内，带 `prefers-reduced-motion` 兜底。划线用内联内层 span 上的背景渐变实现，线只跨文本而不是整个 flex 拉宽的行；行在状态变化时重挂载（`key = id:status`），CSS 动画因此重放。

**构建发现——`composes` 在这里不会导出多类名。** client bundle 的 lightningcss 通道（`build/tsdown.client.ts`，`cssModules: { pattern }`）会把 `composes: capsule` 编进样式表，但 `capsuleActive` 的导出只有单个类名，于是展开态胶囊悄悄丢掉了全部 capsule 规则，退回 UA 按钮描边（2px outset）——A/B 变体一直带着这个 bug。重设计完全绕开 `composes`：状态全部走单个类上的 `aria-expanded`/`data-active` 属性选择器。仓库里已没有任何包使用 `composes`。

## Alternatives considered

- **保留变体 B 为默认并继续打磨**——否决：用户在品味层面否掉了两个变体；继续参数化失败者是在重审已定案的问题。重设计拿官方 chip 体系（变体 A 的骨架）做骨架，修的是 A/B 从未触碰的内容层级。
- **百分比放进进度环内**——否决：14px 的环放不下可读的 3 位数字；百分比以 600 字重放在环侧，环本身保留弧线这个一瞥即得的信号。
- **只留 runner 胶囊、去掉扫光**——否决：扫光是 room 沿用官方 ToolRow 的运行成语，且需求明确保留；runner 胶囊补的是*谁*，扫光补的是*活着*。
- **推迟 store 变更以就地做过渡动画**——否决：任务板是 journal 驱动的；为一段装饰把关闭推迟 240ms 会让状态时间线分叉。`id:status` 重挂载零状态介入地拿到同样的动效。

## Consequences

- 折叠行现在一眼回答三个问题——走多远（环 + 百分比）、剩多少（计数）、谁在跑（runner 胶囊）——代价是 goal 文本要和百分比共享行宽。
- 分组行在分组头下仍重复成员 chip（定稿 ASCII 如此）；冗余是刻意的——分组滚动时 chip 是行的身份锚点。
- `tasks.summary.pending` / `tasks.summary.running` 离开词典；`tasks.doing` 加入（双语）。胶囊 spec 的折叠行断言从计数字符串迁到百分比 + runner 词汇，composer spec 同步。
- `composes` 发现适用于全仓库：今后 client bundle 里 CSS Module 的状态变体必须用属性选择器或在 TSX 里显式拼两个类，不要用 `composes`。

## Testing

144 测试保持绿，断言更新在 `room-dock-capsules.client.spec.tsx`（折叠行百分比/计数/runner 内容、卡片 `1/3` 分数、面板在胶囊行之前的树序断言）和 `room-composer.client.spec.tsx`（`tasks.doing` 键）。真机验证在 scratch :3199 上跑了三轮 Playwright（design-a-*.png 截图当时只在本机 scratch，已清掉）：折叠态、goal 卡、任务面板、运行扫光 + 半环、完成动效、暗色模式、无 goal 引导态。第一轮暴露了 `composes` UA 描边 bug；第二、三轮验证修复和新播种房间的全流程（设 goal → 添加 → 完成 → 推进记录）。描边 + 锚定的后续修正两个主题都验过（capsules-*.png 截图当时只在本机 scratch，已清掉）：折叠胶囊有可见描边；折叠态与两种面板展开态下胶囊行的 `getBoundingClientRect().top` 完全相同（1280×800 视口下均为 642px）。

## Related

取代 [chrome-variants 笔记](2026-08-20-room-capsule-chrome-variants.zh.md)（两个候选均被用户否决；变体机制已删除）。
