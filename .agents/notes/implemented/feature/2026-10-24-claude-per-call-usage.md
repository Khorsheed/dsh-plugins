# Agent Note: Claude child logs carry per-call usage (inline from each assistant event)

Status: implemented

## Problem

In Context Lens, a Claude member's intermediate steps (the Bash calls) showed — tok: only the round's last reply carried usage, and it carried the ROUND TOTAL. Meanwhile kimi members already account per request. The claude wire was never missing the data: every assistant event in the stream-json flow reports that API call's own usage inline (`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`); the terminal `result` event carries the round sum (verified: the result's buckets equal the per-event sums). The fold just never read `message.usage`.

## Decision

The fold stamps each assistant event's inline usage onto the LAST transcript line that event produced (`ClaudeTranscriptLine.usage`): a multi-block call (thinking + text + tool_use) accounts once; a tool-only call's usage lands on the tool line's advertising assistant/message (the `tool/call`/`tool/result` events themselves have no usage slot). In the append paths the line's own usage wins; the round total (from the `result` event) becomes a pure fallback, written to the last non-tool line only when the stream named no per-call usage anywhere — a sum would double count. The live paths need no waiting: the usage arrives with the event, so the historical "carrier mirrored before the usage was knowable" loss mostly disappears. The round total still feeds the run accounting (progress/settle reports), unchanged.

Codex is deliberately NOT in this change: its exec stream reports usage only at `turn.completed` (the last call's, it turns out), and while the rollout's `token_count` events carry per-call `last_token_usage`, the exec mirror writes live and the host log is append-only with no usage-backfill event — per-call attachment would require holding all mirroring until settle (killing live progress) or an upstream backfill seam. Recorded here so the next ask starts from evidence, not re-investigation.

## Alternatives considered

- **Round total stays on the last line AND per-call on the rest**: double counts in every summing reader (the lens's turn totals, the host tokenUsage projection). Rejected.
- **Attach per-call usage to EVERY line of a multi-block call**: same double count at one-call granularity. The last-line rule matches kimi's one-usage.record-per-request placement.

## Consequences

- New claude member rounds: every step that ended an API call shows its own input/output/cache buckets in Context Lens; tool steps answer real numbers instead of —.
- Old child logs are unchanged (round-total-on-last stays readable; per-record cache analyses just lack the old rounds' intermediate calls).
- Context Lens needs no change: same `assistant/message.data.usage` field, now populated per call.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test` (266): a fold-level spec asserts each call's usage lands on its own last line (thinking+tool_use → the tool line; reply → the text line) with the result-event total intact on `parsed.usage`; an exec-mirror spec runs a two-call round through a controllable child and asserts both assistant messages carry their own call's buckets and no message carries the round total. The pre-existing "usage rides the final message" specs keep passing: their fixture streams carry no per-event usage, so the fallback path is exercised verbatim.
