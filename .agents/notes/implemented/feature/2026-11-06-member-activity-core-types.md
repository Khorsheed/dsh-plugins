# Agent Note: Member background activity: core types and the Kimi task read

Status: implemented

## Problem

Two approved designs from 2026-11-06 share one core foundation. Neither design is in the repository; both sit under `proposals/active/`:

- `2026-11-06-member-self-started-rounds.md` (step M1). A Kimi member's background task can finish while the member is idle. Kimi then opens a round on its own. That round needs to be an execution with a recorded cause. The room also needs to see the member's background tasks.
- `2026-11-06-member-cli-subagents.md` (step M0). Subagents that a member's CLI runs itself become grandchild sessions under the member. Each one runs as an execution with a cause, and its usage counts toward the member's execution.

Both designs add the same caller value. Each adds one cause kind. Each adds read shapes that later steps fill in. The user decided on 2026-11-06 to take every recommendation in both designs. This step lands only the shared vocabulary and the read-only task listing. It adds no event type, no watcher and no lost detection.

## Decision

**Vocabulary** (`packages/local-agent/src/types.ts`). Every addition is an optional value or field on a type that is already registered:

- `LocalAgentExecutionCaller` gains `'cli'`. Both designs use this one value. `cause.kind` tells the two uses apart.
- `LocalAgentExecutionCause` gains two kinds:
  - `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId?, startedBy? }` for a round the CLI opened itself.
  - `{ kind: 'cli-subagent', sessionId, callId, executionId?, name?, group?: { index, size }, background?: true, resumed?: true }` for one execution of a CLI subagent.
- `LocalAgentBackgroundTask` holds `id`, `label`, `command?`, `kind: 'shell' | 'agent'`, `startedAt`, `endedAt?`, `state`, `exitCode?`, `startedBy?`, `lostBecause?`, `resultIn?` and `subagentSessionId?`.
  - `state` is a `LocalAgentBackgroundTaskState`: `running | completed | failed | timed-out | stopped | lost`.
  - `lostBecause` is one of `host-restart | process-reclaimed | process-exited`.
  - `subagentSessionId` comes from the note in the subagent design: a Kimi background subagent is the same task as its `kind: 'agent'` entry.
- `LocalAgentBackgroundTasks` is `{ supported, tasks, processAlive, keepAliveUntil? }`. `supported: false` means the room shows nothing at all, not "0".
- `LocalAgentExecutionReading` gains `subagents?: LocalAgentExecutionSubagentReading[]` and `subagentUsage?`. Each subagent reading is `{ sessionId, executionId, name?, callUsage?, calls, providerReportedUsage? }`.

**Ledger** (`member-inbox.ts`). `cli` joins `CALLERS`, so a `cli` row validates. After a restart, a running `cli` row turns `uncertain` like a row from any other caller. That restart rule for self-opened rounds is unchanged in this step; it belongs to M4.

**Readers** (`execution-read.ts`, exported from the package root). All three are pure functions:

- `executionOfToolCall(events, callId)` follows recorded facts only. It finds the `assistant/message` that holds the `tool-call` block, takes its turn, then takes the prompt execution whose turns include that turn. If any link is missing, it returns `undefined`.
- `selfExecutionOfTask(events, taskId)` returns the `self` start record that names the task.
- `subagentReadingsFor(executionId, grandchildren)` collects grandchild executions whose `cli-subagent` cause names the member execution. Its `subagentUsage` adds only per-call usage. A subagent's CLI-reported total stays on that subagent's own entry. `readExecution` does not call it yet; that wiring is M6.

**Harness seam** (`index.ts`, `gateway.ts`):

- The harness method `backgroundTasks?(request)` is optional. Its request `LocalAgentBackgroundTasksRequest` carries `childSessionId`, the member's `homeDir`, `cliSessionId?`, and two async lookups over the member's child log: `executionOfCall(callId)` and `selfExecutionOf(taskId)`. The core reads the child log lazily, only when the harness calls a lookup. It reads the live snapshot if there is one, otherwise it reads once from storage.
- The registry method `memberBackgroundTasks(childSessionId)` returns:
  - `null` for a session that is not a member, or when the read throws (the error is logged).
  - `{ supported: false, tasks: [], processAlive: false }` for a harness without the method.
- The gateway Remote `memberBackgroundTasks` follows the same pattern as `memberTools`.

