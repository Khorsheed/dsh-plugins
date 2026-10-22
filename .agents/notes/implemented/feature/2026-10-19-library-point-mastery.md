# Agent Note: Library — knowledge-point mastery (misses wait to be retaken, coach notes land on points)

Status: implemented

## Problem

On 3080 (2026-10-19) the knowledge-card model was carrying things it was not made for: every card-less miss became a card titled with the question's first 80 characters (cutting `$…$` in half, so the card list showed raw LaTeX and review asked 「用一句话说说：关于反函数与函数复合，下列正确的是？」); the coach recorded the learner's feedback about quiz quality as a weak point; the station's 章节考 tab stacked six blocks with no line of travel; and 今日's 「教练最近记下」 showed questions and feedback rather than what the learner had not mastered.

## Decision

Per the proposal ([proposals/active/2026-10-19-library-point-mastery.md](../../../proposals/active/2026-10-19-library-point-mastery.md)), decided with the user:

- **One rule set, shared**: `src/mastery.ts` (pure) computes a station's points as untested / weak / mastered and its open misses, for the service, the per-turn context and the sidebar alike. A question is open when its newest non-void verdict — its paper, a re-sitting, or a retake — failed. Mastered = nothing open on the point and its newest probe passed; weak = something open, or a coach note newer than its newest pass; untested = neither probes nor notes.
- **Misses wait, they do not become cards**: a card-less miss creates a card only when the coach names a word or concept (`missedCard.term`); the question-text fallback is gone.
- **Retake in the sidebar**: `createRetake` builds a `type: 'retake'` assessment re-asking the station's open misses (each question carries `origin`); it is judged on the spot (open questions go to the coach as before), moves points, and never touches the node's stats or completion — the user's call: retakes do not count toward passing.
- **Coach notes land on points**: `notePoint` appends to `points[].notes` and the point turns weak; `library_cards` routes a card carrying `point` (+ `node`, defaulting to the bound textbook's current station) there in pointsDriven projects. Its description now says feedback on a question or the tools is never a weak point.
- **Point changes are ledgered**: every write that moves a point appends `point.changed` (from, to, open count, the newest note when that is the reason); `recentChanges` feeds 今日's 「最近的变化」 (merged with chat-noted word cards); `LibraryAssessResult.pointChanges` feeds the result page.
- **The coach sees the points**: the binding summary carries the bound textbook's current station and its mastery; the per-turn context lists each point's state and reason, the open-miss count, and a one-line subject hint.
- **Subject profiles**: `src/profiles.ts` (pure data) holds what varies by template — mark kind, whether points drive mastery, fill judging (`math` vs `spelling`), math preview, the coach hint. subject and language ship; custom follows subject. The sidebar judges fills through `judgeFill(profile.fill, …)` and previews math only when `profile.math`.
- **章节考 tab**: pass line → points map (tap: the point sheet with notes, open misses, newest probe, 订正这 N 题 / 围绕它出一套) → one primary action by state (an untaken paper → 开始作答; open misses → 开始订正; else 出题) → 出一套新题 as a summary line with 调整 and 出题 → voided line → earlier papers folded. Other stations' misses are not shown.
- **Fixes**: the card list typesets math in terms and glosses.
- **Data**: the 3080 project's ten question-text cards and the quality-feedback card were deleted (the user's call, no migration).

## Follow-up (2026-10-20)

