# Agent Note: the Kimi fold never writes into a closed turn

Status: implemented

## Problem

The Kimi member 人物建模大师 (child session 2e9c1ffb…) became unreadable again on 10-27, and Context Lens lost every round of that member after round 23. The chat still looked fine because it shows the in-memory session; the stored log failed the strict reader.

The chain of events:

- From 10-26 on, every fold of this member threw: `readKimiTranscript` called `.trim()` on a `ReadMediaFile` result, whose output is a content-part array. The mirror offset never advanced. The visible replies came only from the live stream's finalized steps, so the member had no usage and no model name. 0dec71fce fixed the parser on 10-27 (deployed around 12:39).
- At 13:09 the member was reattached for a new round. The mirror offset lives in memory and started at 0. With the parser working, the fold read the whole wire, 191 lines, and wrote the backlog under its wire turn numbers: turn 1's never-folded steps landed as `turn 1, step 32` inside open turn 11, followed by about 155 more tool calls. The released-log reader admits events only inside the open turn, so it rejected the whole log.

## Decision

`mirrorKimiSessionDelta` skips every unit whose turn already has a `turn/end` in the child log, and the offset still moves past it. Both the live and the exec settle paths fold before they write `turn/end`, so a round's own final fold is never skipped.

The backlog of closed turns is not written (option A, chosen by the user). Earlier rounds keep what the live stream showed, without usage or model. Writing the backlog back would need an offline rewrite of the log each time.

The 2e9c1ffb log was repaired offline. The 591 backlog events written into closed turns were dropped, turn 11's own 24 messages were kept, and seqs and tool-result references were reassigned. The same pass repointed 22 tool results in 2377f26d whose top-level `sourceEventSeqs` were left one off by the 10-25 repair (that repair shifted seqs but remapped only `data.sourceEventSeqs`).

## Alternatives considered

- **Persist the mirror offset across restarts.** This avoids re-reading the wire, but a backlog the offset never covered would still be written into closed turns. The guard is still needed.
- **Map backlog units onto the current turn.** That would mix old work into the current round's view and accounting.

## Consequences

- After a restart or reattach, a Kimi member writes only into the round it is running.
- Coordinated with the session that made 0dec71fce: no conflict with its room changes. The `room/run-moved` branch only affects display.

## Testing

`local-agent-kimi` (289). A session-mirror spec puts a closed turn 1 with never-folded wire steps next to an open turn 2. Only turn 2's tool and answer are written, the answer is last, and the released log is valid. The previous code writes turn 1's tool into the log and fails the spec.
