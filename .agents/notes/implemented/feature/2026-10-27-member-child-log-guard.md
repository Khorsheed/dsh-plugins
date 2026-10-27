# Agent Note: member child-log write guard and repair command

Status: implemented

## Problem

Between 10-24 and 10-27, member child logs became unreadable in seven different ways: a restart left a turn open; Claude kept writing after a cancel; Kimi wrote steps out of order and with gaps; Kimi wrote steps that started below a higher one; Kimi folded a backlog into closed turns after a reattach; Kimi treated a Skill injection as a new turn; Kimi re-wrote orphan duplicates after the answer. Each provider keeps its own turn/step bookkeeping, and the host's stored-log reader is all-or-nothing. One event outside the released V4 relationships hides the whole member from the history view and Context Lens. Every case had to be found and fixed by hand.

## Decision

- **Write guard (`packages/local-agent/src/child-log-guard.ts`).** The registry installs it, idempotently, on every member child session at preparation, at reattach and at the first sync, so the four provider packages need no change. It wraps the session's `append` and decides each relational event before it gets a seq:
  - It **corrects** what has one right answer. A step takes the turn's next number, and the provider's number becomes an alias that later events follow. Content naming a never-opened turn joins the open turn. An open turn or step is closed with the host's own `interruptedTurnClosers` before a new one starts. A step-bound event with no open step opens one. A result whose advertised call never started gets its tool/call first.
  - It **diverts** what has no valid place: an event of a closed turn, an event with no open turn, or a tool event with no advertised call. Diverted events go to `<local-agent homes>/quarantine/<childSessionId>.jsonl`, each with its reason, and the first event per session and reason logs a warning.
  - It **verifies** each corrected event with the host's released-log check (`assertReleasedV4Relationships`, probed at load time, degrade if absent), so its rules cannot drift from the reader's. It only judges a new event against a log that already passes the check; a log that was invalid before the guard never makes a round divert.
  - Events without turn/step relationships pass through untouched.
- **Repair command (`pnpm repair:member-logs`, `scripts/repair-member-logs.mts`).** The default run reports every member log the strict reader rejects and how it would be repaired. `--apply` repairs those no process holds, with a backup outside the session directory, the host's framing (a header frame, then an event frame), and a strict re-read before replacement. `--quarantine` summarizes the guard's diverted events. The rules are the ones each incident was repaired with.
- There is no automatic in-plugin rewrite on reattach. The host persistence API has no rewrite, and rewriting stored files from a plugin would reimplement the host's storage and race its write ownership. An upstream request for a host repair API is the long-term path.

## Alternatives considered

- **Fix each provider again.** The seven shapes came from four drivers' separate bookkeeping. One guard in core covers new shapes too.
- **Drop invalid events.** Diversion keeps them, and their reasons point at the provider bug.
- **Consolidate the provider family now.** The live drivers are under active edits in other branches. The guard is the first shared layer; a family consolidation design follows separately.

## Consequences

- No provider slip can make a stored member log unreadable again. At worst a late event lands in the quarantine file instead of the log.
- A quarantine entry with real answer content, rather than noise or a duplicate, signals a provider bug.
- The repair command needs `DSH_HARNESS` (it uses the harness's zstd and format catalog).

## Testing

- `local-agent` (418): the guard spec writes each incident shape through a guarded session (step gaps and repeats, a never-opened turn, an open turn before the next, late writes after a cancel, a backlog into a closed turn, unadvertised and never-started results, an already-invalid history) and asserts the host check passes with nothing silently lost. It also asserts that a well-formed round passes through unchanged.
- The repair spec covers the rules. The 9 pre-repair backups from 10-25 … 10-27 were used as a test home: 6 were unreadable, and all 6 read after `--apply`. Prod's 51 member logs read and the quarantine is empty.