- **今日复习 is the open misses** (the user's call, replacing the earlier "not now"): one row per project with open misses opens a project-wide retake (`createRetake` without a station, `scope: {}`); due cards stay as a second row (language words, marked concepts). `LibraryProjectSummary.openMisses` counts every station's open misses and backs both this row and the project page's 错题 stat. A retake's questions credit their own station through `origin`, so `stationMastery` now reads every retake and keeps only questions whose origin is one of the station's papers; a project-wide retake reports point changes for each station it touched.
- **Stale rows**: `recentRecords` drops recordings whose cards were all deleted (and names only the live ones); `recentChanges` drops changes whose textbook, station or point is gone — a deleted card had stayed in 「最近的变化」 because the event ledger is append-only.
- **The learner's record, not the coach's notebook**: a coach recorded its own answer-key slip as a chat card *after* the new guidance shipped, so the guard is structural now — in a points-driven project `library_cards` refuses a chat card without `point`, naming the station's points and saying the coach's own slips and feedback on questions are never recorded; the prompt's opening line says the library is the learner's record, not the coach's notebook. That card was deleted on 3080.

- **One way to ask, points as a ledger** (2026-10-20, from the user's walk-through): the point sheet's 「围绕它出一套」 duplicated the ask box and muddied the line of travel — removed; focusing a point happens only under 出一套新题 → 调整设置 → 重点考点. Points render as rows with what they hold — `asked` (distinct questions) and `right` (standing right now), open count, note count — and the sheet adds `history` (each sitting's share: paper or retake, right/total). The ask summary is labeled parts (范围 / 题型 / 题量 / 重点考点) with the buttons on their own row; range, kind and focus choices are wrapping toggles (the horizontal chip rows clipped long point titles).

- **Book type and reused sessions** (2026-10-20): a coach typed 《认知神经科学》 (a domain textbook the learner owns) as `material`, so every question needed a verbatim quote — and, in a session reused from the 数学 project, it padded one with odd-function content and an invented "web quote". Now a thick resource defaults to `bookKind: 'knowledge'`; the tool says material is only for text whose exact wording is tested and that whose book it is says nothing about it; the material refusal asks for a photographed page and forbids the coach's own words as a quote; the textbook page shows 类型 with a one-line explanation and a switch (`setBookKind`). A binding switched to another project keeps `previousProjectId`, and the per-turn context warns that the earlier talk is not this project's material.

## Alternatives considered

- **Retakes count toward passing**: rejected by the user — retaking the same questions would farm the pass line; passing stays a whole paper's job.
- **Migrating the old question cards into 待订正**: unnecessary — the misses are already in the attempts ledger, so they show up as open misses by themselves; the cards were deleted.
- **Due misses in the review queue**: deferred by the user until the point model has run for a while.
- **A dedicated `library_points` tool**: rejected for now — `library_cards` with `point` keeps the tool count and the coach's habit ("the learner is stuck → library_cards"); the routing happens behind it.

## Consequences

- `LibraryAssessment.type` gains `'retake'`; `LibraryQuizQuestion.origin`, `LibraryPoint.notes`, event fields `nodeId` / `from` / `to` / `detail` and type `point.changed` read back through the normalizers; older roots read unchanged.
- Remote: `createRetake`, `recentChanges`. Service: `createRetake`, `notePoint`, `recentChanges`; `bindingSummary().station`.
- Language projects keep word cards as their unit (`pointsDriven: false`); the retake flow works for them too, since it reads only the ledger.

## Testing

172/172 green: `tests/mastery.spec.ts` pins the rules (open / resolved by retake / note newer than a pass / void / re-sitting / changes); service.spec covers no card from a nameless miss, `point.changed` events, retake not touching stats, the no-open-misses refusal and point notes; tool.spec covers `library_cards` with `point` landing as a note and the context listing the station's points. Screens checked in the sidebar fixture (章节考 with open misses, the point sheet, the settings expanded in dark, 今日 「最近的变化」).

## Follow-up (2026-10-20): a mastery bar, and points expand in place

- 3080: one paper with 4 right on a point showed 掌握, and every point tested once read 掌握 after a single right answer. The user: one question is too easy. New state **practicing** (巩固中) between weak and mastered: none open and newest probe passed, but fewer than `MASTERY_MIN_RIGHT` (3) distinct questions right now, or fewer than `MASTERY_MIN_SITTINGS` (2) sittings with a right answer — one lucky paper never masters a point. Both constants live in `mastery.ts`; `LibraryPointMastery.rightSittings` is the new evidence field. Weak/untested rules are unchanged. The context and coach hint ask practicing points after weak and untested ones.
- The point detail was a bottom sheet over a scrim; on a wide pane it read as a long flat strip. It now expands under its row (accordion, one open at a time), showing why the point stands where it does, what is still missing for 掌握, the sittings, notes and open misses with the retake button. No overlay, no close step, same on phone and desktop.
- Stored `point.changed` events read `practicing` back; older roots hold only the three old states.

## Follow-up (2026-10-22): the sidebar only judges right; a miss goes to the coach

- 3080: model-written keys were wrong often enough (tan θ keyed as √3, not √3/3), and the local fill judge kept chasing notations. The user picked option A over "the model judges everything, no stored key": the key stays (retakes, explanations and the "explain this one" draft read it, and writing it forces a determinate question).
- Choice questions are still judged on the spot. A subject fill that matches is right. One that does not match is never marked wrong: it reads "does not match the key · the coach confirms at the end", shows the key as possibly wrong, and goes to the coach at 交卷 marked "to confirm". The grading prompt and `library_assess` tell the coach to judge by the question, not the key. Language spelling fills stay strict, because the spelling is the point.
- `library_quiz` authoring now asks the coach to solve each question again before storing it and to fix any disagreement.
- Each question's tools are one row: 提交 on the left, then two small chips, 讲讲思路 / 讲这题 (turns into "已填入对话框") and 题有问题 (red when on, click to undo). Their long explanations moved to tooltips.
