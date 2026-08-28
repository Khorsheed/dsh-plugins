# Agent Note: codex exec usage fallback + taskpilot stop compatibility

Status: implemented

[English](2026-08-23-codex-exec-usage-fallback-taskpilot-stop.md) | 中文

## Problem

Two acceptance gaps in the family's delegation accounting and stopping:

1. **Killed/failed codex exec rounds booked zero tokens.** The exec path
   parses usage only from the NDJSON stream's `turn.completed` event. An
   `aborted`/`error` round (e.g. the user kills the delegation mid-run) never
   emits it, so the child session's mirrored assistant message carried no
   usage — the `tokenUsage` projection showed 0 even though codex had written
   the round's real token spend to its rollout file under the scoped home.
2. **The taskpilot Stop button silently did nothing on local-agent rows.** The
   dock's interrupt verb (`/taskpilot-interrupt`) calls `subagents.interrupt`
   (an accepted no-op for one-shot children) and `agent.cancel` — but a local-
   agent member's child session is a pure CLI transcript container with NO live
   dsh agent, so neither lever fired. There was no active-run registry in the
   local-agent core that a stop command could consult, and the family tool
   started its runs directly through `ctx.subagents.start` (not the facade),
   so even the facade's `cancel` map could not see them.

## Decision

### 1. codex exec usage fallback (non-completed terminal states)

`packages/local-agent-codex/src/records.ts` owns the rollout-file vocabulary:
the shared `usageFromCodex` caliber (moved here from the provider, so
`turn.completed` and the rollout recovery can never drift), the
`codexRolloutTokenUsage` tail scan (the last `event_msg`/`token_count` entry's
`info.last_token_usage`, `total_token_usage` fallback, mapped with the exact
`input − cached` buckets), and `codexRolloutUsage` — a locator that walks the
scoped home's `sessions/YYYY/MM/DD/` heads and picks the run's file by THREAD
id (`session_meta` head id — the head parser now accepts the real 0.144 schema
`payload.id` alongside the legacy `session_id`) or, when the stream was
truncated before `thread.started`, by the SPAWN-TIME WINDOW (file start within
`[spawn − 5 min, now + 1 min]`, newest wins).

`mirrorCodexAfterExit` (the exec settle mirror) now takes the spawn moment and,
when the parsed stream has no usage (aborted/error), reads the run's rollout
file tail and attaches the recovered usage to the final mirrored assistant
message. Best-effort and silent: no rollout file, an unreadable home, or a
hard kill that wrote no `token_count` leaves the child without usage, exactly
as before. The live driver is untouched (it already observes
`thread/tokenUsage/updated` during the run, including interrupted turns).

### 2. taskpilot stop compatibility (two-part division)

