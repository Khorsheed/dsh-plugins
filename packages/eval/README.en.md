# dsh-eval

English | [中文](README.md)

**The web-eval orchestrator: the dataseek contract schemas, plan/condition validation, deterministic condition & scoped-home hashing, run-template generation from a dataset-suite manifest, and the stage-one/two run loop (per-cell materialization, byte-exact delegation, submit/transition, the archive gate, bundle export).** Starting a run is a human action (`/eval run` — the invoking session is the parent of every delegation); the two MECHANICAL verdict sources (probes writing `script`, blind LLM judging writing `llm-draft`) land with T9, while `human-final` stays a person's act. No sibling-plugin dependencies: the four upstream services (datasets / mission / localAgent) are probed per run via `ctx.get`, and a missing one is a refusal naming it — never a boot failure.

The model-facing surface is exactly three read tools (see "Model tools"); run, finalize, and annotation are never offered to the model.

`report` turns a mission export bundle into results.jsonl + summary.md (see "The report"); it only reads the bundle and consumes no host capability.

## What it owns

Three contract schemas plus one lock record (full text in [dataset-authoring-protocol §6](../../docs/dataset-authoring-protocol.md); in code they live in the single `src/schema.ts` module, and tests pin doc and code against drift):

| Schema | What it is |
|---|---|
| `dataseek.condition/1` | The subject under test: harness, model declaration, permissions (per-harness vocabulary), scoped-home hash, env key names |
| `dataseek.plan/1` | All inputs of one run: items × conditions × reps × stages × order × budget × judge × expected verdict sources |
| `dataseek.verdict/1` | Verdict output: the format both probes and judges emit |
| `dataseek.condition-lock/1` | The material record of a condition hash and its scoped home; a plan's shas resolve from here |

The validator follows the field decisions I1 froze: null in a condition's nullable fields (`harness.version`, `model.declared`, `model.endpoint`, `home.sha`) means "unresolved", listed as a warning; `plan.conditions` carries condition IDs, shas resolve from `conditions/<id>.lock.json`, a missing lock means "not ready" (also a warning — blocking belongs to the pre-run readiness gate); `judge` may be absent, and when it is, `expectedNs` must not contain `llm-draft`; a plan carries no template field.

## Template generation: manifest → run template

The run template is never hand-written by a person or an agent: it is a deterministic function of the dataset-set `manifest.yml` (`generateTemplate`), and tests pin it item-for-item equivalent to the I1 hand-written `templates/bench-v1.json`:

```text
pending → ws-ready → stage-1 → … → judged → archived → releasable → released
                          └→ halted (halt_on fired) → archived
```

