# Agent Note: dsh-eval report verb — bundle facts first, comparison behind the invariants

Status: implemented

## Problem

web-eval's I2 needed the report half of the orchestrator (task T10): mission export bundles are self-contained (manifest.json, run.json, missions/<id>/attempt-N/{meta,annotations,artifacts}, dataset/<layer>/), and the three verdict namespaces (script / llm-draft / human-final) live inside them — but nothing turned a bundle into the paired comparison the methodology demands. The methodology (web-eval README「把它当对照实验来设计」, frozen decisions 9–11, architecture §5's four invariants, and the harness-comparison dimensions doc's "parallel, never summed" efficiency rule) is a set of honesty constraints, and a naive report would violate all of them: it would compare cells whose materialization, environment, subject, or procedure were never proven identical, it would rank on n=1, it would sum efficiency into one score, and it would silently accept a `tool:`-written human-final.

## Decision

`report` joins the eval kernel as a third surface next to validate/hash (`analyzeBundle` / `writeEvalReport`, service face `ctx.eval.report(bundleDir, {out?})`, CLI `dsh-eval report <bundleDir> [--out DIR]`). It reads ONLY the bundle — no mission data root, no dataset repo, no `@khorsheed/*` imports — and writes `results.jsonl` (one line per verdict: `{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`) plus `summary.md` into `<bundleDir>/report/` (overwriting on re-run: a report is derived state, unlike the append-only bundle).

The load-bearing rules, each enforced in code:

- **Invariants gate the comparison.** All four (materialization per task, refs.fingerprint, subject condition/model readback, evalVersion+planSha) must be `ok` — `violated` OR `unverifiable` (absent data) degrades the whole report to fact tables. "Cannot verify" counts as "not established"; missing fingerprints print 本 run 无指纹 rather than being treated as equal.
- **Factors are derived, never declared.** The condition documents recorded in `run.meta.conditions` entries are diffed pairwise on top-level fields (`notes` excluded); exactly one differing field names the factor, several degrade to 多因子 (descriptive only), and absent documents mark the pair's factor unknown — which also refuses ranking.
- **Tasks are blocks, reps are the resampling unit.** Per condition pair and task: rep-matched deltas of passed criteria (authoritative source per cell = human-final > llm-draft > script, majority across samples), n, and a seeded percentile bootstrap CI over per-task means. Ranking requires n ≥ 3 AND the CI excluding 0; anything else prints 不可排名 and no rank. Statistics are hand-written (`src/stats.ts`: mulberry32, FNV-1a seed, bootstrapMeanCi, cohenKappa) with hand-computed test values — no stats dependency.
- **Attempts are rows, current attempts are the aggregate.** Frozen decision 1: every attempt's verdicts land in results.jsonl; aggregation uses each cell's latest attempt; retries count separately.
- **Judge consistency from the bundle alone.** Double-sampled llm-draft criteria give an agreement rate and pairwise-averaged Cohen κ (NaN → 不适用 when raters are constant); human-final presence gives llm-draft-vs-final agreement.
- **Efficiency stays parallel.** Active time (summed delegation durationMs), delegation rounds (compared only on tasks both conditions completed — halted is not completed), listed price (only when run.meta.pricing records one, else blank), tokens only within the same model (cross-model rows render 不适用).
- **Red flag at the top.** An expectedNs namespace whose writer origins are all `tool:` (manifest nsReport writtenBy, recomputed from annotations for pre-writtenBy bundles) prints a red warning before the invariants.

Orchestrator-shape tolerances are pinned to T8's brief (iterations.md): run.meta `{planSha, evalVersion, conditions: [{id, sha, condition?}]}`, orchestrator-ns delegation records `{kind: 'delegation', stage, round, durationMs, usage, model: {declared, observed}}`. Cell identity comes from parsing `<task>-<conditionId>-rep<N>` mission ids anchored on run.meta.conditions' ids — without that anchor (the i1-walk bundle) condition/task stay null rather than being guessed. Verdict payloads are checked against `dataseek.verdict/1`; anything else in a verdict ns is ignored. Rubric weights are read tolerantly from the bundle's dataset layers; absent weights leave the weighted columns blank.

## Alternatives considered

- **Ship the report into mission's export path.** Rejected: the report is eval semantics (invariants, factors, pairing); mission owns generic bundles. Reading the bundle directory keeps the dependency direction clean and works without a host.
- **Import a stats library (e.g. simple-statistics).** Rejected: the whole function set is three small pure functions; the freeze-decision bar for a dependency is higher than that. Hand-written with hand-computed κ/CI test values keeps the numbers auditable.
- **Treat unverifiable invariants as satisfied when all cells are equally silent** (e.g. no fingerprint anywhere). Rejected: that would let pre-orchestrator bundles compare. The i1-walk bundle is the acceptance case — it must produce facts only.
- **Guess condition/task from mission ids without the conditions anchor.** Rejected: `p0-dsh-exec` without a conditions list cannot be split honestly; a guessed factor is worse than a missing one.
- **Wall-clock time for efficiency.** Rejected: frozen decision 8 — active duration (delegation durationMs sum) only; wall clock is an explanatory variable, not a metric.

## Consequences

- The i1-walk bundle now reports honestly: two verdict rows, all four invariants unverifiable-or-violated (no evalVersion, no fingerprint, no condition records), comparison refused — the acceptance fact table.
- `dsh-eval` CLI and `ctx.eval` gained the report verb without touching the offline surface; the executing verbs (run / readiness / provision) remain I2 work owned elsewhere. The report expects the T8 orchestrator's run.meta/ns shapes; until T8 lands, only hand-walked bundles (facts-only) and synthetic fixtures exercise the comparison path.
- `stage` on a results row is null unless the annotation record carries a stage field — the verdict contract has none. If T9 wants stage-attributed verdicts, the annotation-level field is the seam.
- `weight` appears only when the bundle's dataset layers carry a rubric with weights (tolerant reader: `{task, criteria: [{criterion, weight}]}` shapes). Guarded layers are usually excluded from exports, so weighted scores will typically need a deliberately guarded export.
- Stats live in `src/stats.ts` and are exported from the package root for the I5 report view; they are not a general-purpose stats library.
