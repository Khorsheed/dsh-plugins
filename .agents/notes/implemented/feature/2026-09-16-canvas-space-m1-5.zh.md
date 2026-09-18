# Agent Note: 画布 M1.5 —— 摘要/详情分工与右栏 tab 变身卡片详情阅读器

Status: implemented

[English](2026-09-16-canvas-space-m1-5.md) | 中文

## Problem

M1 交付卡板并上了 3080。验收实测暴露一个结构性问题：导入的长文章**把整张卡撑爆了**——板上把全文原样渲染（一张 document 卡从原文 `# 大模型心理学…` 开头糊上去，不折叠、不渲染），一张卡就能占满整块板。板需要摘要/详情的分工：板上摘要，全文在别处。提案 §3「摘要与详情分工」与 M1.5 里程碑就是答案：板上 clamp，右栏画布 tab 做详情阅读器——这也意味着 v1 稿纸编辑器在那个座位上的时代结束（它的存储与 M1 做好的导入通道本来已经是它的归宿）。

三个子问题决定了这一刀的形状。**摘要是什么？** clamp（~6 行 + 渐隐）需要一个不量布局的长文判定，document 卡需要一个不是原文 `#` 开头的标题。**两个座位如何共享"打开了哪张卡"？** 板面板（root 作用域）与右栏 tab（session 作用域）是同一 client bundle 里两个独立的 slot 注册；详情要跟随板上点击，也要跟随两侧各自的变更。**点正文如何程序化激活 tab？** 没有官方 API 时，点击必须降级为只写共享 store。

## Decision

**板卡一律摘要，document 卡以启发式标题开头。** 所有卡 clamp ~6 行（`-webkit-line-clamp`）；`isLongCardText`（纯文本估计——字符数或换行数，绝不量布局）驱动底部渐隐与字数标。document 卡以 `documentHeadingOf` 开头：首个 markdown 标题，否则首个非空行——绝不是原文 `#` 开头——摘要正文去掉标题行，绝不重复显示。两个助手都是 `types.ts` 里的纯函数词表，按词表惯例测试。

**点击语义干净地分开：正文 = 详情，角落勾选框 = 选择。** 点正文写共享 store 并激活详情 tab；多选改到卡片右上角的悬停勾选框（已选后常显），两个手势互不干扰。透镜条逻辑不动。

**共享 store 是唯一的跨座位通道。** `space/selection.ts` 用 `createSnapshotStore`（仓里的 client store 件，worktrees `OpenInAppProbe` 先例）存 `{ canvasId, cardId, rev }`。一个实例活在 client `apply` 闭包里，经两个 inject face 的 `hooks.selection` 到达两侧（slot 运行时把它物化为 `useSelection` prop）。`select()` 写打开的卡；`touch()` 推 `rev`——apply 层的 face 包装在**任一侧**落成的变更上统一调用它，对侧重读跟随。发起变更的一侧已经从响应拿到新板，它自己被 rev 触发的重读是这份一致性付出的代价——一次幂等多余读取，刻意接受，胜过版本门控的花招。

**tab 激活走官方 `ctx.sidebarRight.openTab('canvas')`**（worktrees badge 先例），包在 try/catch 里：`openTab` 要求挂载会话，没有挂载会话（或没有右栏本身）的组合降级为只写 store——tab 以任何其他方式打开时照样渲染详情。文件附件经 `fileAddressFor` 组 `dsh-resource://file` 地址，`ctx.sidebarRight.openResource` 打开（官方文档预览，html 文件同走）。**html 内嵌 srcdoc 预览与 `assets/` 读取动词推迟到 M4**——M4 的粘贴 html 流落地之前，没有卡能带 `assets/*.html` 指针，动词要保护的、渲染器要服务的内容还不存在。

**tab 是卡片详情阅读器，不再是稿纸编辑器。** 它跟随 store：头部（kind 图标、幽灵/归档标记、问题状态、创建/更新时间）、`MarkdownText` 渲染**全文**、评论线程（可读可发）、幽灵卡 ✓/✗ 接 `patchCard`、附件区（url → 链接；file → `openResource`；paste → 注记）。**编辑 toggle** 把正文换成抽取出的 `CardTextarea`——v1 三条硬约束，板与详情共用一个实现（非受控、IME 组合硬停、⌘⏎/blur 保存走 `patchCard`、座位自己的单滚动容器）——保存后回阅读态。tab 是 session 作用域，它的变更经 tab 自己的会话供电围栏。v1 稿纸编辑器（`CanvasView.tsx`、其 CSS、几何 spec）删除；v1 五动词在线上不动，稿纸文件留在磁盘，M1 的导入通道承接它们。

## Alternatives considered

### 为什么不用量高（scrollHeight）检测代替文本估计？

量高需要每卡一个 effect 加一个 resize observer 才诚实，字体加载期还会猜错。文本估计（>240 字符或 >6 换行）是确定的、无 DOM 可测，而且只在便宜的方向上错（一张其实没超的卡多挂了渐隐）。真正的裁切反正由 CSS clamp 做。

