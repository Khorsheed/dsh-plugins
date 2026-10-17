# Agent Note: local-agent family maps onto 0.2.1 subagent activations

Status: implemented

## Problem

Host 0.2.1 (`subagent-activations` upgrade guide) deletes `ctx.subagents.start()`. The successor `SubagentRuntime.startActivation(spec)` changes three things the local-agent family depended on:

1. **Delivery semantics**: every start returns an activation; `delivery: 'parent'` notifies the parent agent, `delivery: 'caller'` only resolves `activation.result`. The family collects results itself and pushes them through its own Remote, so a parent notice would double-report.
2. **Cancellation split**: `spec.signal` owns cancellation only up to publication; after the manager publishes the activation it unlinks the signal, and `activation.dispose()` is the sole post-publication cancel channel. The family's `cancel()` and caller-supplied signals assumed the 0.2.0 "signal cancels anytime" contract.
3. **Identity rule**: the manager rejects a provider run id that names a live Session (`DUPLICATE_CHILD` — `assertChildIdAvailable` also rejects resident ids and live agents). Every family provider's run id WAS the mirrored child session id — live by construction — so a naive mapping compiles green and then fails every delegation at runtime. Resume rounds reuse the same child session id across rounds, so the collision is structural, not incidental.

Also removed in the same wave: `ResolvedSubagentStartRequest.descriptor` (the runtime no longer resolves the one-shot descriptor; `snapshotSubagentDescriptor`'s one-shot overload is gone), and `SubagentCapabilities`' `persona`/`toolFilter` fields.

## Decision

- **`delivery: 'caller'` everywhere** (facade `start`/`resume` and the family tool): the family Remote stays the only result channel; the parent model sees the tool result, never a second completion notice.
- **The child session id moves to the family intent channel**. Facade/tool mint it for fresh starts (`LocalAgentDelegationIntent.fresh.childSessionId`, the same channel the prepared-member path already used via `preparedMemberId`); providers prefer it over their own mint. The family's tracking key, resume handle, `RESUME_HINT` text, and client pushes are unchanged.
- **Providers publish a fresh per-execution run id** (`SessionId(randomUUID())`) on all eight `subprocessRunHandle` sites — the same convention the official dsh-sdk provider uses ("the run id lives in the parent namespace"). The manager's activation `childId` becomes an opaque execution identity the family never reads.
- **The facade/tool return an adapter `SubagentRun`**: `{ id: SessionId(childSessionId), result: activation.result, dispose: activation.dispose }`, so the family's public surface (facade return, `trackRun`, `trackDelegationRun`, `settleForegroundRun`) is byte-identical in shape.
- **Cancellation rewired to dispose**: `cancel()` aborts its controller (pre-publication) AND fire-and-forget disposes the activation (post-publication); caller signals (`DelegationCallOptions.signal`, the tool's `exec.signal`) are re-wired to `dispose()` with the listener detached at settle. `subprocessRunHandle`'s own contract (dispose → requestCancel → result settles `aborted` → teardown) makes the chain equivalent to the 0.2.0 signal path.
- **Providers stamp the descriptor themselves**: `{ version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: this.name, label }` with the label composed from `request.label` — the activation spec's required label arrives as `''` when the caller named none, which the composition reads as "absent" (the harness display name wins, exactly the 0.2.0 default).
- **`MemberControls` gains a child-session-keyed fallback** for `runConfiguration`: callers now hold the adapter, never the provider's run object the `admitted` WeakMap keys. The WeakMap keeps its exact-identity semantics (member-controls.spec pins per-round distinction); the `admittedByChild` map serves adapter holders, and is safe because a child's rounds serialize through the controls queue, so the latest entry at read time is the reader's own round.

## Alternatives considered

- **Bypass the manager (`getProvider(name).start(...)` directly)**: rejected — that abandons lifecycle events, activation pooling, and the host's only supported consumer path; the family would carry the dispatch pre-flight the manager now owns, and the next activation-semantics change would break us harder.
- **Let the provider keep `run.id == childSessionId`**: impossible — the manager's availability check rejects any run id visible in the live session store, and resume rounds keep the child session live permanently.
- **Key `admittedByChild` per round (child + round number)**: rejected as over-design — rounds of one child never overlap, and every known consumer reads its own round's configuration before the next round admits.

## Consequences

- The family's model-facing behavior is unchanged: same resume handles, same tool result text, same Remote pushes, same stop/cancel outcomes.
- Host lifecycle events (`subagent/start`/`subagent/end`) for family runs now carry the per-execution id, not the child session id. No family consumer joins on it; the 子代理 catalog/projection rows the provider appends itself are untouched (catalog `version: 0, mode: 'one-shot'` still folds in 0.2.1).
- `startActivation` requires the `agents` service (the manager) and, at the package level, the runtime's new `static inject = ['workingDirectory']` — test compositions that mount the real runtime must provide both (and enter the exact parent agent object; the manager compares identity).
- Tests that mount the real `SubagentRuntime` must not let a sessions stub answer "live" for the manager's availability probe on the per-execution run id.
- Host 0.2.1's JSONL persistence loads a native flock addon (`@deepseek-ai/node-addon-system-<platform>`); a fresh harness checkout needs `pnpm build:native` under `native/system/` before persistence-backed specs run.
