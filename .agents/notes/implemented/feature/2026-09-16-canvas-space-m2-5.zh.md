# Agent Note: 画布 M2.5 —— 右栏按构造不渲染，卡片详情搬进空间内

Status: implemented

[English](2026-09-16-canvas-space-m2-5.md) | 中文

## Problem

在 3080 上，在画布空间里点卡片正文**没有任何反馈**。M1.5 的设计把卡片详情阅读器放在右栏画布 tab、经 `ctx.sidebarRight.openTab('canvas')` 激活（[M1.5 note](2026-09-16-canvas-space-m1-5.md)）。宿主源码证明这在空间里**按构造**不可能工作：`RightbarRoot.tsx` 只在会话面板激活时渲染右栏（`usePanelInfo(info => info.activePanelId === null)`，否则 `return null`）。画布空间本身就是自定义 main 面板（`activePanelId === 'canvas'`），右栏在那里永远不可见——详情 tab 与程序化激活在它们服务的唯一场景里都是死 affordance。（提案时代的风险注记早把「右栏在自定义 main 面板激活时的表现」列为探针项；探针结论由使用给出。）

## Decision

**详情阅读器搬进空间成为第三列——同组件、同 store。** `CanvasSpacePage` 现在是 画布列表 | 卡板 | 详情 pane，pane 渲染 `CanvasDetailView`——M1.5 的阅读器，本就由共享 selection store 驱动、与座位无关。点正文仍写 store（`selectCard`）；页面在选中时展开 pane。`openTab('canvas')` 的程序化激活是**删除而非降级**：它只可能在画布面板里被触发，而在那里它是必然的静默空操作——没有活场景的 best-effort 是死代码。

**pane 可收起且记忆。** 收起为 28px 窄条（展开按钮），折叠状态写 `localStorage`（`canvas.detailPane`）——一个偏好，best-effort 读取，默认展开。已有选中永远优先：带着选中回到空间时 pane 重新展开（折叠只决定无选中时的默认）。

**阅读器支持无会话的 pane（root 作用域）。** `CanvasDetailProps.sessionId` 放宽为可空；没有当前会话时阅读器只读——编辑 toggle、幽灵 ✓/✗、恢复、评论框、问 Agent 全隐（变更与提问都要借会话供电围栏，没有可借的）。右栏座位照旧传自己的会话。

**右栏 tab 注册保留，一致性免费。** keyed `sidebar.right.pane.tab` 座位与 tab 类型继续注册，服务会话场景（未来会话侧引用跳详情正是它的路）。两个座位同读同写**一个** selection store——pane 与 tab 不可能不一致（M1.5 的 rev 通道在任一侧变更时重读两侧）。

**聊天保持现状；空间内浮现归 side-chat M3。** pane 里的「问 Agent」仍经 `askAgent` prime + 实发，仍 try/catch 调 `openTab('sidechat', …)`——同一 RightbarRoot 契约下它在空间里同样是空操作。side-chat M3 会自建自定义面板的浮层 dock；画布等那条 seam，不自建 dock。

## Alternatives considered

### 为什么不让宿主为自定义面板渲染右栏（改上游）？

仓库的规矩是画布绝不分叉宿主：RightbarRoot 的门是刻意的契约（右列属于会话的上下文，全局面板没有）。放宽它对 side-chat M3 的 dock 也许终究是对的——但那是上游要给的 seam，在那条线追踪，不是画布今天绕开的东西。空间内 pane 是纯插件答案，而且 UX 严格更好（详情在板旁边，不隔一个视口）。

### 为什么不把右栏 tab 注册一并删掉？

它是同组件吃同一个 store，且在会话场景可用——会话侧跳详情（M4 的 `canvas_search`/`canvas_clip` 地带）正是会打开它的路径。删掉它等于为坏的那个面陪葬好的那个；契约保留，注明仅会话场景。

### 为什么不把 `selectCard` 的 `openTab('canvas')` 留作 try/catch best effort？

try/catch 藏的是失败，但这个调用不失败——它落成、在一根永不渲染的列里激活 tab、什么都不报告。命中率 100% 的空操作不是兜底，是代码在撒谎。诚实的句子写在 `index.ts` 的注释里：浮现归 pane；tab 服务会话场景。

## Consequences

- `packages/canvas/src/client/space/CanvasSpacePage.tsx`：三列布局；pane 状态含 localStorage 折叠记忆与选中自展开；经 `{...props}` 渲染 `CanvasDetailView`。
- `packages/canvas/src/client/space/CanvasSpacePage.module.css`：`data-pane` 网格变体（340px pane / 28px rail）、`paneBar`、`paneRail`。
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`：可空 `sessionId` 与完整只读模式；变更助手为每个调用点收窄会话。
- `packages/canvas/src/client/index.ts`：`activateDetailTab` 删除；`selectCard` 纯写 store；`openFile` 两个 face 共用（注明在空间里按构造静默）。
- `packages/canvas/src/client/contract.ts`：`CanvasSpaceInjected` 增 `openFile`；`CanvasDetailProps.sessionId` 可空。
- 词典：`pane.collapse` / `pane.expand`。版本 0.3.1 → 0.3.2。
- 无 Remote、服务、store、线上变更；右栏注册与 M2 聊天路径整体未动。
- M1.5 note 的「经官方 openTab 激活详情 tab」决策由本篇取代；两篇交叉链接。

## Testing

- `packages/canvas`：**160 个测试全绿**（前 158）：space spec 增两个 pane 用例——点正文 pane 渲染全文（空态让位）；折叠状态跨重挂载持久（全新 store，与真实刷新一致）且可再展开；harness 现在为全部测试驱动**真** `CanvasSelectionStore`（pane 跟随生产通道而非 mock）。detail spec 未动且保持绿（会话座位不变）。
- `rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。
- 未在 3080 复验（部署走协调流程）；jsdom spec 覆盖 pane 的打开/渲染/折叠，RightbarRoot 契约引自宿主源码。

## Deferred

- side-chat 的空间内浮现（自定义面板浮层 dock）是它 M3 的 seam——画布保留 try/catch 的 `openTab('sidechat')` 并等待。
- 「全局面板的右栏」宿主契约若要，是上游提案（成形时登记 seam registry）。

## Related

- [M1.5 note](2026-09-16-canvas-space-m1-5.md)（本篇取代的摘要/详情分工与 tab 阅读器）。
- [M2 note](2026-09-16-canvas-space-m2.md)（pane 保留的聊天路径）。
- [canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)（§3 摘要与详情分工）。
