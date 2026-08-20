# Agent Note: mission — slash command face (milestone M2, first half)

Status: implemented

English | [中文](2026-08-19-mission-m2-slash.zh.md)

## Problem

The [mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) gives the task manager four faces over one service kernel; after [M1](2026-08-19-mission-m1.md) shipped the store, state machine, service face, tools, and CLI, the human-facing slash face was still missing. Milestone M2's first half delivers it: `/mission queue`, `/mission run status|list|create`, and `/mission retry`. Run-bundle export — the proposal's other slash item — stays out of this change and lands with the leak gate in M2's second half.

## Decision

One `/mission` command with handler-parsed subcommands (`src/slash.ts`), after the local-agent family pattern: `input.hint` advertises the subcommands, the handler tokenizes `invocation.rawInput` itself (quote-aware, so `--meta '{"a": 1}'` survives), and usage problems answer with the usage text as a `kind: 'error'` result — the slash face never throws across the command registry. Session context comes from `invocation.agent.session.id`: `queue` defaults to runs whose `originSession` is the calling session (`--all` widens, `--run` names one), `run create` records it as the run's `originSession`, and writes are attributed `slash:<sessionId>` in history — beside `tool:<sessionId>` and `cli`.

Rendering is shared, not copied: `renderStatus` / `rowLine` moved from private CLI helpers to exports (`src/cli.ts`), so `/mission run status` prints the exact table the CLI prints. The queue table (`id / title / bucket / state / plan-blocked / duration`, per-run sections, the held-but-unreleasable warning) follows the proposal's ASCII sketch; its duration column needed one additive projection field, `MissionView.enteredCurrentAt` (epoch ms the current state was entered), emitted by `viewOf` — existing consumers only read the fields they name, so nothing else moved. `plugin inject` gained `commands` (the proposal's declared `inject: ['commands', 'tools']` set, plus the pre-existing `systemPrompt`); the registry is a hard dependency of the command face, while headless profiles simply never dispatch to it — the documented degraded item.

## Alternatives considered

- **One command per subcommand (`/mission-queue`, `/mission-run-status`, …)** — rejected: four registrations for one family pollutes the command namespace; the local-agent precedent already established single-name + `input.hint` + handler-side parsing as the repo pattern for subcommand families.
- **Reusing the CLI's `runCli` as the slash backend** — rejected: the CLI parser is argv/exit-code shaped (process-oriented), while slash needs structured `CommandResult`s and session context; only the rendering functions are genuinely shared, so those were exported and the rest of the slash handler stands on the service directly.
- **Storing `originSession` on missions instead of filtering runs** — rejected: the data model already scopes origin at run level (the implicit run is per-session); a per-mission copy would duplicate derivable state.
- **Shipping `/mission export` here too** — rejected: export carries the leak gate (TTY confirmation, non-TTY refusal) and the expectedNs completeness report; half a gate is worse than none, so export waits for its own M2 slice.

## Consequences

- The four faces are now service / tools / CLI / slash, all over the one `MissionService`; export remains CLI-and-future-slash only, still with no model tool — the initiating-class stance is unchanged.
- `MissionView` gained `enteredCurrentAt`; the wire shape of the store is untouched (projection fields are derived, never persisted).
- On headless profiles `/mission` is registered but never dispatched (no command adapter) — documented in the README Compatibility section and `dsh.compat`; tools, service, and CLI are unaffected.
- Remaining M2: export with the leak gate and the expectedNs completeness report; the run-status expectedNs report rides with that work as recorded in the M1 note.

## Testing

`packages/mission/tests/slash.spec.ts` (19 tests, all fixtures in runtime temp dirs): usage errors (bare `/mission`, unknown subcommand, value-less flag, missing RUN_ID/MISSION_ID/--template, unknown bucket, invalid `--meta` JSON); empty states (queue with no session runs, run list with no runs); the queue table's five buckets with plan/blocked and duration cells; the session-scoped default vs `--all` vs `--run`; the held-but-unreleasable warning; `run create` recording `originSession` and meta, lint-error refusal; retry opening a fresh attempt, caller attribution, and `--run` disambiguation. The M1 service-face test now also asserts the `mission` command registers through `apply`. All 67 package tests pass (48 M1 + 19 new).

## Cross-references

- [Mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) — §5 interface faces and the queue ASCII sketch this implements.
- [mission M1](2026-08-19-mission-m1.md) — the store/engine/service/tools/CLI milestone this builds on.
