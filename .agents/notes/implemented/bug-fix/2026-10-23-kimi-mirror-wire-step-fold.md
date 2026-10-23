# Agent Note: The kimi mirror folds per wire step — one LLM request becomes one dsh step

Status: implemented

## Problem

A kimi child session showed every wire PART as its own request record: the thinking fold carried no usage and a 0.0s span, so a round read as two records (a bare `#1 · —`, later `#1 · 思考`, then the real reply). The Context Lens label fix ([the usage-buckets note](2026-10-23-context-lens-usage-buckets-and-no-usage-rows.md)) made the row honest, but the shape remained wrong — one LLM request, two records.

Reading the real wire (tests/fixtures/two-round-resume.wire.jsonl) showed the split was ours, not kimi's: one wire step — bracketed by `step.begin`/`step.end`, opened by one `llm.request` and accounted by one `usage.record` — carries the think part, the text part and the tool calls together. The transcript reader split each part into its own line and the mirror folded per line. The host's own sessions write one `assistant/message` per LLM call with `[reasoning, text, tool-call…]` blocks and that call's usage — the kimi child session now matches it.

## Decision

**The mirror's fold grain is the wire step.** One wire step folds into one dsh step whose assistant message carries the reasoning, reply text and tool-call blocks together, with the tool/call + tool/result pairs inside the same boundary and the step's own `usage.record` riding the message.

- The transcript reader tags content/tool lines with the wire's own `step` number (`wireStep`) and records which steps the wire closed (`closedSteps`, from `step.end`). Untagged lines (older wires) fold one by one, unchanged.
- A mid-round pass holds a unit that may still grow: an unclosed wire step, or a tool call whose result the wire has not recorded. The offset stops before it; the settle pass folds the remainder with the interrupted placeholder.
- Usage stays exactly-once per pass window, but attaches per unit: a step-tagged unit claims its own line span's records; records no tagged unit claims (untagged spans, the flush-race boundary) sum onto the pass's last folded content unit — the pre-tagging shape.
- The live driver's stream ledger pairs per FOLD, not per line: `completeStreams(turn, kinds)` consumes the round's in-flight think/text streams together, the fold lands at the earliest consumed reservation, and the other consumed reservations are RELEASED so later folds may take them. Tool reservations release without writing (the group's step carries the lifecycle).
- Every durable write — folds, gap fills, settle-time finalizations — takes the smallest step nothing holds (first-free, not max+1), so released coordinates never leave holes; `finalizeBefore` still seals open reservations below a fold's target at their own reserved steps first. The released-log reader's dense-sequential contract is enforced by construction and replayed in tests.

## Alternatives considered

- **Merge at read time in Context Lens** (coalesce a reasoning-only fold with the following fold of the same round). The log would keep two messages and the lens would grow a second, inferred numbering on top of them — while other consumers of the child session keep seeing the split. Folding right at the source removes the divergence instead of compensating for it.
- **Pair think with text heuristically** (hold the think fold until a text line arrives). Works without wire step tags, but invents a boundary the wire already declares authoritatively (`step.begin`/`step.end`) — a heuristic mispairs exactly where the wire knows better (a step whose reply is tool-only, a think-only interrupted step).
- **Keep per-line folds** after the label fix. The rows are honest but the request count, durations and usage stay split across two records — every kimi round keeps reading as two model calls it never made.

## Consequences

- kimi child sessions read like host sessions: one request record per LLM call, reasoning as a block inside the response, per-request usage on its own message. Context Lens needs no kimi-specific handling.
- Mid-round durable folds land at wire-step granularity: the OPEN step's content persists when the step closes, not when each part arrives. Live rendering is unaffected — ACP deltas keep riding the `local-agent/stream` channel.
- A session mirrored across this upgrade can split ONE group once: an old offset sitting between a step's think and text parts resumes the group as text-only. Self-limiting to in-flight runs at upgrade time.
- The plan stream and settle-time orphan folds still produce reasoning-only standalone steps — genuinely unattached content, so the standalone `思考` summary stays meaningful.
- The claude-code/codex mirrors keep their per-kind split (same two-record shape when a round thinks); folding them per response is the same follow-up on their own wire shapes, not done here.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test` (22 files, 284 tests): new coverage for the grouped fold (think+reply+tool in one step with its usage), the open-step hold and the fold on close, the unresulted-tool group hold and the interrupted settle, wire-step/closed-step parsing, and the live driver's one-durable-step pairing with the released reservation leaving no trace — all replayed through `expectValidReleasedLog`; the real-fixture resume spec now asserts per-step usage and the grouped message shape.
