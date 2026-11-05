# Agent Note: Kimi live writes one step per model call; lens reads leftover split steps as annotations

Status: implemented

## Problem

A kimi live member's child log wrote one model call as two steps at the same instant. In member `c937f309` (turn 6) step 166 was an `assistant/message` with only a reasoning block, no usage and an empty `stream`, and step 167 the Edit tool call with usage and stream; the log holds 51 such reasoning-only steps, and the kimi home's `usage-diag.jsonl` records all 51 as `finalize-from-live` via `gap`. The cause was the live driver's gap fill (`finalizeBefore`): a fold writing above a live stream's reservation first sealed that stream as its own durable step. When call C's reasoning started streaming before call B's tool-only wire step folded (B carried no reasoning, so no stream paired with it), B's fold sealed C's reasoning ahead of B; C's own fold then excluded the sealed reasoning. The reasoning ended up in the wrong place and in a step of its own.

Before [S8](../simplification/2026-11-05-context-lens-reads-execution-records.md) Context Lens stitched such usage-less steps into the next request. S8 turned stitching off for logs with execution records, so the member's lens showed the split step as its own request ("#348 · 思考", token "—"), and that request's cache breakpoint was computed against the next request's content: the store picks a request's diff baseline by start time, and the split step's start came from the next call's historical stream.

## Decision

**Kimi live: the wire step is the call boundary** (like Claude live after [batch 3](../simplification/2026-11-02-local-agent-shared-mirror-writer.md) and codex live after [S3](../feature/2026-11-04-codex-live-one-step-per-call.md)). `session-mirror.ts` already grouped one wire step's think, text and tool lines into one unit. Each fold now writes that unit as one step, numbered in write order (`nextWrittenKimiStep`), through `appendMirrorStep`, with the unit's usage once. Live streams are browser previews only:

- The gap fill (`finalizeBefore`) is removed, together with the coordinate code that existed only for it (`nextFoldStep`, `markTaken`, `pairing.step`) and the `sealed` exclusion in the fold. `completeStreams(turn, kinds)` now only ends the previews of the call's streams and frees their reservations. It also ends any open stream from an earlier generation, because that stream previewed content its own wire step did not carry, and left open it would be written from live text at settle.
- A new `vacate(turn, step)` hook runs before each durable write. Any live preview keyed at or below the written step moves to a fresh reservation above it and is published again there, so a later call keeps streaming live and never shares a coordinate with an earlier call's step.
- Unchanged: a stream the wire never logged (a cancelled or cut-off round) is still written from its live text at settle (marked `interrupted` on a non-completed round), orphan ACP tools still become placeholder steps, and cancel goes through `session/cancel` as before.

**Context Lens: one structural annotation rule.** `log-lane.ts` `isMirrorAnnotation` treats an `assistant/message` as history, not a request, when all of these hold:

1. the log belongs to an external agent (`cursor.external`);
2. the row has no usage (`readUsage(data.usage)` is undefined);
3. the row has no `interrupted: true`;
4. the row's own `stream` is absent or empty. This is judged on the logged row, before any read-time `harness.timing` enrichment;
5. the message has content, and every content block is `text` or `reasoning`.

The rule applies to recorded and unrecorded logs alike, and in both fold paths: `foldLogRows`, which feeds the member's lens, and `reconstructSession`, which feeds the backfill. It runs before `buildRequest`, so an annotation takes no request number, does not move the next request's fingerprint baseline, and does not end or join a waiting legacy call. The request after it therefore diffs against the previous real request.

## Testing

- `local-agent-kimi` tests: 325 before, 327 after. The new behavior spec follows the prod shape: call C's reasoning streams before call B's lone Edit folds. It now yields 4 steps with usage `[1,2,3,4]`, nothing written from live text, and C's preview moved above B's step; it fails on the old code. The untagged-wire spec now expects wire order (reasoning, tool, text) instead of the gap-filled answer first. The session-mirror spec pins write order plus `vacate`.
- Snapshots: the two existing kimi snapshots (settle-time wire fold; cancelled live round) are unchanged. The new live snapshot (its own commit) has the prod shape: before the fix 5 steps / 27 events (A, C's reasoning alone, B's Edit, C's Bash without its reasoning, the answer); after it 4 steps / 24 events (A [reasoning, Read], B [Edit], C [reasoning, Bash], answer).
- `context-lens` tests: 335 before, 340 after. `mirror-annotation.spec.ts` uses a synthetic fixture shaped like the prod pair and covers recorded and unrecorded logs, the request numbers, the next request's baseline (`added` = the previous response, its result and the annotation), harness timing that does not turn the annotation back into a request, usage / logged stream / `interrupted` each keeping a request, and an in-process subagent being untouched.
- The member `c937f309` log, read in memory with `zstd -dc`: the live fold (`foldLogRows`) gives 429 requests on the old lane and 377 on the new one, with the 52 usage-less reasoning-only rows gone. The backfill without timing gives 377 on both.
- Screenshots from lens's preview harness (not committed): before, "#2 · 思考" with token "—" and a breakpoint "之前 229 字与 #3 一致"; after, 4 requests, and Edit shows "与上一请求 #1 的前缀一致".
- `local-agent` 536, `room` 536 and `bundle-local-agent` 5 tests pass; `pnpm check:plugins` reports 0 findings.

## Other providers checked

- **Claude** (live and exec): every mirrored call carries a usage or a derived stream; a cancelled partial is `interrupted` or streamed. None matches the rule.
- **Codex live**: one step per call with usage; cut-off partials carry stream records. None matches.
- **dsh / dsh-headless**: verbatim host events, which carry the host's own stream and usage; an interrupted partial is marked. None matches.
- **Codex exec** (call boundaries unrecorded): its reasoning/text item steps carry no usage and no stream. They are items of a call, never a call of their own, and they now read as annotations in the live fold as well; the backfill path already read them that way. The local-agent contract spec now expects the codex-exec round as one request (the usage-bearing step, marked as the round total) instead of three rows.
- **Kimi** settle finals written from live text on a completed round without usage (the wire never flushed) would read as annotations. This case is rare, and the content is still shown as history.

## Alternatives considered

**Keeping the gap fill but writing the sealed stream into the next call's step.** Kimi wires do not split one call into two steps, so the gap fill had no job left once each fold numbers its step in write order. Patching it would have kept a second writer for content the wire already logs.

**A time-based lens rule (same timestamp as the next step).** Rejected as attribution by coincidence. The structural signature (no usage, no logged stream, text/reasoning only) is what no provider writes for a real call.

**Judging the stream after harness timing enrichment (the old rule).** The enrichment matches a historical stream by content identity. In the split case that stream belongs to the next call, which is exactly what produced the nonsense timing and baseline.

## Consequences

New kimi live rounds show one step per model call, so the member's conversation and Context Lens agree on the request count. A call's reasoning stays with its own tool call. Old member logs read correctly without a rewrite. Remaining costs: an annotation in an old log sits in history before the step it came out of, and the lens labels it as the previous request's response. A completed-round final that was written from live text without usage reads as history.
