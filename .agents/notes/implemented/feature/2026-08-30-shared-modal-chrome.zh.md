# Agent Note: capability-catalog 全部弹窗统一为一个 ModalShell；MCP 工具 schema 改走共享工具详情弹窗

Status: implemented

[English](2026-08-30-shared-modal-chrome.md) | 中文

本 note 记录 `@khorsheed/dsh-capability-catalog` 客户端的弹窗壳统一。

## Problem

经过多轮迭代，这个面板长出了五个弹窗、两套外观：工具/技能详情和两个新增表单手搓 `.overlay`/`.modal`（且不一致——只有工具详情有 Esc/点遮罩关闭），MCP 管理弹窗则用宿主 `Modal` 原语，外观明显不同（标题字号、关闭按钮、宽度）。更糟的是 MCP 管理弹窗把每个工具的参数 schema 以 compact `SchemaView` 内嵌在工具卡里——schema 渲染存在两个上下文，而 compact 变体挤在窄卡里正是看起来别扭的那个视图。

## Decision

**一个 `ModalShell` 组件统一五个弹窗的外壳**（工具详情、技能详情、MCP 管理、新增 Skill、新增 MCP）：居中遮罩、固定头部（标题 + ×）、滚动正文。Esc 和点遮罩关闭——但仅当它是 DOM 中最顶层的 `[role="dialog"][aria-modal="true"]` 时才生效，层叠的弹窗不会被连带关掉。表单弹窗（两个新增弹窗）传 `closeOnMask={false}`，误点遮罩不会丢掉填了一半的表单；简单确认框（删除 skill、覆盖确认）继续用宿主 `Modal`，那是宿主管的。

**MCP 管理弹窗只管 server 层面。** 点击工具行会在其上叠开共享的 `ToolDetailModal`（渲染顺序排在管理弹窗之后，DOM 序保证它在顶层）；受管的 `CatalogMcpTool` 会合成为带 `channel: 'mcp'` + server 名的 `CatalogToolRow`。内嵌 compact `SchemaView`、`schemaFor` 手风琴状态、`compact` prop、以及 `.mcpToolSchemaBody`/`.schemaTreeCompact`/`.toolParamsHeadCompact` CSS 全部移除——工具 schema 只剩一个渲染上下文，改一处，处处生效。

## Alternatives considered

- **反过来统一到宿主 `Modal` 原语。** 否决：详情弹窗需要 880px 宽壳、固定头部、描述折叠这些宿主 Modal 没有的布局；手搓壳本来就是两套里更丰富、用得更多的那套。
- **MCP 工具卡保留内嵌 compact schema。** 否决：两个 schema 上下文意味着每个展示修复都要落地两遍，而窄卡里的 compact 树正是本次改动的起因。
- **Esc 不做顶层判断、各弹窗各自监听。** 否决：工具详情叠在管理弹窗上时，一次 Esc 会把两层一起关掉。

## Consequences

- 外壳修复（头部、关闭行为、遮罩）现在只落在 `ModalShell` 一处；技能详情弹窗顺带补上了它原本缺的 Esc/点遮罩关闭。
- 已知怪癖（先于本改动存在，不在本次范围）：宿主设置弹窗在 window 层监听 Esc，所以在任何内层弹窗里按 Esc 会连带关掉设置弹窗本身。要修得改宿主。
- MCP 管理弹窗从 600px（宿主 Modal）加宽到共享的 880px 壳；其工具列表的有界滚动（`min(34vh, 360px)`）不变。
- 3090 实例目检通过：详情叠管理弹窗、只关顶层的 ×、新增 Skill 表单外壳、平铺与嵌套两种 schema 树。
