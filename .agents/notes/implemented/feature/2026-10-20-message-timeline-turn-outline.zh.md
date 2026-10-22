# Agent Note: 消息时间轴改读 turnOutline 投影

Status: implemented

[English](2026-10-20-message-timeline-turn-outline.md) | 中文

## Problem

时间轴此前只列出已加载的聊天窗口：要看到会话的第一条消息，只能一页页往上翻历史（打开时预取加面板滚顶 `loadOlder`），而官方轮次轨道能立即展示每一个已开始的轮次。把整段事件日志拉进客户端窗口从来不可行——整页事件携带工具结果与 assistant 输出，比列表所需重几个数量级，还会撑大 transcript 渲染所依赖的 chat store。

## Decision

时间轴的行列表改为两路合并，对齐官方轮次轨道的双层设计（ui-chat 的 `turn-rail-items.ts`）。宿主 `turnOutline` 投影（`@deepseek-ai/dsh-session-turn-outline`，官方 web bundle 自 0.1.2-alpha.3 起挂载）命名每一个已开始的轮次——`{ turn, seq, prompt, response }`，seq 即该轮的 `turn/start`——面板经 `useProjection` 会话标准座席读取（0.1.2-alpha.1 起可用；两条基线都低于本包 0.1.2-rc.1 的 minHost，minHost 不动）。已加载窗口为它覆盖的轮次叠加更丰富的预览、steering 行与 message-tools 气泡。`src/client/outline.ts` 负责线路收窄（缺席或损坏一律读作能力不在）；`src/client/rows.ts` 负责单趟交错：seq 区间内已有加载行的大纲条目视为被覆盖、不再产出行，其余条目各产出一行大纲行（与已加载行同样的压淡灰刻度——只有阅读位置读蓝色）；加载行归属于它跟随的最后一个条目（窗口跑在投影推送前面时，最新几行暂记在最近命名的轮次名下，待推送追平——压掉它的大纲行胜过把一轮显示两次）。

确认一个大纲行会武装一个组件持有的 pending jump：effect 经会话 jump loader（`ISession.loadThrough`，0.1.2-alpha.3 起，由 `ctx.sessions.binding(sessionId).session` 取得——会话作用域的 conversation 服务只暴露 `loadOlder`）回翻历史，该轮首个加载行一物化即落位，不等翻页循环收束。落位后头指针仍有移动的收束会再请求；头指针停滞、或窗口已覆盖而行仍缺席（首条消息被撤回隐藏），则落位到该轮之后最近的已加载行，与官方轨道的 `scrollToTurnAtOrAfter` 兜底一致。当该轮根本没有 user 行——自动轮次（重启恢复、定时任务）渲染的是 `turn-trigger` 卡片而非用户气泡——落位改为该轮第一个可见的已加载节点（`src/client/rows.ts` 的 `firstVisibleKeyInTurn`），即官方 `user ?? loaded[0]` 锚点；缺了这层时，这些行点上去就像"没反应"。落位对 DOM 滚动最多重试 30 帧，因为 transcript 在同一提交或邻近帧渲染新页。tracker 的 `jumpTo` 现在返回是否命中，注入面新增 `loadThrough`。

投影值缺席时整体降级为原行为——只有窗口行、预取与面板滚顶翻页；`initialPages` 只作用于该兜底路径。投影只是 type-only 开发依赖（`@deepseek-ai/dsh-session-turn-outline/client` 把 `turnOutline` 键合并进 `SessionProjectionMap`）外加一条 optional peer 声明，沿用 local-agent 的 token-meter 先例；插件从不运行时引用它。

## Alternatives considered

**把整段历史翻进客户端窗口。** 否决：事件页携带工具结果与 assistant 输出，"一次拿全"的代价比投影推送高几个数量级（每轮最多推送三次，每轮最坏约 600 字节），还会撑大 transcript 渲染所依赖的 chat store。

**插件侧自做宿主折叠（新起一个服务用户消息的 remote）。** 否决：那是重复宿主已有的投影子系统，还要自带宿主侧包与私有线路，而大纲的轮次级首条预览本就匹配面板的单行。

**维持只列已加载窗口。** 否决：这正是本次替换掉的现状——第一条消息不翻页就不可达，而官方轨道正是用同一投影解决它的。

## Consequences

完整的用户消息列表——含第一条消息——在会话打开的一刻即渲染，长会话的代价是一次全量投影推送而不是 N 次翻页。大纲是轮次粒度：steering 行在其轮次加载进窗口后才出现；首条消息被撤回的轮次仍按大纲列出（投影折叠的是已提交日志，不是 UI 的隐藏），确认后落位到最近可见行。这两点与官方轨道语义一致。没有文字预览的消息保留一行并标记 `rail.empty`（「无文本预览」）——过滤方案试过又被评审否决：自动轮次（重启恢复、定时任务）不是幽灵行，它的 `turn-trigger` 卡片是真实的会话内容。落位对齐官方 `user ?? loaded[0]` 锚点，这些轮次因此能跳到触发卡片。覆盖：`outline.client.spec.ts` 钉住线路收窄，`rows.client.spec.ts` 钉住合并与任意 kind 落位查找，组件 spec 驱动 pending-jump 全生命周期（武装、翻页指示、落位、停滞兜底、历史耗尽）及自动轮次落位；flat-list 笔记中的分页段落此后只描述兜底路径。
