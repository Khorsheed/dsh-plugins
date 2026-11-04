# Agent Note: `local-agent/execution` is registered before anything writes it

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) records each member execution in the member's child session: a start record with its cause and task, and an end record with its outcome and turn range. The host's stored-log reader refuses a log that contains an event type missing from its catalog (`KNOWN_SESSION_EVENT_TYPES`), and the refusal is all-or-nothing: the member's whole history stops loading. If the registration and the first write shipped in one build, rolling that build back would leave logs that the previous build cannot open. So the type has to be registered one release before any build writes it.

## Decision

Step S0 registers `local-agent/execution` and writes nothing.

- **Registration sites.** The same two places as `local-agent/stream`, `local-agent/compaction` and `local-agent/context`, both in `packages/local-agent/src/index.ts`: the module-load loop over the host catalogs (the `@deepseek-ai/dsh-session` root and its `src/known-event-types` source export), and the loader-resolved catalogs at the start of `apply`.
- **Shape.** `SessionEventMap['local-agent/execution']` is `LocalAgentExecutionEvent` (`packages/local-agent/src/types.ts`), a union paired by `executionId`:
  - `start`: `executionId`, `caller` (`tool | composer | room | api`), optional `callerRef`, `operation` (`prompt | compact`), `cause` (`LocalAgentExecutionCause`: `human`, `member`, `help`, `decision`, `execution`, `tool-call`, `restart`), optional `task` (`LocalAgentTaskRef`), `parentSessionId`, `admittedAt`.
  - `end`: `executionId`, `outcome` (`done | failed | cancelled | uncertain`), `turns` (the explicit list of turns the execution wrote), `endedAt`, optional `unrecorded` (`LocalAgentUnrecorded[]`: `internal-calls`, `call-boundaries`, `per-call-usage`, `compaction`), and optional `providerReportedUsage`, the CLI's own whole-round total. Per the user's decision of 2026-11-03 (②), that total is an independent fact to check against the per-call `assistant/message.usage` sum, never a copy of it and never added to it.
  - All of these types are exported from the package root.
- **Never remove this registration** once any build writes the event, and do not rename the type. A later batch-5 step may add optional fields only.

## Placement after `turn/end`

The design flagged an end record written after the execution's last `turn/end` as unprecedented. It is valid. The host's released-log check (`assertReleasedV4Relationships`) runs its lifecycle rules only on its fixed set of relationship types. `local-agent/execution` is not one of them, so the check places no constraint on where it sits: before the first `turn/start`, inside a turn, or after `turn/end`. The member child-log guard also passes it through untouched, because it is not in the guard's `RELATIONAL` set. The vocabulary check that matters is a different one: the stored read path (`restoreReleasedV4Artifact` / the persistence reader) refuses unregistered types. That is the check this registration satisfies.

## Alternatives considered

- **Register and write in the same step (S1).** Rejected: a rollback would leave unreadable member histories.
- **Mark the records `ignorable` and skip registration.** Rejected: the reader would keep the payload uninterpreted, and the design relies on typed reads. It would also be a second mechanism next to the three registered siblings.
- **Put the end record inside the last turn.** Not needed, because the released check accepts it after `turn/end`. A compaction execution writes no turn at all, so the end record could not rely on one anyway.

## Consequences

- Logs written by S1 and later builds stay readable on any build from this one on, including after a rollback of S1+.
- The type is permanent vocabulary. Deleting it later costs every member history that carries it.
- The cause `tool-call` also covers a room's main agent continuing a member directly through `subagent` (user decision ④). Whether that case needs its own kind is left to S4/S5.

## Testing

`packages/local-agent/tests/execution-event.spec.ts`:
- the type is in the host catalog after module load;
- a member log carrying a start record, one round, and an end record after `turn/end` round-trips through the jsonl persistence reader and replays into a session;
- the same log is refused (`SessionFormatUnsupportedError`) when the registration is removed. This is the control;
- the released-log check accepts that log;
- the child-log guard writes both records, including the after-`turn/end` end record and a turnless compaction execution, and diverts nothing.
