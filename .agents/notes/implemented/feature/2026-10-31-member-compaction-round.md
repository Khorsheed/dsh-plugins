# Agent Note: a CLI member's context compaction runs as a round of its own

Status: implemented

## Problem

External CLI members compact their context, but the family had no way to ask them to, nothing recorded when they did, and Kimi's compaction spend leaked into the next round's usage. Live probes on 2026-10-30 (Kimi 2.1.1 over ACP, Codex 0.163 app-server) fixed the shapes:

- **Kimi.** `/compact` as a prompt returns at once and compacts in the background. While it runs, a prompt is **dropped silently** (`end_turn`, nothing recorded). The wire writes `full_compaction.begin` → `llm.request kind:compaction` → `usage.record usageScope:session` → `context.apply_compaction {summary}` → `token_counting.rebased` → `full_compaction.complete`.
- **Codex.** `thread/compact/start` runs as a turn of its own (a `contextCompaction` item). A `turn/start` meanwhile is refused with `ActiveTurnNotSteerable { turn_kind: Compact }`.

User decisions are in the local mockup `proposals/prototypes/member-compaction.html` (2026-10-31).

## Decision

- **Compaction is a resume round with `operation: 'compact'`.**
  - It is carried on the resume intent and on `DelegationCallOptions`.
  - `LocalAgentRegistry.compact(parent, provider, child)` is a resume with that operation.
  - The round takes the member's FIFO slot (`MemberControls.run`), so a running round finishes first, and input sent meanwhile queues behind it until compaction ends. Waiting for the CLI's own end, rather than for its prompt ack, is the whole point for Kimi.
- **Kimi** (`compactLocked`):
  - sends `/compact` on the resident session;
  - polls the wire from the pre-compaction line count until `readKimiCompaction` reads an end (`kimi-compaction.ts`);
  - takes the summary, its session-scoped spend, and the token counts before and after.
- **Codex** (`compactLocked`):
  - calls `thread/compact/start`, then holds until that turn's `turn/completed`;
  - takes the turn's `tokenUsage.last` and `modelContextWindow`;
  - the runtime now keeps the thread's `contextTokens` / `contextWindow`, refreshed by every round's `thread/tokenUsage/updated`.
- **What a compaction round writes:** no turn, only one `local-agent/compaction` event (`LocalAgentCompactionEvent`) — `source`, `outcome`, `provider`, `model`, the token counts before and after, `contextWindow`, `usage`, `summary`, `error`, `startedAt`, `endedAt`, `boundarySeq`. The type is registered in the host's known-event catalogs, beside `local-agent/stream`. It deliberately does not reuse the host's `compaction/*` events, whose surface replacement must not run on a mirrored CLI log.
- **The Kimi transcript parser skips `usageScope: 'session'` records**, so a compaction's spend — manual or the CLI's own — never rides a round's usage.
- **The exec fallback refuses compaction**: a one-shot process cannot hold the queue through a background compaction.

## Alternatives considered

- **A separate compaction path outside the round chain.** That would duplicate runtime spawn, session load and queueing, and miss the FIFO that makes the queue-until-done behaviour free.
- **Writing the host's `compaction/*` events into the child log.** Those drive the host's history replacement; on a mirrored log that is wrong.

## Consequences

The family can compact a member, input waits correctly, and the event gives the UI and Context Lens the facts. No entry point calls `compact()` yet: the `/compact` command, the occupancy ring, context-guard's reminder, and detection of the CLI's own compactions come next. The Context Lens request is drafted locally (`proposals/active/2026-10-31-context-lens-member-compaction.md`).

## Testing

- `local-agent-kimi` (304):
  - `kimi-compaction.spec` reads completed, unfinished, failed, cancelled and automatic compactions, plus the latest token count;
  - a `session-view` spec keeps the session-scoped spend out of round usage;
  - a live-driver spec holds the round until `.complete` lands 700 ms after the ack, writes no turn, and records the event with summary, spend and token counts.
- `local-agent-codex` (265): a live-driver spec sends `thread/compact/start`, stays unsettled through the compaction turn, writes no turn, and records the event with the turn's usage and `modelContextWindow`.
- `local-agent` (428) stays green.
