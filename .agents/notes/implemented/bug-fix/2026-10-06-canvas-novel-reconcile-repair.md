# Agent Note: canvas-novel reconciliation — re-reconcile on body change, failed imports stay open, no plans on user drafts

Status: implemented

## Problem

A production session imported five chapters the user had written themselves (用户原稿). The outcome was wrong in several ways:

- The skill said "if the user skips planning and asks you to write, register a default plan first". The model applied this to user drafts too, so chapters 2–5 got plans nobody asked for.
- The subagent call failed on a bad argument. The model then wrote the extract JSON by hand. Its quotes joined two passages with an ellipsis or ran past 50 characters, so the evidence gate dropped nearly everything.
- That first, empty import still marked the chapter 已抽取. A chapter could be reconciled only once, so there was no way back. The model then told the user the reconciliation had succeeded.
- A world memory that matched an existing card was dropped as a "duplicate" and left no trace in the chapter. A new character named 「透镜（已登记c6，无新角色需要登记）」 became a second card.
- The model also left scratch JSON files in the user's folder and added header lines to the manuscripts.

## Decision

- **Body fingerprint.**
  - `ChapterRecord.bodyHash` records the body (whitespace removed, FNV-1a) that the last 对账 read.
  - `effectiveChapterPhase(chapter, fingerprint)` returns the new phase `stale` (待对账) whenever the stored hash differs from the current body. Rows from before the fingerprint read as stale too, so production chapters 1–5 can be re-reconciled.
  - Both `writing` and `stale` chapters reconcile. A chapter whose body has not changed refuses a second import.
  - There is no 定稿 button: editing the text is what reopens a chapter.
- **Chapter-scoped replace.** A re-import first drops the chapter's lines from the mention, experience and relation-point journals, plus its undecided pending items, then writes the new ones. Pending ids are never reused.
- **Failed import writes nothing.** A pre-pass checks every quote. If more than half miss, the import returns `settled: false` and writes nothing. The tool says 「未对完」 and gives a reason per quote:
  - `evidence-spliced`: the quote contains an ellipsis;
  - `evidence-too-long`: over the length cap;
  - `evidence-not-found`.
  It also tells the model to hand the quotes back to the subagent instead of hand-writing JSON.
- **No plans on user drafts.**
  - `writeChapter` refuses a plan on a byUser chapter with `plan-on-draft`.
  - The prepare pack strips any plan from a byUser target.
  - A byUser import deletes a legacy plan, its confirmation and its delivery.
- **Existing settings.**
  - A world memory whose (aside-stripped) name matches a live card, or the opening words of an unnamed one, is linked: it goes into `ChapterRecord.settings`.
  - If the chapter's content differs from the card, a `setting` pending item asks which version wins. Accepting it patches the card's `rule`. The card is never overwritten or deleted by a 对账.
  - Character names are compared with their （…） aside stripped.
  - A new foreshadow whose question matches an existing one is skipped.
- **Story log shows the story only.**
  - Foreshadows need a mark, relations need a journal entry or an origin, characters need an appearance.
  - World cards need a settled chapter's `settings` entry or an origin chapter. Free inspiration cards stay on the canvas without cluttering the log.
  - Chapter headers read 计划 / 待对账 / 已对账.
- **Skill.**
  - Reconcile 待对账 chapters before planning or writing; `novel_read(chapters)` lists them.
  - Do not wait for 「定稿」.
  - On a subagent error, fix the arguments and retry; never hand-write the JSON.
  - Never edit the body or add annotation lines, and never leave temp files in the user's folder.
  - Inspiration cards are allowed.
  - The extract brief's rule 1 now says "one continuous passage, no ellipsis splicing".

## Alternatives considered

**A 定稿 (final) button the user presses before 对账.** Rejected by the user: it adds a step, and people revise after "final" anyway. A fingerprint notices every edit without asking.

**Append-only re-reconcile (keep the old lines, add new ones).** The journals would then double-count a chapter's mentions and relation points after every revision. Replacing by chapter keeps them a faithful reading of the current text.

**Let the import land whatever quotes did match.** That is what locked the production chapters with an empty reading. Below half matching, the subagent output is untrustworthy as a whole, so nothing lands and the chapter stays open for a corrected retry.

**Overwrite a card when a chapter states a setting differently.** A 对账 reads the text; it must not decide which version of the world is canon. The conflict goes to the person as a pending item.

## Consequences

- After deploy, the five production chapters show 待对账. Re-reconciling them rebuilds their journals and drops the stale plans on chapters 2–5.
- Data the model already wrote outside the store (the scratch JSON files, the header lines in 第1章.md / 第2章.md, card c7) is not touched by code. The user cleans it up by hand.
- `normalizeChapter` now carries `bodyHash` and `settings`. An older build reading a newer table drops both. The chapter then reads stale again, which is safe.
