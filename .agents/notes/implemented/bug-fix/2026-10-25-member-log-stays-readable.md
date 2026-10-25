# Agent Note: a member's child log stays readable across restarts and cancels

Status: implemented

## Problem

Context Lens reported `stored log is corrupt: SessionFormatError: turn/start does not open the expected turn` for a Claude Code member (session 2377f26d…). The chat looked fine because it showed the in-memory session. The stored log, however, could no longer be opened by the strict reader, so the member would also fail to reattach after the next restart. A scan of the logs written in the last two days found three such logs:

- **2377f26d (claude, restart).** 3080 restarted during turn 9. On reattach the cold log ended inside turn 9, and the next round wrote `turn/start {turn: 10}` without closing it. The agent loop's own resume closes an interrupted tail with `interruptedTurnClosers`, but the local-agent reattach (`LocalAgentRegistry`, the recipe every CLI member goes through) never did.
- **5dd078d9 (claude, cancel).** The parent cancelled turn 7 and `turn/end` was written. The round's event sink stays installed until the late `result` arrives, and in that window the CLI's `[Request interrupted by user]` notice was mirrored as a new step of turn 7, after its end.
- **bf220f56 (kimi).** The step number jumped from 1 to 3, an old log written before b1d0d972 fixed it.

## Decision

- **Reattach closes an interrupted tail** (`packages/local-agent/src/index.ts`): after the cold read, the host's `interruptedTurnClosers` events (missing tool errors, step/end, an `interrupted` turn/end) are appended through the write handle and seeded, the agent loop's exact order. The helper is read off the module namespace, so hosts without it keep the previous behavior. The documented reattach recipe carries the same step.
- **A settled Claude round writes nothing more** (`packages/local-agent-claude-code/src/live-driver.ts`): once settled, the sink only resolves a late `result` and drops every other event.
- **The three existing logs** are repaired offline by a script that runs only while 3080 is stopped (the open write handle keeps its own seq cursor). It inserts the missing `turn/end` (before the restart's end-seed marker), drops a closed turn's late events, makes step numbers consecutive, reassigns contiguous seqs with their references, validates with the host's strict reader, and keeps a backup.

## Alternatives considered

- **Close the open turn in each provider before its `turn/start`.** That is ten call sites in five packages, and the restart case is one shared path.
- **A lenient reader in Context Lens.** The chat's own reattach fails on the same log, so the log must be valid.

## Consequences

- A member interrupted by a restart shows its turn as interrupted, and its log stays readable.
- Codex, kimi and dsh live drivers may share the post-settle write; not observed in the scanned logs, not changed here.

## Testing

- `local-agent` (405): reattach of a log ending inside an open step yields step/end + interrupted turn/end, durably stored.
- `local-agent-claude-code` (269): after a cancel, a late interrupt notice, a late assistant line and the late result add nothing to the closed log.
- The repaired copies of the three logs pass the host's strict restore; the originals reproduce the reported errors.
