# Agent Note: eval's client half — the Experiments tab's list and detail shell (I5 · T35a)

Status: implemented

English | [中文](2026-09-13-eval-client-lab.zh.md)

## Problem

The web-eval UI spec (`profiles/web-eval/docs/ui-spec.md` §五, §八) gives the human three faces: the session, the 题集 tab, and the 实验室 tab. Two of the three existed. `@khorsheed/dsh-eval` was a host-only package — the tsdown Client pass emitted nothing for it, `package.json` declared no `./client` export, and there was no `src/client/` at all — so the one face where an experiment is planned, approved, watched and read had nowhere to live.

There was also a hole left open on purpose by T46. Dropping `mission-tool` from the evaluation preset removed `mission_run_list`, the one of the four mission read tools whose purpose nothing else covered: an agent could read a run it already had the id of, and had no verb that enumerated runs. T46's note recorded the gap and deferred closing it until this slice's `runs` read face existed, so that the listing could be *eval's* experiments rather than every run in mission's ledger.

## Decision

- **A client half, scaffolded exactly like mission's.** `src/client/{index,contract,store,locales,LabView.tsx,LabView.module.css,preset-visibility}`, `src/css-modules.d.ts`, `tsconfig.json` split into a host project and a client project, `tsdown.config.ts` switched to the shared `clientBundle` helper, and a `./client` export plus a `dsh.client` block in `package.json`. The cordis row is unchanged: the same row's `dsh.client` declaration is what makes the browser half load. `verbatimModuleSyntax: false` / `experimentalDecorators: false` are restated in BOTH tsconfigs — the Remote face uses TC39 decorators and the host program's settings do not reach a sibling project.
- **The tab is `conversation.view` / id `lab` / order 40**, labelled 实验室 · Experiments from a `dshEval` locale namespace. The plugin id stays `eval` (UI spec R5: `lab` in this repository is the container-unit plugin). It **self-hides** on the preset-composition criterion, the row's presence — here `@khorsheed/dsh-eval-tool` — with all four fail-open branches copied from mission's implementation. Hidden means NO registration, because the tab strip enumerates registrations.
- **Two new Remote verbs, both taking an agent**: `runs(agent, request)` and `run(agent, {runId})` on `EvalRemoteService` (namespace `dshEval`). The four CI verbs — `runStart` / `runStatus` / `runOutput` / `runCancel` — are untouched to the byte; they take no agent precisely because a CI caller has none, and these two take one precisely because which experiments a browser may see follows the session's dataset binding, which is a human's decision. The client `$mount`s the namespace and reads it back with `ctx.get`, never `inject` (the property-proxy deadlock mission's comment documents).
- **The list is one projection, `EvalService.experiments`, shared by the tab and the model.** Runs are the mission ledger's runs whose `run.meta.evalVersion` is set, read through the structural `MissionRunListFace` (a `MissionReadFace` widened with an optional `runList`). Drafts are the `datasets/<set>/plans/*.json` documents in the session's bound repository that no run points back at, resolved through the datasets binding face the way `conditions` already does. A run is matched to its plan by resolved path OR by `planSha`, so another checkout of the same file is the same experiment while an edited plan is honestly a new draft. Columns per UI spec §五: name, snapshot, conditions (+ judges), items, reps, factors, status, progress, start time.
- **The factor column is a diff, not a guess.** `conditionFactors(documents)` in `read.ts` reuses the leaf flattening `conditionDiffDocuments` uses and reports the paths a SET of declarations disagrees on; `notes` never counts, and absent-here / present-there is a difference like any other. It SHOWS and never recommends, exactly like the pairwise diff.
- **The status rule is a pure function with its coarse edges documented, not smoothed.** `deriveExperimentStatus({validation, run, job})` returns one of the seven words the spec fixed. Precedence: a killed job is `cancelled`, a failed one `refused`, a fully released run `done`, a live job or a moving cell `running`, a run whose every cell reached `judged` with nothing live `judging`. Four edges are named on the function and pinned by tests: the job layer records a readiness refusal and a mid-run throw identically (`failed` + a `refused:` line), so `refused` means "the job settled as failed" and the detail says which; a settled job that left cells mid-stage reads as `running` because the ledger genuinely still has unfinished cells; a run with no cells reads the same way; and without a job record (any instance restart) `cancelled` and `refused` are unreachable and the run reads by its cells alone.
- **The detail is the seven-sub-page shell, with only the overview filled.** Overview · Plan review · Conditions · Matrix · Cells · Report · Judging desk. The overview shows the snapshot, matrix shape, factors, judge and samples, environment, the readiness records verbatim, the run.meta digest, both histograms, the unreleased list and the job. The other six carry one sentence each naming the task that owns them (T36 / T35b / T38 / T37). 新建实验 is a placeholder (T36).
- **A draft's overview costs no RPC.** It has no run to fetch, and the list row already carries the plan digest, so the shell renders from the row and says in words which fields only appear once a human starts it.
- **`eval_cells` without `run_id` lists the experiments** — the same `experiments` projection, so the tab and the model cannot disagree about what exists. That closes T46's gap.
- **The job record carries its plan.** `EvalRunJobs.start` accepts `plan` and `EvalRunStatus` reports it. Without this a run refused by the readiness gate is unattributable: the refusal happens before `runCreate`, so the mission ledger holds nothing at all for it, and the plan path is the only thing that says which experiment was refused.

## Alternatives considered

### Why not make the detail verb take a plan path too, so a draft has its own page?

The draft's overview would then be a second rendering of data the list row already holds, over an RPC that would spend a `validatePlan` per visit. The plan-review page (T36) is where a draft gets a page of its own, with the validate output line by line and the 批准并启动 button — building half of it here would be work T36 has to redo. The decided Remote shape, `run(agent, {runId})`, is kept.

### Why not an eighth status word for "stopped unfinished"?

The vocabulary is settled copy (UI spec §五) and the interface is the contract between the spec and the code; inventing a word here would put the two out of sync silently. The honest alternative is what the code does: report the coarse reading, and document the edge on the function where the next reader of the rule will see it. If the eighth word turns out to be worth having, it is a spec change and therefore a new task.

### Why not read mission's run list in the browser and project client-side?

UI spec R2 and §八 forbid it, and for a good reason beyond tidiness: the client bundle's purity gate rejects cross-plugin value imports outright, so the projection would have to travel as raw ledger rows and be re-derived in two places. Computing it in the service face keeps one implementation for the tab, the tool, and whatever T35b/T38 need next.

### Why not filter runs by `originSession` the way mission's queue does?

mission's queue defaults to the calling session's own runs because a task queue is a per-session thing. An experiment is not: a run started last week by somebody else is exactly what the person planning this week's comparison needs to see. The scope that DOES apply is the dataset binding, and it applies to the drafts, where the human's whitelist decides what the session may read.

### Why not require a mission service and a binding, and refuse otherwise?

A planning view that answers "refused" is a dead end; a planning view that answers with what it has and one sentence about what is missing is not. Each absent source degrades — no mission lists drafts only, no binding lists runs only — and `notes` carries the sentence. An empty list with no explanation is the one answer this surface must never give.

## Consequences

- `@khorsheed/dsh-eval` now ships a browser bundle (`lib/client.js`, ~221 kB, same order as mission's) and gains the client-half peer/dev dependency rows plus `dsh.client`. The `docs/packages.md` map counts 24 packages with a browser half instead of 23.
- `scripts/gen-typert.mts` points eval at `tsconfig.host.json` instead of `tsconfig.json`, because the aggregate `tsconfig.json` is now references-only and the generator's overlay copies the file it is given. This is the same registration shape mission, datasets and every other split package already uses.
- `packages/eval/tsconfig.build.json` is gone; `build` and `typecheck` run `tsc -b tsconfig.json`, the project-references form.
- `EvalRunStatus` gains an optional `plan`. Existing consumers are unaffected (the CLI and the four Remote verbs read the other fields); a job started without a plan simply does not carry one.
- `dsh.references` now names `@khorsheed/dsh-eval-tool` — the companion row is named as DATA by the self-hide criterion, which the independence gate requires to be declared.
- T36 inherits the shell, the store's `page` routing and the locale namespace; T35b inherits the same for the matrix and cells pages, plus the `runs` projection's row shape.

## Testing

- `packages/eval`: 510 tests green (468 before). New: `tests/experiments.spec.ts` — 23 cases covering all seven status words plus the four named edges, `conditionFactors` (including the `notes` exclusion and the absent-field difference), and the list/detail projections over a fake ledger and a real `plans/` tree (draft rows, the run-not-duplicate-draft rule, sha matching across checkouts, ignoring another package's runs and non-plan JSON, the refused-before-runCreate job, and both degrades). `tests/apply.client.spec.ts` — 8 cases: the inject list, registration at order 40, registration surviving a failed Remote mount, the three gate states (row present / row absent / inventory unreadable), the injected face's two verbs, and teardown. `tests/LabView.client.spec.tsx` — 10 cases: the table with drafts and runs, the judge-aware condition column, the degraded-source notes, the 新建实验 placeholder, the row click opening the seven-tab shell and fetching, the overview's fields, the draft's no-RPC overview, the six placeholders, the back button, and a refused detail.
- `packages/eval-tool`: 3 tests green (the guidance section's new sentence).
- `tests/tools.spec.ts` gains the `eval_cells` listing-mode case; its fake mission face gains `runList`.
- `pnpm gate` green.
