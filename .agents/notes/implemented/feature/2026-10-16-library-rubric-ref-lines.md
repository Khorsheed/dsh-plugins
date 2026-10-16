# Agent Note: Library — acceptance lines carry ids and may be machine-checked (v5 first cut)

Status: implemented

## Problem

Two live frictions from the practice-station design, both visible in the same 微积分 session: (1) a station that should gate on "do the exercises AND pass the quiz" had to split into two nodes, because a practice station could not reference a quiz — its acceptance line 「完成本站测验 ≥ 通过线」 was prose the coach eyeballed, not a check the system ran; (2) verdicts joined acceptance lines by VERBATIM text, so a replan that reworded a line orphaned its history.

## Decision

- **Acceptance lines gain stable positional ids** (`L1`, `L2`, …) via `acceptanceLines()` (types.ts): verdicts now resolve a line by id or by verbatim text (the legacy form), and are ledgered with the canonical id + text. Rewording a line in a replan no longer orphans its verdicts.
- **A line may be machine-checked**: authored as `{ line, ref: <quiz id> }` (the quiz must exist before the draft — the shape validator refuses otherwise). At acceptance time the service auto-judges ref lines from the referenced quiz's latest sitting (pass = ratio ≥ the roadmap's pass line, `by: "auto"`), refuses coach verdicts for them, and folds them into the same ratio and cascade. A failing ref line creates no card — the quiz sitting already carded its misses.
- ~~The practice acceptance tab renders the rubric with the ref link~~ **Superseded (2026-10-16)**: the acceptance tab is removed; practice acceptance is conversation-only — see [the acceptance-tab removal](../simplification/2026-10-16-library-acceptance-tab-removal.md). The service-side machine checking this note added is unchanged: ref lines still auto-judge from the referenced quiz's latest sitting, and the coach judges the rest by line id (ids are listed wherever the coach reads the roadmap).
- `LibraryVerdict.by` widens with `'auto'` (never accepted from a caller); the attempt normalize keeps it.
- Deliberately NOT in this cut: the Assessment entity fold (practice rubric as its own file) and `Attempt`'s single `assessmentId` key — those ride the Resource merge (the v5 second cut), when the whole layout moves anyway. The `quizId | nodeId` pair stays on disk unchanged.

## Alternatives considered

- **Let quizzes attach to practice nodes**: rejected — it forks the gate semantics (two completion paths per station); the ref line keeps one gate (acceptance) with a machine-checked row inside it.
- **Practice assessments as stored files**: rejected for this cut — a derived rubric (positional ids over the node's lines) needs zero migration; stored practice assessments add a write-at-adopt path with no capability gain until the Resource merge.

## Consequences

- The 练习+测验 two-node pattern collapses into one station: rubric = [machine-checked quiz line, human-judged work lines].
- Existing string lines and verbatim-criterion attempts read back unchanged (compat covered by the untouched legacy tests).
- The coaching order for a gated practice station is now: compose the quiz FIRST (book-level, no node), then draft the path referencing it.

## Testing

service.spec.ts (+1): the full ref flow — unknown ref refused at draft, no-sitting auto-fail, coach verdict on a ref line refused, quiz pass → auto-pass → completion + unlock, and the auto verdict surviving read-back. tool.spec.ts: unchanged behavior through `library_roadmap` / `library_assess`. 131/131 green.
