# Agent Note: Context Lens 显示成员自己开的一轮，轮次标题去掉房间前置段

Status: implemented

## Problem

这是设计 `proposals/active/2026-11-06-member-self-started-rounds.md`（gitignored）的 M8 步。M4（[kimi-self-started-rounds](2026-11-06-kimi-self-started-rounds.zh.md)）把 Kimi 在后台任务结束后自己开的一轮变成了一次执行。它的 start 记录调用方是 `cli`，起因是 `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId, startedBy? }`，并抄了启动任务那次执行的 `task`。lens 原先不读这个起因。3080 上一个真实房间暴露了两个问题：

1. **房间 lens 里看不到自开轮。** 一次房间派活让 Kimi 成员跑了一轮，这一轮在后台起了一个部署。部署结束后，Kimi 自己开了一轮。房间给它写了一条 run `execution:<id>`，没有派活编号。lens 只安放带派活编号的 run，所以这一轮的请求既不在任何房间轮次里，也不在未归轮里。
2. **成员的轮次标题是房间的前置段。** 房间会在人的消息前面插入几段：【房间简报】、协调者交接「你现在是本房间的协调者。【协调者交接】…」、【房间变动】、【通知】和被扣下的回报。成员 lens 用提示词开头做轮次标题，标题读起来就像一条交接通知，这一轮看上去也像和上一轮并在了一起。

## Decision

**房间 lens：自开轮挂在启动它那个任务的房间轮次下**（`store.ts` `roomSelfRounds`、`addSelfScopes`）。

- 归属顺着记录下来的链判定，从不按时间。`startedBy` 指向启动任务的那次执行。如果那次执行本身也是自开轮，就继续顺着它的 `startedBy` 往上找，直到第一次不是自开轮的执行。列出的房间轮次里，run 正是这次执行的那一轮，认领这条自开轮。
- 自开轮显示为成员旁边多出的一个页签，scope id 是 `self:<executionId>`。页签名是「kimi · 后台任务完成后继续」。同一轮里同一成员有多条自开轮时，页签名末尾加上序号（`… 2`）。页签沿用成员页签的列表、详情和耗时视图。
- 耗时分布视图里，它以同样的名字单独占一条泳道。一轮的耗时泳道现在用承载该请求的视图的 scope id，而不是请求原本所在的 scope；房间轮次的压缩页签也因此有了自己的泳道。
- 它的请求是它自己的执行记录所指的那些（`executionRequests`）。这些请求计入这一轮的请求数、token 合计、结束时间和会话地图上的柱子。地图对非主对话的 scope 没有单独的画法，房间轮次的请求全部画出，所以没有加新样式。
- 它的成员视图显示起因行「起因：后台任务完成后继续（成员自己开的一轮）」。文字随任务状态变化：失败后、超时后、被终止后，其他情况是结束后。页签行显示「由 #N 启动的后台任务 · 回到 #N ↩」，点一下跳到本轮视图里的启动请求。
- 链条没有被任何轮次认领时，自开轮进未归轮，显示为同样的页签。这包括没有 `startedBy` 的自开轮、由成员页那一轮启动的、由未记录的轮次启动的。在未归轮里，自开轮的压缩留在该组原有的压缩页签里，不重复列出。

**成员 lens：自开轮仍是独立的一轮，并说明它为什么开始。**

- `reconstructSession` 会标记在 `self` 执行里开始的那一轮（`LogTurn.selfCause`）。它看 `turn/start` 时开着的执行，以及 end 记录列出的轮次。
- 轮次行带 `continues: { taskId, taskStatus, startedBy? }`。这种轮没有人的消息，所以头部行显示「后台任务完成后继续」，轮次菜单也一样。
- 主视图的页签行显示「由 #N 启动的后台任务」和「回到 #N ↩」，用的是现有的 Relation 跳转。

**任务在哪里启动**（`startingRequest`）。在启动执行的请求里，lens 取工具结果写有该任务 id 的那一个，也就是 CLI 对启动任务那次调用的回复。没有哪个工具结果写有这个 id 时，lens 取那次执行的第一个请求，并照实说明：「后台任务由 #N 开始的那一轮启动」。没有 `startedBy`，或它的请求在当前视图里没有加载时，不显示跳转。

