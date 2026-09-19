# Agent Note: Separate goal execution, submission and evidence acceptance

Status: implemented

## Problem

Room chat rows used a member's terminal run state as task completion. They could not represent dependency acceptance, rework history, explicit authorization to continue, or a budget enforced before native side effects. A successful process exit is insufficient evidence that a goal was achieved.

## Decision

Formal goals have their own versioned journal state, stages, task IDs, parent groups, dependency IDs and attempts. Ordinary messages keep the lightweight dispatch path and do not create a formal plan. A draft never dispatches; execute or explicit resume enables automatic ready-leaf dispatch. Groups complete through accepted children, including inherited dependency checks and cycle rejection.

The room_plan tool uses one bounded JSON command grammar across native DSH, authenticated external MCP and the human Remote. room_read supplies the grammar and current plan. Stable request IDs and revisions reject changed retries or stale organization decisions. Role and member identity come from the host. Workers can submit only their own current attempt; the coordinator or human reviews settled submissions with evidence. Rework retains the rejected attempt and reserves a new one. Native success creates a submission, never acceptance. Goal completion requires accepted remaining leaves and goal-level evidence.

PlanService serializes journal mutations. It persists reservations and dispatch correlation before starting work, records native admission through the shared provider callback, and derives settlement from the exact execution. Completion reports target the current goal coordinator. A paused goal stores results and reports but does not wake the coordinator until explicit continuation. Existing native work can finish; pausing automation is separate from member Stop.

Parallel capacity, total/per-task attempt limits and active-time budgets are enforced mechanically. Only the human can revise the authorized budget. A deadline timer pauses further work. Restart recovery pauses automation and marks previously active native attempts uncertain; only a human can reconcile those attempts with evidence. No unknown execution is replayed automatically.

The existing Room composer hosts an optional goal panel with stages, dependencies, attempt history, evidence reviews, pause/resume, human budget changes and explicit unknown-result reconciliation. Member session navigation and targeted Stop remain available. Accepted-leaf counts exclude groups and cancelled tasks. Lost acknowledgements retain command identity; no optimistic acceptance is shown. Reconciliation updates the matching execution projection and supersedes held uncertainty reports without resuming automation.

## Alternatives considered

**Treat a settled run as accepted work.** A successful process may have produced incorrect or incomplete artifacts. Submission and evidence review remain separate transitions.

**Use member names as dependencies.** One member can own several tasks, and names change. Stable task and attempt IDs preserve the exact prerequisite and result being reviewed.

**Let model instructions enforce budgets and restart behavior.** Instructions cannot prevent side effects after a lost acknowledgement. Reservations, admission checks and durable state enforce those limits before native execution.

## Consequences

A reviewed result can release the next dependent task without polling or blocking ordinary coordinator chat. Failed, rejected and uncertain attempts retain their evidence and history. Formal tasks do not create the legacy chat task rows.

Evidence locations are recorded claims for the coordinator or human to inspect; recording a reference is not filesystem or semantic verification. Attempt limits cover formal work reservations, not all coordinator reasoning steps or token costs. Missing provider usage is not invented. Full local artifact navigation, reassignment/editing, richer context capture and real harness/browser acceptance remain under implementation. This state/service slice does not establish M4/M5 acceptance or complete the proposal.

## Testing

Tests cover dependency release after review, rework and late-result isolation, worker ownership, settled-submission requirements, evidence gates, group/dependency cycles, concurrency, attempt/time budgets, pause/resume clocks, restart reconciliation, retry identity, actual room dispatch/report integration journal persistence, the actual active-time deadline, cold read-only projection, recovered delivery reconciliation and lost-acknowledgement report deduplication. Client tests cover optional draft creation, review evidence, session/Stop controls, reconciliation, command retry identity and leaf counts.
