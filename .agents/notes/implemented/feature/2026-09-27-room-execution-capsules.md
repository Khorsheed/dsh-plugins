# Agent Note: Room execution and plan capsules

Status: implemented

English | [中文](2026-09-27-room-execution-capsules.zh.md)

## Problem

Room's composer exposed a chat-task board and an empty formal-goal form, while member navigation and interruption lived in individual chat messages. The latest-run-per-member projection could not describe several executions in one persistent member conversation. Different labels for opening the same conversation also implied a separate result viewer that did not exist.

## Decision

The composer puts collapsed Background agents and Current plan capsules against the input's upper edge. Only one panel opens at a time, above its triggers; outside clicks and Escape close it. The agent capsule contains only its label and an icon, replaced by a steady green dot while work runs. Counts and detailed states stay inside the panel or its accessible tooltip. The plan capsule exists only for a stored plan. Its compact task list links to the existing evidence/review controls in an optional, session-scoped host sidebar; missing sidebar services retain inline details. Sidebar registration follows Room's preset visibility policy.

Room replays an additive execution history from existing run events without changing dispatch, delivery or goal scheduling. An execution retains its child session and identity through later rounds, member renames and removal. Optional observed model, effort and round token totals are recorded from the facade's settled progress report; absence stays unknown. These observations use a separate log-only metadata event, so they cannot restart the chat renderer’s run lifecycle. Native descendant sessions come from the public session list, exclude unrelated sessions and Room duplicates, and label their duration/token totals as session totals. Direct follow-ups from a member’s own composer remain visible as live session totals when no Room execution represents them; the coordinator remains excluded. Harness-internal workers without host sessions are not invented.

Execution-card cancellation supplies the displayed run identity and admission time. The host compares both before touching the cancellation channel. Native descendant cancellation verifies the entire ancestry back to the room and uses the existing host/facade controls. All conversation links open the real child session, not a copied transcript. Completion and evidence acceptance remain separate states. Current coordinator turns and completion-report deliveries do not become background execution cards.

Full plan controls preserve revision fences, evidence requirements and restart reconciliation. Run limits are folded by default; manual creation offers separate Start and Save draft actions. Ordinary chat does not create a plan. Legacy task/goal controls remain available for rooms without execution history or a formal plan, and in their existing package surfaces.

## Alternatives considered

**A new toolbar at the top right.** The host does not provide the proposed Room-specific position. Input-edge capsules match the existing product and keep the composer self-contained.

**Separate View result and Message history labels for the same destination.** Rejected because the actions would be indistinguishable. Cards consistently say View conversation; actual evidence remains in plan details.

**One card per roster member, with cumulative tokens shown as a task cost.** Rejected because persistent members execute multiple rounds. Durable Room executions and native session summaries retain their distinct accounting units.

**A new scheduler or a hard TaskPilot dependency.** Rejected: Room already owns durable dispatch and review; public session projections provide descendant visibility without a sibling dependency.

## Consequences

The default composer has less permanent chrome. Historical run records survive settlement, and a stale stop action cannot target a successor. Unknown historical model/usage values stay absent; opening a legacy member conversation does not promise positioning at a specific message. Large histories scroll within the expanded panel. The optional sidebar adds an official peer dependency but no required runtime inject. Tests cover history replay, rename/removal, stale cancellation, native ancestry, missing observations, folded indicators, panel dismissal, and explicit detail navigation.
