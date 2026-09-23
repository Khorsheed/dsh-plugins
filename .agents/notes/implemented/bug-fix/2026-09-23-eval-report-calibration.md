# Agent Note: Calibrate the eval report's conclusions — a fifth check for verdict coverage, a CI by item count

Status: implemented

## Problem

The pilot-d-preset report printed `mean Δ = 4, 95% CI [4, 4]` from one item run once per group. Two things were wrong at once. First, the two sides were scored by different sources: on the dsh-full cell both judge calls failed (`judge-parse-failed` × 2 in the bundle) and only the probe's script verdict remained, while the dsh-lean cell carried the judge's llm-draft verdicts. The per-criterion merge (T54) takes each side's highest layer, so the delta subtracted a script-only score from a judged one and reported the gap as a difference between presets. Second, the interval was computed from a single block: a bootstrap over one item can only ever resample that item, so `[4, 4]` states zero uncertainty where there is no information about it at all. `comparePair` refused the rank when n < 3 but still printed the interval, and the page rendered any non-null `ci`.

## Decision

**A fifth validity check, 「判定覆盖一致」 (`verdict-coverage`).** For every compared pair of cells (same item, same rep) each criterion must carry a judged verdict — human-final or llm-draft — on both sides or on neither. A side with only a script verdict, or nothing, fails it. A person re-judging one criterion does not: a human verdict counts as judged. The check's status is the conjunction over all pairs; its details name each gap, and when every judge call on that cell failed ("judge absent") they quote the failures from the `judge-parse-failed` annotations already in the bundle — no new annotation was needed.

**Coverage degrades a pair, not the section.** The first four checks still close the whole comparison section and `comparisonAllowed`/`criteriaTables` still look only at them. A coverage gap keeps that pair's per-item facts (scores, per-rep deltas) and drops its interval and rank; `rankReason` reads 「判定覆盖不一致：<item> 的 <criteria…> 在 <group> 没有判官 / 人的判定（判官缺席 / 仅脚本）」. The page's closed-section banner counts the first four only.

**The CI is given by item count.** With k items carrying at least one paired delta: k < 3 → no interval, `ciWithheld: {tasksWithDelta: k}`, and page/summary say 「只有 k 道题有差值，给不出区间」. k ≥ 3 → computed as before; if n < 3 it is marked `ciAdvisory` and the page says 「仅供参考，未达排名条件（每题需跑满 3 次）」. The ranking gate itself is unchanged: n ≥ 3 and an interval excluding 0.

On the real pilot-d bundle the summary now shows the fifth check ❌ with 「P0-placeholder 第 1 次的 B2、D1、D2、D3、D4 在 dsh-full 没有判官 / 人的判定——判官缺席（判官调用 2 次均失败：judge delegation ended with stopReason "error"）」, no interval line, and the rank verdict 「判定覆盖不一致：…（判官缺席）」.

## Alternatives considered

**Count reps (n) rather than items for the interval.** Rejected. The bootstrap resamples items as blocks, and what the interval claims is "would a fresh batch of similar items move this mean"; that is a statement about the number of items, not about how often each was rerun. Three reps on one item still give a single block and a degenerate `[x, x]`. Conversely, an experiment with many items run once each is common, and gating on n would never show it an interval even though it has real between-item spread — which is why a CI from k ≥ 3 items with n < 3 is printed as advisory instead of hidden. The rank stays on n ≥ 3 because repeat noise within an item is what n guards against.

**Make coverage a fifth gate that closes the whole comparison section.** Rejected. The first four are preconditions of the RUN — same materialization, environment, subject and procedure — and if any fails no pair is comparable. Coverage is a property of ONE pair of cells: a judge failing on one cell says nothing about the other pairs, and closing the section would also hide the criteria tables, which are exactly where a reader sees which layer scored which criterion. Degrading only the affected pair withholds the conclusion that is unsupported and keeps every fact that is.

**Add a "re-judge" button or a new judge-absence annotation.** Rejected per the brief: the failures are already recorded by `runJudgeSamples`, and re-judging is a workflow decision outside the report.

## Consequences

Bought: a report can no longer rank or bound a difference that comes from comparing two different scoring sources, and it can no longer print a zero-width interval from one item. The reason is written out per pair with the judge's own error text.

Cost: small but complete experiments lose their interval — 2 items × 3 reps (the S2 fixture) and 1 item × 3 reps (S9/S10) now get no CI and so no rank, where they used to rank. That is the intended reading of D7 but it is a visible behaviour change for anyone running short pilots.

## Testing

`packages/eval`: 942 tests green, `tsc -b --noEmit` clean. New describe 「report — D7 verdict coverage and CI thresholds」: one side judged and the other script-only degrades the pair (not the section); a human re-judging one criterion does not degrade; 1 item × 1 rep withholds the CI; 3 items × 1 rep gives an advisory CI and no rank; 5 items × 3 reps still ranks. S2/S5/S8/S9/S10 and the report-face invariant ids were updated to the new rules.

## Deferred

- UI spec says a degraded pair gets 「不给 Δ」; this implementation keeps per-item means and per-rep deltas (description) and drops the mean Δ, interval and rank. To be confirmed with the interaction-draft author.
- The check's details and `rankReason` remain host-assembled Chinese strings (the known data-plane gap already noted in the README).

## Related

- `packages/eval/src/report.ts` (`checkVerdictCoverage`, `coverageGapsOf`, `comparePair`)
- `packages/eval/README.md` / `README.en.md`, T71 paragraph
