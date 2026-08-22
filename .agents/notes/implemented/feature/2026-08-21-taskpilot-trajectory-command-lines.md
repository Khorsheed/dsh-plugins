# Agent Note: taskpilot trajectory start rows carry the issued command

Status: implemented

[English](2026-08-21-taskpilot-trajectory-command-lines.md) | 中文

## Problem

The job detail drawer's execution trail is folded from the session log, but a
background bash start produced a single thin row: the tool ack text is literally
`started background job bash-1` — no command, no context. Users reported that the
trajectory for a bash job showed "only started background job bash-1".

## Decision

The start row now renders the command exactly as the model issued it, recovered
from the `tool/call` arguments already in the session log (never from the host's
consuming read cursor):

- title: `HH:MM:SS bash-1 started · <command>`, with the command clipped to 80
  chars plus an ellipsis;
- expandable detail: a command block (`$ <command>`, `workdir:`, `description:`)
  followed by the ack text;
- a missing or empty paired ack (page split, compaction) still mints the start
  row when the call arguments prove a background start of this job.

The full raw stdout of a background job is deliberately still not fetched: the
host registry exposes stream output only through the single consuming cursor
`jobs.read`, which the model's own `job_output` calls share; a UI read would
silently steal the output the model is about to collect. That constraint is
unchanged and documented in the README's known limitations.

## Alternatives considered

- **A host half that reads `ctx.jobs.read` for the drawer** — rejected: for
  stream kinds (bash) the read consumes the delta and marks the job reported,
  stealing output from the model's next `job_output` and mutating notice
  semantics; the registry has no non-consuming peek.
- **Show nothing new** — rejected: the command and parameters were already in
  the log and cost nothing to render.

## Consequences

- A richer, still model-perspective trajectory: the command and parameters are
  visible even when the model never surfaced output, while the output itself
  remains exactly what the model read (or the completion notice's status).
- No side effects on the job registry or the model's read cursor; the fold stays
  a pure function over the durable log, so compaction degrades it to fewer rows,
  never a throw.