### 为什么不用 tab 的 navigation params 传打开的卡，而用共享 store？

`openTab(kind, { params })` 只在打开那一刻携带参数；阅读器还要跟随**之后**的板上点击（不再调 openTab），两侧的变更还要互相同步数据。params 是一次性信封，store 是活通道。（openTab 照样调——为了激活——但不带 params。）

### 为什么不把 v1 稿纸编辑器留在详情旁边（第二个 tab 类型或 tab 内模式）？

提案 §0.2 那行写得明白：座位保留，功能替换——v1 稿纸编辑由「导入为画布」接续，M1 通道已经做好。给旧编辑器第二个座位是把稿纸的归宿劈成两半，还要养 580 行没人打算用的死路 UI；git 历史留着它。

### 为什么现在不做 html 内嵌预览（读资产动词 + sandboxed srcdoc iframe）？

它需要一个新的读 canvas 资产文件的 Remote 动词（一个对路径穿越敏感、需要和其他写入路径同等沙箱照顾的面），去渲染 M4 之前任何卡都不可能引用的内容——M1/M1.5 里没有 html 资产的生产者。官方 `openResource` 预览今天已覆盖 html 文件。推迟让 M1.5 保持零新动词。

## Consequences

- `packages/canvas/src/types.ts`：`SUMMARY_CLAMP_LINES` / `SUMMARY_CLAMP_CHARS` / `MAX_DOCUMENT_TITLE_LENGTH`、`isLongCardText`、`documentHeadingOf`（+9 词表测试）。
- `packages/canvas/src/client/space/selection.ts`（新）：基于 `createSnapshotStore` 的 `CanvasSelectionStore`；devDep `@deepseek-ai/dsh-client-store`（无新运行时依赖——它打进 `client.js`）。
- `packages/canvas/src/client/space/CardTextarea.tsx`（新）：编辑器硬约束抽取；`BoardView.tsx` 与详情阅读器共用。
- `packages/canvas/src/client/space/BoardView.tsx`：摘要渲染（clamp/渐隐/字数标/文档标题）、悬停勾选框、正文点击开详情；幽灵卡 ✓/✗ 改为 stop propagation（正文可点了）。
- `packages/canvas/src/client/detail/`（新）：`CanvasDetailView.tsx` 与其 CSS module——右栏 tab 的新 body。
- `packages/canvas/src/client/contract.ts`：`CanvasViewInjected`/`CanvasViewProps` 由 `CanvasDetailInjected`/`CanvasDetailProps` 替换；`CanvasSpaceInjected` 增 `selectCard` + `hooks.selection`。
- `packages/canvas/src/client/index.ts`：tab 座位改挂详情阅读器；`selectCard` = 写 store + `openTab`（try/catch 降级）；face 包装在落成变更上 touch store；`inject` 增 `sidebarRight`。
- `definition.ts` guide 文案与词典改为描述详情阅读器；`CanvasView.tsx`、`CanvasView.module.css`、`tests/view-style.spec.ts` 删除。
- Remote 面：**零新动词**——整刀是客户端加纯词表。
- 退役稿纸编辑器留下的未用 v1 词典键刻意保留：修剪它们的代价大于收益，且 M4 粘贴流会复用其中一部分；记在这里，免得被重新当成坏味道发现。

## Testing

- `packages/canvas`：**134 个测试全绿**（M1 合并时 115）：`board-vocab.spec.ts` +9（摘要启发式：标题/正文拆分与首行兜底）、`space.client.spec.tsx` 12（勾选框多选替代正文点选、正文点击 → `selectCard`、字数标与启发式标题、IME 硬停不变）、`detail.client.spec.tsx` 新增 10 例（空态、全文渲染、启发式标题、同画布跟随不重取、rev-touch 重读、幽灵 ✓、编辑 toggle ⌘⏎ 保存、评论发出、文件附件 → `openFile`、归档恢复）——详情 spec 用的是**真的** `CanvasSelectionStore`，板↔详情契约被实测而非 mock。
- `pnpm --filter @khorsheed/dsh-canvas build`（gen-typert → tsc → tsdown）、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins` 全绿。
- 未做：3080 实机浏览器走查（部署仍走协调流程）；jsdom spec 覆盖接线，clamp/渐隐是纯 CSS。

## Deferred

- html 资产内嵌预览（sandboxed srcdoc iframe）+ `assets/` 读取动词——M4，有了生产者再做。
- 粘贴即建卡、画布改名、建后挂载编辑、超出 rev 通道的板轮询（外部改动仍靠版本守卫在下一次手势时浮现）。
- 退役稿纸编辑器词典键的修剪（见 Consequences）。

## Related

- [M1 note](2026-09-16-canvas-space-m1.md)（空间、state 目录、围栏重定界）。
- [canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)（§0.2 tab 行、§3 摘要与详情分工、里程碑 M1.5）。
