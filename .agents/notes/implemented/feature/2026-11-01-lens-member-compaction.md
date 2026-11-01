# Agent Note: Context Lens shows a CLI member's compaction in the round it belongs to

Status: implemented

## Problem

An external CLI member's compaction left no trace in Context Lens. It runs no turn, so the lens built no request for it. Worse, a human `/compact` in a room was listed as a round of its own. That round borrowed the previous round's requests, because the run named the child's last turn. The user wanted the compaction attached to the previous round in a tab of its own, the way the host's compactions already show.

## Decision

- **Log lane.** The lane reads local-agent's registered `local-agent/compaction` event structurally and builds one compaction request (`purpose: 'compaction'`, `inputPartial`):
  - The call's usage is the request's usage, and the CLI's summary is its output.
  - `CompactionInfo` gains `source`, `beforeTokens`, `afterTokens` and `betweenTurns`.
  - A compaction run inside a turn (the CLI's own) belongs to that turn. One run between turns (`/compact`) belongs to the turn that closed last. The cursor keeps `lastTurnHost` for this.
  - Its input is the member's folded context at that moment. Kimi's own record (`llm.request kind:compaction`) shows the call sends the whole history (`droppedCount: 0`) under the same prompt and tools hashes; only the CLI's compaction instruction is unrecorded.
  - It takes no request number. Its `logIndex` sits between the requests around it (`n - 0.5`), so a bodiless member log rebuilds its body on read like any other request.
- **Room rounds.**
  - A human `/compact` dispatch is no longer a round.
  - In each round, a member scope's compaction requests move to a `compaction:<child>` scope (`kind: 'compaction'`, the 压缩 tab after the member's). Its overview carries `compaction.member {name, source, beforeTokens, afterTokens}`.
  - A member opened on its own needs nothing new: the main backfill already turns compaction requests into pseudo-turns attached by `hostTurn`.
- **Panel.**
  - The 压缩 tab's relation line reads 「X 在本轮之后压缩（/compact）」 or 「X 的 CLI 在本轮中自动压缩」, followed by 「上下文 289K → 44.7K tok」.
  - The request header shows the before/after counts and an external-CLI note in place of the host's reconstruction note.

## Alternatives considered

- **Keeping `/compact` as a round of its own, holding only the compaction.** Rejected: it is no conversation turn, and the host's own compactions do not count as rounds either.
- **Putting the compaction inline in the member's request list.** Rejected: it would read as one of the round's model calls. A tab of its own matches the host's 压缩 tab.

## Consequences

- Round numbers after a `/compact` move down by one, because the rounds are numbered on read.
- The next request's input still shows the whole history, and its cache break is unexplained. Rebuilding requests around the compaction boundary is the second step.
