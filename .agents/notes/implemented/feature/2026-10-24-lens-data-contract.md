# Agent Note: The external-agent child-log data contract for Context Lens

Status: implemented

## Problem

Context Lens reads external-agent child logs and room run events as its data source, and surfaced four gaps:

1. **Cache fields: 0 vs absent.** claude-code logs wrote `cacheWriteTokens` but dropped `cacheReadTokens` when it was 0 — a reader cannot tell "no hits" from "not reported". codex logs showed only input/output — but codex's mapper existed; those runs genuinely had `cached_input_tokens: 0` and the `> 0` guard dropped the zero. codex also never mapped its cache-write counter at all.
2. **A codex child session lost replies** (a completed round's turn held no assistant/message; a later completed round wrote no turn at all).
3. **No room↔child correlation**: `room/run-state` carried `childSessionId` only sometimes (a member's first run never did), and nothing says which child-session turn a run maps to.
4. **Undocumented read interface**: the lens reads four room events as its correlation interface with no recorded contract.

## Decision

- **cacheReadTokens is written whenever the upstream reports the field, zero included** — kimi (`usageFromWire`), claude (`usageFromClaude`), codex (`usageFromCodex` + `usageFromAppServer`) all follow the same rule now, so "no hits" never reads as "not reported". codex additionally maps its cache-write counter (`cache_write_input_tokens` / `cacheWriteInputTokens`) to `cacheWriteTokens`, previously dropped.
- **The codex "lost replies" were not a current-code defect.** The damaged session ran a pre-`62411daa` live mirror (the step-order bug it fixed) whose corrupt bracket made the log unreadable; a later manual truncation repair cut everything from the first invalid event, dropping the round-2 completion fold and round 3 with it. Current code has no path where a completed round writes nothing: regression coverage added for the exact shape (an aborted resume round mid-stream lands its partial reply as an interrupted message), and the one real residual hazard found in review — a `turn/completed` fold failure skipping `resolveCompletion`, hanging the round — is hardened (try/finally).
- **room/run-state carries the correlation**: `childSessionId` on every edge once the identity exists (the running edge re-reads the roster instead of the stale captured snapshot; a fresh member's first running edge still predates the handle — the terminal edge and the journal backfill cover it), and terminal edges add `childTurn`, the last turn/start the child wrote (live sessions only). The four lens-read events (`room/dispatch`, `room/run-state`, `room/coordinator`, `room/member-added`) carry a keep-in-sync comment at their SessionEventMap registration.

## Alternatives considered

- **Codex per-turn accounting counts only the LAST API call's usage** (a multi-call turn under-reports; rollouts carry `total_token_usage` for a diff-based per-turn total). Left as a recorded gap, not changed here: it alters recorded usage semantics and deserves its own口径 decision with the lens.
- **Write the running edge later** (after the handle exists). The running edge's purpose is marking admission; the correlation the lens needs is answered by the terminal edge's `childSessionId` + `childTurn`, and the journal already backfills the execution record.
- **A `runId`-keyed correlation event instead of fields on run-state.** Additive optional fields on the existing edge are cheaper and replay-compatible; old journals replay with the fields absent.

## Consequences

- New child logs distinguish 0-hit from unreported across the family; codex's cache-write cost is no longer invisible.
- The lens can correlate a room run to the child-session turn without time guessing; old journals replay unchanged (the fields are optional).
- Codex's remaining known gaps, recorded for their owner: per-turn usage counts only the last API call (see Alternatives), and the exec usage-carrier race (a carrier mirrored before `turn.completed` drops the round's usage with a warn) — both warn-level today.
- Collision note: room's `types.ts`/`dispatch.ts` have active in-flight branches (room-local-agent-host021 was rewriting the admitted/settle hunks and makes `room/coordinator`'s `previousMemberId` optional — the lens reads that event). This change is additive optional fields; textually it conflicts with that branch — merge order is the coordinator's call.

## Testing

claude-code 262 + codex 250 + kimi 284 + room 333, all green. New coverage: claude's zero-hit/write-field contract, codex's cache-write mapping + always-written cacheRead + the aborted-resume regression, room's run-state edges carrying childSessionId (running edge of a fresh member honestly omits it) + childTurn on the terminal edge.
