# Agent Note: Library — the quiz loop: a state-aware paper card, one mistake ledger, knowledge points

Status: implemented

## Problem

Four gaps surfaced from real use of the mistake loop (see [the mistake-loop note](2026-10-17-library-mistake-loop.md)): the latest-paper card never changed after a sitting — 开始作答 stayed the primary action on an already-taken paper, so the station offered the same set forever; the tab piled up five action buttons, two of them the same retake; the project page's 错题本 duplicated the station's missed list under a second口径; mastery existed only as card weakness, so nothing answered "does the learner actually have THIS station"; and the learner could not steer a set at chosen points.

## Decision

- **The paper card carries the loop** (`client/views/book.tsx` QuizTab): it reads the latest sitting and flips — untaken → 开始作答; passed → 再出一套新题; failed with misses → 重考错题 N — with the demoted actions as text links in the card's foot (重做这套 / 换方向再出一套). The direction chips lost the 错题重考 option (a retake is a purpose, not a source), the missed list lost its duplicate retake button, and the result view hands off (重考错题 / 再出一套新题 prime from the score) so a sitting never dead-ends.
- **One mistake ledger** (`client/mistakes.ts`): every quiz's latest sitting, failed non-void verdicts. The station's 错题 list, its collapsible 其他站 shelf (which keeps the cross-station 「围绕错题出一套」 free-quiz ask) and the project page's 错题 band entry (jumps to the newest miss's station) are three filters of one collection; the project page's `MistakesSection` is gone.
- **Knowledge points (考点)**: a quiz station carries 3–6 points authored on the roadmap DRAFT (`points: [{ id, title }]` on each quiz-gated node) — adoption is the review checkpoint for the model's split. `library_quiz` requires `question.point` (an id on the station) once a station has points, `addPoints` extends the split mid-flight (never re-adds), and a full set that skips a point earns a coverage warning. Mastery aggregates per point off the newest verdict probing it; the 章节考 tab renders the split as a tappable grid (已掌握 / 薄弱 / 未考) that doubles as the pick-to-focus picker — picked points ride the ask's primed text (重点考：…) and outrank the state-default CTA. The gate stays the global pass ratio: points diagnose and steer, they do not gate.
- **Weak points ride every ask**: the station's weak cards (weakness ≥ 1) show as a 薄弱 line on the tab and append to the primed 出题 request, so the coach's own-cards-first rule no longer depends on it remembering to read the cards.
- **Math typesets only inside $…$ / $$…$$** — the authoring guidance says so in both places models read (the library_quiz description and LIBRARY_PROMPT: no unicode approximations like √(x+1), no kind labels or solution recipes in the prompt), `putQuiz` warns on a math-smelling question with no $, the answer box previews typed TeX live (bare \commands render as one inline formula) and grows with its content, fill judging folds LaTeX notation onto its unicode reading (\sqrt{2} = √2 = $…$-wrapped), and the missed-question rows render prompts through MathText.
- **The 讲义 tab renders through the host's MarkdownText** (ui-primitives — a platform module, external in the bundle, peer-optional as canvas set the precedent): full GFM + KaTeX instead of the hand-rolled mini-markdown. The voided list compacts to one line naming the count (the latest paper's flags only — a replacement clears it), and the result view states how many were voided.
- **The ask carries 题型 / 题量 settings**: a multi-select kinds row (none picked = the coach's mix) and a 题量 number field (default 10, clamped to 1–20 on commit, always rides the ask). The settings area reads as uniform label-left rows (范围 / 题型 / 题量) under 出题设置. The 「凭什么 · 引用级证据闸」 card left the tab: the gate stays server-side, and each question already carries its evidence chip, so the card was pure noise.

## Alternatives considered

- **Quiz-time point splitting**: rejected — each paper would invent its own names (「极限的定义」 vs 「极限的概念」), mastery could never aggregate across papers, and no review checkpoint would exist; drafting the split with the roadmap reuses adoption as the learner's consent point.
- **Auto-composing a fresh set after each sitting**: rejected — composing is the coach's (a conversation turn), and auto-priming would hijack the session mid-chat; the result page's one-tap ask is the same speed without the interruption.
- **Per-point gating (every point must pass)**: deferred — the global 80% line stays; points first prove themselves as diagnostics before they gate.
- **A separate mastery page**: rejected — the point grid lives where the learner acts (the 章节考 tab), merged with the picker so one surface both reads and steers.

## Consequences

- `putQuiz` hard-requires `question.point` once a station has points — coaches composing for a pointed station must tag every question (refusals teach the valid ids back).
- A replan that drops a point id orphans no history (attempts stay attached to their papers), but that point simply stops aggregating.
- Points survive adoption and replan by node id, exactly like quizStats / 讲义; `normalizeRoadmap` / `normalizeQuizQuestions` parse them tolerantly, so pre-points data reads unchanged.

## Testing

147/147 host tests (5 new: draft → adopt point round-trip, draft-time refusals (read node / duplicate / unsafe id), the per-question point demand with its teaching refusals, addPoints merge + re-add refusal, station-less refusal); tsc + tsdown + `check:panels` clean; the v5-ported sidebar example covers the untaken / failed paper-card states, the result handoff, the project entry and the pointed draft card — screenshotted at 390px touch, light and dark.

## Related

- Supersedes two facts of [the mistake-loop note](2026-10-17-library-mistake-loop.md): its project-page 错题本 section (now the band entry + the station's 其他站 shelf) and its 错题重考 direction chip (now the paper card's state-driven CTA).
