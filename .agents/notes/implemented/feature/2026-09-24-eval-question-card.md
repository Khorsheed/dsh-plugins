# Agent Note: eval — the plan carries the question, the conclusion card answers it, the numbers are edited in place (T74, protocol v1-rev14)

Status: implemented

## Problem

An experiment is run to answer a question, and before T74 the plan had nowhere to write it. The person asks "is high better than medium?" in the session; the agent drafts a plan that holds a name and a matrix; the results page's conclusion card answers "which side of which pair won". The question the person asked appears on no page. The design page also had no way to change the numbers of an unstarted plan short of asking the agent to draft again: two reps instead of three meant a new experiment.

## Decision

- **Protocol v1-rev14, a separate commit.** Three optional top-level plan fields: `question`, `expectation`, `answeredWhen`, all free text. An old plan has none of them, validate does not warn, and no page shows the block. A blank string reads as absent (`planQuestionOf`, `packages/eval/src/plan-question.ts` — the one reader behind all three pages). The brief says §6.5 for the plan schema; the plan schema is §6.4 (§6.5 is the criteria / weight table), and the fields are documented there.
- **`eval_plan_draft`** takes `question` / `expectation` / `answered_when`. Its description says 「起草时把人的问题原样写进 question」, and the eval-tool prompt section says the same once. The SKILL is not changed.
- **Design page ⓪ 要回答的问题**, above ①, only when the plan has a block. The prototype's heading is 「要回答的问题」; the numbering is ⓪ so ①–③ from T67 keep their numbers.
- **Numbers in place** — reps, `budget.activeMinutes`, `budget.turns`, `judge.samples`. They go through a new Remote, `setPlanNumbers`, and the service verb of the same name (`packages/eval/src/plan-numbers.ts`). The write is **textual**. plan.json has been kept byte for byte since T73 (an imported plan's hash is how an old run finds it), so the scanner locates each value token and replaces only those bytes. It then compares the result, as canonical JSON, with the intended document before writing, writes through temp + rename, and reads the file back. It refuses:
  - a key written twice;
  - a missing field;
  - a plan with no judge — adding one is structural, so the refusal says to ask the agent.
- **Frozen after start.** The service refuses when the ledger has a run for the experiment (`experimentRunIds`) or a job is starting one. The page checks `row.runId` / the approval receipt. When frozen, the numbers are read-only with the reason on the line below.
- **Conclusion card.** With a question, the first line is 「问题：… — 结论：…」. The answer comes from the report's own `pair.rank`: 「A 优于 B」 / 「A 与 B 未分高下」, 「暂时不能下结论」 when comparison is closed, 「单对比组，无对比数据」 for a single group. Under it are two dim lines, 「怎么算回答了」 and 「预期：<text> · 实际：<direction>」. Without a question the card is T72's.
- **List row**: the question on a second line, ellipsis, full text on hover, only when present.
- **⑤ 分析初稿 renders markdown** through the official `MarkdownText` (`@deepseek-ai/dsh-client-ui-primitives`), wrapped in eval's own `MarkdownDoc.tsx`. The frame uses the same tokens as the datasets preview. T75's answer view reuses this component.

## Alternatives considered

- **Grade the expectation as 一致 / 相反** (what the brief's decision 4 asked for, "expectation vs actual direction"). Rejected. The expectation is free text and the direction is a rank. Deciding that 「high 更强」 agrees with `rank: 'a'` means understanding the sentence, which is a model call or a guess. The card puts the two side by side with vocabulary words only, and no new colour. **Deviation from the brief — reported.**
- **Re-serialize plan.json after changing a number.** Rejected: it rewrites indentation, key order and escaping, and changes the hash an imported plan is found by.
- **Import datasets' preview component.** Rejected: plugins do not import one another (`pnpm check:plugins`). Re-assembling from the official primitive keeps one implementation of markdown underneath.
- **Put the numbers editor in 高级设置.** Rejected: the brief places them in ②/① beside scale, and they are what a person changes most.

## Consequences

- Old plans (pilot-d) render exactly as before: no ⓪ block, T72 conclusion card.
- `EvalExperimentRow.question`, `EvalPlanDigest.question`, `EvalRunReportView.question` are new required-nullable fields. Test fixtures that build these by hand need `question: null`.
- A structural edit of an unstarted plan still goes through the agent. Only four numbers are editable, and only before start.
