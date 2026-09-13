# Agent Note: eval_cells — the evaluation preset drops mission's tool row (I5 · T46)

Status: implemented

English | [中文](2026-09-13-eval-cells-tool.zh.md)

## Problem

The web-eval UI spec settles R6: in evaluation mode the word *mission* does not appear. mission stays what it always was on this line — the run ledger and the release gate, driven by the orchestrator's service face — but nothing model-facing or user-facing should name it.

Two things still did. The pack's `eval` preset composed `mission-tool: read`, so every evaluation session carried four mission read tools (`mission_run_list` / `mission_run_status` / `mission_list` / `mission_get`); and that same row is the criterion mission's own [`preset-visibility`](../../../packages/mission/src/client/preset-visibility.ts) uses to decide whether the 任务 tab shows, so the tab was on in evaluation sessions too.

Dropping the row on its own would have left a hole rather than closed one. The four mission tools answered a real question — what is each cell of this run doing — that `eval_run_status` only half answers: it digests `run.meta` and gives a thin row per cell (state, bucket, the last orchestrator annotation), while the unit a cell holds, the checkpoints it reached, how much each annotation namespace has to say, and the child session its delegation ran in were readable only through `mission_get`.

## Decision

- **The preset drops the `mission-tool` row.** `datasets-tool: authoring` and `eval-tool: all` stay exactly as they were. The 任务 tab then self-hides with no second switch, because the row's presence *is* the tab's criterion. The package still ships with the pack (`package.json`, `install.sh`'s `UNPUBLISHED_DIRS`), so an overlay preset can name the row again — this pins a default, not a reachable set.
- **eval grows a per-cell read projection**, `EvalService.cells(runId, query)` over `read.ts`'s `runCells`. One row per cell: the matrix coordinates and every other label, bucket, current state, `enteredCurrentAt` plus `inStateMs`, the attempt number, the current attempt's `refs.resource` / `refs.fingerprint`, its checkpoint NAMES, annotation counts per namespace, and the delegation's `childSessionId`. It reads mission through the structural `MissionReadFace` — widened here with optional `attempts` and an optional `enteredCurrentAt` on the row — so eval still imports nothing from mission, and the projection is computed on the SERVICE side: the tool and (from T35b) the lab tab both consume eval's own answer and never touch mission.
- **`eval_cells` is the fourth read tool**, registered by the companion row `@khorsheed/dsh-eval-tool`; `tools: all` now means four read tools. Parameters: `run_id` (required) and the exact-match filters `bucket` / `task` / `condition`. Its description and the `tool:eval` guidance section both say the mission read tools are not granted here and are not to be looked for — a tool the model hunts for and cannot find costs turns.
- **Every field is nullable and absence is reported, never guessed**: a ledger that predates a field, or a cell `mission.get` cannot resolve, degrades to nulls for that cell instead of failing the listing (the same degrade `runStatus` already made).
- **`total` / `buckets` describe the whole run even under a filter.** A narrowed list must not shrink the reader's sense of how big the run is; `matched` says how many the filter kept.

## Alternatives considered

### Why not keep `mission-tool: read` and simply hide the tab another way?

The tab's criterion is the row, by design (M4'③): "the composition grants the agent the mission tools" is the honest reading of "show mission's chrome". Inventing a second, eval-specific switch would leave the two halves of R6 disagreeing — an agent that can still call `mission_get` in a mode where the word is supposed to be absent. Removing the row settles both halves with one edit.

### Why not have `eval_cells` list the run's *runs* when `run_id` is omitted?

That was tempting, because `mission_run_list` is the one purpose of the four that nothing else now covers: after this change an agent gets a run id from the `/eval run` reply in its own session (the human starts every run there) or from a bundle's `run.json`, and has no verb that enumerates them. It is a real, small gap and it is recorded here rather than closed on the spot: the shape was decided as `cells(runId)`, the lab tab's own run list is T35a's `runs` read face, and a listing mode is a cheap follow-up on top of it — with the advantage that eval's list can be *eval's runs*, where `mission_run_list` returned every run in the ledger.

### Why not put the projection in the tool adapter?

Then the lab tab (T35b) would need its own copy, and the frontend is forbidden to import sibling packages. Service-side keeps one implementation for both consumers, and keeps `ctx.mission` behind eval's own Remote — which is what "the frontend never touches mission" requires.

### Why not report a total elapsed time per cell instead of time-in-state?

Time-in-state is mission's own queue column and it is the one that answers the question a stuck run raises ("how long since anything happened here"). A total elapsed would need a notion of when a cell settled, which is the state machine's business, not this projection's. The counter keeps running on a settled cell for the same reason, and the field name says exactly what it measures.

## Consequences

- An evaluation session's tool card loses four `mission_*` tools and gains `eval_cells`; the 任务 tab is gone from those sessions. Sessions on other presets (standard, and any preset still naming the row) are untouched — the tab and the mission tools are still there.
- `EVAL_TOOL_NAMES` is four names; `@khorsheed/dsh-eval-tool`'s `tools: all` grants four tools, `none` still grants nothing at all.
- `MissionReadFace` now declares optional `attempts` / `currentAttempt` and an optional `enteredCurrentAt` on the status row. Both are optional precisely because the face is structural: a mission service (or a fake) that answers less still satisfies it and simply reports nulls.
- T35b inherits a service verb shaped for the cell list and the cell drawer it has to build, including the `childSessionId` the drawer opens with `sessions.open`.

## Testing

- `packages/eval`: 468 tests green, including six new `eval_cells` cases — the full projection over a two-cell ledger (current attempt's refs and checkpoints, per-namespace annotation counts, the latest session of `refs.sessions`), the pinned-clock durations and the backwards-clock floor, the three filters with `total` / `buckets` unchanged, the annotation fallback for a child session plus the degrade on an unreadable cell, the missing-mission refusal, and the unknown-run passthrough.
- `packages/eval-tool`: 3 tests green, updated to the four names and to the guidance section naming the absent mission tools.
- `check:profiles` (preset rows resolve from the profile's dependencies) and `check:plugins` (33 packages, 0 findings) green; `pnpm gate` green.
