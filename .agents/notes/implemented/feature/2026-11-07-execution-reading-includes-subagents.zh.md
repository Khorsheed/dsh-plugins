# Agent Note：成员执行读数带上它的 CLI 子智能体，房间把它们算进每轮用量

Status: implemented

## 问题

房间的每轮用量经核心的 `readExecution` 读一次成员执行（批 5 S6，「用量只在一处」）。这个读数原来只加成员自己的调用。M3 与 M4 把成员 CLI 的子智能体镜像成孙会话之后（[Kimi](2026-11-07-kimi-subagents-mirrored.md)、[Claude Code](2026-11-06-claude-subagents-mirrored.md)），子智能体的花费已经有记录，却没有任何地方读它。Kimi 的一轮里子智能体那部分仍然显示为零，而它往往占了这一轮花费的大头。

已定稿的设计 `proposals/active/2026-11-06-member-cli-subagents.md`（不在仓库里）把这一步叫 M6。用户 2026-11-06 定了：子智能体算进这一轮，明细分「成员自己 / 子智能体」两行显示。

## 决定

**核心（`packages/local-agent/src/index.ts`）。** `readExecution` 加上 `subagents` 与 `subagentUsage`。这两个字段在 M0 已经声明，由 M0 的 `subagentReadingsFor` 计算。

- 孙会话从成员日志的 `subagent/catalog` 行里找：`childId` 以 `<member>.sub.` 开头的就是，这是 CLI 子智能体的确定性 id。宿主子智能体的目录行不会被当成 CLI 子智能体。
- 孙会话的事件有活会话就取活会话的快照；没有就从存储里读一次，孙会话一直冷着就一直用这份。这与成员自己的冷读规则相同。
- 只有孙会话里某次执行的 `cli-subagent` 起因指向本执行，才出现这两个字段。没有子智能体时，读数与原来完全一样。
- `subagentUsage` 与 `callUsage` 分开放。子智能体自己的 `providerReportedUsage` 留在它那一条 `subagents` 里，不加进合计。

**房间（`packages/room/src/client/round-usage.ts`）。** `roundUsage` 把子智能体加到成员自己那一行上。

- 主数字等于成员那一份加上子智能体的逐次合计。成员那一份在 CLI 报了整轮合计时取 CLI 合计，否则取逐次合计。明细各项也同样相加。
- 这一行带上 `member`（加子智能体之前的主数字）与 `subagents`（子智能体的用量、明细，以及跑了几个子智能体）。
- 续用的子智能体只算一个，因为它是一个会话（用户决定）。
- 只有子智能体花了钱的一轮，照样显示一行。
- 「逐次合计 vs CLI 报告」的比对仍然只拿成员自己的调用和 CLI 合计比，Claude 的一轮不会因此冒出假的差额。

**房间显示（`RoomSpeechView.tsx`）。** 回复下面的用量显示新的合计。悬停明细多两行：「成员自己」与「子智能体（n 个）」。元信息行加一行小字「这一轮用了 n 个子智能体」，点击打开成员会话。

设计里还要求点击后滚到第一张子智能体卡片。卡片属于 M5，由另一个 agent 在做，所以滚动留给那一步。团队合计（`memberUsage`、`executions.ts`）读的是 `roundUsage`，因此也一并包含了子智能体。

## 考虑过的其他做法

**在核心里把子智能体加进 `callUsage`。** 不采用。`callUsage` 要和 CLI 的整轮合计比，而整轮合计只覆盖成员自己的调用。混进子智能体之后，每个 Claude 轮的比对都会变成一条假的「比 CLI 报告多」提示。

**子智能体另起一行，主数字只算成员自己。** 用户决定不采用：这次派活花了多少，应当包括它派出的子智能体。

**在成员这边另存一份孙会话 id 索引。** 不采用。目录行本来就是宿主谱系也在用的、记录下来的父子关系；再存一份索引，就多一份要保持同步的副本。

## 影响

- 有子智能体时，成员一次执行的读数要多读每个孙会话一次：活的孙会话读快照，冷的从存储读一次。
- 房间新增文案键：`usage.member`、`usage.subagents`、`speech.subagents`，中英文各一份。
- 不新增房间事件类型，也不写日志，数字每次读取时现算。

## 测试

- `packages/local-agent/tests/execution-read.spec.ts`：新增一个 `readExecution` 用例。没有子智能体时读数里没有 `subagents` 字段。有活的孙会话时多出 `subagents` 与 `subagentUsage`，成员的 `callUsage` 不变，宿主子智能体的目录行被忽略。换一个进程、两份日志都冷时，从存储读出同样的读数。
- `packages/room/tests/usage-reading.client.spec.tsx`：新增三个用例。
  - Kimi 从 0 变为含子智能体：加之前的一行、加之后带两部分的一行、续用的子智能体只算一个、只有子智能体花费的一轮。
  - 有 CLI 合计又有子智能体：差额比对只用成员自己的调用。
  - 回复的悬停明细显示这两行，小字点击打开成员会话。
