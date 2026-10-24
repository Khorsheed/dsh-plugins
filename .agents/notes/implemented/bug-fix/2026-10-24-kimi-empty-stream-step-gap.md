# Agent Note: an empty kimi stream reservation no longer strands a step gap

Status: implemented

## Problem

Context Lens failed a kimi member's child log with `stored log is corrupt: SessionFormatError: step/start does not match the open turn and next step` (session bf220f56, turn 2): the log went step 1 → step 3 with step 2 never written. Root cause: a think/text stream reserved step 2 but accumulated NO content (the wire step carried reasoning + a tool call, no text of that kind). `finalizeStep` returned early on empty blocks WITHOUT releasing the reservation or writing anything, and the fold had already computed its coordinate with step 2 marked reserved — so it wrote step 3, leaving a permanent gap the released-log reader rejects.

## Decision

Two halves, one invariant — the log's steps must stay dense and strictly sequential:

- `finalizeStep`'s empty case now RELEASES the coordinate: the reservation is removed from `reservedSteps` (when no other open stream shares it), the entries seal (a later delta opens a fresh reservation), and the live preview finishes. An empty reservation must never pin a step it will never write.
- The mirror fold, after `finalizeBefore`, recomputes its coordinate against the FRESH session ledger plus the remaining reservations and takes `min(provisional, sequential)`: a reservation that was finalized below now sits in the ledger, a released one frees its number. `nextFoldStep` no longer marks its provisional choice early (the mark happens once, at the final coordinate), so a lowered choice cannot collide with a later unit in the same pass.

## Alternatives considered

- **Write an empty step triple to fill the gap**: an assistant message with no content is a phantom request record, worse than the gap it patches. Releasing and recomputing keeps the log honest.
- **Finalize every in-flight stream before choosing any fold coordinate**: forces live text to seal early on every tool fold, degrading the live cadence for a case (empty reservations) that has a surgical fix.
- **Only release, without recomputing**: the provisional coordinate was computed with the reservation held, so the fold would still write above the freed step — the gap persists. Both halves are required.

## Consequences

- New kimi live rounds cannot strand a step gap from a contentless stream reservation; the released-log reader (and Context Lens) reads such rounds again.
- The already-corrupt historical log keeps its gap (append-only; re-mirroring old wires is a separate tooling question).

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test` (285): a new session-mirror spec reserves step 2 with no content and drives the full wire through the fold — the written steps must be exactly 1..N with no gap, and the log passes the released-log validator (the previous code wrote step 3 over the empty reservation).
