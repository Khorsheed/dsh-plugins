# Agent Note: the core writes `local-agent/execution` start/end records

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) needs every member execution to say, inside the member's child session, why it ran, which task it worked for, which turns it wrote, how it ended, what its source never reports, and the CLI's own round total. Step S0 registered the event type (`2026-11-04-local-agent-execution-event-registered`); step S1 writes it. Until now none of these facts existed on the child side, so Context Lens inferred them from time windows.

## Decision

The core writes one `start` and one `end` record for every round admitted through `withMemberConfigurationRound` (the `MemberControls.runNow` admission point). The recording lives in `packages/local-agent/src/execution-records.ts` (`ExecutionRecorder`, `OpenExecution`).

- **Where the start lands.** The wrapped provider start runs exactly at admission (after `onAdmitted`). If the child session is live then (a resume, a prepared member), the start is written there, before the provider does anything. For a first round the provider creates the child inside its start, so the record waits for the round's first `turn/start`: every provider now opens its turns with the new `openMirrorTurn(session, turn, transport)` from `mirror-step.ts` (8 sites across claude/codex/kimi/dsh, exec and live), which first runs the open execution's hook. Fallbacks, so a start is never lost: it is also written as soon as the provider's start returns, and at the latest just before the end.
- **The hook registry.** Hooks are keyed by child session id in a `Symbol.for` map on `globalThis`. The design passed the execution through the staged intent into the provider's turn opener. That would have meant threading it through every exec and live driver. With the registry the providers change one line per site, and the registry stays shared even when the provider bundles and the core load separate copies of `mirror-step`.
- **The end.** It is written when the run settles. `turns` is every `turn/start` the child log gained after the admission watermark (the last seq at admission), read at settle. A member's rounds are serialized, so nothing else writes turns in that window. `outcome` maps `completed` → `done`, `aborted` → `cancelled`, everything else (including a start that throws) → `failed` (`cancelled` when the caller's signal aborted). A start that throws before the child exists leaves no record (the design's "failed before admission into the child" case). A prompt round that opened a turn waits for the provider's settle report so it can carry `providerReportedUsage`. The wait is bounded by the existing `RUN_PROGRESS_SETTLE_GRACE_MS` and flushed on plugin dispose. A compaction or turnless round ends immediately.
- **cause / task (S1 sources only).** The new optional `DelegationCallOptions` fields `caller`, `callerRef`, `cause`, `task` are staged as `intent.execution` (`LocalAgentExecutionIntent`) and passed to the admission by every provider (`withMemberConfigurationRound(…, intent?.execution)`). The family tool stages caller `tool`, `callerRef` = the call id, cause `tool-call` (`exec.rootCallId ?? exec.callId`), and task `turn:<n>`, read from the call's own `tool/call` event in the calling session. If that event is missing, no task is recorded. User decision ④ (a room's main agent continuing a member through `subagent`) is covered by this same tool path. The member composer records caller `composer` with its input row id; its cause is S4's. If a facade call gives no cause, none is recorded: `LocalAgentExecutionStartEvent.cause` is now optional and means "not recorded". This is the one relaxation of the S0 shape. No reader exists yet.
- **providerReportedUsage (user decision ②).** `recordRoundSettled` takes a new optional `providerReportedUsage`, filled only with a total the CLI itself reported. Claude (exec and live): the `result` event's `usage`. Codex exec: `turn.completed`'s usage. The rollout fallback is excluded, because it is the last call's usage. Codex live: the wire's thread total diffed to this round. The per-call `last` and the rollout read are excluded. Kimi and dsh report none: their settled `usage` is a sum of the per-call usage they mirrored, which is exactly what decision ② must not copy.
- **`LocalAgentHarness.unrecorded`** (`LocalAgentUnrecordedDeclaration`: `exec` / `live` / `compact`) is copied verbatim. The transport comes from `openMirrorTurn`'s argument. A compaction uses `compact`. A turnless prompt round declares nothing. A round that opened a turn without the opener (a third-party provider) gets the union of `exec` and `live`.

## Declarations and their evidence

| Harness | exec | live | compact | Evidence |
|---|---|---|---|---|
| claude-code | internal-calls | internal-calls | internal-calls, compaction | `tests/fixtures/stream-json.sample.jsonl` (a real CLI recording): the result's `modelUsage` counts 735 input / 148 output tokens, `result.usage` 4 / 129, and no streamed assistant event accounts for the difference. The parser has no `compact_boundary` case. The provider ignores `operation`, so `/compact` runs as a prompt and no `local-agent/compaction` is written. |
| codex | call-boundaries, per-call-usage, internal-calls | internal-calls | — | Exec: usage only on `turn.completed`, hung on the last non-tool line (`appendCodexResponse`), and `parseCodexJsonStream` has no compaction item type. Live: auto-compaction is a `contextCompaction` item written without usage (`recordRoundContext`). Boundaries are on the wire (`thread/tokenUsage/updated`). Manual compact records its usage. |
| kimi | internal-calls | — | — | `session-view.ts` skips session-scoped `usage.record`s (a compaction call's spend) because the compaction event carries them. Only the live driver writes that event (`readKimiCompaction`), so on `kimi -p` that spend is dropped. |
| dsh | internal-calls | internal-calls | internal-calls, compaction | `session-mirror.ts` copies only user/assistant/tool/step events, so the sub-dsh's `compaction/start\|summary\|end` and its summary call never cross. The provider ignores `operation`. |

The declarations are exported constants (`CLAUDE_CODE_UNRECORDED`, `CODEX_UNRECORDED`, `KIMI_UNRECORDED`, `DSH_UNRECORDED`) so the mirror snapshots lock them.

## Alternatives considered

- **Thread the execution through each provider to its turn opener** (the design's wording). Rejected for the registry above: same placement, far less plumbing.
- **The core pre-creates a first round's child session.** Rejected. It would change who creates the session, and with it the descriptor order and the subagent catalog row.
- **Use the settled `usage` as `providerReportedUsage` for every provider.** Rejected: for kimi and dsh it is a copy of the per-call sum.

## Consequences

- **No user-visible change** is expected. Nothing reads the records yet (lens S8, room S5/S6). The member composer's `MemberInbox` execute callback now also receives the input id.
- **Deployment order:** S1 must not reach 3080 before S0 is live there. A build that writes the type has to run on top of a build that registers it.
- The mirror snapshots now lock the records' placement. See the second commit.
- **S4/S5** replace the option fields with `run()`'s request and wire room. The record shapes stay.

## Testing

- `packages/local-agent/tests/execution-records.spec.ts` (10 cases) drives facade → admission → `openMirrorTurn` → real JSONL persistence. It covers a first round (start after the descriptor and before `turn/start`; end after `turn/end` with turns, outcome, declaration, total), a resume (start written before the provider opens its turn), a compaction (no turn, compact declaration, no wait), a cancelled round, an error round, a failed spawn, a late settle report, and the composer. Each stored log loads through the host reader, passes `assertReleasedV4Relationships`, and leaves no quarantine file. Recorder unit cases cover the bounded wait, the start fallback with no opener (union declaration), and no record when no child exists. A tool-path case covers `toolCallExecution`.
- The 8 provider mirror snapshots run their rounds inside an open execution, and `expectValidReleasedLog` accepts every one, including completed and cancelled live rounds and an end written inside the still-open turn of the kimi wire fold.
- Not verified against a real CLI: the claude `internal-calls` claim rests on the recorded sample, not a fresh run. The codex exec `internal-calls` claim rests on the parser's item types, not on observing an auto-compaction in exec mode.
