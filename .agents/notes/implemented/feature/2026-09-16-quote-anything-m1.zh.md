# Agent Note：quote-anything M1——选区浮层、composer 插入路径与薄 `quote` Remote

Status: implemented

[English](2026-09-16-quote-anything-m1.md) | 中文

## Problem

[quote-anything 提案](../../../proposals/active/2026-09-16-quote-anything.md)要做「选中任意内容 → 浮出菜单 → 引用到某处」，作为灵感三件套（画布 + 侧边对话 + 引用）的引用层。三个问题必须用契约回答，不能靠口味：

**有没有官方选区 seam？** 没有——side-chat M2 探针已定论：`conversation.*` SlotMap 目录里没有文本跨度的座位，ui-conversation 里所有 selection 命名都是 composer 输入机内部件，message-tools 也没有选区能力。提案因此准许 `window.getSelection()` 作为最后手段的 DOM anchor——但必须带兜底。

**诚实的 composer 插入 API 是什么？** 提案给了方向（`ctx.sessions.scope(id).get('conversation')`），并要求对宿主契约核实准确 API。

**浏览器端能不能不造分叉就排队一条 side-chat ref？** `ctx.sideChat.openWith` 是宿主服务。任务允许经 side-chat 的 Remote namespace 到达——前提是真有合适的 verb。

## Decision

**选区读取收敛成一个可注入的小 seam，兜底语义是安静消失。** `src/client/selection.ts` 把整个 DOM anchor 折进 `SelectionSource`（`start(listener)` → teardown）：真实实现监听 `selectionchange`（拖拽中挂起、mouseup 以 0ms 定时器评估、键盘选区 120ms 防抖），任何 scroll/resize 都隐藏（缓存的视口矩形已过期）。分类是纯函数：非塌陷、非空白文本，anchor 与 focus 都在 `input, textarea, [contenteditable]:not([contenteditable="false"])` 之外，且在菜单自身已挂接的根之外。它只读选中的纯文本与 range 矩形——不碰宿主 DOM 结构、不碰类名；可编辑排除是手势本身要求的唯一结构判定，而 `evaluate` 调用整体包了 try：anchor 读取抛错时降级为「浮层不出现」，绝不拖垮启动。组件测试用手动 source 驱动，从不触碰真实 window 选区；真实 source 自己的 jsdom 规格只补 jsdom 缺失的 range 几何。

**菜单是 root scope 的单个 `shell.overlay` 条目，动作与活选区零竞态。** 文本与矩形在选中时刻捕获。点击动作即关闭菜单并把该快照标记为已消费：点击自身的 mouseup 会让 source 重报仍然完好的同一选区，这一声回声（同文本 + 同矩形）被忽略——下一个不同选区正常唤起。菜单项按降级矩阵：无当前会话 → 两个引用项都隐藏（复制保留）；`remote.quote` 或 `remote.sidechat` 缺席 → 侧边对话项隐藏；点击仍赶上服务缺席 → verb 拒绝 `unavailable`，静默无操作。菜单是不占焦点的 `role="toolbar"` 卡片，视觉对齐官方 Menu 的 token（按钮 mousedown preventDefault，点击不破坏选区）。

