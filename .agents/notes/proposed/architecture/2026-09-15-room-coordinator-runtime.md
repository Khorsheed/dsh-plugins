# Agent Note: room coordinators share participant contracts across harnesses

Status: proposed

English | [中文](2026-09-15-room-coordinator-runtime.zh.md)

## Problem

Room sends unaddressed messages to the native DSH agent, while external members expose a different model, control and transcript surface. Existing streaming mirrors do not make the room stream; a final member reply does not prove task acceptance. Making an external member the default coordinator before resolving these differences would carry them into every ordinary conversation.

## Proposal

The [capability proposal](../../../../proposals/active/2026-09-15-room-coordinator-runtime.md) is the scope and acceptance ledger, pending user review. Treat coordinator as a role over stable participant identity. Adapt native DSH through public host interfaces and external harnesses through the existing local-agent facade. Extend shared model, control, content and replay contracts; keep provider-specific discovery and transport in providers, and routing/task policy in room. Preserve optional package boundaries and the existing session-promotion entry.

Deliver reliable model selection, native generation deltas and direct default routing first; then add task dependencies, durable reports, acceptance and goal continuation. Claude's isolated 2.1.272 initialize/set_model probes support evaluating native control instead of shared settings-file scratch writes, but do not establish authenticated inference or exhaustive model availability. The existing 208 passing tests primarily cover simulated data.

The review adds three explicit delivery gates. Retire the live event mirror mode, normalize legacy configuration, drain old runtimes and verify partial-output arguments; separate bounded real-time flushes from durable snapshot throttling to meet the 200ms P95 target. Carry model/effort choices through execution and records, including eval's frozen conditions, while preserving historical hashes, locks and results. Following user review, model/effort selection is allowed during a run and takes effect at the next turn boundary. Core durably owns applied and pending configurations; room and member composer share their state. The active turn keeps its original configuration, including its tool loop.

Use one replaceable pending configuration rather than a FIFO of intermediate choices. The latest accepted valid revision wins; cancellation targets a revision. Apply before admitting the next turn, including previously queued ordinary messages. Serialize control and admission, reconcile in-flight changes and restarts, and block subsequent turns on failure or uncertain acknowledgements until resolved. An idle selection does not trigger generation. Stop, apply and continue is the immediate-switch path; eval-locked configurations reject changes before accepting pending state.

## Alternatives considered

**Replace the host AgentFactory.** Not required for default room routing and expands the compatibility burden beyond this request.

**Keep native DSH as an LLM relay.** Adds a second reasoning/context boundary instead of directly addressing the selected coordinator.

**Centralize provider discovery code or flatten all models to strings.** Loses native aliases, capabilities, environment-specific availability and loading state. Share contracts and cache/subscription mechanisms while preserving provider implementations.

**Simulate streaming from final text.** Cannot expose actual in-flight progress or preserve honest interruption behavior.

**Keep selectable event mode or queue model changes only in room.** Leaves defaults outside the streaming contract or creates conflicting controls across entry points. Retire the live mode split while preserving exec and final reconciliation; core owns pending controls for every entry point.

**Reject model/effort selection while busy.** This earlier v1 suggestion was superseded after user review: it unnecessarily prevents choosing the next turn's configuration. Accept the intent immediately while preserving the active turn's configuration.

## Acceptance criteria

User review precedes implementation. Delivery A requires all four coordinator choices to support direct conversation, truthful controls and verified streaming/replay. Delivery B additionally requires dependent tasks, explicit acceptance, durable reporting and bounded continuation. Detailed matrices and evidence limits live in the linked proposal; this documentation commit does not claim those capabilities shipped.

Delivery A also covers default/legacy streaming paths and sparse-tail latency; synchronized applied/pending controls, replacement/cancellation, stale revisions, admission races and recovery; effort binding on start/resume; and eval override/mismatch counterexamples. Historical condition digests remain stable; missing runtime evidence stays unverified rather than being backfilled as a match. Eval compatibility is an M1 gate, not follow-up work after exposing the selector.

## Risks

Native protocols and model menus vary with version and account. Shared runtime assumptions can corrupt model selection; duplicate/late events can corrupt content or tasks. The design requires capability probes, stable event identities, scoped authorization, explicit handoff and real output comparison. Missing public host capabilities go through the upstream-change path, never a local host patch.
