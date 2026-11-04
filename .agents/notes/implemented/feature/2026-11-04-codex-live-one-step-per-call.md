# Agent Note: Codex live writes one child-session step per model call

Status: implemented

## Problem

Batch 3 ([the shared mirror writer](../simplification/2026-11-02-local-agent-shared-mirror-writer.md)) made Claude live group its mirror by API call, but the codex live driver still wrote one step per app-server item: one model call that reasoned, said something and ran two commands became four steps, its usage riding whichever item happened to be the call's last. Context Lens had to merge usage-less external steps back into one request (`log-lane.ts` `deferred`/`flushDeferred`/`joinCall`), and the member's own conversation showed a call as a pile of separate cards. Batch 5 (design `proposals/active/2026-11-03-unified-execution-entry.md`, not in the repository, migration row S3) asks codex live to write the call as one step, the way Claude does. The codex exec path stays as it is: its JSON stream names no call boundary, which [S1](2026-11-04-local-agent-execution-records-written.md) already declares as `call-boundaries` unrecorded.

## Decision

`packages/local-agent-codex/src/live-driver.ts` keeps a ledger of the round's model calls (`CodexCall`) in place of the per-line ledger (`lines`/`folded`/`usageByLine`/`mirrorUpTo` are gone).

- **Call boundary.** One `thread/tokenUsage/updated` notification closes one call. Codex emits a call's token count right after the call's last item, tool outputs included (the next request needs them), so every item first seen since the previous boundary belongs to the call the next boundary closes, and the boundary's `tokenUsage.last` is that call's own usage. Evidence: real codex rollouts (`~/.codex/sessions/…`, codex-cli 0.163.0) record `token_count` after each call's `function_call_output`, one per `token_usage_record`; a real `codex app-server` round driven against a local mock Responses server (no paid model call) emits `item/started reasoning` → `item/completed reasoning` → `item/started commandExecution` → `item/completed commandExecution` → `thread/tokenUsage/updated` (last 100/10, total 110) → `item/started agentMessage` → deltas → `item/completed agentMessage` → `thread/tokenUsage/updated` (last 130/6, total 246) → `turn/completed`.
- **Repeated readings are no boundary.** Codex re-emits an unchanged reading (37 of 3994 `token_count` events in one real rollout carried the same totals as the previous one, some of them mid-call between a reasoning item and its tool call). A reading whose thread `total` equals the last one this runtime saw (`CodexLiveRuntime.lastUsageReading`, so a carry-over from the previous round counts too) neither ends a call nor moves the round's own total (`threadTotalBefore`). A notification without a numeric total is never deduplicated.
- **Membership.** An item joins the open call when first seen (`item/started`, its first delta, or its completion); a call opens lazily with its first item after a boundary. The echoed `userMessage` and codex's own `contextCompaction` are not model output and join no call. An item whose call was already written (a completion that outlived its call) joins the open call.
- **Writing.** A call is written once its boundary arrived and every item it started has completed (the released-log reader resolves every advertised tool before `step/end`): one `assistant/message` through `appendMirrorContent` with every block in first-seen order and the call's usage once, then each tool's call/result pair, then `step/end`. A later call that streams meanwhile is previewed live and opens its step once the earlier calls are written. `turn/completed` and the settle after a cancel or failure write everything left, call by call; a stream whose completion never came rides from its live text, and the message is marked `interrupted` only when such a cut-off block is in it on a non-completed round.
- **Live text.** A call's first stream opens the call's step; later streams of the same call join it, published as sub-items (`turn:step:itemId`), exactly as Claude live does, so text still streams character by character. Without live streams, each durable snapshot carries every opened block of the call so far.
- **Stream timing.** The call's single message derives its stream records from all its blocks, so they cover the call: a streamed item without an `item/started` gets the window from its first delta to its completion (it had none before), and the stream's start is the delta's arrival time, not a replay time (notifications that arrive before the turn opens are buffered and replayed).

Unchanged: codex exec (`codex-cli-provider.ts`), the core mirror writer (`packages/local-agent/src/mirror-step.ts`), the cancellation path (`turn/interrupt`, bounded converge), and the settled report.

## Testing

`tests/live-driver.spec.ts`: the behavior specs that pinned one step per item now pin one step per call (the basic round, per-call usage, stream joins and the call's stream span, tool-first arrival order, the cross-call preview wait, the aborted round's partial call, the stream-less round, the resume round); a new spec pins repeated readings, mid-call and carried across rounds. The two codex live mirror snapshots changed in their own commit: the completed round went from 4 steps to 2 (24 events to 19), the cancelled round from 2 steps to 1 (13 events to 11). Codex package tests: 277 before, 278 after. Run once against the real codex-cli 0.163.0 `app-server` through the driver with a local mock Responses server: 4 steps before, 2 after, usage once per call, the second call's reasoning and answer streamed as `1:2` and its sub-item `1:2:msg_1`.

## Alternatives considered

**Grouping by `item/started` turn order without the usage notification.** The wire carries no call id on items; the token-usage notification is the only call delimiter the app-server exposes.

**Writing a call once its boundary arrives, even with items still pending.** It never happens in the recorded traffic (tool outputs precede the count), and writing early would close the step before a tool's result exists; holding the call is the Claude live rule.

**Writing a call as soon as the next call starts, even with items still pending.** It bounds how long a stuck item can hold the log, but it splits a tool from its call; the settle already writes everything left.

**Deduplicating readings on `last`.** Two different calls can report equal per-call usage; the thread total only grows with a new request.

## Consequences

Codex live child logs now show one step per model call, with that call's usage once and stream records covering the call, so Context Lens's request count is unchanged (it merged the steps already), and its `joinCall` merge no longer has codex live work to do (S8 removes it). A call's message is written when the call ends instead of item by item; live previews and `local-agent/stream` checkpoints still show it as it streams. Costs: a stuck item (started, never completed) keeps its call — and every later call — out of the log until the round settles; usage reported for a call with no mirrored block (a compaction-only or unmapped item) is not written; deltas without an item id still pair with nothing (unchanged).
