# Agent Note: Honor human pause across concurrent goal updates

Status: implemented

## Problem

Real Kimi/DSH acceptance reproduced a lost pause: a worker submitted evidence after the browser displayed a plan revision, so the human pause failed its optimistic revision check and automatic rework continued. A changing transcript should not invalidate the user's stop request.

## Decision

The Room goal panel includes the displayed goal identity in pause commands. A human pause with a matching goal identity operates on the current serialized state even if its revision advanced. It preserves all submitted evidence and stops subsequent automatic admission. Already running native turns keep their existing targeted Stop controls.

A different goal identity is rejected. Coordinator pauses, legacy pauses without a goal identity, resumption, budgets and evidence review retain their revision checks. Closed goals remain closed. Request receipts retain the original input signature for acknowledgement retries.

## Alternatives considered

**Automatically retry every stale action in the browser.** Rejected because resumption, budget changes and evidence review can act on materially changed information. Stop is the narrow monotone exception.

**Ignore revisions on all pauses.** Rejected because a delayed old-page request could stop a replacement goal. Matching the displayed goal prevents that crossover.

## Consequences

The human pause survives concurrent evidence and scheduler updates without overwriting them. It cannot undo a native execution already admitted before the pause reaches the service. Regression coverage checks preserved evidence, idempotent acknowledgement retry, replacement and closed goal rejection, unchanged coordinator/resume guards, and the browser's goal identity.
