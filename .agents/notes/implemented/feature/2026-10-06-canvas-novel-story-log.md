# Agent Note: canvas-novel story log — relation cards, card history, and the story log page replacing the foreshadow ledger

Status: implemented

Supersedes part of [the three canvas surfaces](2026-10-05-canvas-novel-surfaces.md): its foreshadow ledger page (`novel:ledger`) is deleted and replaced by the story log page (`novel:story-log`).

## Problem

The foreshadow ledger answered one question: how long each foreshadow has slept. Writing a long novel, the user also needs three things the canvas could not show:

- how a relationship between two people got to where it is, step by step;
- which field on a character card changed, by whom, and in which chapter;
- which chapters each character appears in, and what they went through.

Separately, when the model judged a relation's stage from a descriptive "relationship depth", its scale drifted from call to call. The ledger's 「势」 (tension) was also a score the model jotted down that nobody maintained or used.

## Decision

This batch is eleven commits on `feat/canvas-novel`.

- **Clean up before adding** (37f5b009):
  - Removed 「势」, the confidence notes inside card fields, `reconciled` / `autoImported` / `extractedBy` / `firstChapter` / `word_count` and `retractExperience`; code now counts words from the text.
  - The user's star now marks a foreshadow's importance, stored as the sidecar's `starred`. Sleep thresholds: 4 chapters for starred, 6 for the rest, both through `isOverdue`.
  - Sleep counts the reconciled chapters after the foreshadow in reading order; chapters being planned or written do not count.
- **Foreshadow state derives from mentions** (13872844): 推进中 and 已揭晓 come from the mention journal; only 已放弃 and 未埋 are still set by hand.
- **Plan gate** (46704dd3): text goes only into chapters whose plan is confirmed. Replanning clears the confirmation, so the user confirms again. The user's own manuscript needs no plan, and reconciliation does not check it against one.
- **Stars and injection** (d8697bd1, dcfabda4):
  - Starred foreshadows lead the plan brief and are never cut by the budget.
  - The write brief injects appearance and voice; the plan brief injects want, lack and wound.
  - The card page gains a star toggle and 「此刻」 editing; more than five stars gets a soft hint.
- **Info gaps** (dff811fb): the plan says who learns what; reconciliation checks it against the text and pends it, and adopting it updates the character card's knows / unaware.
- **Relation cards** (b8f278c0, with the canvas-side d3e99dfe):
  - One card per pair. Seven types, four levels each, plus two states: rift and break.
  - Each chapter the model only scores a present pair −2…+2; code banks the points, and 3 points mark the pair 可升 (ready).
  - Moving up, rifts, breaks, repairs and type changes all go to review, and all need evidence from the text.
  - The 关系 line on a character card is now derived from the relation cards.
  - A new genre version adds the 关系 role; a canvas that already chose the genre gets that category on its next write (`seedMissingRoles`).
- **Card history** (90e1dd0e):
  - Snapshots of the plot fields of character and world cards live in the annotations, and `ensureRefs` compares them on every sync.
  - Each write site declares the fields it wrote (model reconciliation, adoption); any other change counts as the user's own canvas edit, is stamped with the current chapter, and goes to `history.jsonl`.
  - A hand edit of a relation card's type or stage is not history: it appends a `set` or `type` event to the relation journal and resets progress.
- **Story log page** (139a887c):
  - A new Remote, `storyLog`, merges the foreshadow mention journal, the plan marks of chapters not yet reconciled, the relation journal, character appearances (plan cast, POV, experiences), `history.jsonl`, and canvas edits the engine has not synced yet. That last part is read-only and never written.
  - After the user tried the first version, the page was rebuilt to the v3 prototype (`proposals/prototypes/canvas-novel-story-log-v3.html`, not committed): one tab per kind (foreshadows, characters, relations, world), each with its own hue, filter pills with counts, and its own sorts. The table has rows down and chapters across, with sticky row heads and the current chapter column tinted. Each cell carries one mark, the heaviest of the chapter (settled beats planned), and planned marks are hollow. The legend is folded away behind a toggle. A single side detail replaces the Now/Changes tabs. Below 860px the table and the detail show one at a time, with a crumb back. The minimap and zoom are gone.
  - The relation wording no longer shows 积分 or 建卡: a points entry reads 加深 / 疏远 (明显 when |delta| ≥ 2), a level-up reads 「prev → stage」, a repair reads 回到「stage」, and a type change reads 转为〈type〉.
  - `LedgerPage.tsx`, the `ledger.*` strings and the ledger styles are deleted. The `ledger` Remote stays: the pending strip's counts and `novel_read ledger` still use it.
