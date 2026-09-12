# Agent Note: Delegated child sessions reattach on the tool path and persist explicitly

Status: implemented

## Problem

A production review session (session-e19a1be9, host restarted 19:14 by the watchdog) surfaced two independent durability defects in delegated CLI child sessions, on top of the live-render gap fixed in [the step-boundaries note](2026-09-12-local-agent-mirror-step-boundaries.md):

1. **Resume after a restart failed with "not live".** A host restart evicts every child session from the in-memory store. The facade's `resume` reattaches from persistence, but the family subagent tool (`subagent_codex` & kin) starts runs directly through `ctx.subagents.start` — the file says so itself — so no reattach ever ran and the provider refused the resume.
2. **Child session logs never grew past their header.** Every delegated child log on the prod instance (six examined, pre- and post-restart) held exactly one header line. The host routes live `session/event` appends into the per-id writer only while a WRITE handle is open, and drains it on `session/flush` checkpoints; a mirror session has no agent loop, so nothing ever checkpoints it. The providers' `persistIfStandalone` skipped live sessions on the assumption that "a live session's own write-behind stores every appended event" — an assumption that is false for loop-less mirror sessions on host 0.1.5/master. Whatever the user saw live was gone from disk forever.
3. **Every CLI failure read "subagent run failed".** The seam carries provider-authored failure detail in `SubagentResult.diagnostic`, but the codex provider never supplied one and the tool's error mapping dropped the field — a transient codex outage (three exit-0 runs with `last_agent_message: null` in their rollouts) was indistinguishable from a real defect.

## Decision

- **Reattach on the tool path.** The registry exposes `ensureChildLive(childSessionId)` — the public, idempotent entry of the facade resume's reattach recipe — and the subagent tool calls it (duck-typed for older cores) before staging a resume intent.
- **One registry-owned write handle per child session.** `LocalAgentRegistry` holds a `childWriteHandles` promise cache as the single owner of each child's write handle; the reattach recipe was refactored onto it (a second open fails `SessionAlreadyOwnedError`), and all handles close on plugin dispose. `syncChildSession(session)` syncs through the cache: read the stored prefix, append only the missing suffix (idempotent under repetition and under a working write-behind), flush; any failure downgrades to a warn — persistence must never fail the round. Providers call the core's `persistChildSession(ctx, session)` after every mirror pass instead of their own `persistIfStandalone`, and no longer create (and leak) their own persistence handles at delegation start. The standalone fallback keeps the one-shot handle flow but drops the live-session skip: a stored-prefix read makes the suffix append a no-op exactly where write-behind works.
- **Diagnostics travel the seam.** The codex provider passes `collectDiagnostic` to `settleRunResult` — the failure's own message, the stderr tail, and the rollout path (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`, or the directory when no thread id streamed) — and the family tool renders `subagent run failed: <diagnostic>` instead of the bare generic line.

## Alternatives considered

- **Wait for an upstream write-behind for loop-less sessions** — the flush/checkpoint architecture is deliberate host design (checkpoint policy owns durability timing); a mirror session is a plugin-side concept, so the plugin owns its durability. The suffix sync also works *today*, on every host line.
- **Always-manual persistence (no registry cache)** — a per-call `open('write')` collides with the reattach-held handle (`SessionAlreadyOwnedError`) and with itself under concurrent mirror passes; the single-owner cache is what makes the sync safe.
- **Leaving errors generic / putting rollout paths in the host log only** — the agent (not a human reading logs) is the consumer that must decide retry vs. substitute; the diagnostic field exists for exactly this and the tool was the only thing dropping it.
- **Retro-recovering the lost transcripts** — impossible: the events were never written anywhere. The CLI-side rollouts survive (codex's own files), so CLI-thread resume still works; the dsh-side child log simply starts from the next round.

## Consequences

- Resume of a delegated child works across host restarts from every entry point (facade, tool, member composer). The dsh-side log of a pre-fix child starts empty (its events were never written); the CLI thread itself is intact, so conversation continuity is unaffected.
- Child session logs grow as rounds run — visible in the subsession view after any reload, and resume-reattach restores real history instead of an empty shell.
- One more observable behavior: kimi/claude/dsh live rounds now persist DURING the run (the old code skipped live sessions entirely), not only at settle.
- Error results name the failure and point at the rollout file; transient CLI null-completions become distinguishable from real defects without host-log access.
- The double-write race (a repaired future write-behind draining alongside the sync) resolves to a warn + self-heal on the next sync, never corruption: the suffix is empty once the stored prefix covers the snapshot.

## Testing

`child-session-sync.spec.ts` (core): live sync lands events, repeat sync is a no-op append, reattach + sync share one handle (no already-owned), failures warn-and-retry. Tool specs: reattach recipe runs before staging a resume (open + enter asserted), provider diagnostics surface in the error text. Codex provider spec: the settle diagnostic names the exit code and the rollout directory. Full family suites green (local-agent 230, tool-subagent 17, codex 166, kimi 186, claude-code 153, dsh 147).

## Related

- [Local-agent child-session mirrors emit step boundaries](2026-09-12-local-agent-mirror-step-boundaries.md) — the live-render half of the same incident.
