# Agent Note: eval_cells — 评测预设摘掉 mission 的工具行（I5 · T46）

Status: implemented

[English](2026-09-13-eval-cells-tool.md) | 中文

## Problem

web-eval 的界面规格定下 R6：评测模式下 *mission* 这个词不出现。mission 在这条线上仍是它一直以来的角色——run 的账本与释放闸，由编排器的服务面驱动——但模型面与人的界面都不该再提它。

有两处还在提。pack 的 `eval` 预设挂着 `mission-tool: read`，于是每个评测会话都带着四个 mission 只读工具（`mission_run_list` / `mission_run_status` / `mission_list` / `mission_get`）；而同一行正是 mission 自己的 [`preset-visibility`](../../../packages/mission/src/client/preset-visibility.ts) 判断 任务 tab 显不显示的判据，所以评测会话里那个 tab 也一直在。

只摘行不补东西会留个洞，而不是补上一个。那四个 mission 工具答的是一个真问题——这次 run 的每一格在干什么——而 `eval_run_status` 只答了一半：它摘 `run.meta`、每格给薄薄一行（状态、桶、最后一条 orchestrator 注解），至于这一格持有哪个单元、走到了哪个检查点、各注解命名空间各有多少条、委派跑在哪个子会话里，原先只能靠 `mission_get` 读。

## Decision

- **预设删掉 `mission-tool` 那一行**。`datasets-tool: authoring` 与 `eval-tool: all` 原样不动。任务 tab 随之自隐，不需要第二个开关——那一行的有无*就是* tab 的判据。包仍随 pack 安装（`package.json` 与 `install.sh` 的 `UNPUBLISHED_DIRS`），谁要在覆盖层预设里加回这一行都还在：这钉的是默认值，不是可达集。
- **eval 服务面加一个逐格读投影**：`EvalService.cells(runId, query)`，本体是 `read.ts` 的 `runCells`。一格一行：矩阵坐标与其余全部 labels、桶、当前阶段、`enteredCurrentAt` 与 `inStateMs`、attempt 数、当前 attempt 的 `refs.resource` / `refs.fingerprint`、检查点**名**、各注解命名空间的条数，以及委派的 `childSessionId`。数据经结构面 `MissionReadFace` 读——本次把它加宽了：可选的 `attempts` 与行上可选的 `enteredCurrentAt`——所以 eval 仍然不 import mission 的任何东西，而且投影算在**服务端**：工具与（T35b 起）实验室 tab 消费的都是 eval 自己的答案，谁都不碰 mission。
- **`eval_cells` 是第四个读工具**，由伴生行 `@khorsheed/dsh-eval-tool` 注册；`tools: all` 自此是四个读工具。参数：`run_id`（必填）与三个精确过滤 `bucket` / `task` / `condition`。它的描述与 `tool:eval` 提示词段都点名说：这条线上不授予 mission 的读工具，不要去找——模型找一个找不到的工具是要烧回合的。
- **每个字段都可为 null，缺席如实记、绝不猜**：账本老于某个字段，或者某格 `mission.get` 解析不出来，该格退化成 null 而不是让整张清单失败（与 `runStatus` 已有的退化同一条）。
- **过滤时 `total` / `buckets` 仍描述整个 run**。被过滤后的清单不该让读者误以为 run 变小了；`matched` 说过滤留下了几格。

## Alternatives considered

### 为什么不留着 `mission-tool: read`，换个别的办法藏 tab？

tab 的判据就是那一行，这是 M4'③ 的设计：「组合把 mission 工具授予了这个 agent」正是「显示 mission 的界面」的诚实读法。再发明一个 eval 专用的开关，只会让 R6 的两半互相打架——一个模式里说这个词不该出现，agent 却还能调 `mission_get`。摘掉行，一处改动同时结清两半。

### 为什么不让 `eval_cells` 在不给 `run_id` 时改列 run？

这个念头很诱人，因为四个工具里唯独 `mission_run_list` 的用途现在没人接：改动之后，agent 的 run id 来自自己会话里 `/eval run` 的回复（run 都是人在这个会话里发起的）或 bundle 的 `run.json`，没有一个动词能枚举。这是个真实的小缺口，这里是**记下**而不是就地补上：形状是按 `cells(runId)` 定的，实验室 tab 自己的 run 列表是 T35a 的 `runs` 读面，列 run 的模式在它之上是一次便宜的后续——而且那样列出来的可以是*评测的 run*，`mission_run_list` 返回的是账本里的所有 run。

### 为什么不把投影写在工具适配器里？

那样实验室 tab（T35b）就得再抄一份，而前端不许 import 兄弟包。放服务端，两个消费方共用一份实现，也让 `ctx.mission` 留在 eval 自己的 Remote 后面——「前端不碰 mission」要的正是这个。

### 为什么逐格给的是停留时长，而不是总耗时？

停留时长是 mission 队列自己的那一列，也是一次卡住的 run 真正会问的那个问题（「这里多久没动静了」）。总耗时需要「这一格什么时候settled」的判断，那是状态机的事，不是这个投影的事。settled 的格子计数器继续走也是同一个理由，字段名把它量的是什么说清楚了。

## Consequences

- 评测会话的工具卡少四个 `mission_*`、多一个 `eval_cells`；那些会话里的 任务 tab 不再出现。走别的预设的会话（standard，以及任何仍挂那一行的预设）不受影响——tab 与 mission 工具都还在。
- `EVAL_TOOL_NAMES` 是四个名字；`@khorsheed/dsh-eval-tool` 的 `tools: all` 授予四个工具，`none` 仍然什么都不授予。
- `MissionReadFace` 现在声明了可选的 `attempts` / `currentAttempt` 与行上可选的 `enteredCurrentAt`。之所以都是可选，恰恰因为这是结构面：答得少的 mission 服务（或测试替身）照样满足它，只是报出 null。
- T35b 接手的是一个照着它要建的格子列表与格子抽屉定形的服务动词，包括抽屉用 `sessions.open` 打开的那个 `childSessionId`。

## Testing

- `packages/eval`：468 个测试全绿，其中六个是新加的 `eval_cells` 用例——两格账本上的完整投影（当前 attempt 的 refs 与检查点、各命名空间注解计数、`refs.sessions` 的最新一条）、钉住时钟的时长与时钟倒流时的下限、三个过滤且 `total` / `buckets` 不变、子会话的注解兜底与某格读不出时的退化、缺 mission 服务的拒绝、未知 run id 的原样透出。
- `packages/eval-tool`：3 个测试全绿，已改成四个名字，并钉住提示词段点名了缺席的 mission 工具。
- `check:profiles`（预设行必须能从 profile 自己的依赖解析）与 `check:plugins`（33 个包、0 违规）绿；`pnpm gate` 绿。
