# Agent Note: 成员会话里的子智能体卡片

Status: implemented

## Problem

成员 CLI 自己的子智能体（Kimi `Agent` / `AgentSwarm`、Claude Code `Agent` / `Task`）已经镜像成成员子会话下的孙会话（[核心的 CLI 子智能体会话](2026-11-06-cli-subagent-sessions-core.zh.md)、[Claude 子智能体镜像](2026-11-06-claude-subagents-mirrored.zh.md)）。但成员会话里发起它的那次调用仍是宿主的通用工具行：没有状态、没有用时、看不到子智能体做了什么，也打不开它。房间里成员在等前台子智能体时只写「正在工作…」。member-cli-subagents 设计（M5；界面见 `proposals/prototypes/member-activity.html` 的「成员会话」组与「运行卡片 · 正在等子智能体」）要求一张和宿主自己的子智能体运行卡片一样的活卡片，并与后台命令卡片共用一个卡片外壳（[成员后台活动界面](2026-11-06-member-activity-ui.zh.md)）。

## Decision

**核心里一个读取，不另存。** `local-agent` 新增 `memberSubagentCalls(childSessionId)`（registry 方法与 gateway Remote），由纯函数折叠 `packages/local-agent/src/subagent-calls.ts` 实现：成员的 `subagent/catalog` 行里 child id 为 `<成员>.sub.<key>` 的就是孙会话；孙会话里每条 cause 为 `cli-subagent` 的 `local-agent/execution` start 就是一条 `LocalAgentSubagentCall`——调用 id、孙会话、类型与描述（descriptor label 按 `<类型>: ` 拆开）、组内位置、后台标记、序号（同一子智能体的第几次调用：Kimi 续用为 2 起）、第一个轮次、状态（缺 end 记录为 `running`；`done` / `failed` / `cancelled`；`uncertain` 读作 `lost`）、起止时间、该执行逐次用量之和，以及按顺序的步骤（请求带思考首行与生成时长；每个工具带可识别的参数与执行时长；执行以 `done` 结束时最后的文字作为回复），只保留最近 40 步。非家族成员的会话返回 null。

**卡片在 room，用共享外壳。** `packages/room/src/client/subagent-card-view.ts` 把调用行和读取折成一种卡片状态；`SubagentCards.tsx` 经 `ActivityCardShell` 渲染，外壳新增可选项（转圈代替图标、标记、用量、状态覆盖、行）。工具视图经 `slots.inject` 注册到 ui-tool 的键控插槽 `tool.call.toolview`，键为 `Agent`、`AgentSwarm`、`Task`：

- **单卡**——默认收起：转圈、类型（探索 / 编写 / 通用，否则用 CLI 自己的词）、描述、「运行中 · 1:12」、「已用 32.2K」、「展开 ▾」、「打开」；运行中第二行是最近一步。展开：按顺序的步骤，最近一步高亮。完成：「完成 · 2 分 43 秒」与「输入 · 缓存 · 输出」（缓存为 0 时不写）。
- **组卡**（`AgentSwarm` 调用，或同一调用 id 下多个执行）——默认展开：「◇◇ 并行 3 个」、汇总状态「运行中 · 2 完成 · 1 在跑」、「合计」，每个子智能体一行，各自状态与「打开」；超过 6 个只显示前 5 个和「另外 N 个」。
- **标记**——后台调用「后台」，续用「续用 · 第 n 次」；**已取消**与**失去联系**带交互稿的一行说明。
- **等待中**——调用在跑、孙会话还没写出：运行中卡片，没有「打开」。
- **不支持**——已有结果却没有孙会话（旧日志不回填；不镜像的 provider）：「暂不支持查看过程」，没有「打开」和用量。
- **回落**——local-agent 返回 null（不是成员会话）或没有读到：通用行样式的普通行（键控插槽没有让出的路径，条目内部无法渲染宿主自己的通用行）。

「打开」在右侧栏的子智能体对话里打开孙会话（ui-subagent `openChildAside` 的地址 `dsh-resource://subagentchat/session/…`）；窄窗口或宿主没有该资源时整页打开。

**房间运行行。** 成员这一轮在跑、读取里有本轮开始的、非后台的运行中调用时，运行行的当前动作写「· 正在等子智能体：探索 · 6 分钟」并带「看子智能体」（打开成员会话；卡片经共享的 `ActivityReveals` 自己滚到视野里）。窄行写「· 等探索 · 6 分钟」、去掉链接——整行本来就打开成员会话。`RoomRunView.tsx` 只多一个元素，`RoomRunInjected` 只多一个可选字段。

**轮询。** 每个客户端一个 `SubagentCallsStore`，按成员会话共享一次读取；跟随者说明自己是否还要新读数（调用在跑、等待中的卡片、运行行，或没有记录的已结束调用的前三次读取），只在需要时按房间的 4 秒节奏轮询。

## Alternatives considered

**在浏览器里读孙会话（投影、实时会话订阅）。** 宿主的谱系下拉对自己的子智能体就是这样做的，但卡片需要执行记录、按执行的用量和步骤摘要，投影里都没有；宿主侧一个折叠让客户端只负责渲染，冷会话也同样从存储读出。

**把卡片放进 local-agent 的客户端。** 成员也会在房间外运行，但卡片外壳、状态与运行行都在 room（后台命令卡片也在那里），再复制一份外壳会走样。没有 room 的组合保留通用行。

**回落时复用宿主的通用行。** ui-tool 不导出它，键控条目也不能让出；深引 `@deepseek-ai/dsh-client-ui-tool/src/…` 会把宿主内部代码打进插件。普通行只用于极少见的、恰好有名为 `Agent` / `Task` 工具的非成员会话。

**像交互稿那样在第二行写「正在…」。** 镜像要等一步的工具都有结果才写出这一步，所以最近写出的一步是子智能体刚做完的事，不是正在做的事；这一行只写那一步，不加时态。

## Consequences

- Kimi（M3）不需要改客户端：它的镜像一旦写出 cause 为 `cli-subagent` 的孙会话执行，`Agent` / `AgentSwarm` 行就变成卡片。Kimi 的参数名（`run_in_background` / `runInBackground`、`resume`、`tasks`）只宽松地用于等待中与不支持两种状态；卡片的事实都来自读取。
- 成员调用的工具行要等镜像写出成员那一步才出现在成员会话里，前台子智能体通常已经结束；它在跑时，实时的界面是房间运行行的「正在等子智能体」。
- 「打开」进孙会话的开头，不定位到续用那一次的轮次（侧栏对话地址没有轮次参数）。
- 步骤只保留最近 40 步（「前面还有 N 步」）。
- 测试：`packages/local-agent/tests/subagent-calls.spec.ts`（对真实写入器输出的折叠）、`packages/room/tests/subagent-cards.client.spec.tsx`（每种卡片状态、工具视图与 store、运行行、store 的轮询）。预览：`packages/room/tests/preview/subagents.html`。