**local-agent side** (`packages/local-agent`): the facade's private `runs` map
becomes the **active-delegation registry** — in-flight runs keyed by dsh child
session id, now with a public surface:
`trackDelegationRun(childSessionId, run, cancel)` registers non-facade runs
(the family tool's direct `ctx.subagents.start` path) with an explicit cancel
lever, `isDelegationActive` reads the table, and `cancel` aborts the facade
controller or fires the tool lever. Entries clear on `run.result` settle (any
stop reason); a facade entry for the same child wins. The `/local-agent stop
<childSessionId>` command (same `/local-agent` registration, commands seam)
cancels by this table — semantics aligned with the official
`subagents.interrupt(targetSessionId)`: fire-and-return, and an absent target
(unknown child or no in-flight run) is an explicitly-named accepted no-op, not
an error. `local-agent-tool-subagent` now starts each run with a fused
controller and registers it (`trackDelegationRun`), so every tool-started
delegation is stoppable.

**taskpilot side** (`packages/taskpilot`): the `/taskpilot-interrupt` handler
keeps the continuable-child path (`subagents.interrupt`) and the live-agent
cancel, then — for a row with NO live agent — routes the stop through the
commands seam to `/local-agent stop <childSessionId>`
(`ctx.commands.execute`, same lifecycle nodes as any command). When the
local-agent core is absent (the command does not resolve) it degrades to an
explicit `cannot stop subagent …: no live agent to cancel and the local-agent
integration is not mounted` error instead of the old "interrupt requested"
claim. The dock/client is unchanged — it already dispatches
`/taskpilot-interrupt <childId> [parentId]`.

## Alternatives considered

- **Whole-file rollout parse vs bounded tail scan**: parsing every line of
  long resumed sessions for `token_count` was rejected as wasted I/O; the
  tail window (64 KB) catches the last token_count in every realistic layout,
  with a bounded full read only when the tail holds none (one giant trailing
  event).
- **Live-driver-style push usage vs post-exit rollout recovery**: the exec
  wire has no token-push channel (unlike the app-server's
  `thread/tokenUsage/updated`), so recovery from the on-disk record after the
  process exits is the only source that exists at abort/error time.
- **Applying the fallback whenever stream usage is missing vs only on
  aborted/error**: the broader trigger is a strict superset — a completed run
  always has `turn.completed` usage, so the fallback only ever fires on
  non-completed states — and avoids threading the stop reason into the mirror.
- **Moving the family tool onto the facade (reusing `trackRun`) vs a
  registry cancel lever**: the facade `start`/`resume` additionally require a
  live parent agent and the reattach machinery, forcing heavier behavior and
  test changes in the tool path; a public `trackDelegationRun` with an
  explicit lever keeps the tool's own start/staging and lands every run in
  the same stop table with a three-line registration.
- **Direct `ctx.localAgent.cancel` from taskpilot vs the commands seam**: the
  requirement names the command, and the seam gives the visible
  `command/run`+`command/done` lifecycle nodes plus a natural degrade signal
  (`commands.execute` resolving `undefined` when the core is absent).
- **Error vs explicit no-op for an absent stop target**: aligned with
  `subagents.interrupt`'s accepted-no-op semantics, the command reports a
  named no-op success instead of an error; a silent success was rejected on
  both sides (the registry's `cancel` still returns a boolean, and the
  taskpilot degrade path errors loudly).

## Consequences

- A killed or failed codex exec round now books the tokens codex recorded on
  disk (same `input − cached` caliber as `turn.completed`), so `tokenUsage`
  projections stop under-reporting aborted work; the cost is a bounded
  rollout head-walk + tail read only on the non-completed path, and the
  rollout format is a second on-disk vocabulary the adapter maintains (torn/
  malformed lines degrade to no usage, never a failure).
- The active-delegation registry makes every family run — facade- or
  tool-started — cancellable by child session id; `/local-agent stop`
  integrates with any surface (taskpilot first) through the commands seam,
  and its absent-target no-op keeps stop idempotent and safe to fire on
  settled rows.
- Taskpilot rows that previously claimed "interrupt requested" while doing
  nothing now either really stop the family run or report an explicit
  degrade error; a live agent under another parent stays untouched.
- No ownership check beyond the dispatching agent's authority on
  `/local-agent stop` (same as every slash command); the dock only shows Stop
  on the current session's own running lineage rows.
- Real-boot verification of both flows (kill a live codex delegation; stop a
  local-agent row from the taskpilot dock) is 3080 acceptance work.

## Testing

- Unit tests: `records.spec.ts` (caliber buckets, last-token_count tail scan,
  thread-id + time-window locators, real `payload.id` head schema), the
  `codex-cli-provider.spec.ts` abort suite (kill mid-run → the child's last
  mirrored assistant message carries the rollout's last token_count usage
  `{ inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 }`; same via the
  time window when the stream lost `thread.started`), the local-agent
  delegation-facade suite (tool registration, cancel lever, facade-entry
  precedence, auto-clear), the local-agent command suite (`/local-agent stop`
  hit / explicit no-op / usage error), the tool suite (tool-started runs land
  in the registry and a registry cancel settles the run aborted), and the
  taskpilot host suite (seam dispatch + forwarded result, degrade on absent
  core, wrong-parent live agent untouched).
- Suites: local-agent 159/159, local-agent-codex 67/67,
  local-agent-tool-subagent 11/11, taskpilot 37/37; family regression
  (kimi/claude-code/dsh/dsh-headless) green; hygiene + plugin-independence
  gates green; translation pairs re-recorded.
