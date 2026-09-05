# Agent Note: local-agent observed model readback and delegation cwd

Status: implemented

English | [中文](2026-09-06-local-agent-observed-model-cwd.zh.md)

## Problem

The web-eval frozen baseline (decision 5) requires proving that the model a delegation actually ran with equals the declared one, and the orchestrator (I2) must give each evaluation cell its own working directory. Neither was possible: all four providers' output streams carry model identifiers that nobody recorded (and codex's stream carries none at all — only its on-disk rollout does), and every CLI round ran in the parent session's cwd with no override, so four cells doing the same task shared one directory and became competitors rather than replicates.

## Decision

- **Observation channel.** The registry gains `recordRoundSettled(childSessionId, { observedModel?, usage? })`: providers call it once per settled round at the point their output is fully parsed. It merges `observedModel` into the delegation record (in memory and `delegations.jsonl`, same last-wins append) and reports a new `LocalAgentRunProgress` variant `{ kind: 'settled', observedModel?, usage? }`. Absent fields stay absent — absence is recorded, never guessed. A round with no record yet still reports the event; nothing else about the record changes.
- **Read side.** `delegationOf(childSessionId)` returns the record WITHOUT the CLI-session resume handle (`LocalAgentDelegationInfo`), so the orchestrator can read a cell's observed model and first-round cwd while the resume handle stays a first-class parameter plus the intent channel.
- **Per-provider sources, pinned against the real CLIs.** claude: the stream-json `system` (init) event's `model` (plus a `result`-event fold for future CLIs); codex: the located rollout file's LAST `turn_context` line inside the round's spawn window — the exec --json events of codex 0.144.0 carry NO model, so the same rollout locator that recovers usage now also recovers the model, with the parser still folding a stream-named `model` if a future CLI emits one; kimi: the wire.jsonl `usage.record`'s `model` (falling back to `llm.request`'s), last one seen; dsh: the sub-dsh session's own `assistant/message` `message.source`, formatted `provider/model` to match the effectiveSettings snapshot's shape. `observedModel` never enters any prompt or model-visible face.
- **cwd override.** `DelegationCallOptions.cwd` rides the staged delegation intent (the host `SubagentStartRequest` seam stays untouched) and resolves through the shared `resolveChildCwd(parentCwd, override)` — the override position the official ACP provider's seam reserves. The first round's resolved cwd is recorded in the delegation record (`cwd` field); a resume round whose effective cwd differs from the recorded one is rejected by the shared `assertResumeCwdUnchanged` BEFORE any process spawns. Absent everywhere means the parent session's cwd, byte-for-byte the previous behavior; old `delegations.jsonl` records without `cwd` or `observedModel` load unchanged and opt out of the check.
- This is a new capability, not an extension of the T3 effective-settings snapshot: T3 reads what WOULD run (declared side, condition hash); T11 records what DID run (observed side, per round).

## Alternatives considered

**Read the model from a fresh `codex exec` probe or a new CLI invocation.** Rejected: extra processes are a family invariant violation and the rollout already records the turn's model — reading the run's own artifacts keeps the evidence local to the run being observed.

**Report only the first round's observed model and never update.** Rejected: the record is last-wins by design, and a resume round's own observation is exactly what decision 5's per-round check wants; the settled event carries every round, the record carries the latest.

**Carry `cwd` through the host `SubagentStartRequest`.** Rejected: the harness seam is fixed by the no-host-fork rule, and the staged-intent channel already exists precisely for family-private start facts — the override rides where the resume handle rides.

**Per-call `cwd` without persistence (compare against the parent's current cwd).** Rejected: the parent's cwd can differ from the first round's effective cwd after a restart or a re-parented session; only the recorded first-round anchor makes "resume in the same directory" checkable rather than assumed.

**Also wiring `settled` through the live drivers.** Deferred: the evaluation drive is exec-only (frozen decision 2), the live drivers' per-round usage accounting differs per wire, and absence in live mode is honest — the exec paths pin the contract; wiring live is additive later.

## Consequences

- The orchestrator can, per round, compare declared vs observed model and fail loud on drift, and per cell, run each CLI in its own directory without cross-cell interference.
- `delegations.jsonl` grows one extra line per model observation (the same replace-append class as the existing record writes); records remain JSON-plain and credential-free.
- codex model readback is file-based: a round killed before codex wrote its `turn_context` reports no model even though the round started — absence stays the honest answer. A torn final `turn_context` line is skipped for the same reason.
- The kimi round usage in the `settled` event is the sum of the disjoint mirror windows (live polls plus the settle pass), matching the child session's exactly-once token accounting.
- Providers hard-call `recordRoundSettled` like every other core method: core and providers ship as one family line; a mixed npm composition predating the method fails loud rather than silently skipping the merge.
