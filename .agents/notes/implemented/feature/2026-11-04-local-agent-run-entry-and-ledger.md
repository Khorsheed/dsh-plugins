# Agent Note: the single execution entry `run()` and the per-member execution ledger

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) step S4. Before it, a member round took one of three routes. The host `subagent` tool staged its own intent and called `ctx.subagents.startActivation` directly. The members-page composer went through the facade `resume` from the `MemberInbox`. Plugins (room, eval) used the facade `start`/`resume`. The only shared layer was `MemberControls`' in-memory FIFO. Only composer input was durable, and only it recovered after a restart. A tool call and a composer input to the same member queued in different places.

## Decision

- **`localAgent.run(request)`** (`LocalAgentExecutionRequest` in `types.ts`) is the one entry. The request carries `parentSessionId`, `provider`, `member: { childSessionId, create? }`, `input` (blocks, or a function evaluated when the execution reaches the head of the member's queue), `operation`, `caller`, `cause`, `task`, `key`, `callerRef`, `label`, `signal`, and `on: { admitted, progress, settled }`. It resolves once the execution is durably queued, with `{ executionId, settled, started }`. The core decides first round vs continuation. A delegation record means a continuation, whose scope and cwd come from the record. A ready prepared member starts its prepared identity. Anything else starts fresh under `member.childSessionId` with `member.create`.
- **`start` / `resume` / `compact` are thin wrappers.** They run the same documented pre-checks synchronously (unknown provider, foreign handle, model or effort on a resume, the resume-lock probe for non-configurable providers, no live parent). Then they submit to the ledger and return `started` (the published `SubagentRun`). Their options pass through to the round verbatim (cwd, scope, exec, onAdmitted, onProgress, label, preparedMemberId, reattach). eval and context-guard are unchanged and pass.
- **The ledger** (`member-inbox.ts`, class `MemberInbox`, alias `MemberLedger`) is the old composer inbox generalised: same directory `.member-inbox/`, same file per member (sha256 of the member id), same atomic write. Each row is `{ id = executionId, caller, key?, text? (composer only), operation?, status, createdAt, updatedAt, admittedAt?, settledAt?, error? }`. It is the only queueing layer above `MemberControls`, which stays as the executor below it. Rows dispatch **strictly one at a time per member, in ledger order**. The next row starts only after the previous row's run settled. That is also what makes "evaluate the input at admission" true for a lazy input.
- **Execution id = ledger row id = record id.** `LocalAgentExecutionIntent.executionId` carries the row's id to `ExecutionRecorder.admit`, so the `local-agent/execution` start/end records and the ledger row name the same execution.
- **Key dedup.** A key the member's ledger holds is never run twice. If the row is queued or running in this process, the same handle comes back. If it is finished, its settlement comes back. If it is uncertain, `run()` throws. A queued or running row with no in-process handle also throws.
- **Restart recovery, in one place.** On load, a `running` row becomes `uncertain`, whoever submitted it. A queued composer row is kept, and the queue is paused as before. A queued row of any other caller carries no input, so it is dropped (its caller resubmits it under the same key). Any `uncertain` row blocks every later admission of that member. Non-composer callers are refused at submit, which fails fast. A tool call never hangs in a blocked queue.
- **`reconcileExecution(childSessionId, executionId, outcome, evidence)`** is the one reconciliation action. The members page's reconcile control (`gateway.controlMemberInbox`) calls it. `cancelExecution(childSessionId, executionId)` cancels a queued row or stops a running one. `cancel(childSessionId)` is unchanged. The run's caller signal cancels the execution while queued and while running.
- **Settlement.** `settled` resolves when the row ends. It never rejects. It carries the outcome, the run when one published, `turns` from the open execution record, and the provider's settle-report observations (`observedModel`/`observedEffort`/`cliVersion`). The report counts only when it lands within `SETTLEMENT_REPORT_WAIT_MS` (2 s) of the run's end. Otherwise the observations are absent, meaning not recorded. `recordRoundSettled` now passes these observations to the recorder.
- **The host `subagent` tool** calls `run()` with caller `tool`, cause `tool-call`, task `turn:<n>`, callerRef the call id, the tool's signal, and the description as label. The tool's own intent staging, `ensureChildLive`, `startActivation`, and `trackDelegationRun` are gone. The facade now does the reattach, tracking and stop. `trackDelegationRun` and `ensureChildLive` stay public for other callers.
- **The members-page composer** submits through the same path: caller `composer`, key and callerRef the request id, cause `{ kind: 'human', sessionId: <owner session>, via: 'member-composer' }`. A queued composer row replayed after a restart runs through the same dispatch from its stored text. `queuedMemberRounds` counts queued ledger rows, so room's "coordinator busy" check and 立即载入 see them.

## Deviations from the design

- `run()` also returns **`started`** (the published run). The wrappers and the tool need the `SubagentRun`, and the design's shape had no way to reach it before settlement.
- **`caller`** and a top-level **`label`** are request fields. In the design, the ledger had `caller` but the request did not, and `label` lived only under `create`.
- A running key with an in-process handle **returns the same execution** instead of erroring. It is still one execution.
- The settlement **waits up to 2 s** for the provider's settle report so it can carry observations. In the design it was emitted the moment the run ended, and the observations would then almost never be present. The 60 s `settledRuns` grace is untouched; it goes with S5/S7.
- `reconcileExecution` writes no `local-agent/execution` end record for the reconciled execution. The child log keeps a start without an end.
- A key replay of a finished execution returns `turns: []`. The ledger does not store turn ranges; the child's end record has them.
- Cause for the composer: the type has no `inputId`, so the input id is the `callerRef` and the key.

## Alternatives considered

- **Keep dispatching every queued row at once and let `MemberControls`' FIFO order them** (the old inbox model). Rejected: the order would be whoever reaches admission first after async pre-checks (reattach, input assembly), not ledger order, and a lazy input would be evaluated long before its admission.
- **A new ledger file and format next to the inbox.** Rejected: two durable stores for one member's executions is exactly the split the design removes; generalising the inbox keeps one file and lets old files load.
- **Persist the input of every caller so all queued rows replay after a restart.** Rejected per the design: room assembles its prompt at admission and a tool call's host turn is gone, so only composer text is the caller's sole source.

## User-visible change (members page)

The members-page queue now shows every caller's queued executions, not only typed input. A row without text shows its caller ("宿主会话的子代理调用" / "协作间派活" / "插件调用"), and it can be cancelled there. An uncertain execution from any caller appears with the reconcile controls (user decision ③). Failed rows are still listed for composer input only. A paused queue or an uncertain execution now also refuses a tool call or facade call to that member at once. Before, the call reached the provider and was refused at admission.

## Consequences

- A ledger file now exists for every member that ran a round, one-shot tool delegations and eval cells included. That is one small JSON file per child, and terminal rows are pruned to the last 200 per member.
- `tests/tool-factory.spec.ts` now uses a temp homes root instead of `/tmp/homes`. The tool path writes ledger files, and a fixed shared directory would leak rows across runs.
- S5 (room) can now pass `cause`/`task`/`key`/`callerRef` and a lazy `input` to `run()` and drop its CLI queue. S7 moves room's uncertain handling onto `reconcileExecution`.

## Testing

- `packages/local-agent/tests/run-entry.spec.ts` (7) runs on the real stack: SessionStore, JSONL persistence, ToolRuntime, the family tool, and a holding provider. It covers a first round and then a continuation (scope and cwd taken from the record, lazy input evaluated once, `admitted`/`settled` payloads, records matching ledger ids) and key dedup (in flight and after settle; one provider round). It covers queue order with cancel of a queued row (maxRunning 1) and a caller signal cancelling a queued row while `cancel()` stops the running one. It covers restart, where running becomes uncertain, a queued room row is dropped, tool/room/wrapper callers and a same-key replay are refused, and `reconcileExecution` unblocks the next round. It covers the tool (start, then continue) plus a concurrent composer input sharing one queue with records carrying their causes, and a `resume` wrapper waiting behind a running tool round.
- `packages/local-agent/tests/member-inbox.spec.ts` (8), rewritten for the ledger. It covers strict order across callers, cancel by id or key, pause, the restart split, migration of a version-1 inbox file (rows become composer rows keyed by their id, running becomes uncertain, retries are deduplicated, the file is rewritten as version 2), storage failure, and corrupt files.
- Existing specs were adjusted only where an intent now carries the execution id and admission edge (`delegation-facade`, `scripted-provider`) and where the composer cause is now recorded (`execution-records`).
- local-agent 495 → 504 tests, all green. Dependents unchanged and green: claude-code 281, codex 277, kimi 315, dsh 246, room 476, context-lens 311, bundle-local-agent 5, eval 1484, context-guard 52. `pnpm check:plugins` is clean.
- Not verified: a real CLI round or a live 3080 instance. The members page was not exercised in a browser.
