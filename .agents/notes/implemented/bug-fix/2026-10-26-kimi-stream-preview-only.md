# Agent Note: Kimi live output stays out of the log

Status: implemented

English | [中文](2026-10-26-kimi-stream-preview-only.zh.md)

## Problem

After a refresh, a Kimi CLI member's finished turn showed only the collapsed 「已完成，用时…」 header. The final answer was folded into the process along with everything else. Claude and Codex members were fine.

The Kimi driver published every live snapshot with `LiveStreamPublisher.update`, which writes a durable `local-agent/stream` checkpoint at the step the stream had *reserved*. That step was not open in the log yet. The fold wrote the real `step/start → assistant/message → step/end` triple later. So a checkpoint for step 29 could sit at seq 64, ahead of step 2's `step/start` at seq 77.

When the host rebuilds the location index (cold open, refresh, prepend), it orders a turn's steps by each step's first event. Any event carrying `turn`/`step` counts. Step 29 therefore sorted first, and `turn.steps.at(-1)` became step 28, a tool call. `latestAnswer` (ui-chat `turn-process.ts`) returned null and the whole turn folded. Live append orders steps by `step/start`, so the turn looked right until a refresh. Reproduced from the affected log with the host's assembler: with the early checkpoints the answer is null; without them the final step is found.

## Decision

Kimi publishes live snapshots with `preview`, which is browser-only and never written to the log. This is the contract `live-stream.ts` documents, and the Claude and Codex drivers already follow it. The durable content is still the fold's atomic triple. `finish` / `dispose` already clear previews.

## Alternatives considered

**Write the checkpoint only once the step can open.** Not done: Kimi gains nothing from mid-stream durability, because the fold writes the content anyway.

**Change the host rebuild to place steps by `step/start` only.** Out of reach: the host is read-only to us and would need the upstream pipeline.

## Consequences

- A host restart mid-round no longer leaves a durable partial of the stream that has not been folded yet.
- Logs already written this way still fold after a refresh, because the old checkpoints remain in them.
- `nextKimiSessionStep` counts stream events as occupied steps. That no longer matters for new logs, since nothing writes them.
- Tests now assert that live snapshots reach the live channel at their step and that the log holds no `local-agent/stream` events.
