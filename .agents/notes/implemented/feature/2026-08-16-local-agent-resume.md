# Agent Note: CLI sub-agent resume for the local-agent family — family tool + localAgent carrier

Status: implemented

English | [中文](2026-08-16-local-agent-resume.zh.md)

## Problem

The official `subagent` continuable capability (`prepareContinuable` + continuation manager) is **Agent-typed only**: `send_message`/`interrupt_agent` (tool-subagent-control) operate on the `AgentHandle` held by the continuation manager via `ctx.subagents.followup`/`interrupt`, while the CLI sub-agents (kimi/codex/claude) run through the out-of-process one-shot provider — no local Agent, no inbox, no `ctx.agents.create()` Activation ownership contract (upstream `subagent/README.md:147` only mentions that ACP `prepareContinuable` needs "provider-specific descriptor data" to persist a remote session id, but the descriptor schema strictly rejects unknown fields and that contract is missing upstream). The CLI providers therefore cannot plug into the official continuable seam — this is why option 1 was excluded.

## Decision

Adopt option 2: manage resume outside the official seam, inside the family.

- **Family tool**: each bundle's patch replaces the official `@deepseek-ai/dsh-tool-subagent` row with `@khorsheed/dsh-local-agent-tool-subagent`; `toolName` unchanged (`subagent_kimi`/`subagent_codex_local`/`subagent_claude_code_local`); schema = the official subset (`description`/`prompt`) plus an optional `resume?: string` whose value is the dsh child session id returned by the first delegation.
- **Prompt-embedded handles are forbidden**: task text is untrusted — a forged resume would hijack another session's context. The tool reads only the `resume` parameter and never extracts a handle from the prompt.
- **Carrier verdict**: `descriptor.ts`'s one-shot keys are strictly `version/mode/provider/label` and `assertKnownKeys` throws on unknown fields — the descriptor schema cannot hold a resume target. The target therefore travels inside the family via the **localAgent service**: a delegation registry (child session id → CLI session id + parent + provider) plus a per-(parent, provider) intent FIFO.
- **Resume rounds still go through `ctx.subagents.start()`**: lifecycle events (`subagent/start`/`subagent/end`) and sub-agent rendering stay unchanged; the provider consumes exactly one intent at the top of `start()`; a resume intent reuses the same child session and appends a new round with an incremented turn.
- **Per-round accounting**: turn number increments; `turn/start` + `turn/end` pair per round (subagentTiming accumulates per round); usage hangs on the current round's assistant message (tokenUsage deduped by turn/step); the kimi wire.jsonl mirror becomes incremental (the registry records a `kimiMirroredLines` offset; resume mirrors only the delta).
- The first delegation's result text self-describes `追问请带 resume="<childSessionId>"` (run.id == child session id, the seam's local-run contract).

### Registry and provider details

- `LocalAgentRegistry` additions: `recordDelegation` / `resolveDelegation` (rejects forged handles: unknown child session, other parent, wrong provider) / `stageDelegationIntent` / `takeDelegationIntent` (FIFO; exactly one staged per tool call, exactly one consumed per start) / `acquireResumeLock` / `releaseResumeLock` (per-child resume mutual exclusion) / `kimiMirroredLines` / `setKimiMirroredLines` / `listDelegations`.
- The three providers' `start()` splits fresh/resume: resume reuses the child session via `sessions.get(childSessionId)` (fail loud when missing), `nextTurn = turn/start count + 1`, spawns the resume command (kimi `-S session_<id> -p`, where `-S` must precede `-p`; claude `-p --resume <id>`; codex `exec --json resume <thread_id>`, thread_id from the `thread.started` event), and returns `id: childSessionId`.
- **Resume concurrency boundary**: resumes of the same child session must serialize — the per-child mutex lives in the framework registry (the same layer as the delegation registry; the future stop registry reuses it). The provider takes `acquireResumeLock(childSessionId)` before spawn and fails loud when unavailable (该子会话有进行中的委派，等其完成后再追问) — no silent queueing; the model sees an explicit error and retries itself. The lock releases on `run.result`'s settle path (completed/error/aborted all resolve through result) and on the start exception path, so no deadlock remains. Fresh delegations take no lock (each mints a new child session, naturally conflict-free).
- After a fresh round settles, the cliSessionId is recorded (kimi from the stderr hint, claude from the result JSON `session_id`, codex from the NDJSON `thread_id`).
- Tool package `@khorsheed/dsh-local-agent-tool-subagent`: injects `['tools','subagents','localAgent']`; `execute` first `resolveDelegation`-validates then stages, then calls `ctx.subagents.start()` as usual; fresh rounds append `追问请带 resume="<run.id>"` to the result output.

## Alternatives considered

### Why not the official continuable seam (option 1)?

The seam is Agent-typed: it operates on the continuation manager's `AgentHandle` via `ctx.subagents.followup`/`interrupt`, but CLI sub-agents are out-of-process one-shot providers without a local Agent, inbox, or `ctx.agents.create()` Activation ownership. Upstream's ACP `prepareContinuable` mentions persisting a remote session id via "provider-specific descriptor data", yet the descriptor schema strictly rejects unknown fields and the contract is missing upstream — the resume target cannot ride the descriptor. Option 1 was excluded.

## Consequences

- The family owns resume end-to-end: one tool package, three providers, one registry; lifecycle events and rendering stay on the official seam, so nothing user-visible changes.
- Security posture: the handle is a first-class parameter, never prompt-extracted; the registry rejects forged handles at resolve time.
- Resumes are serialized per child session with explicit fail-loud errors; no queueing, no deadlock (lock release covers every settle path).

## Testing

