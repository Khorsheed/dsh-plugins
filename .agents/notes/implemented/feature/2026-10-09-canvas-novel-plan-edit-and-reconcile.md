# Agent Note: the person edits a chapter plan in place; 对账 asks less and reports in the Turn tail

Status: implemented

## Problem

The creative-journey inventory (local prototype `proposals/prototypes/canvas-novel-journey.html`, agreed 2026-10-09) found three frictions:

- **Confirming a plan was a click with nothing behind it.** The person still had to say in the chat 「可以，写吧」 before the model wrote. And when they disagreed with a beat, the only route was to describe the change in prose and wait for the model to re-register the plan.
- **Plan-covered foreshadow work was asked twice.** A confirmed plan says 「推进 #12」. When the 对账 subagent then reported that mention at medium confidence, the mention went to 待审 again: the same question, asked a second time.
- **Suspected mentions outside the plan held ✓ 审过.** An item that is a guess blocked the chapter from closing. And the result of an import (what landed, what is left) lived only inside the folded tool calls.

## Decision

- **The plan block edits in place.** While the plan leads (in planning, or a re-plan that still waits on the person), the chapter page offers 「编辑计划」.
  - The edit box holds the plan as the same `键：值` lines the model's text form uses. `planToText` in `text-forms.ts` is the inverse of `planFromText`: foreshadows by ref `#N`, characters by name. The chapter Remote sends it as `planText`.
  - 「保存并确认」 goes through the `editPlan` Remote → `store.editPlan`. The edit is the confirmation, because the person wrote this version.
  - The store answers with the fields that moved. The page then prefills the conversation input, without sending, with one line such as 「第N章的计划我在章节页改了（走向、章末钩子），已保存并确认，请按新计划写正文。」
  - The input is reached structurally, through `sessions` → `conversation.input.for`, the way the canvas quote gestures reach it. Without it, the face's `draftToConversation` simply reports false.
  - The skill tells the model not to re-confirm, and to write from the brief's plan.
- **The store refuses some edits.** It refuses a plan that the text was already checked against: one that is confirmed and no longer in planning. It also refuses a 用户原稿.
- **A mention of a planned foreshadow records whatever its confidence.** The import condition is now `confidence === 'high' || plannedIds.has(foreshadowId)`. Only mentions outside the plan pend.
- **Suspected mentions are optional.** `isOptionalPending` (kind `mention`) marks them.
  - They never hold 「✓ 审过」. The progress line says 「还有 N 条疑似提及可以看看；不处理也能审过，当作没提到」.
  - `reviewChapter` discards whatever is left of them, so unhandled reads as not mentioned.
  - The other kinds (计划落空, experiences, 信息差, relations, settings) still hold the gate.
- **A 已对账 card appears in the Turn tail.** The import's answer now opens with `第 N 章已对账（画布 <id>）。`, and `write-row.ts` reads that line as state `extracted`. The Turn definition also folds settled `novel_extract` results.
  - `ExtractCard` reads live: 走向 x/y · 伏笔 a/b, new cards, 待审 (blocking), and optional suspected mentions.
  - It has one door: 去处理 / 读完去审过 / 查看 → the chapter page.

## Alternatives considered

- **Structured form fields per plan section.** That means one input per beat and op, with add and remove buttons. It is heavier to build and slower to type. The text lines are what the model already writes and what `planFromText` already reads, so one parser serves both.
- **Edit without confirming, then confirm separately.** This keeps a second click that adds nothing: the person who wrote the version has agreed to it.
- **Send the change summary to the model automatically.** Sending without the person is outward-facing. Prefilling leaves the wording and the moment of sending to them.
- **Keep suspected mentions blocking, but lower their count.** This still blocks a chapter on a guess. Discarding at 审过 matches 「不处理就当作没有提及」 from the inventory.

## Consequences

- An edited plan's foreshadow ops must resolve to existing cards. Otherwise the save is refused and the unknown handles are listed, and the edit box stays open.
- `novel_extract(import)` answers gain a first line. Anything that read the first line as the counts must read the second line.
- Leftover suspected mentions are discarded at 审过 and are not recoverable from 待审. Their evidence is lost unless the person handled them first.

## Not done

- No 「待你处理」 dock above the input: the Turn tail already carries every ask past the fold.
- No confirm button on the conversation cards: confirming happens on the page or in the chat.
- Merging consecutive `canvas_write` rows into one row is left for later.

## Validation

- `pnpm --filter @khorsheed/dsh-canvas-novel run build && run test` (160 tests).
- Tests rewritten for the rules:
  - import gate 4 now uses an unplanned medium mention (#18);
  - a planned low-confidence mention records;
  - 审过 discards leftover suspected mentions;
  - the page holds 审过 only for non-optional items.
- New tests: text form round trip, PlanBlock edit and failure, the 已对账 tail card.
