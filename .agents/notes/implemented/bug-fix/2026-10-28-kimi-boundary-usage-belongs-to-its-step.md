# Agent Note: a Kimi usage record at a live pass's boundary waits for its own step

Status: implemented

## Problem

In room bb05b2d3, the game-master member's turn 15 showed its final reply in Context Lens with no tokens at all, and the room's run usage counted only step 1. Kimi's wire did hold the reply's record (1,006 input, 541 output, 194,816 cached), and it was written before the turn ended.

Kimi writes a step's `usage.record` after `step.begin` and before the step's content. A live mirror pass that lands in between sees the record at its window's inclusive boundary with nothing of the step folded. The 10-27 counted-once change then marked the record as seen. Depending on the window, the record either rode the round's unattached rest, which a completed round never writes, or the previous step's message. When the reply step folded, it found no unseen record.

## Decision

The wire transcript tags each usage record with the wire step open when it was written (`${turn}:${wireStep}`). A live pass leaves a record at its boundary uncounted and unmarked when that record's step has not closed, or when the step is the held unit's. The step's own fold claims the record later. Untagged records (older wires write them after the content) keep the inclusive boundary. The settle pass takes everything.

## Alternatives considered

- **Exclude the boundary entirely.** That would drop the trailing record on untagged wires, the case the inclusive boundary exists for.
- **Drop the counted-once set.** That brings back the 3.2M re-count on a held round.

## Consequences

Each step carries its own wire record again. Logs written between the 10-27 deploy and this fix keep a final reply without usage, or one step carrying two records.

## Testing

`local-agent-kimi` (294): a session-mirror spec polls between step 2's record and its close, then folds the step. Before this change it wrote `[172926, undefined]`, and now it writes `[171920, 1006]`. The 3.2M held-round spec still carries the record once.