**找到的插入 API：`input.setDraft(merged)` 走 scope 寻址输入机——message-tools backfill 先例。** 已对宿主契约核实（`ui-conversation/src/client/contract/input.ts`）：scope 寻址的 `conversation.input.for(scope)` 门面暴露 `setDraft`（整草稿程序化写入）与 `state.getSnapshot().draft`；span-CAS 的 `insertReference` / `slash/input-insert-text` 路径存在，但服务的是 trigger token 替换，不是任意插入。所以路由读活草稿、写 `mergedQuoteDraft(draft, block)`——空白草稿直接填入，已有草稿空一行后追加，绝不覆盖、绝不发送（提案的「格式化 `> 引用块」兜底」就是主路径，没有更富的插入动词可选）。块由 `formatQuoteBlock` 生成：每行 `> ` 前缀，本地化来源标注收在同一块引用尾。来源标签 = 当前会话显示名，回退「选区」——best-effort、纯文本、不回链原文（v1 无锚点 seam）。

**侧边对话路由走本包自带的薄 typert Remote——`remote.sidechat` 上没有合适的 verb。** 审计结论：`send` 会发完整一轮 agent（且拒绝空文本），`quoteMessage` 按消息 id 引用助手消息——都不能把任意文本排队成 pending ref。所以 `quote` namespace 只带一个 verb `addRef({contextKey, label?, ref})`，宿主半探测 `ctx.get('sideChat')`（结构镜像——绝不 import sidechat 包；边在 `dsh.references` 声明）并调用 `openWith`，canvas 已经在用的正当宿主到宿主 seam。verb 不带 calling agent：`openWith` 不持有会话域写入，side-chat store 对宿主侧调用按部署默认模式落围栏（canvas `askAgent` 先例）。结果是显式的：`unavailable`（无 side-chat）、`empty`（空 key/文本）、`io`（seam 抛错）。成功后客户端经官方 `sidebarRight.openTab('sidechat', {params: {contextKey}})` 导航面浮现 tab——同样是结构镜像，探测式，无座位则静默。

## Alternatives considered

### 为什么不做成纯客户端（完全没有 Remote）？

任务「可行则纯客户端」。不可行：side-chat 的上下文映射是宿主服务背后的宿主状态，浏览器唯一可达的面是 Remote namespace；`remote.sidechat` 没有 refs verb（审计如上），纯客户端等于砍掉「引用到侧边对话」——提案的一半。薄 Remote 是最小的诚实桥：一个 verb，自身零状态。

### 为什么不拿 `remote.sidechat.send` 把引用当文本发？

那会**发送**一条消息并唤醒侧边 agent——手势从「归档为 pending ref 供我接着写」变成「拿这段去问侧边对话」，与提案形态列（composer 上方的 ref chip）相悖；而且每次引用都白烧一轮模型。

### 为什么不像 canvas `chatStatus` 那样加一个 `status()` verb 做可见性判定？

canvas 需要诚实的宿主侧答案，因为它的聊天入口常驻屏上。我们的菜单是瞬态的——每次选区都重渲染，廉价的同步探测（`ctx.get('remote.sidechat')` 在 = side-chat 客户端半已加载，加上自己的 `remote.quote`）按次重估已足够准；残余缝隙（side-chat 客户端在、宿主服务没了）也有 `addRef` 的 `unavailable` 兜底。第二个 verb 是没有消费者的 wire 面积。

### 为什么 composer 不用 span-CAS 插入事件（`slash/input-insert-text`）？

那些事件服务的是输入壳裁决出的 trigger token 跨度替换；在草稿尾构造合成跨度要骑内部的坐标语义（"detect-projection coordinates"），公开门面刻意不暴露它。`setDraft` 是文档化的程序化写入——message-tools 撤回回填与持久草稿播种用的都是它。

### 为什么复制/引用后不保留菜单做个确认态？

没有契约的镀铬。两条引用路由的关闭本身就是确认（composer 可见变化；侧边 tab 浮现），复制在 v1 保持最小。记在这里，让以后的打磨轮知道这是想过的，不是漏了。

## Consequences

- 新包 `packages/quote`（`@khorsheed/dsh-quote` 0.1.0）：宿主半 = `src/remote.ts`（`quote` namespace，一个 verb）+ `src/index.ts`（裸挂载，无 inject）+ `src/invariant.ts`；客户端半 = `src/client/{index,contract,locales,selection,SelectionMenu.tsx,SelectionMenu.module.css}`；共享词汇在 `src/types.ts`。已登记进 `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES`；`docs/packages.md` 已重生（35 包）。
- `dsh.references: ['@khorsheed/dsh-sidechat']` 把唯一的跨插件边声明为数据；`pnpm check:plugins` 原样通过（检查器认 `dsh.references`，担心的误报没有发生）。
- 上游提案起草于 `docs/upstream-proposals/2026-09-16-selection-actions.md`（ui-conversation + 文档预览的选区动作 seam，owner props 带纯文本 + 可选锚点），DOM anchor 路径的退役与之挂钩。
- 一条值得重述的 jsdom 教训：jsdom 的 `Range` 没有 `getBoundingClientRect`——seam 自己的规格补了 range 几何；生产行为在 anchor 读取抛错时是 catch-to-null 兜底（安静消失），不是零矩形菜单。

## Testing

- `packages/quote`：**32 测试全绿**——`tests/types.spec.ts`（4：引用块与草稿合并）、`tests/remote.spec.ts`（5：`addRef` 降级矩阵——`unavailable`/`empty`/`io`、label 缺省、精确的 `openWith` 载荷）、`tests/selection.spec.ts`（11：分类排除 + source 的拖拽/防抖/滚动/拆除接线）、`tests/client.spec.tsx`（12：可见性降级矩阵、三条路由、消费回声、label 回退）。
- `pnpm --filter @khorsheed/dsh-quote build`（gen-typert → tsc → tsdown）、`pnpm check:plugins`、`pnpm check:hygiene`、`pnpm test:scripts` 全绿；`docs/packages.md` 已重生。
- 未做：真实 3080 实例的活浏览器走查（验收第 3 条——聊天区选中 → 浮层 → composer → 发送；画布详情 → side-chat ref chip；卸载 side-chat → 只剩当前会话项）。jsdom 覆盖接线与降级逻辑，不覆盖真实选区手感。

## Deferred

- 提案的 M2：连续多处引用累积、引用块内联展开、随上游 seam 落地按区域退役 DOM anchor。
- 菜单打磨：键盘导航、滚动跟随（替代滚动即隐藏）、复制确认态。

## Related

- [side-chat M2](2026-09-16-side-chat-m2.md)（本 M1 承接的选区 seam 探针结论，以及浮层 dock 的 overlay 先例）。
- [side-chat M1](2026-09-16-side-chat-m1.md)（路由排队所依赖的 `openWith` seam 与 pending-ref 模型）。
- [quote-anything 提案](../../../proposals/active/2026-09-16-quote-anything.md)（M1 行及其验收标准）。
