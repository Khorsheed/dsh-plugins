# Agent Note: Refresh Room from the journal event window

Status: implemented

## Problem

The Room transcript displayed new coordinator responses while the goal panel and task counts stayed on old state. Closing the second test page did not fix the stale projection. Inspection of the current host showed that ordinary journal appends update the public event window but only notify the session summary when summary-owned data changes. Room subscribed to that summary and assumed every event would notify it. The test double incorrectly used one store for both surfaces.

## Decision

Room observes `SessionBinding.eventSource` as a refresh signal and re-reads its own Remote state. It does not fold or own the host event window. The existing summary subscription remains only a compatibility fallback when the event source is unavailable. The test bench now keeps the summary quiet while journal notifications independently change, exercising the actual host contract.

## Alternatives considered

**Poll every idle room continuously.** Rejected because the public journal already supplies the change signal and constant polling adds avoidable requests.

**Treat every stale panel as connection starvation.** Rejected by the one-page reproduction and source inspection. Shared member subscriptions address a separate observed connection limit; they cannot repair a wrong notification source.

## Consequences

Host-side plan updates, run completion and task progress refresh even when session summary fields do not change. Existing debounce, active-run polling and composer election stay in place. Regression tests independently cover journal-driven refresh, promotion, late binding and disposal with an unchanged summary.
