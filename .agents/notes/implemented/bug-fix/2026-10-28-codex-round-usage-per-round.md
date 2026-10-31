# Agent Note: a live Codex round settles with its own spend, not the thread's running total

Status: implemented

## Problem

The app-server's `thread/tokenUsage/updated` carries `last` (one API call) and `total`, and `total` is cumulative over the whole THREAD. A room member resumes one thread for every round. So the settled report carried everything the thread had ever spent. In room 5d4f0d41, 游戏策划大师's rounds read 2.15M → 2.25M → … → 3.04M. The room's stats line sums rounds, so it showed 28.2M where the host's switcher (which sums per-call usage in the child session) showed 5.3M. Room 2e44ba43's Codex member had the same pattern (0.49M → 9.27M, monotonic). It only looked plausible because each round added about 65K.

## Decision

The live driver diffs `total` against the thread total before the round's first call. That baseline is the first notification's `total` minus its own `last`, so it needs no state across rounds. The per-call `last` stamps on transcript lines are unchanged.

## Alternatives considered

- **Sum the round's `last` values.** This is equivalent when every call notifies exactly once; the diff stays right if a notification repeats.
- **Diff consecutive rounds in the room.** That puts provider-wire knowledge in the room, and it breaks on the first round after a restart.

## Consequences

The room's per-reply usage and the stats total now agree with the host switcher for new rounds. Already-journaled `room/execution-metadata` keeps its cumulative values; nothing rewrites history.

## Testing

`local-agent-codex` (264): a new live-driver spec resumes a thread whose total already holds earlier spend and expects the round's own 14/7/16.
