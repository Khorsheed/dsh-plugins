# Agent Note: 成员页队列显示房间这一轮要做什么

Status: implemented

## Problem

成员页上 CLI 成员的队列（`MemberInboxView`）列出所有来源在等的轮次，但房间轮次的账本行没有正文——只有成员页输入行保留 `text`，因为只有它们会重放——所以只显示「协作间派活」，人分不清是哪条消息。房间时间线设计 B 线第 G1 步（待定 8，选 A）。

## Decision

- **核心账本行加可选 `preview`**（`LocalAgentMemberInput.preview`），来自新的可选请求字段 `LocalAgentExecutionRequest.preview`（去首尾空白，最多 120 字），经 `ExecutionPlan` 传进 `MemberInbox.submit`。只供显示：它不算可重放的输入（没有 `text` 的排队行加载时照旧丢弃），也不参与准入。
- **房间传入它**：每个非压缩轮次都传 dispatch 自己的话（`previewOf`，空白折叠、120 字），不是拼上房间简报后的完整提示。
- **成员页读它**：带 preview 的房间行显示「来自协作间：…」（英文「From the room: …」）；没有的（旧行、旧房间）保持「协作间派活」。暂停和取消留在原处——成员页是这个成员的控制台。

## Alternatives considered

- **维持「协作间派活」**（待定 8 的 B）：人分不清各行。
- **存下房间轮次的完整 `text`**：`text` 的含义是「重启后重放」，房间行不能这样做（房间会自己重新提交投递）；单独一个只供显示的字段才不破坏这层含义。
- **让浏览器去房间里查正文**：成员页得读房间日志、按投递 key 匹配；账本行本来就是它渲染的东西。

## Consequences

- 旧核心忽略请求字段，旧成员页忽略行字段，新核心读到本 note 之前写的账本只是没有 preview。无需迁移。
- 每个房间行让账本文件最多多出 120 字（已结束的行照旧有上限）。

## Testing

`local-agent` 的 `member-inbox.spec.ts`：preview 持久保存在行上且不是 `text`；没有 preview 的行不带这个字段。`member-inbox.client.spec.tsx`：带 preview 的房间行显示「来自协作间：…」，没有的保持来源名。`room` 的 `real-core.host.spec.ts`：人类 dispatch 的账本行以消息原话作为 preview。