- The earliest transition carries the run-meta schema-check (`schemas/run-meta.json`: `datasetId` + `commit`), pinning the snapshot into the state machine;
- every stage's OUTGOING edge carries a schema-check on that stage's structured schema (the `schemas/<stage>.json` file the manifest's `output_schema.<stage>.structured` references; the retired inline draft notation is refused on sight);
- a stage declaring `halt_on` gains a `→ halted` edge whose guard points at the conventional `schemas/<stageId>-halted.json` file (the const check lives in the schema file);
- entering `releasable` carries the file-check (`archive/workspace/`, `archive/verdicts/` — directories must be non-empty).

Stage states are named by manifest position (`stage1` → `stage-1`); cell outputs are `<stageId>.json` / `<stageId>.md` (the prompt names the stage). Schema paths are emitted relative to the template's own location — the orchestrator writes the template beside the plan (`plans/<plan>.template.json`), resolving `../schemas/…` exactly like the hand-written template does.

## The run loop v0 (stages one and two; host directories or container units)

`ctx.eval.run(planPath, options)` is the body; `/eval run` is the human act of starting it. The flow:

1. **Validation first**: a plan with errors is refused before anything executes; a condition lock that disagrees with the fresh hash is refused (a missing lock is a warning and the fresh hash is used — the full readiness gate lands with I4 provision).
2. **Readiness (T23)**: before the run is created, every condition is probed with ONE minimal delegation through the same facade, provider and cwd rule the cells use — see [Readiness](#readiness-one-real-delegation-per-condition). Any condition that fails refuses the whole run; `--ignore-readiness` starts anyway and records every cell of that condition as `cell-skipped` with the reason.
3. **Subset (T23)**: `--only <missionId,…>` and `--max-cells N` select part of the seeded order. The selection lands in `run.meta.subset` (`{only, maxCells, totalCells, selectedCells}`) and the generated template carries exactly the selected missions, so the ledger holds no cell the run will never drive. The plan contract gains no field: a subset belongs to ONE execution, not to the reviewed program.
4. **Snapshot**: `datasets.snapshot` pins the commit into run.meta.
5. **Template + matrix**: the template is generated beside the plan; `expandMatrix` expands (items × conditions × reps) and `orderCells` shuffles by `plan.order.seed`, preferring same-condition non-adjacency when interleaving; order and concurrency are written into run.meta.
6. **Per cell** (concurrency default 1): an isolated directory `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/` receives the item's visible-layer content plus a `materialization.json` (sorted per-file sha256 + overall sha, addArtifact kind `materialization`); each stage's prompt = the dataset-level `prompts/<stage>.md` bytes + one newline + the item's `task.md` bytes, sha256 recorded into the orchestrator ns; the orchestrator calls `ctx.localAgent.start` (first round) / `resume` (later rounds) directly, passing the cell directory as the delegation `cwd` (the local-agent family's cwd support, T11).
7. **Advancing**: after each delegation the stage outputs are collected from the cell directory and `submit({to, json, files})` (intended-edge pre-validation) + `transition(to)` run; a fired `halt_on` diverts to `halted`. Schema violations are never retried: `{kind: 'submission-rejected', violations}` is recorded and the cell stops in its current state.
8. **Failure policy**: delegation start failures, facade errors, and timeout cancels → `retry(reason, 'infrastructure')` and the cell is redone, budget default 1 (adjustable via `--retries`); past the budget `{kind: 'cell-skipped'}` is recorded and the cell skipped. Timeout = the per-cell cumulative delegation time against `plan.budget.activeMinutes`; on expiry `cancel(childSessionId)` fires.
9. **Judge, then archive**: once the cell parks in its terminal stage state it is judged (next section), the verdicts land in `archive/verdicts/`, the cell directory is copied into `archive/workspace/`, and `transition(archived)` runs. The default run stops at archived; `--finalize` pushes `releasable → released` explicitly, and the file-check requires a non-empty verdicts/ — either source having produced something is enough; with neither, `finalize-refused` is recorded honestly and the cell stays at archived.
10. **Export**: at the end the bundle is exported to `<dataset repo>/exports/` (override with `--out`), visible layer only (modelFacing:true — no leak-gate confirmation needed).

Before any work, the run writes one anchor per cell: `{kind: 'cell', task, condition, conditionSha, rep}` — so even a cell that never runs stays attributable, and the report reads cell identity from this anchor alone (a bundle carries no labels, and the mission id is lossy).

Every delegation records one orchestrator-ns annotation `{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, model: {declared, observed}}`; `observed` comes from T11's read-back — this round's settled event first, then the `delegationOf(childSessionId)` record. Reading the record means WAITING: a provider merges its observation in a settle pass chained after the result resolves, while the facade clears the tracked run (and with it the `onProgress` the options carried) at that same moment — so on a real facade the settled event never reaches the orchestrator and the record gains its value a beat late; reading it the instant the run returns reads nothing (what the first real two-cell run showed). The loop therefore polls the record for a bounded moment after settle (10s by default, `readbackWaitMs` to tune), taking an observation that differs from the one held before the round began; when the wait expires it still returns the record's current value (a resumed round that ran the same model is indistinguishable anyway, and the record means "this delegation's latest observation"), and null only when neither channel ever carried one. `usage` rides the settled event alone: a facade that clears the tracked run first records none here, and null is the honest answer. A model read back that contradicts the condition's `model.declared` fails the run on the spot (frozen decision 5: the run is misattributed), never as a retryable infrastructure failure.

## The container path (I3·T20)

A plan that declares a `unit` segment takes the container path; one that does not takes the host path, **byte for byte** what it was before this section existed (pilot A's bundle recomputed on this branch produces a byte-identical `results.jsonl`). The container path needs `ctx.lab` and a credentials root: `/eval run … --creds-root DIR`.

**One unit per cell, in a fixed order** (architecture trajectory steps 11–17):

1. **`acquire`**: image, network, `user` and ceilings come from the plan's `unit` segment; **exactly one mount** — this condition's credential directory, `bind` and writable (a credential refresh has to land back on the host — T17's decision); **exactly one environment entry**, the condition's `unit.scopedHome.var` = its in-container path, plus `NODE_OPTIONS=--use-env-proxy` for dsh; `missionId` and `runId` both ride along. `workdir` is `/workspace`, and lab is asked to hand it to the unit's own user (`ownWorkdir`) — docker creates a missing workdir as root, which a non-root unit cannot write.
2. **`setRefs({resource, fingerprint})`**: written by the orchestrator itself, the moment the unit exists. lab writes the same two refs, but that write is warn-and-skip by design, and an invariant may not rest on a write that is allowed to skip — pilot A's fingerprint column was empty for a whole run and the report read `unverifiable` for the whole iteration.
3. **`populate`**: the host materialization directory → `/workspace`, with `manifestPath` pointing at the attempt's `materialization.json`; lab hashes, writes it, and registers the artifact. The orchestrator does not compute a second one: two files called `materialization.json` carrying two different hashes is worse than either alone. The workspace therefore holds **only the item's bytes** — no manifest, and so no host path, inside the unit.
4. **One delegation round per stage**: `exec = {container, workdir: '/workspace', env: {<VAR>: <in-container path>}}`, and **no `cwd`** (inside a unit the host cwd means nothing; a target that fails to name the scoped-home variable is refused outright by T17).
5. **A `checkpoint({name: <stage id>})` at the end of each stage** (its ref reaches mission through lab), then `collect('/workspace' → the cell directory)`. On the container path the cell directory is the **host mirror of the workspace**: collecting outputs, contract-checking, `submit`, and the judge's material all read it, which is why steps 7 and 9 of the run loop are shared code between the two paths.
6. **Judging happens inside the unit**: the probes run through `lab.verify`, their material riding verify's own scratch directory (`/run/dsh-lab/verify`, removed after every call); `--out` is written to `/run/dsh-lab/verdicts/<probe>/`, **not** into `/workspace` — the archive is the player's work and must not carry judging output. After the last probe, one `collect` brings the whole verdict tree back into the attempt's `probe-verdicts/`, where it is read and judged on the host; then the in-unit directory is removed. The three exit states and the backfill-before-validation order are identical to the host path's, verbatim.
7. **`archive`**: lab exports `workspace/` plus `manifest.json` into the attempt's `archive/`; `verdicts/` is already beside it (judging runs before archiving, because the gate refuses an empty one).

### Directory and credential conventions

- One credential directory per condition: `<--creds-root>/<condition id>`, bound at the in-container path the condition's `unit.scopedHome.container` declares. **No host path enters a plan or a condition** — a condition file runs unchanged on another machine, and the host side is an operator fact.
- A human stages those directories (the dataset repo's `env/creds/stage.sh`); the orchestrator only checks that they **exist, are non-empty, and have a plausible owner**, and never reads their contents. The owner must be the unit's uid or the orchestrator's own: the first is right where a Linux host passes uids through, the second where Docker Desktop remaps a bind mount to the container user. A third uid is refused — that is exactly the case where the unit cannot read, or write back to, its own credentials.
- The attempt's run-data directory gains two things: `materialization.json` (lab's manifest) and `probe-verdicts/` (the raw verdicts the probes wrote inside the unit). The host mirror of the workspace deliberately does **not** live there — the bundle would then carry it twice, once beside `archive/workspace/`. Where the mirror lives is recorded in a one-file `workspace-mirror.json`, which is the artifact each `collect` registers.

### One destroy path

`run.ts` holds a single `destroyUnit`, and `lab.release` appears nowhere else:

- **Pass the gate, then destroy.** With `--finalize`, the unit is destroyed as soon as `archived → releasable` succeeds, and only then does the cell move `→ released`. The placement is deliberate: `isReleasable` reads the CURRENT state and the template's releasableStates is `['releasable']` alone — destroying after `released` asks the gate a question it answers no to, and every container would survive.
- **Refused gate, kept container.** Without `--finalize`, or when an empty `verdicts/` blocks `releasable`, the destroy is still attempted, still refused, and the **container stays**, with `{kind: 'unit-retained', reason}` recorded on the cell. For a cell nobody has looked at, the scene is worth more than the container.
- **The failure path archives first.** When a cell throws (infrastructure failure, schema refusal, misattribution) the loop does `collect` → `archive` → the same gate: releasing without archiving destroys the evidence (lab README, «失败恢复循环»). No force there either, so a failed cell keeps its container.
- **`force` appears exactly once in this file**: the readiness probe unit. It is bound to no mission and therefore has no gate; lab requires an explicit `force` for such a destroy precisely so that a gate-less destroy is a sentence rather than a default.

### Known trade-offs

- **Serial.** The container path pins `concurrency: 1` (an explicit `>1` is refused); parallel units are I4. An `acquire` that hits `maxConcurrentUnits` is reported as a defect, not queued.
- **A multi-harness run does not share one fingerprint.** The composite fingerprint includes env key NAMES, and each harness names a different scoped-home variable (`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / …) — so four harnesses in one run make «环境一致» read `violated` under the existing rule. That is honest: the four environments genuinely differ. Making it hold needs either a fingerprint component change or a report-side rule, which is I4.
- **The two paths hash their materialization differently**: the host path uses the orchestrator's own concatenation (`path\0sha\0`), the container path uses lab's (`path  sha`, newline-joined). Comparable within one run (the invariant only asks whether cells of the same item agree), not across paths. The report reads both field names (`sha256` and `sha`).

## Readiness: one real delegation per condition

`/<harness> status` answers a SHAPE question — is there a credential record here? An expired, unrefreshable grant reads exactly like a working one. Pilot A took that answer at face value: `claude-code status` said `authenticated: yes` while every delegation returned 401, six of twenty-four cells were doomed before the run began, and the first evidence arrived at the first delegation.

So the pre-run check does not ask; it spends one delegation. Before `runCreate`, every plan condition is probed with the byte-exact one-sentence prompt `READINESS_PROMPT` (reply `READY`, no tools, no files) through the SAME facade, provider and per-directory `cwd` rule the cells use — there is no back door, so what the probe proves is what the cells will meet. A condition is ready only when the delegation both started AND returned `stopReason: 'completed'`; the probe also reads the model back and fails the condition when it contradicts `model.declared` (frozen decision 5, caught before the run instead of at its first stage round).

Each verdict is a `{kind: 'readiness', condition, harness, provider, ok, startedAt, durationMs, childSessionId, declaredModel, observedModel, reason?}` record. It lands in `run.meta.readiness` AND as an orchestrator-ns annotation on every cell of that condition, so a reader asking why a cell produced nothing finds the answer on the cell. A failed condition refuses the whole run and prints the reason (the 401, not "a condition failed"); `--ignore-readiness` starts anyway, and then every cell of that condition is recorded `cell-skipped` with the reason and is never delegated to.

## `finalize`: the re-entry point after `archived`

`--finalize` exists only at the moment a run starts, and judging-then-final-review is exactly the work that happens after archiving. Pilot A therefore pushed twelve cells through `dsh-mission transition` by hand. `/eval finalize <runId>` is that walk, mechanized: for every `archived` cell of a run it takes the same gate (`archived → releasable → released`, the archive gate's non-empty `verdicts/` file-check included), and for every cell that is not `archived` it reports the state and moves on.

It never forces. A gate refusal is recorded as `{kind: 'finalize-refused', from, error}` in the orchestrator ns and the cell stays where the gate stopped it — the gate is the reason an archive means anything. And it never touches a cell that has not reached `archived`: a pending or mid-stage cell is unfinished work, not un-released work. Skips are classified `already-released` / `interrupted` / `not-started` so a whole run summarizes in one line.

Outside a host there is no mission service, so `dsh-eval finalize` drives the `dsh-mission` CLI in a child process (`--data-dir`, `--mission-cli`, `$DSH_MISSION_CLI`) — the same seam a person uses by hand. eval still imports nothing from the mission package.

## Judging: probes (`script`) and blind LLM judging (`llm-draft`)

Once the cell has finished its stages and parked in its terminal state, the orchestrator runs the two mechanical sources before archiving. The full contract is [protocol §6.7 / §6.8](../../docs/dataset-authoring-protocol.en.md); this is the implementation-side reading.

**Probes (`script`)** — any `.mjs` / `.sh` under a `probes/` segment, from either of two sources: **the item's own** (its verify layer, judging that item alone) and **the dataset's shared** (the dataset-level verify layer, run once for every item — this is where "every item is measured with the same ruler" criteria like `shared/no-patch.sh` live). The invocation is `<probe> --cell <cell dir> --rubric <rubric path> --out <verdicts.json>`.

**The exit code carries three states**: `0` = judged (including `pass: false`), recorded `judged`; `3` = **not applicable this round** (the probe is fine and the criterion is not false — the input it needs is not in place: stage three never ran, the harness worktree is not in the cell), recorded `probe-skipped` with the first stderr line and **not counted a failure**; any other non-zero = the probe failed, recorded `probe-failed`. Exiting 0 without a readable `--out` counts as a failure. `3` rather than `2`, because `2` is the getopt-conventional "usage error" code and reading it as "cannot judge" would swallow every mis-invocation.

**The execution environment**: **both verify layers are materialized whole** into a host-side temporary directory, in the dataset's own relative layout (`<tmp>/verify/…` and `<tmp>/items/<item id>/verify/…`), so an item probe imports the dataset's shared library through the same relative path that resolves in the repository (`../../../../verify/helpers/lib/x.mjs`). The cwd is always the item's verify root, shared probes included. The whole directory is removed afterwards (from I3 `lab.verify` runs it inside the container; the contract is unchanged).

**`task` / `by` are backfilled BEFORE validation** — both are `required` under `additionalProperties: false`, so the other order would void a complete verdict for omitting exactly the two fields the orchestrator supplies. `by`: an item probe's display path in that item's verify layer; a shared probe's is `shared/` plus its display path in the dataset-level verify layer. A value the probe wrote that disagrees loses, and `overwritten` is recorded in the orchestrator ns. A verdict carrying `ratio` is checked at the source against the two numeric facts (`total > 0` with `0 <= passed <= total`, and `pass === (passed === total)`); a failure counts as off-contract output — the report's fallback to the boolean is a backstop, not the only gate.

Output goes to the `script` ns and `archive/verdicts/script.json`; when neither layer ships a probe, nothing at all is written. Every probe run is recorded in the orchestrator ns under `kind: 'probes'` as `{probe, origin, exitCode, outcome, ok, verdicts, durationMs, error?, reason?, overwritten?, dropped?}`.

**Blind LLM judging (`llm-draft`)** — the judge is itself a condition, named by `plan.judge.conditions`, with `plan.judge.samples` (default 2) samples per judge condition. Three constraints are enforced (frozen decision 9):

- **The judge must not be a contestant**: beyond validate's id-intersection check, the run compares `(harness.name, model.declared)` before executing — two different ids naming the same subject are refused too, and the refusal says which player it collided with.
- **De-fingerprint first**: harness names, CLI names and self-reported names in `stage1.json` / `stage1.md` / `stage2.json` / `stage2.md` become `<harness>`, and the plan's declared model identifiers become `<model>`; the replacement table and counts are recorded as `{kind: 'deidentify', files, table, total}`, the **originals are untouched**, and the judge only ever sees the copy.
- **Two samples**: each sample is a **fresh delegation** (a resumed judge would see its own previous answer), in its own cwd — the judge material directory.

The judge prompt = the `kind: llm-draft` criteria of the item's grading-layer rubric (`objective` rows go to the probes, `human` rows to the judge bench; neither is shown) + the de-identified material + the output contract. The judge writes a `dataseek.verdict/1` array into `verdicts.json` in its cwd; an unreadable answer records `{kind: 'judge-parse-failed'}` and is **retried once**, and a second failure drops that sample honestly. One `llm-draft` annotation per sample, `{sample, judgeCondition, judgeSha, promptSha, verdicts}`, plus `archive/verdicts/llm-draft-<judge condition>-<sample>.json`; `task` and `by` are backfilled by the orchestrator (the judging side only echoes them, and getting them wrong would corrupt every join the report performs).

The judge's cost is recorded as `{kind: 'judge', judgeCondition, judgeSha, sample, attempt, childSessionId, promptSha, startedAt, durationMs, usage, model}` — the kind is not `delegation`, so it **stays out of the report's contestant efficiency table**. The judge material directory (`$DSH_HOME/state/eval/judge/<runId>/…`: prompt + de-identified material + the judge's answer) is retained after the run for review; the probe directory is removed as soon as its probes have run.

The grading and verify layers are read through the datasets service face with an explicit single-layer scope (`layers: ['grading']` / `['verify']`) and materialized into host-side directories — **never into a player's cell**.

## Service face `ctx.dshEval`

The cordis service name is `dshEval`, deliberately NOT `eval`: the loader evaluates `!!js` config expressions with `with (ctx) { return eval(expr) }`, so a ctx property named `eval` shadows the global `eval` and crashes any composition mounting this plugin the moment a `!!js` expression is interpolated (found live on the 3171 instance). The package name, the loader entry id (`eval`), and the `/eval` slash name are unaffected.

| Method | What it does |
|---|---|
| `validatePlan(planPath)` | Validates the plan schema and semantics (judge ≠ players, judge/expectedNs cross-check, budget bounds), resolves condition declarations and locks, lints stage schemas, and cross-checks `expectedNs` against what each item can actually produce — `script` with no executable probe under `verify/probes/`, `llm-draft` with no rubric or no `kind: llm-draft` leaf, both as warnings (T23; the dataset-side rules are T26's). Data problems come back as diagnostics (`errors` / `warnings`, each with a stable code); it never throws |
| `hashCondition(condition)` | Condition hash = sha256 of the canonical JSON (sorted keys, no whitespace), `notes` excluded (editing a comment is not a new factor). Throws `EvalContractError` on an invalid document |
| `hashHome(homeDir)` | Scoped-home content hash: config-suffixed files only, credential-shaped paths skipped via the deny list; content feeds the digest and is never returned or printed |
| `generateTemplate(manifestPath, opts?)` | Generates a run template from a suite manifest (options: `stages` subset, `missions` cell batch, `name`, schema-path prefix). Pure: no schema files probed — probing belongs to mission's runCreate lint |
| `run(planPath, options?)` | The run-loop body (above). Refuses naming any missing one of datasets / mission / localAgent; the `dryRun` option validates, generates the template, expands, and orders — needing no upstream at all |
| `conditions({repo?, dataset?, session?})` | Lists the conditions a dataset repository declares: harness, declared model, condition hash, readiness (lock present, still matching, home verified), and the fields still unresolved. Without `repo` it resolves the calling session's datasets binding and honours that binding's dataset whitelist — which datasets an agent may see is the human's decision |
| `runStatus(runId)` | Projects one run: the run.meta digest (planSha, pinned commit, conditions, seeded order, start time) plus a row per cell (task, condition, rep, attempt, state, bucket, the orchestrator's latest annotation, submission-rejected count). Refuses in words when no mission service is mounted |
| `finalize(runId, options?)` | Walks every `archived` cell of a run through `archived → releasable → released` (the same gate `--finalize` takes) and reports every other cell with its state. A refused gate is recorded against the cell, never forced. Refuses naming the mission service when the composition mounts none |
| `report(bundleDir, {out?})` | Turns a self-contained mission export bundle into `results.jsonl` + `summary.md` (next section). Reads only the bundle; writes `<bundleDir>/report/` by default, overwriting on re-run (a report is derived state; the bundle itself stays append-only) |

## The report (`report`)

Input: a mission export bundle (manifest.json, run.json, missions/<id>/attempt-N/{meta,annotations,artifacts}, dataset/<layer>/). Output: two files.

- **results.jsonl** — one verdict per line: `{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, ratio?, weight?, negative?, evidence, by}`. `ratio` appears only when the verdict declared a usable `{passed, total}`; `weight` / `negative` appear only when that criterion's polarity is known (below); `stage` comes from the annotation record's stage field (the verdict contract itself has no stage — null when unrecorded).
- **summary.md** — opens by checking the four invariants (same materialization / same environment fingerprint / same subject / same procedure). **If any one fails or cannot be established, the report prints fact tables only — no comparison.** When comparison is allowed: factors are derived by pairwise-diffing the condition documents recorded in run.meta.conditions (exactly one differing field names the factor; several degrade to 多因子, descriptive only); pairing blocks on tasks and resamples reps for a deterministic seeded bootstrap 95% CI (hand-written statistics, no dependency), reporting per-task deltas (scored criteria and weighted score), n, and refusing to rank when n < 3 or the factor is unknown/multi. Judge consistency reports per-criterion agreement and Cohen's κ across double samples, and llm-draft vs human-final agreement when the final pass exists. Efficiency metrics stay parallel, never summed, and every one of them counts **completed cells only** (`judged` / `archived` / `releasable` / `released`): active time (summed delegation durationMs), listed price (only when run.meta.pricing records one), delegation rounds (compared only on tasks both sides completed), tokens only within the same model. An unfinished cell's delegation time buys an unknown fraction of the work, so pooling it produces a number that means nothing — pilot A's two harnesses both read 21.0 min of active time, and the tie was one dsh cell that had only ever run stage one. What was excluded is printed on its own line under the table, by condition and state; `results.jsonl` is unaffected. The procedure invariant also prints `run.meta.subset` when the run recorded one, so a run that covered part of its plan cannot be read as a complete one. An expectedNs namespace whose verdicts were all written by `tool:` origins raises a red flag at the top of the summary.

The authoritative verdict source per cell is picked in order (human-final > llm-draft > script, majority across samples per criterion); reps are independent samples and attempts are infrastructure retries — every attempt's verdicts land in results.jsonl, aggregation uses each cell's latest attempt.

### Criterion polarity and the weight table (protocol §6.5)

`pass` always means "the criterion holds". A negative criterion words a DEFECT, so its holding means the defect is present — which is why the report's main axis is the **scored-criterion count**: a positive criterion scores 1 when it holds, a negative one scores 0 when it holds and 1 when it does not. The weighted score is Σ `weight` × the fraction that criterion earned, so a negative weight subtracts on its own. The summary also carries a separate «negative criteria that held» table (which cell, which criterion, what proportion, what evidence) — the defect list.

Criteria scored proportionally (F2 / F3's C1 and C2) carry an optional `ratio: {passed, total}` on the verdict (protocol §6.5): the report scores `passed / total` instead of the boolean (a negative criterion scores the remainder, `1 − passed/total`), averaging the proportions across samples of the same criterion. `pass` remains the boolean fact (the criterion **fully** holds) and `ratio` only refines it — a consumer that does not understand `ratio` degrades to the strict boolean and can only under-count. The proportion travels in the field alone: the report **never** parses a `通过 6/9` prefix out of `evidence`, and a ratio with `total ≤ 0` or a `passed` out of range is treated as absent and named in the notes.

Polarity comes from the rubric, never from the verdict. The rubric lives in the grading layer and never enters a bundle, so after exporting, the run DERIVES a weight table from that layer into `<bundle>/report/rubric-weights.json` (`dataseek.rubric-weights/1`: `{task, id, weight, negative, kind, axis}` — identifiers and numbers only, **no criterion text and no evidence**, which is why it needs no leak gate). The report prefers that table and falls back to a rubric inside the bundle's dataset layers (a deliberately guarded export). With neither, it prints counts only and says plainly that the polarity is unknown and the counting assumes every criterion positive, reporting the negative-criterion count as unknown — "cannot tell" is never rendered as "no defects". `report` only reads this file; it never rewrites it.

## Model tools (read-only, three of them)

The agent appears twice in an evaluation: drafting during planning, reading during analysis. Neither needs to write. So this package registers **exactly three model tools, all reads**, and deliberately no fourth — an agent that could start a run could start one the human never approved.

| Tool | What it answers |
|---|---|
| `eval_conditions` | Which conditions the dataset repository declares, each with its hash, readiness, and which fields are still null. Parameters: `repo` (default: the session's datasets binding) and `dataset` (default: every set in the repository) |
| `eval_plan_validate` | The validation of a plan at a given path: `ok` / `errors` (it cannot run) / `warnings` (not resolved yet) plus the resolved condition shas. Validating starts nothing |
| `eval_run_status` | One run's run.meta digest and per-cell state; sourced from `mission.runStatus` and the orchestrator ns |

Not one write verb is exposed: a run is started by a person with `/eval run` in their session, and materialize / submit / transition / annotate / archive / export / finalize belong to the orchestrator's service face and the human's CLI (the profile's [tool-opening-by-domain rule](../../profiles/web-eval/README.md#工具按域开放)).

Configuration is `tools: 'all' | 'none'` (default `all`). There is no finer grouping because there is nothing to group: this package registers no write tool at all. Under `none` the plugin keeps only its slash, CLI, and service faces.

Tools join through **deferred injection** (`ctx.inject(['tools'], …)`), not an apply-time `ctx.get('tools')` probe: the probe races the tool registry's own mount order and loses, so the tools silently never register and nothing says so (room and worktrees each shipped this same fix). Deferred injection fires when the registry appears and never fires in a composition without one — such a composition keeps the slash, CLI, and service faces and never fails boot. The `tool:eval` prompt section rides through the same deferred door on `systemPrompt`.

## slash and CLI

```sh
/eval run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N]
                      [--only id,id] [--max-cells N] [--ignore-readiness]
/eval finalize <runId>
```

Starting a run is a human action: execute it in a session of the web-eval instance and that session becomes the originSession and the parent of every delegation. No run-class model tool is registered — the write verbs belong to the orchestrator's service face and to people.

```sh
dsh-eval validate <plan.json>             # validate a plan; JSON report on stdout
dsh-eval run <plan.json> --dry-run        # offline rehearsal: validate + template + matrix + order; anything else is refused
                                          #   [--only id,id] [--max-cells N] rehearse a subset
dsh-eval finalize <runId>                 # walk the archived cells through the release gate
                                          #   [--data-dir DIR] [--mission-cli PATH]; drives the dsh-mission CLI
dsh-eval template <manifest.yml> [--stages a,b]  # print the generated run template
dsh-eval conditions hash <condition.json> # prints { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # emit results.jsonl + summary.md; JSON summary on stdout
```

Data goes to stdout as JSON, diagnostics to stderr; exit codes 0 ok / 1 failure / 2 usage (matching `dsh-lab`). The CLI builds the kernel directly and needs no host — scripts and mounted plugins behave identically; there is no live parent agent outside a session, so the CLI's `run` is `--dry-run` only. `finalize` needs no parent agent — only the ledger — so it works outside a host by driving the `dsh-mission` CLI in a child process, and exits 1 when any cell's gate refused.

## Hash rules

- **Condition hash**: sha256 hex (lowercase) of the canonical JSON (keys fully sorted, no whitespace); `notes` excluded.
- **planSha**: sha256 of the canonical JSON of the whole plan document (notes included — an edited comment IS a new plan, which is exactly the "same plan, same program" reading).
- **home.sha**: hash config-suffixed files only (`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`), fed to sha256 as `<relPath>\0<content>\0` in sorted relative-path order. Deny list: `auth.json`, `.env*`; file names containing `token` / `key` / `credential` / `secret` / `password` / `auth` (case-insensitive); the `credentials/`, `oauth/`, `sessions/`, `keys/`, `secrets/` directories whole; symlinks and oversize files (>1 MiB). File content is never logged or printed.
- **materialization.json**: the item's visible-layer files, path-sorted, each with its sha256; the overall sha folds `<path>\0<fileSha>\0` in sorted order — same-task cells can PROVE identical materialization.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — consumes `Context.provide` and `commands`; the three sibling services are probed at run time, a missing one is a refusal, never a boot failure.
- source line (deepseek-harness master): ✅ — same.

Degraded / absent items (kept in sync with `dsh.compat` in package.json):

- The three read tools and the `tool:eval` prompt section arrive by deferred injection: in a composition with no tool registry / no systemPrompt they simply do not register — the slash, CLI, and service faces keep working and boot is unaffected.
- Against a local-agent predating T11: the delegation `cwd` is ignored and the child inherits the parent session's cwd — the cell is then refused honestly at collection (submission-rejected), never mis-attributed; with neither `delegationOf` nor a settled read-back, `usage` and `model.observed` are recorded as null and the report's 受试对象一致 invariant degrades to unverifiable rather than assumed. The judge collects `verdicts.json` through the same `cwd`; without it the sample is recorded as a parse failure, never as a verdict.
- `human-final` is not written by this package: it arrives only from the judge bench or `dsh-mission annotate --ns human-final` (I5).
- A composition without `ctx.lab` runs the host path as before; only a plan with a `unit` segment is refused for lab's absence, and the refusal names it.

## Status

I2: T2 offline verbs, T8/T8b orchestrator v0 (template generation, matrix expansion, the stage-one/two run loop, cell anchors, T11 read-back backfill, slash, CLI dry-run), T10 `report` (results.jsonl / summary.md / the four invariants / paired deltas with bootstrap CIs / judge consistency / parallel efficiency), T9 judge (probe contract, de-fingerprinting, double-sampled blind judging, `--finalize` through the gate), and T14's three read-only model tools have landed. I3: T23 closed pilot A's four orchestrator gaps — the pre-run readiness check (G4), `finalize` as a re-entry point (G13), efficiency over completed cells only (G15), and `--only` / `--max-cells` recorded in `run.meta.subset`; T28 closed the three the T19 probe self-test surfaced — dataset-level verify materialization with shared-probe execution, the tri-state exit code, and `task` / `by` backfilled before validation. T20 landed the container path: a plan's `unit` segment gives every cell its own unit (acquire → populate → one delegation round and one checkpoint per stage → probes inside the unit through `lab.verify` → archive → release through the gate), and `refs.fingerprint` is written by the orchestrator, so the second of the four invariants is checkable at last. Provision (I4), parallel units (I4) and the UI (I5) follow the web-eval iteration plan.

## License

[MIT](../../LICENSE)
