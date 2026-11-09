# Agent Note: A synthetic fixture of the 2026-11-09 restart incident

Status: implemented

[English](2026-11-09-restart-incident-fixture.md) | [中文](2026-11-09-restart-incident-fixture.zh.md)

## Problem

The restart-recovery consolidation (design `proposals/active/2026-11-09-restart-recovery-consolidation.md`, steps R1–R5) changes how a room, the local-agent core and a formal goal read a round a host restart cut off. The incident that motivated it (room 6a56367b, 2026-11-09) left a specific mix on disk: `uncertain` delivery edges, an English 「结果不确定」 report queued for the coordinator, a 「按没做完处理」 cancellation, a 「被取代」 cancellation written outside the plan, a human 「确认已完成」 in the core, five duplicate release reminders, and a plan stuck `paused` with one attempt `uncertain` and one `queued`. Each step must prove it reads that mix — and the shapes older logs carry — correctly, without copying the real session into a public repository.

## Decision

Step R0 adds fixtures only, no product code:

- `packages/room/tests/fixtures/restart-incident.ts` — `seedRestartIncident(room, cast)` appends the incident's event shapes (the comments name the incident seq each event stands for) to a room whose roster holds the cast, and returns the delivery ids, the seeded plan (the #1613 shape) and the two members' core ledger rows as they stood at #1613. Every name and text is invented (总编排 / 地图匠 / 剧情师, task-a / task-b).
- `packages/local-agent/tests/fixtures/restart-ledgers.ts` — ledger files as an old core left them right after the restart (`uncertain` rows, `pausedBy: 'restart'`), a ledger a host died on mid-round, and `writeLedger` to put one where the core reads it.
- `packages/room/tests/restart-recovery.host.spec.ts` — the bench later steps extend; its first case pins the replayed shape of the fixture (the goal paused, task-a's attempt `uncertain`, task-b's `queued`, the obsolete reports queued).

The room's core double (`tests/run-entry-shim.ts`) accepts `interrupted` and `reconciledAt` on seeded rows.

Real logs are only ever read through `zstd -dc … > /tmp/…`; nothing from them is committed.

## Alternatives considered

**Commit a trimmed copy of the real room log.** Rejected: the repository is public, and even trimmed the log carries session content. The event shapes are what the steps depend on, and those are reproducible by hand.

**One fixture per step.** Rejected: the steps must agree on what the incident looked like; one fixture keeps R2–R5 replaying the same history.

## Consequences

Later steps assert against one shared history, and the design's section G (what the room looks like after the upgrade) becomes an executable case. The fixture encodes the incident's shapes as understood on 2026-11-09; a shape it misses is a gap in the fixture, not proof the code handles it.
