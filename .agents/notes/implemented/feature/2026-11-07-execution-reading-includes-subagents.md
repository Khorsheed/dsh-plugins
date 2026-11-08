# Agent Note: A member's execution reading includes its CLI subagents, and the room counts them in

Status: implemented

## Problem

The room's per-round usage reads one member execution through the core's `readExecution` (batch 5 S6, "usage in one place"). That reading summed only the member's own calls. Once steps M3 and M4 mirror a member CLI's subagents as grandchild sessions ([Kimi](2026-11-07-kimi-subagents-mirrored.md), [Claude Code](2026-11-06-claude-subagents-mirrored.md)), their spend is recorded, but nothing read it. A Kimi round still showed zero for its subagents, which were often most of the round's spend.

The approved design `proposals/active/2026-11-06-member-cli-subagents.md` (not in the repository) calls this step M6. The user decided on 2026-11-06 that the subagents count toward the round and that the breakdown shows two lines, member and subagents.

## Decision

**Core (`packages/local-agent/src/index.ts`).** `readExecution` adds `subagents` and `subagentUsage`. Both fields were declared at step M0. They are computed by M0's `subagentReadingsFor`.

- The grandchildren are found in the member log's `subagent/catalog` rows whose `childId` starts with `<member>.sub.`, which is the deterministic CLI-subagent id. A host subagent's catalog row is never read as a CLI subagent.
- A grandchild's events come from its live session when it has one. Otherwise they are read once from storage and kept while the grandchild stays cold, the same rule the member's own cold read follows.
- The fields appear only when a grandchild execution names this execution in its `cli-subagent` cause. With no subagent the reading is exactly what it was before.
- `subagentUsage` stays apart from `callUsage`. A subagent's own `providerReportedUsage` stays on its `subagents` entry and is never added in.

**Room (`packages/room/src/client/round-usage.ts`).** `roundUsage` adds the subagents to the member's own line.

- The headline becomes the member's part plus the subagents' per-call sum. The member's part is the CLI total when the CLI reports one, and the per-call sum otherwise. The breakdown buckets add up the same way.
- The line carries `member` (the headline before the subagents were added) and `subagents` (their tokens, buckets, and how many subagents ran).
- A reused subagent counts once, because it is one session (user decision).
- A round where only the subagents spent still gets a line.
- The "calls vs CLI total" check still compares the member's own calls against the CLI total, so a Claude round does not start reporting a false gap.

**Room display (`RoomSpeechView.tsx`).** The reply's usage chip shows the new total. Its hover panel adds two rows, "成员自己" and "子智能体（n 个）". The meta row gets a small text, "这一轮用了 n 个子智能体". Clicking it opens the member session.

The design also says the click should scroll to the first subagent card. The cards belong to step M5, which another agent is building, so the scroll is left to that step. The team totals (`memberUsage`, `executions.ts`) read `roundUsage`, so they now include the subagents too.

## Alternatives considered

**Add the subagents into `callUsage` in the core.** Rejected. `callUsage` is compared with the CLI's round total, which covers only the member's own calls. Mixing in the subagents would turn every Claude round's check into a false "more than the CLI total" hint.

**Show the subagents on a separate line and keep the headline as the member's own.** Rejected by the user decision: what a dispatch cost should include the subagents it ran.

**Keep the grandchild ids in a member-side index.** Rejected. The catalog row is already the recorded parent link that the host lineage uses. A second index would be one more copy to keep in sync.

## Consequences

- When subagents ran, a member execution's reading costs one grandchild read each. A live grandchild is read from its snapshot; a cold one is read once from storage.
- New room locale keys: `usage.member`, `usage.subagents`, `speech.subagents`. Each is in zh and en.
- No room event types were added, and nothing is journaled. The numbers are computed on each read.

## Testing

- `packages/local-agent/tests/execution-read.spec.ts`: a new `readExecution` case. With no subagent, the reading has no `subagents` field. With a live grandchild, it gets `subagents` and `subagentUsage` while the member's `callUsage` is unchanged, and a host-subagent catalog row is ignored. In another process, with both logs cold, the same reading comes back from storage.
- `packages/room/tests/usage-reading.client.spec.tsx`: three new cases.
  - Kimi goes from 0 to including subagents: the before line, the after line with both parts, a resumed subagent counted once, and a round with only subagent spend.
  - A CLI total with subagents: the gap check uses the member's own calls only.
  - The reply's hover panel shows the two rows, and the small text opens the member session.