- Live verification of all three resume commands: kimi `-S session_<id>` (42 remembered), claude `--resume <id>` (42), codex `exec resume <thread_id>` (same thread returns).
- Tests: core delegation registry (forged-handle rejection, FIFO pairing, mirror offset, resume-lock mutual exclusion / independence across child sessions / release with no side effects); tool package, 10 cases (schema with resume, fresh self-describing handle, resume target passing, forged handle isError, prompt-embedded handle ignored, mount/unmount); the three providers' resume tests (resume argv, child session reuse, turn 2, missing child session fail loud, a second concurrent resume of the same child session rejected with zero spawn, lock released after settle allowing resume again).
- `pnpm typecheck` green; `pnpm test` green; `verify-translation-pairing` 31 pairs in sync.

## Sub-session record fidelity batch (harness-comparison prerequisite)

Goal: the three children's session records reach fidelity comparable enough for comparison, with all fixtures taken from this round's real wire/NDJSON/stream-json samples:

- **kimi usage becomes a sum**: each `usage.record` entry is the caliber of one LLM request (measured on a real two-round resume session, 8 records: round 1 three — 4027/7855/2799; round 2 five); the mirror sums every record in the delta and hangs it on the current round's last assistant message. `session-view` now outputs `usageRecords` (with transcript line positions); the mirror sums by offset.
- **Turn alignment fixed**: the wire's `turnId` (loop event) IS the dsh round number (1-based); the mirror uses `line.turn` directly instead of inferring from the user line count — with system-reminder filtered out, user counting was unreliable.
- **Resume duplicate-mirroring fixed**: root cause — `kimiMirroredLines` lived in the delegation record, which depended on stderr-hint parsing; when the hint was missing the offset was never written and resume fell back to `fromLines=0`, mirroring the first round twice. Fix: the offset becomes an independent `kimiMirrorOffsets` map (decoupled from delegation records), and resume's session id uses the intent-recorded value rather than re-parsing stderr. Regression test: after mirroring a real two-round fixture there is no duplicated assistant text and the usage sum is correct.
- **system-reminder filtered**: kimi auto-permission mode's `<system-reminder>` user messages do not enter the child session (the real wire carries them every round).
- **Tool lines carry parameters**: `tool.call.args` renders as `[工具 WebSearch] 查询词`; `tool.result` is matched back to its own call by `parentUuid`/`toolCallId` (parallel calls no longer mismatch), falling back to the nearest tool line when no id is present.
- **codex mirrors all events**: `reasoning`→reasoning blocks, `agent_message`→text, `command_execution`/`web_search_call`/`function_call_output`→tool lines; the final `agent_message` is the run output, usage on the last entry. The stream is naturally incremental per round.
- **claude switched to stream-json**: argv is now `--verbose --output-format stream-json` (the CLI forces `--verbose` for `--print` + stream-json); parses system/assistant/user/result events; `thinking`→reasoning blocks, `tool_use` + `tool_result`→tool lines, `text`→replies; session_id from the system init, usage from the result event.

## Abort-chain fix for one-shot delegation (dead-wait + content preservation)

**Dead-wait root cause (confirmed by the 3080 live postmortem)**: when the parent round aborts, the three providers' `requestCancel` only flips the `runAbort` flag — the `attempt` race had only the `child.done`/`processFailure` branches, both of which wait for the child to exit before settling, and `settleRunResult`'s `cancelled()` is checked *after* `await attempt()`, so the result never settles on abort. The kill-process `dispose` (SIGTERM→grace→SIGKILL ladder) is ordered after result settle → dead-wait; the CLI child never receives any signal. kimi/claude only *looked* stoppable because they happened to finish fast naturally; a long codex request hung 3.5 minutes with the parent round stuck.

**Official contract basis**: `out-of-process.ts`'s `subprocessRunHandle` comment states dispose's job — "removes the abort listener, settles local cancellation — there is no assumption the child cooperates — and then awaits the backend's teardown to actual exit". That is, `requestCancel` settles the result **immediately** and teardown kills asynchronously. This fix aligns with that contract: the three providers' attempt race gains an `abortBranch` (rejects on `runAbort`), `settleRunResult` observes `cancelled()` and settles `'aborted'` right away; process killing stays in dispose's ladder.

**Abort preserves content too**: mirror/writeback previously ran only on `completed`; an aborted round wrote only `turn/end` — the child session was blank with zero tokens even though the CLI side had produced content (kimi/claude's naturally completed full answer was discarded). Now mirror/writeback hangs on `result.then(() => child.done).then(...)` — first let the settle chain write `turn/end`, then wait for the child's real exit (stdout/wire fully received), then write back the produced content and usage regardless of stopReason (kimi reads wire, codex parses the received NDJSON, claude parses the received stream-json); the `turn/end` reason stays aborted/error. kimi's mirror offset, codex's threadId, and claude's sessionId are recorded on abort/error rounds too, so partial results remain resumable. **Note**: the mirror chain must hang on `result.then(() => child.done)` and not directly on `child.done.then` — a direct hang appends before the settle chain writes `turn/end`, leaving the persistence batch without `turn/end`.

Acceptance criteria for the fix: after a parent-round abort the tool result returns in seconds (the result settles `'aborted'` immediately); the child exits within dispose's SIGTERM→grace→SIGKILL ladder; the aborted round's child session contains the produced content + usage + the correct aborted/parent `turn/end`; dispose is idempotent when the process already exited. The test uses a 10-minute fake CLI (`done` never self-resolves; `terminate()` releases it), verifying <1s settle after abort, dispose kills the process, idempotency, and content preservation on the aborted round.

## Deferred

- The stop registry will share the same record structure as the delegation registry (registration of active child processes).
- The delegation stall timer, when it lands, should reset per round.
- The official `settleRunResult` defect (await `attempt()` before checking `cancelled()`) still awaits an upstream fix — abort cannot break a pending `child.done` race.