- **Relation evaluation criteria** (1f181b6c): `packages/canvas-novel/docs/relation-criteria.md`, paired zh/en.
  - The score bands are now one constant, `RELATION_POINT_SCALE`, and the reconciliation prompt lists an anchor example for each band.
  - It asks for one score per pair per chapter.

## Alternatives considered

- **Have the model score a relation's total** (e.g. "depth 65"): the scale drifts, so no. As with affinity in games, it moved to per-event points plus a key scene.
- **Split relations into trust, intimacy and hostility**: the user decided against it; one axis plus a type.
- **Keep the story log as a page beside the ledger**: the rows have the same shape (one thing changing chapter by chapter), and one page lets foreshadows and relations be read against each other.

## Consequences

Decisions made overnight without the user, for review in the morning:

1. **The first sync only takes the snapshot, and logs nothing**: edits made before history was enabled never show up under Changes.
2. **A hand edit of a relation card's stage or type reaches the relation journal only at the next sync**, stamped with the current chapter at that moment.
3. **The current chapter is the newest one, including one being planned**: in the seed, chapter 5 is being written and chapter 6 planned, so a user edit lands on chapter 6. If it should land on the last written chapter instead, that is one change.
4. **One field edited by the user and then by the model in the same sync**: only the model's row remains, with the user's value as its `from`; there is no separate 「你改的」 row.
5. **Canvas edits not yet synced**: the story log shows them live as 「你改的 · 第 N 章前后」 but writes nothing; they land in `history.jsonl` when the next write triggers a sync.
6. **Replanning clears the plan confirmation**: any change to the plan content needs a new confirmation; a title change alone does not.
7. **The `set` event**: a stage set directly on the card reads 「手动改成〈阶段〉」 under Changes, with the legend 「手动改阶段」, kept apart from moves the model proposed and you adopted.
8. **A repair returns to the level held before the rift**: the newest stage event in the relation journal that carries a level; level 1 when none does.
9. **The four level names for 其他 (相识, 亲近, 交心, 确立) are mine**: the prototype had none.
10. **The old hand-written 关系 field on character cards is no longer read**: the text stays on the card, with no migration and no notice.
11. **The page key moved from `novel:ledger` to `novel:story-log`**: a canvas still on the old ledger page shows the canvas fallback 「这一页属于没有安装的体裁」; going back to the board and clicking 「故事日志」 fixes it. The fallback text is misleading here, but I added no alias for the old key, to avoid leaving zombie code.
12. **What "planned" means**: plan operations of chapters not yet reconciled (planning or writing) are drawn hollow. After reconciliation the mention journal rules; a missed plan goes to review, with no dashed cell.
13. **World cards created before the baseline have no marks on the world tab**: only changes after the snapshot are recorded. The detail says so. Falling back to the card's source chapter, as characters already do, is a possible follow-up.
14. **The prototype's 「牵涉」 chips on foreshadows (linking them to characters) are not built**: they need new data; waiting for your call.
15. **A relation row's starting level**: when the journal's first entry is not a stage event (an old card with points first, say), the start is taken from the card's current level.
16. **"One score per pair per chapter" lives only in the prompt**: code does not enforce it. Several scores for one pair in one chapter add up one by one, each capped at ±2.
17. **The duplicate cards on the 3195 trial instance**: untouched, left for you to clean up.
18. **World cards without a name read by their setting's opening clause**: the text up to the first `：，。；` or `——`, capped at 18 characters (「异界森林：树木……」 reads 异界森林). These cards were written before names were required, and they used to show their ref (w1).
