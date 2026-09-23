# Agent Note: Durable member configuration controller foundation

Status: implemented

## Problem

Existing provider model overrides are private in-memory maps and reject busy members. Implementing independent room and composer queues would create conflicting selection semantics. Native controls may acknowledge after a newer selection, or succeed before the host records their success.

## Decision

Core exports a provider-neutral member controller with current configuration, one replaceable pending slot, intent revisions, correlated request receipts and an immutable whole-round admission lease. Model and effort selection each distinguish member inheritance, harness default and an explicit native value. Provider adapters own read-only validation, bounded native application and reconciliation; the controller never generates a model turn.

Acceptance writes the intent before returning a receipt. Validation yielding past a round admission makes the selection affect the following round. A running model/tool round retains its admitted configuration. New valid selections replace an unsent pending choice; changes arriving during application are accepted immediately and converge before the next admission. Revision conflicts and invalid combinations leave the last valid intent untouched.

Cancelling an unsent choice clears it. Cancelling an already-started control installs restoration of the last applied selection and keeps admission blocked until restoration finishes. Failed or uncertain controls retain intent and operation state. Retry and restart reconcile against native current/operation facts; an unknown result keeps admission blocked, and an already-applied operation is not blindly repeated. Frozen configurations reject selection before provider validation.

Per-member storage uses versioned, validated atomic files, flushed before rename, with directory synchronization where supported. Request receipts survive restart. Malformed state fails closed for that member; it never silently becomes a default configuration. Storage failures produce no accepted receipt and prevent automatic admission/retry loops. The owning core instance must be unique for its data directory, consistent with isolated acceptance-instance homes.

## Alternatives considered

**One FIFO of every intermediate model choice.** Rejected because users intend the latest valid configuration, not every intermediate click.

**Treat a provider ack as durable success before storing it.** Rejected because a crash between those events makes native state uncertain; reconciliation is required.

**Put native protocol or room policy in this controller.** Rejected. The controller owns consistency and admission; adapters supply facts and effects, and room owns orchestration policy.

## Consequences

This commit is the tested control foundation. It is not yet wired to provider admission, gateway controls or UI; existing busy-rejection behavior remains until those entrances migrate together. Effort transport, eval locking and provider-specific recovery are still required before the proposed product contract is delivered.

## Testing

Tests cover busy-time coalescing, validation/admission races, late acks, cancellation restoration, revision conflicts, request deduplication, frozen configurations, write failures, malformed files, unknown native state, no duplicate application after recovery, and actual storage reconstruction. Core's existing suite remains green.
