# Agent Note: 矩阵页、格子页与格子详情抽屉（I5 · T35b）

Status: implemented

[English](2026-09-14-eval-matrix-cells.md) | 中文

## Problem

T35a 给了实验室 tab 一份列表和七个子页的壳，里面只填了概览。八步流程的第 6 步——**编排器逐格执行，人在旁边看**——一个面都没有：让一次比较读得懂的矩阵、接替 missions 队列的格子表，以及三枚人的动作所在的那个抽屉（带原因重跑、释放检查、导出 bundle）。

有两条约束贯穿每个决定。界面规格 R2：格子与格子详情是 mission 账本的投影，前端只读 eval 自己的 Remote，一行都不 import mission。以及泄题闸：`exportRun` 是整个 tab 里唯一能把参考答案写到盘上的动词。

## Decision

- **矩阵的排布是一个纯函数**——`matrix-view.ts` 的 `pivotMatrix`，单独有单测。行永远是题；列是人选的**那一个**因子；其余因子要么分组成带（`groupBy`），要么钉成一个值（`filter`）。因子集合不是自己编的，是对 run 自己的 `run.meta.conditions` 文档跑 `conditionFactors`——与 `conditions diff` 同一套叶子比较，矩阵与 diff 因此不可能报出不同的因子。
- **既不是列、也没分组、也没钉住的因子，随格同行**，那一格的条件列表于是列出不止一个 id。另一种做法——悄悄只显示其中一个——会让人以为自己在比一个受试对象，其实比了两个。
- **格内四样**就是规格定的：rep 圆点（`judged` 及以后实心、`pending` 空心、中间半心——与状态推导同一个 `isJudgedOrBeyond` 判据）、阶段（各 rep 一致就是那个态，否则 `mixed (a / b)`）、卡格告警、题面哈希是否一致。
- **卡格 = 在态时长超阈值（缺省 30 分钟）且尚未判完。** 已判的格子计时器照走——那是 mission 自己的时长列——但「这里好一阵没动静」在没有什么该发生之后就不再是问题。
- **红边指向那个异类，而不是整行。** 每道题取出现次数最多的哈希作参照（同频按字典序定），与它不同的格子才描红；读不到哈希是 `hashUnknown`，不是「不一致」。哈希从 run 循环自己写在 `<dataDir>/runs/<runId>/data/<missionId>/attempt-<n>/` 的 `materialization.json` 读——这是共享约定不是猜；mission 面报不出 `dataDir` 就记「无法核验」。
- **run 级汇总借报告的词**（`ok` / `violated` / `unverifiable`）说物化哈希与环境指纹，判官一致性写「待报告」而不自己算。一致性是报告的计算；矩阵猜一个出来，人是会信的。
- **格子详情抽屉**给出各次 attempt（含开启它的重跑原因）、检查点、产物、refs、每个注解命名空间一行（条数 + 最近一条摘要 + 写入者）、**verify 原样输出**、子会话 id，以及此刻的释放答案。
- **verify 原样输出就是编排器的 `kind: 'probes'` 注解，整段展示。** 这条线上没有 `lab` 注解命名空间：探针在容器轮经 `lab.verify`、在宿主轮直跑，记账的是编排器。把它说成「lab 的」会指认一个不存在的来源；把它摘要掉会丢掉退出码和「本轮不适用」——而那正是人打开这个抽屉的唯一理由。
- **导出闸留在 mission 那边。** `exportPlan` / `exportRun` 经结构面 `MissionExportRemoteFace` 转发给 `ctx.missionRemote`（mission 自己的 Remote 服务，宿主侧）。这样一来，判定哪些层 guarded 的 datasets 探测**和**按新鲜 plan 复核的 fail-closed 闸都只有一处。eval 只转发调用方的 `confirmed`，既不能放宽也不能收窄；组合里没有 mission 的 Remote 就整体拒绝，而不是在这边把闸重写一遍。
- **`retry` 在 eval 这一层就拒空原因**，不留给 mission。这不是第二道闸，是同一道闸写在调用方看得见的地方，好让 tab 与服务面对「一次 attempt 必须带什么」说法一致。
- **`runsForItem(datasetId, itemId)` 这次一并落地**，尽管它的消费者是 T47：它就是 `experiments` 已经在走的那趟账本遍历，按 `task` label 与 `meta.datasetId` 认题，与它们写在一起才只有一份「哪些格子属于这道题」的实现。
- **子会话用宿主的 `sessions.open` 打开**，由 client 入口注入。eval 的 Remote 只负责把 id 报出来。