**Kimi** (new file `packages/local-agent-kimi/src/background-tasks.ts`, registered in `index.ts`; `live-driver.ts` is untouched):

- `readKimiBackgroundTasks(sessionDir, lookups)` reads `agents/main/tasks/*.json`.
- Kind mapping: `process` becomes `shell` and `agent` becomes `agent`. Other kinds are skipped, for example the `question` records written for ask-user. Tasks with `detached: false` are foreground and are skipped too.
- State mapping: `timed_out` becomes `timed-out`, and `killed`/`cancelled`/`stopped` become `stopped`. An unknown status is not listed. A `lost` that Kimi itself wrote is passed through, and no `lostBecause` is invented for it.
- The list holds running and lost tasks, plus tasks that ended within the last hour, oldest first.
- The wire is read only when a listed task's state file has no `parentToolCallId`. The `task.started` lines supply it, and lines are pre-filtered by substring.
- `startedBy` comes from `executionOfCall(parentToolCallId)`. `resultIn` comes from `selfExecutionOf(id)` and only for tasks that have ended.
- The harness reports `supported: true` only while the member's live setting is on. `kimi -p` exits with its round. `processAlive` is the live driver's `hasRuntime(childSessionId)`.

## Alternatives considered

**The harness resolves `startedBy` itself.** The harness would read the dsh child log on its own. Each harness would then need its own access to session storage and its own copy of the turn-range logic. The core already owns the child log and `executionReadingsOf`, so it passes lookups instead. The Kimi reader stays a pure function of files plus callbacks.

**A static `backgroundTasks?: 'live'` declaration next to the method.** The design names the declaration and the method under the same field name. One optional method covers both jobs. If the method is absent, the harness has no background tasks. If it answers `supported: false`, the harness has them but not in its current way of running (Kimi exec). A static flag cannot express that second case.

**Fill `subagentSessionId` now from the agent task's `agentId`.** The grandchild session id is deterministic (`<member>.sub.<agentId>`). The session does not exist until subagent step M3, though, and naming a session that does not exist would be a guess. The field stays type-only.

**Fill `resultIn` for a result that folded into another round.** Doing so needs the wire's in-round `context.append_message` notification mapped onto a dsh turn. The 11-01 fold and step M4 both change that turn numbering. For now only a recorded `self` execution fills `resultIn`.

## Consequences

- No event type is added, so no registration has to ship first. Old readers see `caller: 'cli'` and the two new cause kinds as an unknown cause. The Context Lens cause line falls back to the raw kind string until lens step M8.
- **Rollback hazard (correcting the design).** The self-started-rounds design says an older core "drops" `cli` ledger rows. It does not. `validRow` rejects the whole ledger file ("Invalid member inbox; admission is blocked"). This step writes no `cli` rows, so nothing is at risk yet. Once M4 writes them, rolling the core back past this step blocks that member's ledger until the row is removed. Family packages must still deploy together.
- Room keeps its own copy of the caller union for its restart-recovery line (`packages/room/src/client/member-recovery-view.ts`). That copy gains `'cli'`, and `recovery.member.caller.cli` gets zh/en text, so a future `cli` row renders words instead of a raw key.
- Nothing calls `memberBackgroundTasks` yet: the room tray is M2. The Remote and the Kimi reader are exercised only by tests.

## Testing

- `packages/local-agent/tests/execution-read.spec.ts`:
  - A `cli`/`self` execution reads like any other.
  - The tool-call → turn → execution chain resolves, and missing links answer `undefined`.
  - `selfExecutionOfTask` finds the right start record.
  - `subagentReadingsFor` filters by execution, keeps the CLI total apart, and sums per-call usage only.
  - The registry's `memberBackgroundTasks` returns `null` for a non-member, an unsupported answer for a harness without the method, and resolves both lookups against a live child log.
- `packages/local-agent/tests/member-inbox.spec.ts`: `cli` rows validate, a running `cli` row turns `uncertain`, and an unknown caller still invalidates the ledger.
- `packages/local-agent-kimi/tests/background-tasks.spec.ts`: synthetic `tasks/*.json` and wire lines only, nothing copied from a real session. It covers state and kind mapping, the recent-window filter, skipped records (question, foreground, unknown status, a half-written file, an output directory), labelling from the command, a session with no tasks directory, and `startedBy`/`resultIn` resolved through the real core readers. The `startedBy` cases include the wire fallback for a missing call id.
