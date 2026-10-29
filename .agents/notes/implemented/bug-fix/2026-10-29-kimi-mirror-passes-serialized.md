# Agent Note: a Kimi round's mirror passes never run side by side once it settles

Status: implemented

## Problem

Room 75844e33, Context Lens turn 15 showed an `ask_user_question` call and its result twice (×2). The child session holds them twice: turn 14 steps 1 and 2 (seq 145–148 and 150–153, both written at 20:25:59) are the same message, with the same call id `tool_OTIDchIimoI0G7zJwnFKZchO`, the same thinking and text, and the same result. The wire has that step once (wire step 7 of a turn whose other 16 model calls all failed with `turn.step.retrying`, ending `turn.step.interrupted`). Turn 19 repeats the pattern: the human stopped it while step 3's request was in flight (`turn.cancel` → `prompt.aborted`, no content for step 3), and the child log holds step 2 (`canvas_write`, call `tool_fG22WmUFHhmmq7JRay7B2C2u`) twice, at steps 2 and 3, both at 21:34:14. Context Lens showed the copy as request #35 with no usage. Both cases are interrupted turns settling.

A mirror pass reads the stored offset, folds, then writes the offset back. Live passes are chained on `mirrorQueue`, but the settle polls called `mirrorKimiDelta` directly. `triggerMirror` kept firing on every `session/update` until the sink was removed after settlement. An interrupted turn whose late updates arrive while it settles can therefore run a live pass beside a settle poll: both read the same offset and fold the same step.

## Decision

- `triggerMirror` returns once `roundSettled` is set, so settlement owns the wire.
- Every settle pass (the polls and the final settle pass) runs through `serialMirror`, on the same queue as live passes.

## Alternatives considered

- **Dedupe in the fold (skip a call id the session already holds).** That would hide the race instead of removing it, and it would not cover text-only steps.

## Consequences

One wire step folds once. The ×2 already in this session's log stays.

## Testing

`local-agent-kimi`: the suite stays green. A spec that pushes updates throughout settlement did not reproduce the race (each pass is one small file read, so the window is too narrow to hit), so it was not kept. The cause is inferred from the logs: in both turns 14 and 19, the copies were written in the same second by the fold, not by the live finalize path, and only in interrupted turns.