## Alternatives considered

### 为什么不让人把题放到列上？

因为矩阵是**横着读**的。题一旦上了列，一行就成了「条件 X 面对若干个不同的问题」，而眼睛照样会沿行比——那是在比不同问题的答案。把行钉死在题上，能比的就只剩那个成立的比法。真要转置，那是改口径，不是加一个开关。

### 为什么不在 eval 里重算 guarded 层并自己复核？

那是更短的路：mission 的**服务面**有 `planExport` / `exportRun`，而 guarded 判定与 fail-closed 复核在它上一层的 Remote 里。抄过来，eval 就有了一份自包含的导出——和第二道泄题闸。闸有两份实现就有两个地方会错，而错的那份一定是没人再读的那份。转发给 `missionRemote` 的代价只是一个可选结构面，外加 Remote 不在场时一句如实的拒绝。

### 为什么不把探针输出做成摘要？

因为抽屉存在的意义正是那些摘要会搞砸的情形：退出码 2 配「本轮不适用」，在任何按条数计的摘要里都读成「两个探针坏了」——T28 修的就是这个误读。紧凑的逐探针列表用来扫，下面那段原文用来信。

### 为什么不在浏览器里算矩阵？

客户端 bundle 的纯度门不允许 import mission，于是账本行只能原样运过去、排布在第二个地方再算一遍——「这格为什么红」也就有了第二个答案。算在宿主侧，tab、`eval_cells` 工具、以及 T38 接下来要的东西共用一份。

### `cells` 为什么另写一份行类型，而不是把 `RunCellsReport` 再导出一次？

Remote 的边界类型必须能从 `./types` 这个子路径够到。把宿主侧读模块的类型再导出，会把 `node:fs` 和整条 validate/schema 链拖进浏览器半边的类型工程，换不到任何东西。**投影仍然只有一份**——`cellRows` 是对 `cells` 的收窄——只有 wire 形状被重述了一遍，而测试钉住了两者对得上。

## Consequences

- `EvalRemoteService` 多八个动词（`matrix`、`cells`、`cell`、`retry`、`releaseCheck`、`exportPlan`、`exportRun`、`runsForItem`），都带会话参数。CI 的四个一个字没动。
- `MissionAttemptFace` 多了可选的 `artifacts` / `retry` / `history`；`MissionReadFace` 多了可选的 `dataDir` / `title` / `labels`，注解多了可选的 `by`。全是可选：答得少的账本报 null。
- 两个新结构面：`MissionActionFace`（retry + isReleasable）与 `MissionExportRemoteFace`（mission 的 Remote，给导出两步用）。mission 本身没改。
- `EvalService.cell` 改成 `async`，好让它的拒绝是一次 rejection，而不是藏在 `Promise` 签名后面的同步抛错。
- `matrix` 与 `cells` 两个占位词条删掉；还有四个子页带着占位（T36、T38、T37）。
- T47 继承 `runsForItem`；T38 的报告页继承这套汇总词汇。

## Testing

- `packages/eval`：559 个测试全绿（此前 510）。`tests/matrix-view.spec.ts` 18 条，覆盖纯透视：因子并集与列的选取、行永远是题、分组（且绝不按列本身分）、筛选把不匹配的条件剔掉、随格同行的因子、空洞与空格之别、mixed 阶段行、卡格规则含已判豁免与自定义阈值、只描异类的红边、未知不算不一致、以及汇总的每一条分支含「待报告」。`tests/cells-face.spec.ts` 19 条，覆盖投影与三枚动作：注解摘要、原样的探针载荷（成功轮与失败轮）、完整的格子详情、从真实 run-data 树读出的物化哈希与读不到的情形、释放答案、两处拒绝、`cellRows` 的收窄、带调用方标记的 retry 转发、空原因拒绝，以及导出两步——含「未确认的 guarded 层经 eval 照样被拒」。`tests/MatrixCells.client.spec.tsx` 12 条：矩阵的行/列/圆点、两个告警与汇总、按列与按带重排、点圆点开抽屉、格子表与桶筛选、抽屉各字段含原样探针块、重跑（与空原因时的禁用）、释放检查、`sessions.open`（与没有子会话时的禁用）、导出对话框的 plan → 确认 → 导出，以及改字段作废已勾确认。
- `pnpm gate` 绿。
