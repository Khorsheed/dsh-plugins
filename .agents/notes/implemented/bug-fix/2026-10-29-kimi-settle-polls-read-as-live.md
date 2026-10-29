# Agent Note: a Kimi round's settle polls read the wire as live passes, and only the last pass settles

Status: implemented

## Problem

Room 75844e33 turn 15 (20:47): the final reply again had no usage, with both earlier fixes deployed (`2026-10-29-kimi-settle-waits-for-final-step` and the diagnostics in 782e39a37). `usage-diag.jsonl` logged no `finalize-from-live`, only `unattached` 3304/1973/66048 at `mirroredLines: 74`. The transcript has 76 lines: step 2's `usage.record` sits at line 74, and its think/text are lines 74–75. A settle poll caught the wire after kimi had flushed the record but before the content. A `settle` pass never defers a boundary record, so it counted the record as the round's rest, with no content unit in that pass to carry it, and marked it seen. The next poll folded the reply without usage. The settle-wait fix made this likelier: it polls more often while kimi is mid-flush.

## Decision

The settle loop's polls are plain live passes. A step still flushing holds, so it never splits into two folds, and a boundary usage record waits for its step. After the loop, one `settle` pass takes what is left: an open step folds as it stands, a missing tool result is synthesized, and a record whose step never landed counts as the rest. `session-mirror` is unchanged.

## Alternatives considered

- **A `settlePoll` mirror option that defers boundary records in settle mode.** That option alone still let a poll fold a half-flushed step, splitting the reply. Live passes already get both right.

## Consequences

The final reply keeps its usage even when kimi flushes the record ahead of the content. A completed round still waits up to 10 s for unfolded streams; a stopped round settles after the quiet window, plus the one settle pass.

## Testing

`local-agent-kimi`: a new live-driver spec writes the final step's `step.begin` and `usage.record` when the prompt resolves, and the content and `step.end` 1.5 s later. The reply carries 3304/1973/66048. Against the previous driver it fails with no usage.
