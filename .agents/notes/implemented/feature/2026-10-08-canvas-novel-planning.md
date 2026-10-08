# Agent Note: canvas-novel 规划 — one-page outline, volume roadmap, word budget, core suspense

Status: implemented

## Problem

The novel had a plan for each chapter and nothing above that. The one-sentence spine lived only in the skill's coaching text and was gone once the conversation moved on. How long the book is, how it splits into volumes, and where the writing has got to had no home. Three things followed from this in real use (the user's 《幻梦境》 and 《梦境守护者》, 2026-10-08):

- Chapter plans had no length, so the model packed seven or eight beats and five foreshadow ops into one chapter.
- A mystery meant to be revealed at the end got pushed into chapter 1. Every foreshadow was treated the same: 6 chapters untouched raised ⚠, and the 待埋 list never said *when*.
- Cards set up in discussion were filed as 已埋 before any text existed, with several questions in one card. The first part was fixed separately; see the story-log note's 2026-10-08 addition.

## Decision

- **A lead face 规划.** `@khorsheed/dsh-canvas` gains `CanvasGenreFaces.lead`: a genre face read first, before 成稿. A fresh canvas of the genre opens on it while nothing is written, and the store's genre summary passes it through. The novel declares `faces: { view: 'story', lead: 'plan' }`, so the tabs read 规划 · 章节 · 设定 · 故事. An older canvas drops `lead` from the summary and the novel simply has no 规划 tab.
- **`outline.json`** (per work, beside `chapters.json`) holds the following, read through `normalizeOutline`:
  - **The one page**: logline, 核心冲突, protagonist (a character card id), 成长弧线, theme, tone, ending, and 篇幅 `{words, volumes, chapters, perChapter}`.
  - **Volumes** `{id, title, chapters (an estimate), goal, landing}`.
  - **One-line sketches** of the next one or two chapters.
  - **One pending proposal**, and a revision history.
- **The outline stops at volumes.** That is as far as an outline can know: about how many chapters each volume has, what it achieves, and where it lands. A chapter is detailed only when the writing nears it. When planning a chapter, the model may sketch the next one or two; past that, a volume shows 「约 N 章，写到附近再细化」.
- **The model proposes, the person adopts.** `novel_write(what=outline, sheet/volumes/sketches/rationale)` merges into the one pending proposal:
  - Sheet fields merge; a volume list replaces the previous one; sketches merge by chapter number.
  - Volume ids stay stable: a volume whose title matches an adopted one keeps its id, so the chapters filed under it stay put.
  - The protagonist must resolve to a character card (`unknown-protagonist`).
  - Only the 规划 page's 采用 (`decideOutline`) folds the proposal in, as one revision with one history line; 不采用 drops it.
  - `novel_read(what=outline)` reads it all back, including the core suspenses.
- **The protagonist is their character card.** The character type gains 抱负 (`ambition`) and 价值观 (`values`), definition v3 (genre `novel@4`, so the canvas catch-up adds the fields to existing works). The one page keeps only a pointer to the card plus the arc. The plan brief's one-page block lists their 目标 / 抱负 / 价值观 / 缺失.
- **Chapters file under volumes.** `ChapterRecord.volume`:
  - A new chapter takes the volume asked for (`volume=卷二`, by id, title or number; `unknown-volume` otherwise), else the previous chapter's, else the first.
  - A re-plan may move a chapter.
  - Chapters without a volume belong to the first volume.
- **Word budget.** `ChapterPlan.words` is the 目标字数, defaulting to the one page's `perChapter` when the plan omits it; the default is computed, never stored, so the plan gate's re-plan comparison stays exact.
  - `capacityOf`: 750–1000 characters per beat, at most 2 foreshadow ops (3 above 4000 characters), at most 4 cast (6).
  - The plan brief opens with this budget.
  - Registration answers with reminders, not refusals: too many beats, ops or cast, and a 揭晓 of a core suspense before its volume.
  - The plan card shows the target and the room, and 计划 N · 实际 M once the chapter is reconciled. The chapter Remote returns `targetWords`.
- **Core suspense.** The foreshadow card gains 揭晓时机 (`reveal`, free text parsed by `parseReveal`: 本章内 / 卷N / 终局), definition v2.
  - A foreshadow set to reveal in a volume is never overdue by chapter count: `isOverdue` returns false.
  - Its pacing is `coreSuspenseNudge`: before its volume it reads 「定在卷N揭晓，现在卷M：可以暗示，不能揭」. A soft nudge appears only near the end of a volume that has not touched it, or in its reveal volume with fewer than two touches. Past its volume it reads 「原定…已经过了」.
  - A 本章内 hook is flagged after 2 chapters.
  - The answer reaches a brief only in the reveal volume, or in a chapter whose plan reveals it.
  - Clues are not scheduled ahead. The 已放线索 are the reconciled mentions (`ForeshadowView.mentionChapters`; the 规划 Remote lists them with kind and note).
- **Extraction stops flooding foreshadows.** The extract rules now admit only questions the reader will carry and the book must pay off, at most 2 per chapter.
- **The 规划 page** (`PlanView`, `canvas.board.view` key `novel:plan`) shows, from top to bottom:
  - progress: the newest chapter, its volume, and the share of 篇幅 written;
  - the one page, with the protagonist box opening the card;
  - the proposal as a dashed block with 采用 / 不采用;
  - the volumes, each with its chapters, the sketches ahead, the fold, the landing, and what it reveals;
  - the core suspenses, each with its clue ladder and pacing line.
  
  It is one layout that adapts to the panel width.

## Alternatives considered

**A chapter-by-chapter roadmap at outline time.** This was in the first draft of the prototype. The user rejected it: an outline can say how many volumes, about how many chapters and words, not what every chapter does, and a list made up front only gets thrown away. Volumes plus near sketches replaced it.

**A scheduled clue ladder for each mystery.** Rejected for the same reason: only the reveal volume can be decided up front. Clues are recorded as the text lays them.

**Protagonist fields stored on the outline.** Rejected: the character card already holds name, identity, want, lack and wound, and two copies would drift. The outline points at the card; the card gains 抱负 and 价值观.

**A second genre face via `faces.views[]`.** This is more general, but one named `lead` slot covers the need, and an older canvas ignores it cleanly.

**Persisting the default 目标字数 into the plan.** Rejected: the stored plan would then differ from the model's resend, and the plan gate would read that as a re-plan and refuse the body.

**Calling it 大谜 or 核心冲突.** The user settled on 核心悬念 for the reader's question. 核心冲突 is a separate one-page field (what the protagonist wants against what blocks it): one drives the plot, the other times information.

## Consequences

- A work can carry its outline. The planner sees the spine, the protagonist, its place in the volume, and a budget, and core suspenses stop being rushed into early chapters.
- Works without an outline render every brief exactly as before; a test pins that.
- The brief's extract rules changed one line (snapshot updated).
- `NovelError` gains `unknown-protagonist`, `unknown-volume` and `no-proposal`, with locale strings.
- Not built: an 「整理伏笔」 menu action. Splitting multi-question cards is done in conversation for now: the skill tells the model to explain the split and use canvas_write.
- Tests: `tests/outline.spec.ts` (parsing, ids, pacing, capacity, the tool flow end to end), `tests/plan-view.client.spec.tsx` (the page and the plan budget), and a canvas tab test for the lead face.
