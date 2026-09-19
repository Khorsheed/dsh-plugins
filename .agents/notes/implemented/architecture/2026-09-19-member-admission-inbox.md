# Agent Note: Serialize member admission and persist human input

Status: implemented

## Problem

A room delivery, a member composer input and a direct delegation tool could contend for the same native member. Some paths queued while the core rejected an active resume. A composer could not acknowledge queued input durably or explain what survived a restart.

## Decision

MemberControls owns a FIFO at the provider boundary. All four providers submit fresh and resumed rounds with the request's abort signal. The queue holds through complete result settlement, then admits the next round using the converged model/effort configuration. Other members proceed independently. Cancelling a waiting request removes it without running it, and cancellation during native startup does not mark a model selection as failed. Legacy providers without configuration admission retain their busy rejection.

The member composer writes human input to a per-member atomic inbox before returning acceptance. Request IDs deduplicate matching retries and reject changed text. A host-only admission callback records running before the provider starts. The callback may be asynchronous: core awaits durable storage and rechecks cancellation before native startup. Room uses this same boundary for its running edge and duration clock, so queue time is excluded. A failed journal flush prevents native execution without poisoning model configuration. Stop may cancel independent member work, but it only closes room tasks when a room run is actually running. Completion, failure and cancellation update the same input record. Stop can also cancel an admitted inbox input before its native run handle publishes. Frozen evaluation delegations reject extra human input.

Inbox files use private permissions, file and directory fsync, and atomic rename. Corrupt state and failed persistence block admission. Recovery retains unstarted input paused and marks previously running input uncertain. It never replays an uncertain execution. The human records an outcome and evidence, then resumes remaining input explicitly. Read-only inspection does not start work; resuming requires the parent agent to be live.

The member composer remains writable during a running turn, with separate Send and Stop controls. Its inbox shows queued input, targeted cancellation, pause/resume and reconciliation. The selected external coordinator exposes the same inbox in room. Room no longer displays the former native coordinator's projection statistics as if they belonged to an external coordinator; independent member session statistics remain available. Request IDs also work on LAN HTTP origins without crypto.randomUUID.

Prepared members now expose their empty durable inbox before the first delegation transcript exists. The member composer can inspect a promoted fresh coordinator without a false missing-delegation error. Unknown identities still fail; enqueue requires an executed delegation, while the initial Room input uses the prepared-start path.

## Alternatives considered

**Retain busy rejection at the core and queue in each UI.** It leaves direct delegation tools and room deliveries with different execution semantics. The provider boundary is shared by all entry points.

**Acknowledge a composer input held only in memory.** A restart could silently lose accepted work. Acceptance follows the durable input write.

**Replay all unfinished input after restart.** A prior native execution can have side effects despite missing settlement. Unknown results require reconciliation; queued input remains paused until explicit continuation.

## Consequences

Human member messages survive browser reconnect and host restart. Native execution, model/effort admission and cancellation share one FIFO, while the exact admitted configuration remains attached to the published run for frozen evaluation evidence.

Room owns its durable delivery journal and a short submission chain: a fresh member waits for its stable native handle to be persisted; an existing configured member enters the shared core queue without waiting for the previous room result to finish journaling. Legacy providers and the native room agent retain room serialization. Each execution has a stable run ID; delivery outcomes come from that execution, and delayed terminal edges cannot replace a newer run projection. Automatic chat task rows carry their delivery ID so completion and Stop only settle the matching row. A handle-publication persistence failure waits for native settlement before reporting a terminal failure.

Combining all queue presentation and ordering at initial durable acceptance, refreshing queued prompt context at admission, and replacing automatic chat task rows with formal goal attempts remain outstanding. This slice does not complete M3 or the full proposal. Inbox records retain text and outcomes locally; terminal history compaction is not implemented. Real CLI/browser, streaming latency and isolated deployment acceptance remain pending.

## Testing

Tests cover whole-turn FIFO order, independent members, pending configuration application, waiting cancellation, aborted startup, asynchronous admission persistence and cancellation, room queue-time exclusion, independent-work Stop isolation, immediate submission to core, first-handle serialization, delayed settlement isolation, facade lock compatibility, durable acceptance and retry identity, corrupt/unwritable storage, restart fencing, cancellation before handle publication, writable busy composers and reconciliation controls. Provider and frozen evaluation suites are rerun against the admission changes.