**标题去掉房间前置段**（`messages.ts` `stripRoomPreamble`）。它作用于日志通道的 query、实时 query 和房间轮次那一行。房间没有给这些段写结构化标记；lens 不依赖 room，只按形状识别。去掉的是开头那些以房间字面量开头、用 `\n\n` 分隔的段，以及开头的 `<system-reminder>…</system-reminder>` 块。这些字面量是：【房间简报】、【协调者交接】、你现在是本房间的协调者。、你的指令更新为：、【房间变动】、【通知】、【#mN 的回报。最后一段从不去掉，所以整条都是前置段的消息（例如一条回报）保持原样。成员派活的信封（【来自 X · #m3】）属于消息本身，保留。

## Alternatives considered

- **按房间写的 `execution:<id>` run 和时间来安放自开轮。** 不采纳：这是按时间推断，S8 已经去掉了。start 记录串起来的链是记录下来的事实。
- **把自开轮的请求并进认领轮的成员页签。** 不采纳：这就是 11-01 Kimi 折叠造成、M4 刚撤掉的那种合并。自开轮是一次独立的执行，有自己的起因。
- **让房间给前置段写结构化标记。** 这样更稳，但不在本步的范围内（只改 context-lens），而且只对新日志有用。以后可以补；按形状识别作为旧日志的兜底保留。
- **页签总是带序号（「… 1」）。** 不采纳：单独一个「1」读起来像计数。只有需要区分同一成员的多条自开轮时才显示序号。

## Consequences

- 房间 lens 把 Kimi 的每条自开轮显示在引发它的那一轮里，这一轮的数字也算上它的花费。链条没有记录的自开轮显示在未归轮，不会哪里都看不到。
- 在成员自己的 lens 里，自开轮说明了自己为什么开始，并能跳回启动处。派活那几轮的标题是人的原话。
- 回退只涉及 lens。回退后自开轮在房间 lens 里又看不到，标题又显示前置段。本步不写任何数据。
- 没有在 3080 的真实房间里验证。房间的 M5 改动（回复上的 `continues` 字段、后续回报）不影响 lens。

## Testing

- `packages/context-lens/tests/self-started-rounds.spec.ts`（新增）：
  - `stripRoomPreamble`：交接、简报、房间变动、通知、被扣下的回报和 system reminder 都去掉；整条都是前置段的消息、普通消息、成员信封和人自己写的多段文字都保留。
  - 房间：成员旁边的自开轮页签，带它的请求、continues/startedBy 和起因信息。这一轮的请求数、结束时间、柱子和耗时都算上它，未归轮里没有它。
  - 房间：经过第二条自开轮的链，序号为 1 和 2；没有工具结果写有任务 id 时，跳转到启动那一轮的第一个请求。
  - 房间：没被认领或没有 startedBy 的链进未归轮；未记录的轮次保持兜底显示。
  - 成员：第 2 轮的标题是人的原话；第 3 轮的轮次行和主视图都带 continues，并能跳到工具结果写有该任务 id 的请求。没有 `startedBy` 时不显示跳转。
- `packages/local-agent/tests/lens-contract.spec.ts`：生成器新增一轮起后台任务的轮次和一次 `admitSelf`。夹具用 `UPDATE_LOCAL_AGENT_CONTRACT=1` 重新生成。
- `packages/context-lens/tests/local-agent-contract.spec.ts`：回放这份日志。房间轮次显示自开轮页签，跳转指向工具结果写有 `bash-1` 的请求；成员自己的第 4 轮带同样的信息。
- `examples/workbench/self-rounds.tsx` 使用一个固定的 tab info 对象。每次渲染都新建一个 `AbortController` signal，会让面板的请求 effect 每次渲染都重跑，点页签时页面就卡死；`room-records.tsx` 还有这个问题，只影响预览。
- 截图（1280 和 390）来自 `examples/workbench/self-rounds.html`（`view=room|member`），存在 `/tmp/m8-lens/`，不提交。
