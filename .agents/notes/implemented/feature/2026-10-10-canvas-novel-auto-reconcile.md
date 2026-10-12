# Agent Note: 对账 writes straight to the cards, and 设定 · 最近更新 shows what it did

Status: implemented

## Problem

The person found three frictions on 3080 (2026-10-09):

- **Review was a chore.** 「审过」 and the 待审 queue made every chapter wait on a person, who in practice only wants to fix what is wrong.
- **The 已对账 card opened the chapter page.** That page shows the plan and the text, not what the 对账 wrote into memory.
- **Writing a chapter's text produced a second 「计划 · 已确认」 card.** The body write answered with the plan answer.

They also asked what 「走向 5 拍」 means.

They agreed the shape on a prototype (local `proposals/prototypes/canvas-novel-recent-updates.html`) and then decided:

- A setting the text words otherwise is updated and the person is told; there is no second gate.
- 最近更新 keeps only the newest 对账: looked at and left alone means accepted.
- No 「恢复成对账前」: the person asks the agent if they want something undone.

## Decision

- **对账 asks nothing.** In `extractImport` (`packages/canvas-novel/src/store.ts`):
  - Mentions and experiences record at high and medium confidence; a planned op's mention records at any confidence. Low-confidence guesses outside the plan are left out.
  - A missed planned op is a reminder: `report.planMisses`, the plan block's ✗, and one line in the answer.
  - 信息差, relation level-ups and type changes, and settings the text words otherwise used to wait. They now go through `materializePending` right after the import's own writes, with `source: 'model'` in the card history. The answer lists them (`report.applied`).
  - A differently worded setting **adds** `（第N章）…` to the card's 设定 and never replaces it. The 设定 cards hold long paragraphs, and a 50-character extract would destroy them. The match is a loose substring check, so most "conflicts" are paraphrases.
  - An earlier 对账's undecided items for the chapter are discarded. Items left from before stay readable and acceptable.
- **No 审过.**
  - The chapter page's progress is 规划 · 写作 · 已对账.
  - The 审过 button is gone, and 已审过 rows read as 已对账.
  - The 章节 badge counts only chapters to reconcile.
  - The table of contents counts 已对账.
  - `reviewChapter` stays in the store and Remote for compatibility, but no surface calls it.
- **设定 · 最近更新.**
  - Each import stamps `extractedAt` and `newCards` on its chapter row. A mention line now keeps its `evidence`.
  - `store.recentUpdates` reads the newest import back from the journals into per-card `RecentNote`s: card history (`source !== 'user'`, at that chapter, since `extractedAt`), mentions, experiences, the relation journal, and `newCards`. The `recentUpdates` Remote exposes it.
  - `CardScopes` adds a 「最近更新 · 第 N 章」 scope with one `notes` line per card.
  - `@khorsheed/dsh-canvas` gains:
    - `CanvasCardScope.notes`, drawn under each card while that scope is pressed (`.scopeNote`);
    - `canvasNav.openFace(canvasId, face, scope)`, backed by `CanvasSelectionStore.openBoardFace`, which is a one-shot `ask` on the snapshot that `CanvasTab` answers once the canvas is open. It is never stored.
- **Conversation cards.**
  - A body write answers `已写入第 N 章《…》正文（画布 … · N 字）`. `write-row.ts` reads that as state `body`, and `BodyCard` shows the length, the opening lines and 读正文 →.
  - `ExtractCard` shows 情节 x/y · 伏笔 a/b, 新建 N, and 改了已有卡 M (parsed from the answer). Its door is 看最近更新 → (`openFace(…, 'board', 'recent')`), and it falls back to the chapter page.
- **情节 N 段 replaces 走向 N 拍** in every person-facing string and in the plan edit box (`情节：` is read as an alias of `走向：`). Answers written before this still parse.
- **The skill and the extract brief follow suit.** They describe no review step, say what to tell the person after an import, and spell out that medium records and low is left out.

## Alternatives considered

- **A per-chapter review strip on the 故事 face.** This was prototyped in `canvas-novel-chapter-review.html` and rejected: it added a page and kept review as a duty.
- **Ask the person about conflicts.** Rejected by the person: tell them afterwards, and they reply if they want a change.
- **Replace the setting's text with the chapter's line.** Rejected: it loses the card's long description to a short extract.
- **Persist a separate `last-import.json`.** Rejected: the journals already hold everything. Only `extractedAt` and `newCards` were missing, because foreshadow cards have no change history.

## Consequences

- A wrong 对账 finding lands until the person notices it. 最近更新 and the answer's list are the only nets.
- Chapters reconciled before this change have no `extractedAt`, so 最近更新 appears only from the next 对账 on.
- Pending items from before stay listed on the chapter page and in the contents queue until they are handled. Nothing new joins them.

## Validation

- `pnpm --filter @khorsheed/dsh-canvas-novel run build && run test`: 162 tests.
- `pnpm --filter @khorsheed/dsh-canvas run test`: 619 tests.
- `pnpm check:panels` for both packages; `pnpm check:plugins`.
- Import tests were rewritten for the new rules:
  - medium mentions record and low ones are left out;
  - a missed op is a reminder;
  - 信息差, level-ups and settings apply at once;
  - an old queue item still accepts;
  - `recentUpdates` reads the newest import.
- New client tests cover the body card, the 已对账 card's face door, the 最近更新 scope and its notes, and the canvas's scope line and outside face ask.
