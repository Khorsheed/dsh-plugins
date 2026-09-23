# Agent Note: Synchronize port-race fixtures on listener readiness

Status: implemented

## Problem

Two watchdog integration fixtures remained flaky under host load even with serial lane scheduling. The stale-listener launcher returned before its detached HTTP server bound, relying on a 200 ms sleep. Its ten-second lifetime could also end before the previous process attempted recovery. The six-attempt retry test imposed a 20-second aggregate launch budget without observing progress or retaining useful timeout diagnostics.

## Decision

Use an IPC ready message from the stale server's listen callback before the competing target runs. Keep the orphan's lifetime bounded at 90 seconds while its normal release remains the first previous-process bind failure. Use the existing diagnostic lifecycle waiter with a 60-second observation bound and 90-second test bound for both complete scenarios. Assert the ordinary retry fixture executes exactly six attempts as well as preserving its no-rollback/no-give-up checks. The cutover fixture still requires two rejected target attempts, one previous bind failure, no accepted target ownership, and the restored previous response.

## Alternatives considered

Reducing lane concurrency alone helped but did not remove fixture timing assumptions. Weakening assertions, skipping tests, or changing production retries would hide the behavior under test. A larger bounded integration budget is appropriate for process orchestration, which is not a latency contract.

## Consequences

Only test setup and observation change. Production timeouts, retry limits, authentication, ownership checks and restart behavior remain unchanged. Broken behavior still fails a bounded wait with lifecycle diagnostics.

## Testing

The full guard lane covers both real-process scenarios with exact outcome and attempt-count assertions. The complete repository gate remains required before merging.
