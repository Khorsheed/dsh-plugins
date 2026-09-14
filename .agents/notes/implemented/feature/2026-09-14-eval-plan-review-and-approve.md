# Agent Note: the plan-review and conditions pages, and the one human write — approve (I5 · T36)

Status: implemented

English | [中文](2026-09-14-eval-plan-review-and-approve.zh.md)

## Problem

T35a built the Experiments tab's list and its seven-sub-page detail shell, and filled exactly one page. Two of the six placeholders were the ones the eight-step flow actually turns on (`profiles/web-eval/docs/ui-spec.md` §七): **step 3**, where a human reads what validate makes of a drafted plan, and **step 5**, where a human approves it and the run starts. Until those exist the interface can watch an evaluation but cannot begin one — starting still means typing `/eval run <plan.json>` in the session, with the review that should precede it happening in a CLI in another window, or not at all.

Step 4 —登录与 provision — has the same hole on its reading side. `dsh-eval conditions list` and `conditions diff` answer everything the reviewer needs about the subjects, and the tab could not show any of it, so "are these two conditions actually a single-factor pair" was a question the planning surface could not answer about the experiment it was displaying.

And approving is where R1 lives. The starting verb must be reachable by a human's click and by nothing else — no model tool, then or later.

## Decision

- **Four Remote verbs, all session-scoped, exactly one of them a write.** `plan(agent, {planPath})`, `conditions(agent, {repo?, dataset?})` and `conditionDiff(agent, {a, b, …})` read; `approve(agent, {planPath})` writes. The four CI verbs (`runStart` / `runStatus` / `runOutput` / `runCancel`) are untouched to the byte, and `runOutput` is now also how the browser reads a run log — one verb, no second implementation. No approve-class model tool exists, and the reason is recorded on the verb, not only here.
- **`approve` gates on validate and refuses without touching `runStart`.** An error refuses; warnings do not (`dataset.commit: null` is the normal shape of a plan whose snapshot pins at run start). Passing it calls the existing `runStart` with the approving session as the run's parent and `agent.session.header?.cwd` as the cwd — the same two values `/eval run` resolves, read the same way, so a run started from the button and a run started from the slash command are the same run.
- **A refusal is a return value, not a throw.** `EvalApproveResult` carries `started`, the check list, and `refusal` verbatim. The page renders the same list either way and the reason belongs beside the list that explains it; a thrown RPC error would carry a message and drop the list. Wiring failures (no job registry, no live parent agent) are caught into the same field.
- **The review is `validatePlan`'s own output, rearranged — never re-derived.** `reviewPlan` flattens the diagnostics into `ok / warn / error` lines and adds the plan's structural digest. The page therefore cannot be stricter or laxer than `dsh-eval validate`; a test pins the one boundary that surprises people (a condition the repository does not hold is a WARNING, so such a plan is approvable, exactly as the CLI says).
- **The `ok` lines are the resolved conditions.** A review page that renders only problems shows a clean plan as an empty page, and "cond-a is ready, cond-b is ready" is precisely what the reviewer is approving.
- **退回修改 writes nothing.** It records a note on the page and shows the experiment as a draft. Sending a plan back is a message to its author; a button that rewrote the document would make the reviewer the author, and the plan file is the agent's or the human author's to change.
- **Condition diff values cross the wire as canonical JSON TEXT.** `EvalConditionFieldDiff.a/b` are `string | null`, `null` meaning the field is absent on that side. The declaration's field types are whatever the document holds, so the raw values would be `unknown` in the wire schema; the page renders them as text either way, and "absent" stays a first-class difference (`scope` absent versus `scope: "eval-b"` is the two-subjects case the field exists for).
- **The two pages fetch lazily, when their tab is opened.** A validate walks the dataset tree and a condition listing walks `conditions/`; making the overview pay for both on every visit would tax the cheap page for the expensive ones.
- **After an approval the page keeps the ids and shows the job log verbatim.** The mission ledger holds nothing for a run until `runCreate`, and the readiness gate refuses exactly *before* that — a refused run never gets one ledger row, so its refusal exists only in the job's output. The store keeps what the approval answered with, `runOutput` is read by that job id, and the lines go up raw. The overview and the plan-review page share the block.
- **The open row survives its own id changing.** An approved plan is `plan:<path>` in the list until the orchestrator calls `runCreate` and its run id afterwards; the view re-finds it by the plan that was approved, so the reviewer is not dropped back to the list mid-run.
- **The job-log read passes its cursor explicitly.** `runOutput(jobId, cursor?)` defaults the cursor, but the gateway's client proxy enforces EXACT positional arity: a one-argument call throws `client api: dshEval/runOutput expected 2 argument(s), got 1` before it reaches the wire. Measured on the temporary instance — the specs' injected mocks accept any arity, so only a live gateway can catch it. The effect also takes a rejection handler, because a proxy that rejects before an envelope exists would otherwise leave the block saying "no line yet" forever with the reason only in the browser console.
- **`scope` and `preset` join `ConditionSummary`.** The conditions table needs both columns, and the CLI listing and the `eval_conditions` tool get them for free — one projection, no second read path.

## Package shape

`src/review.ts` holds the two projections (pure, over `validatePlan` and `listConditions` / `diffConditions`); `src/service.ts` exposes `planReview` / `conditionsPage` / `conditionDiffPage` / `approve`; `src/remote.ts` gains the four verbs. On the browser side `src/client/parts.tsx` holds what the pages share with the overview (the row cells, the labelled field, the started-run block) and `PlanReviewPage.tsx` / `ConditionsPage.tsx` are the two pages. All three are listed in `tsconfig.client.json` — that project enumerates files rather than globbing.

