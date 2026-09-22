# Agent Note: Make interrupted Room execution recoverable from the UI

Status: implemented

## Problem

A real abrupt restart of the isolated coordinator instance correctly paused its goal and projected the active attempt as uncertain, but the transcript still showed both old members as running. Reading the room deliberately does not resume agents, so those durable running edges could remain visible indefinitely. A coordinator conversation interrupted by the same restart had a host reconciliation API but no Room UI entry; the read-only queue could describe the blockage without resolving it.

## Decision

The dispatch engine projects persisted running deliveries without a matching in-process reservation as uncertain, and matching run cards as failed with an explicit unknown-outcome explanation. This projection is read-only: inspection neither appends recovery events nor starts work. Real active reservations retain running state. Unknown duration is labelled unknown, not rounded from an invented zero. The node renderer uses the matching member and start boundary, so historical cards are not overwritten by another run.

Room exposes an interruption panel for ordinary deliveries, including coordinator reports. It links to the same member session, requires a human finding, and offers completed or abandoned outcomes through the existing reconciliation endpoint. It explains that queued ordinary conversations may continue after reconciliation, while paused goals remain paused. Formal task deliveries carry their plan correlation into the projection and remain exclusive to the goal reconciliation path; the host rejects attempts to bypass that path with ordinary reconciliation. A recorded outcome also settles the matching run card, replaces stale uncertainty copy with the human finding and clears the goal recovery prompt only after its last uncertain attempt is reconciled. The goal remains paused until explicitly resumed. Closing a goal retires its unstarted deliveries and held reports, including old closed goals discovered during recovery. A still-running turn may finish and retain its evidence, but it cannot create another automatic report for the closed goal. Closed goals hide retry/review controls while retaining reconciliation for uncertain effects.

## Alternatives considered

**Resume agents during every state read.** Rejected because opening history must not initiate generation or repeat uncertain effects.

**Tell users to repair ordinary deliveries through raw RPC calls.** Rejected because the normal interface must offer a path out of a restart blockage.

**Treat all interrupted work as cancelled.** Rejected because an external action may already have completed; a human must inspect the evidence before choosing an outcome.

## Consequences

Unknown work remains blocked and visible without a misleading running timer. The panel preserves the finding when a request fails. Regression coverage verifies read-only projection, active-run preservation through existing concurrent dispatch tests, session navigation, required findings, retry after a transport failure and exclusion of formal tasks from ordinary recovery. Real crash recovery remains part of the isolated tarball acceptance matrix.
