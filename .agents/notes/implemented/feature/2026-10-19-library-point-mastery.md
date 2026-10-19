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
