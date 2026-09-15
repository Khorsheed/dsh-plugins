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

New rooms start with native DSH. The existing invite action needs no mention target; inviting adds a member without changing the coordinator. Explicit promotion of a ready member transfers the role after handoff, with both participants idle and their input/control state settled. Reopening a configured room restores its coordinator. Native DSH remains addressable after handoff. A coordinator is a stable member role, so model changes do not require promotion again; automatic external-coordinator templates for new rooms are outside v1.

Extend existing member cards, goal/task capsules and chat events. Delivery A adds invitation/promotion and visible default-recipient controls. Delivery B adds milestone grouping, task dependencies, submitted versus accepted results, evidence/rework history, concise progress events and goal start/pause/resume controls. Saving a draft alone does not execute it; a natural-language execution request or the start button can authorize work. Keep per-turn todos distinct from room tasks and attributed to the current coordinator; accepted-task counts describe the current plan, not a reliable percentage of total goal work. Routine automated acceptance does not require a human click for every task.

An ordinary request such as asking main to have Kimi do a small job supports background delegation without a formal goal. Return an accepted/queued receipt promptly, persist correlated reports and deliver them automatically to the coordinator, without manual forwarding. A running member does not hold the coordinator waiting for its result; the user can keep chatting subject to normal per-agent serialization. Main chooses whether larger execution requests need a staged plan, parallel tasks or dependent handoffs; no separate automation mode or mandatory start button is required. Discussion/drafts do not start work, and pauses, scope and budgets remain effective. M3 delivers the shared durable report path for lightweight work; M4 reuses it for formal task dependencies.

Preserve independent member sessions and existing breadcrumb/session-tree, TaskPilot and room entry points. Stable child-session lineage and run identity survive renaming, model changes and coordinator promotion/demotion. Keep member transcripts, elapsed time, reported tokens and member-scoped stop controls; room summaries supplement these surfaces. Stop interrupts the current turn while retaining output, rather than promising process suspension, and automated retries must not undo a user stop. TaskPilot remains optional, with no new hard dependency.

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

Cold-start acceptance covers DSH first, invitation without automatic promotion, candidate readiness failures and restoration of a saved external coordinator. Goal UI acceptance covers draft versus active state, navigable dependencies and evidence, truthful acceptance counts, visible blockers and pause/recovery across refresh and narrow screens. M3–M5 own these UI changes alongside their corresponding service contracts.

Delivery A verifies continued main conversation while Kimi works, automatic completion/failure reports without a goal, and report deduplication and pause behavior. Delivery B verifies that a conversational execution request is sufficient for main to organize the goal, while discussion and saved drafts remain inactive. Direct human mentions retain their separate routing and do not automatically wake main.

M2/M3 compatibility gates cover existing navigation to the same member session during and after execution, role changes and refresh; token deduplication across streaming snapshots and final reconciliation; and equivalent targeted stops from member, room and TaskPilot surfaces. Missing usage remains unknown or pending. Stopping one worker preserves its partial transcript and other members' execution; room/member navigation and controls remain usable without TaskPilot.

## Risks

Native protocols and model menus vary with version and account. Shared runtime assumptions can corrupt model selection; duplicate/late events can corrupt content or tasks. The design requires capability probes, stable event identities, scoped authorization, explicit handoff and real output comparison. Missing public host capabilities go through the upstream-change path, never a local host patch.
