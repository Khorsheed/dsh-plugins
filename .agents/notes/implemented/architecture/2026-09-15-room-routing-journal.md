# Agent Note: Persist room coordinator routing and delivery outcomes

Status: implemented

## Problem

Room input was hardwired to native DSH, member queues used mutable display names, and background completion lacked a durable link to its requester. A restart could not distinguish accepted work from an execution with an unknown result.

## Decision

The journal owns the coordinator member ID, revision and bounded handoff. Legacy members derive a stable ID from their original join event; new invitations allocate one. Human input resolves its recipient on the server, records target IDs and an optional retry ID, and retains that target across renames. Inviting a member keeps the existing coordinator. The current coordinator cannot be removed before handoff.

Delivery lifecycle records distinguish queued, running, settled and uncertain work. Recovery preserves unstarted work and never repeats an uncertain execution. That member's queue remains blocked until a human records a reconciliation outcome and evidence. Coordinator-originated background requests carry their requester's stable ID. Their durable completion produces a deduplicated report dispatch; human direct messages and report dispatches do not recursively report.

The composer routes input through room, binds external configuration and Stop to the selected member, and hides the former native Todo and queue. A public agent pre-step listener catches stale official text input before a native model call, routes it durably, and returns an empty first step. Explicit native-member dispatches remain possible. No host source is changed.

## Alternatives considered

**Use the member name as queue identity.** Renaming or reusing a removed name could redirect accepted work. Names remain addressing and presentation fields; queued recipients are stable IDs.

**Replay every unfinished dispatch after restart.** An interrupted external execution may already have produced side effects. Unknown outcomes block that member until reconciliation.

**Let a DSH model forward every external input.** It adds an unnecessary model call and can alter the user's request. Room owns routing directly, including a stale-client guard through a public host seam.

## Consequences

Existing independent sessions, navigation and run records stay attached to their member. Delivery recovery and reporting are traceable in the same journal. Read-only room inspection does not wake an agent; cold mutation recovery uses the existing public agent resume path.

This is the routing foundation of M3, not completion of delivery A. Native preparation now lives in [its owning note](2026-09-19-native-member-preparation.md). Coordinator tool capability checks, the shared core message queue, richer handoff capture, goal pause integration, full reconciliation UI and real harness/browser acceptance remain outstanding. Promotion currently requires a member session and converged configuration; this does not claim the proposal's complete readiness contract. Existing automatic chat task rows remain until the formal task/attempt model is separated in the next implementation slice.

## Testing

Room tests cover direct external routing without a native followup, explicit native addressing and switch-back, role revision conflicts, active-coordinator removal, accepted-request deduplication, rename-safe queues and speech, single completion reports, non-recursive human messages, crash reconciliation and the public pre-step stale-client guard. Composer tests cover external configuration/Stop and former native Todo/queue ownership.
