# Agent Note: codex live rounds log each API call's own usage

Status: implemented

## Problem

Codex members' intermediate steps showed — tok in Context Lens: the live driver kept only the LATEST `thread/tokenUsage/updated` and wrote it at turn end on the last line. Also, what that last line carried was the LAST CALL's usage, not the round total — so the settled report (and the room's per-run tokens) undercounted every multi-call round.

## Decision

The app-server wire closes each API call with a `thread/tokenUsage/updated` notification whose `tokenUsage.last` is that call's own accounting (same position as the rollout's `token_count`: right after the call's last item — verified against real rollouts). Each notification now stamps its `last` onto the call's LAST transcript line (`usageByLine`), which carries the usage whenever the line folds — including the volatile last line, which keeps its result-merge hold. The turn-total fallback (last non-tool line) only fires when the wire named no per-call usage at all, and a final stream snapshot no longer double-writes the last-call read once per-call usage exists. Tool-only calls ride the tool line's advertising assistant/message (the tool/call and tool/result events have no usage slot).

The settled report now prefers the wire's cumulative `tokenUsage.total` (an object with no numbers is "not reported", never overriding the per-call read), so multi-call rounds report the true round total.

Exec rounds are deliberately unchanged: `codex exec --json` reports usage only at `turn.completed`, and while the rollout has per-call `last_token_usage`, the exec mirror writes live into an append-only log with no usage-backfill seam — per-call attachment there would mean holding all mirroring until settle (killing live progress) or an upstream backfill capability.

## Alternatives considered

- **Hold every call's lines until its usage notification arrives**: the notification lands right after the call's last item, so the delay is negligible — but a tool call's line would then fold before its result exists and settle as a phantom interruption. Stamping the map and letting the line fold on its normal schedule avoids that entirely.
- **Sum the per-call `last` values for the settled total**: works only while every round reports exactly one notification per call; the wire's own cumulative `total` is authoritative and needs no such assumption (and an empty `total` object must not zero it out).

## Consequences
- New codex live rounds: every step that closed an API call shows its own input/output/cache buckets; earlier lines of the same call carry nothing, so no double counting.
- The room's per-run token total is now the round total, not the last call's.
- Old logs unchanged; Context Lens needs no change (same `assistant/message.data.usage` field).

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-codex test` (252): a two-call live round asserts the intermediate text carries no usage, the tool line's advertising message carries call 1's buckets, the final answer carries call 2's, and the settled report carries the cumulative total. Pre-existing single-call usage assertions pass verbatim.
