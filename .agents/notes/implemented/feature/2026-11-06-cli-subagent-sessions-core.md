# Agent Note: CLI subagents as grandchild sessions: the core writer

Status: implemented

## Problem

A member's CLI can run subagents of its own. Kimi has `Agent` and `AgentSwarm`; Claude Code has `Agent` (formerly `Task`). Today none of that work reaches dsh. The member session shows a plain tool row, the host lineage dropdown has nothing below the member, and the subagent's usage is invisible.

The approved design `proposals/active/2026-11-06-member-cli-subagents.md` (not in the repository) mirrors each subagent as a grandchild session under the member. Its step M0 already landed the vocabulary; see [the core types note](2026-11-06-member-activity-core-types.md). This note covers step M2: the shared core writer that the Kimi (M3) and Claude Code (M4) integrations will call.

The user's decisions of 2026-11-06 that apply here:

- A reused Kimi subagent is one session. Each reuse is one more execution and one more round in it.
- Old logs are not backfilled.
- Tool results are truncated by the same rules as the member mirror.

## Decision

A new module `packages/local-agent/src/cli-subagent.ts` is exported from the package root. It writes; it does not discover. Each provider parses its own CLI records and calls it.

**Session.** `openCliSubagent(ctx, member, { provider, key, name?, description? })` returns a handle.

- The id is deterministic: `cliSubagentSessionId(member, key)` = `<member child id>.sub.<CLI subagent id>`. A replay after a restart finds the same session without a mapping file.
- The lookup order is live, then stored, then new. A live session is reused. A stored session is reattached through the core's `ensureChildLive`, which also closes a turn the restart left open. Only an absent session is created.
- A new session's header carries the host-native parent link, built the same way as the member's own child session: `parentSession` is the member's child session, `origin` is `'subagent'`, `delegationDepth` is the member's depth + 1, and `cwd` is the member's.
- The grandchild gets one `subagent/descriptor`: one-shot, the member's delegation provider, and the label `<type>: <description>`.
- The member session gets one `subagent/catalog` row with the exact payload of the host's `establishCatalogChild`: `{ version: 0, childId, childCreatedAt, mode: 'one-shot', label? }`. The row is written only when the member log holds none for this child. The grandchild is stored before the member, so a reader that follows the row finds the session.
- The grandchild passes the core's child-log guard and persists through the core's cached write handle, the same path as the member.
- Concurrent opens of one key share a single opening. The in-flight map lives on `globalThis`, because each provider bundle carries its own copy of the module.

**Execution.** `handle.beginExecution({ callId, memberExecutionId?, group?, background?, resumed?, transport?, admittedAt? })` covers one member call.

- It writes a `local-agent/execution` start with caller `cli`, operation `prompt`, `callerRef` = the call id, and `parentSessionId` = the member's child session.
- The cause is `{ kind: 'cli-subagent', sessionId, callId, executionId?, name?, group?, background?, resumed? }`.
- The member's execution is resolved from recorded facts. An explicit `memberExecutionId` comes first. Next is `executionOfToolCall`, the execution whose turns hold the mirrored call. Last is the member's open prompt execution: a live mirror may write the subagent before the member's own tool call. The member execution's `task` is copied verbatim, so a per-task sum includes the subagent unchanged.
- The same call id returns the execution its earlier begin wrote; no second start is written. This makes a replay idempotent.
- A new call id first ends any execution the grandchild log still holds open, as `uncertain`. A CLI resumes only an idle subagent, so the old call cannot still be running.

**Writing.**

- `execution.mirror(unit, source)` writes the open turn's next step through `appendMirrorStep`, opening a turn when none is open. `beginTurn()` and `closeTurn(stopReason)` are there for providers that cut turns themselves; Kimi has one `turn.prompt` per turn.
- `execution.end(outcome, { providerReportedUsage?, unrecorded?, endedAt?, errorMessage? })` closes an open turn first. `done` closes it as completed, `failed` as an error, and `cancelled`/`uncertain` as aborted.
- The end record then follows. Its turns are the `turn/start`s after this execution's start, up to the next start. Its `unrecorded` list is the member harness's declaration for the call's transport unless the caller overrides it. Its `providerReportedUsage` is the CLI's own total for the call, and that total is never added to the per-call usage.
- After the end record, the grandchild is persisted. Every write after the end is a no-op.

The grandchild's start record is written by this module. It does not go through the member's turn hook (`beforeMirrorTurn`), because a grandchild has no admitted execution of the core's own. For an unregistered session that hook is a no-op anyway.

## Alternatives considered

**One session per call, including Kimi reuse.** The user decided against it. A reused Kimi subagent's context accumulates; split sessions would make later calls appear to know things from nowhere.

**Execution ids derived from the call id.** A random id plus a lookup by `cause.callId` gives the same idempotency. It also keeps the start record's shape identical to every other execution, and it does not tie the id format to any CLI's call id syntax.

**Resolving the member execution by time.** Rejected, as everywhere in batch 5. The open-execution fallback is still a recorded fact: the call is being mirrored while its round's start has no end.

**Importing `establishSubagentCatalogChild`/`persistChildSession` from the core entry.** Importing them would make a cycle through `index.ts`, whose top-level await makes cycles fragile. The catalog payload is inlined; it is the same six lines and is pinned by the test against the host listing. The registry is reached structurally through `ctx.get('localAgent')`.

## Consequences

- No event type is added. The `subagent/catalog`, `subagent/descriptor` and `local-agent/execution` types are all registered already.
- Nothing calls the module yet. Kimi (M3) and Claude Code (M4) will.
- Context Lens still stops at depth 1 (`store.ts`) until M7. The host lineage dropdown reads the grandchild already, because it walks catalogs recursively.
- Without the local-agent registry (a bare host in a test), the module still writes in memory, but it neither guards nor persists.
- A throw from `openCliSubagent` (no sessions service, a failed reattach) is the provider's to degrade. A missing subagent mirror must never fail the member's round.

## Testing

`packages/local-agent/tests/cli-subagent.spec.ts` uses synthetic inputs only. A fake family provider runs member rounds through the real core admission and the shared mirror writer.

- **One session per key.** Concurrent opens share one handle, and a later open finds the same session. Covered: the header link (depth 2, parent = the member), one descriptor, and one catalog row whose payload equals the host's, key for key. Both logs are stored.
- **One execution per call.** A repeated begin for the same call writes no second start. The start record is checked whole (caller, cause with the member execution and group, copied task, parent), and so is the end record (turns, the live declaration, the CLI total). Steps go through the mirror writer, writes after the end are no-ops, and `subagentReadingsFor` reads the execution under the member's execution.
- **Reuse.** In a later member round, the same session gets one more execution and turn (`[1]`, then `[2]`), marked `resumed` and `background`, with the second member execution as owner. There is still one catalog row and one descriptor.
- **Fallbacks.** A call not yet mirrored resolves to the member's open execution. A new call over a still-open execution ends the old one `uncertain`, and its open turn closes aborted. With no name and no description, no label is written.
- **Restart.** A second stack is mounted on the same storage. The grandchild is reattached, not recreated, and a replayed call returns the stored execution id.
- **Host lineage.** The host's real `SubagentRuntime.listDescendants` walks room → member → subagent at depth 2.
- In every stored-log case, the grandchild passes `assertReleasedV4Relationships`, and nothing lands in the quarantine.
