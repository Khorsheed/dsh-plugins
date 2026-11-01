# Agent Note：CLI 成员的上下文圆环与压缩提醒

Status: implemented

## 问题

用户 2026-10-31 的决定（交互稿 `proposals/prototypes/member-compaction.html` v2）要求：

- **占用显示**：CLI 成员的上下文占用和宿主一样显示，统计行末尾一个圆环加百分比。
- **按钮**：压缩按钮只由 context-guard 画，且超过比例才出现。
- **比例**：可以按 CLI 设，也可以按成员设，优先级为成员 > CLI > 全局。
- **房间**：输入框里显示协调者的圆环和按钮；成员弹层里显示每位成员的圆环，成员胶囊上显示提醒点。
- **独立**：context-guard 与 local-agent 家族互不依赖。

宿主的圆环和按钮到不了成员会话：成员输入框盖住了宿主输入栏，而宿主 `/compact` 只作用于 dsh agent。

## 决定

- **占用数据（local-agent 家族）**：每轮结束后，驱动写一条 `local-agent/context {provider, usedTokens, contextWindow}`（已向宿主登记），数值不变就不写。
  - Kimi：取每轮结束后发出的 ACP `usage_update {used, size}`。
  - Codex：取 `thread/tokenUsage/updated` 的 `last.inputTokens` 和 `modelContextWindow`。
  - Claude Code：取最后一条顶层 `assistant` 消息的提示量（`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`）；窗口取 `result` 事件 `modelUsage[model].contextWindow`。子智能体的消息（带 `parent_tool_use_id`）不计入。只有 live 驱动记录，exec 兜底路径不记。
- **CLI 自己触发的压缩**：记一条 `local-agent/compaction`，source 为 `auto`。
  - Kimi：从 wire 读，起点是发出提示时的行数；wire 当时还不存在则从第 0 行读。
  - Codex：从普通轮次里的 `contextCompaction` item 读。
- **读回占用**：`memberContext` Remote 读最新的占用。之后若有完成的压缩，就用它的压缩后数值；Codex 不给这个数，所以压缩后占用未知，等下一轮再报。
  - 同时返回运行状态（`idle` / `running` / `compacting`）和 harness 名（`kimi`、`codex`）。
  - 冷会话只从存储日志读一次。
- **成员工具登记（local-agent 客户端）**：`localAgentUi.registerMemberTool({id, render(face)})` 与 `renderMemberTools(child, placement)`。
  - `meter` 是 local-agent 自己画的圆环，样式同宿主 ContextMeter；点开是挂到 body 的面板，显示数字和 `panel` 工具。
  - 其余位置只渲染登记的工具：`composer`、`row`、`panel`、`dot`。
  - 每位成员一个共享的 1.5 秒轮询，供所有界面使用。
  - face 是纯数据加 `compact()`，默认经成员收件箱发 `/compact`。有自己压缩流程的界面可以给 `renderMemberTools` 传 `options.compact`，替换默认做法。
- **成员输入框**：圆环接在统计行末尾，`composer` 工具放在模型选择前，`/` 菜单提供「压缩 compact」。
- **context-guard**：
  - 探测 `localAgentUi`，登记 `MemberGuard`，负责画：
    - 超过实际生效比例时的「⚠ 压缩」（压缩中显示「压缩中…」）。请求被接受后按钮保持禁用，直到成员状态变化：房间可能把压缩排在正在跑的一轮后面，再点一次就会排进第二次压缩。成员空闲时 30 秒后恢复可点。
    - 提醒点；
    - 面板里的「此成员的提醒比例」，写入 `memberThresholds`。
  - 配置新增两个 volatile 字段：`harnessThresholds`（按 harness 名）和 `memberThresholds`（按会话 id，附名字与 harness）。
  - 设置卡新增「外部 CLI」一组（来自 `localAgentUi.harnessCards()`），以及单独设了比例的成员列表，可清除。
- **房间**：
  - 外部协调者的 `meter` 接在统计行末尾，`composer` 工具放进输入框那一行。
  - 只要知道成员名字，`compact` 就走房间自己的 `/compact` 派发（`submit(room, '/compact', [name])`），统计行上的协调者圆环也一样（名字从名单取）。这样提醒按钮和手打命令走同一条路：「正在压缩」运行卡、`room/member-compacted` 记录行、Context Lens 里的压缩请求都有。走成员收件箱的话，CLI 虽然压缩了，房间日志却看不到。
  - 成员弹层新增「上下文」列（`meter` + `row`），成员胶囊显示第一个 `dot`。
  - 圆环通过 `--dsh-member-context-*` 变量按统计行的字号接入（12px / 20px，圆环 12px）；成员输入框里仍是宿主圆环的 13px。
  - 胶囊的下拉箭头改用房间的 chevron 图标。
  - 用量详情的宽度按输入框那一栏算，不按视口：分栏时会话区比窗口窄得多。这一栏窄于 560px 时（容器查询）去掉输入、缓存命中、输出、耗时四列。
  - 输入框加 `/` 菜单，@ 成员之后也能用。
  - 人发的 `/compact` 不再推进该成员的提示游标，所以待发的交接说明、房间变动仍随下一条真正的消息送达。

## 考虑过的方案

- **按交互稿用子插槽 `local-agent.member.tools`**：子插槽由一个条目声明，只能在它自己那棵树里渲染；房间输入框在另一棵树里，渲染不到。改用服务登记（与 `harnessCards` 同一套做法），两棵树都能用，依赖也保持可选。
- **往成员日志写 `request/context`，复用宿主的 `contextPressure` 投影**：那个投影看不到我们的压缩，而且宿主圆环在成员会话里本来就被盖住了。
- **房间按钮仍走成员收件箱，让 Context Lens 去读成员日志**：房间里照样没有运行卡和压缩记录，手打 `/compact` 和点按钮留下的记录也不一样。一条路更简单。
- **每个界面各自轮询**：一个房间里成员一多，请求成倍增加。改为每位成员一个共享的 store，所有界面一起用。

## 影响

- 只装 local-agent 家族：成员只有圆环、没有按钮。只装 context-guard：一切照旧。两个都装：按每位成员的比例出现提醒。
- 设置卡里改的比例经设置 scope 实时生效。
- Codex 压缩后占用暂时未知，等下一轮上报。
