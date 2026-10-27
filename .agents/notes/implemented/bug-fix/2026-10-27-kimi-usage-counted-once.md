# Agent Note: a Kimi wire usage record counts once

Status: implemented

## Problem

Context Lens's session map for room 2e44ba43 had one bar far above all others: a Kimi member request recorded 3,201,120 input tokens with 112,640 cached (fbc8ba18 turn 43, a round cancelled after 40 s). Kimi's own wire held one usage record for that round: 320,112 input and 11,264 cached. The mirror had carried that record exactly ten times.

A mirror pass owns the usage records in `[fromLines, consumedTotal]`. The boundary is inclusive, so a record flushed right after its content is never missed. When a unit stays held (the round's only wire step never closed), the offset cannot advance, and every live poll re-reads the same window. Each poll returned the boundary record again as unattached usage, the driver summed it into the round's remainder, and the cancel's settle wrote the total onto the round's only step.

## Decision

`mirrorKimiSessionDelta` remembers, per child session (a `WeakMap` keyed by the `Session`), the wire lines of the usage records it has counted. Records already seen are excluded from every sum, and each pass marks its window's records as seen. Wire line numbers only grow, so a record is identified across passes and rounds. Both the live driver and the exec polls benefit without changing their calls.

## Alternatives considered

- **Make the boundary exclusive.** That would drop a record flushed right after its content, the case the inclusive boundary exists for.

## Consequences

A round's usage is each wire record once. Logs written before this change keep their inflated step. Context Lens's map now scales bars by the 95th percentile, so such an outlier no longer flattens the rest.

## Testing

`local-agent-kimi` (292): a session-mirror spec polls a held round ten times and asserts the record is carried once. The previous code carries 3,201,120, the in-the-wild figure.
