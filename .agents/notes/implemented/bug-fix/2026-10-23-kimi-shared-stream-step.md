# Agent Note: kimi live streams share one reserved step per generation

Status: implemented

## Problem

A kimi live round's reply disappeared into the collapsed turn-process block: the child session view showed only 已完成，用时 4 秒 with the answer folded away. Root chain, verified against the real child log:

1. The live driver's think and text streams each reserved their OWN step (`kimi-stream-{kind}-{turn}-{generation}`), and the wire-step fold ([the wire-step fold note](2026-10-23-kimi-mirror-wire-step-fold.md)) consumed both and landed at the earliest, releasing the other.
2. The released reservation's `local-agent/stream` frames were already durable at their step — append-only, so the text stream's frames sat at a step that never received a `step/start`.
3. The host's conversation location index drafts a step for ANY event carrying (turn, step) coordinates, so the turn's steps became [1 (the fold), 2 (stream frames only)].
4. `latestAnswer` (ui-chat `conversation-nodes/turn-process.ts`) anchors the finalized answer at the turn's LAST step's assistant message; the trailing stream-only step has none, so no answer was found — and a collapsed turn folds everything.

## Decision

**The think and text streams of one generation share ONE reserved step** — the host's own live shape is reasoning + text on a single step, so this is also a fidelity improvement, not only a fix.

- Reservations key on (turn, generation) (`generationSteps`); the plan stream keeps its own lane. Stream items carry the kind in their id (`turn:step:kind`) so two kinds sharing a step never collide in the publisher (a subitem id earns its close-out tombstone on finish).
- The fold pairing (`completeStreams`) frees a consumed reservation only when no open stream still holds that step, and a step whose triple an earlier fold already wrote steers nothing (singleton folds of untagged wires: the think line folds at the shared step, the text line's pairing finds that step written and takes the next free one).
- Finalization merges per step: a gap fill (`finalizeBefore`) or settle writes ONE triple per step carrying `[reasoning?, text?]` together, and consumes the generation's mapping so a later delta re-reserves fresh.

The coordinate rule everywhere stays first-free: every durable write takes the smallest step nothing holds, so a released coordinate never leaves a hole.

## Alternatives considered

- **Fold at the latest consumed reservation.** The stray frames then sit BELOW the reply and the answer anchor works — but the durable step numbering starts at 2 with no step 1, which the released-log reader rejects (`step/start` must equal the dense next step). Dead on arrival.
- **Tombstone the released reservations' frames.** The log is append-only; the frames' coordinates created the step draft at write time. No retraction exists.
- **Only fix the host** (`latestAnswer` walks back to the last step carrying reply content). That is the robust general answer — any trailing stream-only or dangling step otherwise swallows the reply — and it is registered as an upstream seam ([S20](../../../docs/upstream-seam-registry.md)); doing ONLY that would leave the kimi child log carrying meaningless empty steps, so both happen.

## Consequences

- The common kimi flow (think chunks then message chunks within one response segment) publishes both kinds at one coordinate; the fold lands there; no step draft ever points at unwritten content, and the collapsed turn keeps the reply visible.
- Residual edge: commentary text arriving after a tool-call notification (a new generation mid-wire-step) still reserves a later step whose frames outlive its release — a presentation wart (the reply may fold into the process block for that shape), no content loss; S20 covers it properly.
- The publisher's frames now carry kind-suffixed ids and their close-out tombstones — one more frame per kind per step; consumers key on the id opaquely.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test` (22 files, 284 tests): the step-tagged live test now mounts a real `LocalAgentStreams` and asserts every stream frame carries the fold's step and nothing points at a step 2; the transient-output test asserts the snapshot+tombstone frame pair. All rounds replay through `expectValidReleasedLog`.
