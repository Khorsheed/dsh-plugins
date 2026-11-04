# Agent Note: `local-agent/execution` 先登记、后写入

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）要在成员子会话里记下每次执行：开始记录写起因和所属任务，结束记录写结果和轮次区间。宿主的存储日志读取器遇到目录（`KNOWN_SESSION_EVENT_TYPES`）里没有的事件类型会拒绝整份日志，成员的全部历史都打不开。如果登记和第一次写入放在同一个版本里，回退这个版本后，旧版本就读不了已经写下的日志。所以这个类型必须比任何写入它的版本早一个版本登记。

## Decision

S0 只登记 `local-agent/execution`，不写入。

- **登记位置**：和 `local-agent/stream`、`local-agent/compaction`、`local-agent/context` 相同的两处，都在 `packages/local-agent/src/index.ts`。一处是模块加载时对宿主目录的循环（`@deepseek-ai/dsh-session` 根和它的 `src/known-event-types` 源码导出），另一处是 `apply` 开头经 loader 解析到的目录。
- **形状**：`SessionEventMap['local-agent/execution']` 为 `LocalAgentExecutionEvent`（`packages/local-agent/src/types.ts`），是按 `executionId` 配对的联合类型：
  - `start`：`executionId`、`caller`（`tool | composer | room | api`）、可选 `callerRef`、`operation`（`prompt | compact`）、`cause`（`LocalAgentExecutionCause`：`human`、`member`、`help`、`decision`、`execution`、`tool-call`、`restart`）、可选 `task`（`LocalAgentTaskRef`）、`parentSessionId`、`admittedAt`。
  - `end`：`executionId`、`outcome`（`done | failed | cancelled | uncertain`）、`turns`（本次执行写下的轮次，显式列出）、`endedAt`、可选 `unrecorded`（`LocalAgentUnrecorded[]`：`internal-calls`、`call-boundaries`、`per-call-usage`、`compaction`），以及可选 `providerReportedUsage`，即 CLI 自报的整轮合计。按用户 2026-11-03 的决定②，它是一个独立事实，用来和逐次 `assistant/message.usage` 之和核对，不是那个和的抄写，也不往和里加。
  - 以上类型都从包根导出。
- **一旦有任何版本写过这个事件，就不得去掉这条登记**，也不得改类型名。批 5 后续步骤只能加可选字段。

## 写在 `turn/end` 之后

设计稿指出，结束记录写在执行的最后一个 `turn/end` 之后，这个位置没有先例。实测是合法的。宿主的已发布日志检查（`assertReleasedV4Relationships`）只对它固定的一组关系类型执行生命周期规则。`local-agent/execution` 不在其中，所以检查对它的位置没有约束：第一个 `turn/start` 之前、轮内、`turn/end` 之后都可以。成员子日志守卫也原样放行它，因为它不在守卫的 `RELATIONAL` 集合里。真正起作用的是另一项检查：存储读取路径（`restoreReleasedV4Artifact` 和持久化读取器）拒绝未登记的类型。这条登记满足的就是这一项。

## Alternatives considered

- **在 S1 里登记和写入一起做**：否决。回退后成员历史会打不开。
- **记录标成 `ignorable`、不登记**：否决。读取器会把内容当成不解释的数据，而设计依赖按类型读取。这也会在三个已登记的同类事件旁边多出第二套机制。
- **把结束记录放进最后一轮里**：不需要，已发布检查接受它写在 `turn/end` 之后。压缩执行根本不写轮次，结束记录本来也不能依赖某一轮。

## Consequences

- S1 及以后版本写下的日志，在本版本起的任何版本上都能读，回退 S1 以后的版本也一样。
- 这个类型成了永久词汇。以后删掉它，所有带它的成员历史都会打不开。
- 起因 `tool-call` 也涵盖 room 主 agent 用 `subagent` 直接续聊成员的情况（用户决定④）。这种情况要不要单独一类，留给 S4/S5 定。

## Testing

`packages/local-agent/tests/execution-event.spec.ts`：
- 模块加载后，宿主目录里有这个类型；
- 一份成员日志（开始记录、一轮、`turn/end` 之后的结束记录）经 jsonl 持久化读取器读回，并能回放进会话；
- 去掉登记后，同一份日志被拒绝（`SessionFormatUnsupportedError`），这是对照组；
- 已发布日志检查接受这份日志；
- 子日志守卫写入两条记录，包括 `turn/end` 之后的结束记录和不含轮次的压缩执行，没有转入隔离区的。