## Alternatives considered

**Why not a `eval_approve` model tool, so the planning agent can start its own experiment?** Because R1 is the point of the whole surface, not a formality. The evaluation exists to produce a comparison a human will believe; a model that can start runs can spend the budget and pick the moment, and the one act that says "I have read this and I accept it" would then have no human in it. The agent drafts, validates and reads progress — that is the whole of its half. Making the verb browser-only is what makes the rule enforceable rather than advisory.

**Why not let 退回修改 write something — a `status: draft` field, or a note into the plan?** Two reasons. The plan document is a contract (`dataseek.plan/1`) whose sha identifies the experiment, so a review-time write would change `planSha` and make the reviewed plan a different plan. And a review status stored in the file makes the reviewer an author of the thing being reviewed. A page-local note is honest about what the button is: a message to whoever will edit the plan.

**Why not throw the refusal, so the client's `RemoteResult` error path handles it?** A throw carries a message and nothing else. The refusal a reviewer needs is "here is the check list, and here is which lines stopped it" — the list and the reason are one answer, and splitting them across a value channel and an error channel would make the page reassemble what the service already knew. Genuine transport failures still arrive as RPC errors; what is modelled as data is the *decision*.

**Why not re-derive the check list in the browser from a raw plan document?** Then two implementations would answer "may this be approved", and the day they disagreed nobody could tell which was right — with a run's worth of delegations riding on it. The client is deliberately a renderer of `validatePlan`'s output.

**Why not wait for the mission ledger and show the readiness block the overview already has?** Because the case that most needs the evidence is exactly the case with no ledger row. The readiness gate refuses before `runCreate`, so `experiment(runId)` has nothing to project and the overview's readiness block stays empty forever. Reading the job log is the difference between "the run was refused" and "the scoped home for codex-exec holds no credential".

**Why not carry the diff's values as raw JSON?** The wire schema would then have to say `unknown` for two fields whose type is whatever a declaration holds, which weakens the whole payload's contract to buy nothing: the page renders both sides as text. Canonical JSON text also makes "absent" expressible as `null` without colliding with a JSON `null` value on that side.

**Why not fetch the plan review together with the experiment detail?** A validate resolves every condition, reads every stage schema and walks the verify layer; the overview is opened on every visit and the review on some of them. Lazy per-tab fetching keeps the common path cheap, and the refresh button re-reads whichever page is open.

## Consequences

- The Experiments tab now covers steps 3, 4 (reading) and 5 of the eight-step flow. Steps 6 to 8 remain placeholders naming T35b, T38 and T37.
- The 新建实验 placeholder now names **T34**, not T36: the new-experiment form is where a condition is minted (choosing a model IS minting one), and the conditions page's 新建条件 button points at the same task rather than growing a second writer of the same file.
- `ConditionSummary` gains `scope` and `preset`. Additive: the CLI listing and `eval_conditions` see two more fields and nothing moves.
- The browser bundle grows from ~221 kB to ~273 kB (two pages, the shared parts module, and the copy for both).
- `EvalApproveResult.refusal` is the one place a human sees why an approval did not start a run; anything that later refuses inside `approve` must put its sentence there rather than throwing, or the page loses it.
- T35b inherits the `parts.tsx` split and the store's per-experiment reset (`open` clears the review, the approval and the started run, and keeps the repository-scoped condition listing).

## Testing

- `packages/eval`: 534 tests green (510 before). New `tests/remote.spec.ts` — 9 cases over a real service core in a cordis context: the review's digest and its ok lines, a contract-violating condition as an error, the missing-condition warning boundary (pinned so the page can never be stricter than the CLI), approve refusing without reaching `runStart`, approve passing the approving session and its cwd, a session with no workspace passing no cwd, a wiring failure arriving as a refusal, the conditions table's scope / preset / lock columns, the diff carrying only differing keys with absent-as-null, and the notes-only diff staying `identical`.
- New `tests/LabReview.client.spec.tsx` — 13 cases through `LabView`: the lazy review fetch, the kv block and the per-line validate list, approve landing on the overview with the job, run and log verbatim, a refusal shown without starting anything, a rejected plan disabling the button, 退回修改 changing only the page, a run with no plan document, the conditions table, the two-condition diff carrying only the differing fields, the third-pick replacement, unpicking, the 新建条件 placeholder, a refused listing, and a job-log read that REJECTS rather than answering an envelope.
- `tests/apply.client.spec.ts` gains the five new injected verbs and pins `fetchRunOutput` as the session-LESS one.
- `pnpm gate --all` green.
- Walked on a throwaway instance (its own `DSH_HOME`, port 3199, the profile installed in source mode, torn down afterwards): the tab registers under the 评测模式 preset, the list shows the repository's plans, the plan review renders the kv block and every validate line with its severity and code, 批准并启动 answers `job eval-run-1 · run run-20260914070348-djrz` and lands on the overview, the run log shows the refusal verbatim (`run … refused: condition dsh-exec: no local-agent harness "dsh" with a delegation provider is registered`), and the conditions page diffs `dsh-exec` against `codex-exec` into 7 differing fields and nothing else. Zero console errors throughout. The arity bug above was found on this walk.
