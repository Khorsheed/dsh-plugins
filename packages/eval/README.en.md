# dsh-eval

English | [中文](README.md)

**The web-eval orchestrator: the dataseek contract schemas, plan/condition validation, deterministic condition & scoped-home hashing, run-template generation from a dataset-suite manifest, and the stage-one/two run loop (per-cell materialization, byte-exact delegation, submit/transition, the archive gate, bundle export).** Starting a run is a human action (`/eval run` — the invoking session is the parent of every delegation); judging and reporting belong to later tasks (T9 / T10). No sibling-plugin dependencies: the four upstream services (datasets / mission / localAgent) are probed per run via `ctx.get`, and a missing one is a refusal naming it — never a boot failure.

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

## The run loop v0 (stages one and two, host directories)

`ctx.eval.run(planPath, options)` is the body; `/eval run` is the human act of starting it. The flow:

1. **Validation first**: a plan with errors is refused before anything executes; a condition lock that disagrees with the fresh hash is refused (a missing lock is a warning and the fresh hash is used — the full readiness gate lands with I4 provision).
2. **Snapshot**: `datasets.snapshot` pins the commit into run.meta.
3. **Template + matrix**: the template is generated beside the plan; `expandMatrix` expands (items × conditions × reps) and `orderCells` shuffles by `plan.order.seed`, preferring same-condition non-adjacency when interleaving; order and concurrency are written into run.meta.
4. **Per cell** (concurrency default 1): an isolated directory `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/` receives the item's visible-layer content plus a `materialization.json` (sorted per-file sha256 + overall sha, addArtifact kind `materialization`); each stage's prompt = the dataset-level `prompts/<stage>.md` bytes + one newline + the item's `task.md` bytes, sha256 recorded into the orchestrator ns; the orchestrator calls `ctx.localAgent.start` (first round) / `resume` (later rounds) directly, passing the cell directory as the delegation `cwd` (the local-agent family's cwd support, T11).
5. **Advancing**: after each delegation the stage outputs are collected from the cell directory and `submit({to, json, files})` (intended-edge pre-validation) + `transition(to)` run; a fired `halt_on` diverts to `halted`. Schema violations are never retried: `{kind: 'submission-rejected', violations}` is recorded and the cell stops in its current state.
6. **Failure policy**: delegation start failures, facade errors, and timeout cancels → `retry(reason, 'infrastructure')` and the cell is redone, budget default 1 (adjustable via `--retries`); past the budget `{kind: 'cell-skipped'}` is recorded and the cell skipped. Timeout = the per-cell cumulative delegation time against `plan.budget.activeMinutes`; on expiry `cancel(childSessionId)` fires.
7. **Archive**: after the last stage the cell directory is copied into the attempt's run-data `archive/workspace/`, and the run stops after `transition(archived)` — verdicts/ stays empty until the judge (T9) lands, an empty directory cannot pass the file-check, so `released` happens only on an explicit `--finalize` and requires a non-empty verdicts/.
8. **Export**: at the end the bundle is exported to `<dataset repo>/exports/` (override with `--out`), visible layer only (modelFacing:true — no leak-gate confirmation needed).

Before any work, the run writes one anchor per cell: `{kind: 'cell', task, condition, conditionSha, rep}` — so even a cell that never runs stays attributable, and the report reads cell identity from this anchor alone (a bundle carries no labels, and the mission id is lossy).

Every delegation records one orchestrator-ns annotation `{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, model: {declared, observed}}`; `observed` comes from T11's read-back — this round's settled event first, then the `delegationOf(childSessionId)` record. Reading the record means WAITING: a provider merges its observation in a settle pass chained after the result resolves, while the facade clears the tracked run (and with it the `onProgress` the options carried) at that same moment — so on a real facade the settled event never reaches the orchestrator and the record gains its value a beat late; reading it the instant the run returns reads nothing (what the first real two-cell run showed). The loop therefore polls the record for a bounded moment after settle (10s by default, `readbackWaitMs` to tune), taking an observation that differs from the one held before the round began; when the wait expires it still returns the record's current value (a resumed round that ran the same model is indistinguishable anyway, and the record means "this delegation's latest observation"), and null only when neither channel ever carried one. `usage` rides the settled event alone: a facade that clears the tracked run first records none here, and null is the honest answer. A model read back that contradicts the condition's `model.declared` fails the run on the spot (frozen decision 5: the run is misattributed), never as a retryable infrastructure failure.

## Service face `ctx.dshEval`

The cordis service name is `dshEval`, deliberately NOT `eval`: the loader evaluates `!!js` config expressions with `with (ctx) { return eval(expr) }`, so a ctx property named `eval` shadows the global `eval` and crashes any composition mounting this plugin the moment a `!!js` expression is interpolated (found live on the 3171 instance). The package name, the loader entry id (`eval`), and the `/eval` slash name are unaffected.

| Method | What it does |
|---|---|
| `validatePlan(planPath)` | Validates the plan schema and semantics (judge ≠ players, judge/expectedNs cross-check, budget bounds), resolves condition declarations and locks, lints stage schemas. Data problems come back as diagnostics (`errors` / `warnings`, each with a stable code); it never throws |
| `hashCondition(condition)` | Condition hash = sha256 of the canonical JSON (sorted keys, no whitespace), `notes` excluded (editing a comment is not a new factor). Throws `EvalContractError` on an invalid document |
| `hashHome(homeDir)` | Scoped-home content hash: config-suffixed files only, credential-shaped paths skipped via the deny list; content feeds the digest and is never returned or printed |
| `generateTemplate(manifestPath, opts?)` | Generates a run template from a suite manifest (options: `stages` subset, `missions` cell batch, `name`, schema-path prefix). Pure: no schema files probed — probing belongs to mission's runCreate lint |
| `run(planPath, options?)` | The run-loop body (above). Refuses naming any missing one of datasets / mission / localAgent; the `dryRun` option validates, generates the template, expands, and orders — needing no upstream at all |
| `report(bundleDir, {out?})` | Turns a self-contained mission export bundle into `results.jsonl` + `summary.md` (next section). Reads only the bundle; writes `<bundleDir>/report/` by default, overwriting on re-run (a report is derived state; the bundle itself stays append-only) |

## The report (`report`)

Input: a mission export bundle (manifest.json, run.json, missions/<id>/attempt-N/{meta,annotations,artifacts}, dataset/<layer>/). Output: two files.

- **results.jsonl** — one verdict per line: `{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`. `weight` appears only when the bundle's dataset layers carry a rubric with weights; `stage` comes from the annotation record's stage field (the verdict contract itself has no stage — null when unrecorded).
- **summary.md** — opens by checking the four invariants (same materialization / same environment fingerprint / same subject / same procedure). **If any one fails or cannot be established, the report prints fact tables only — no comparison.** When comparison is allowed: factors are derived by pairwise-diffing the condition documents recorded in run.meta.conditions (exactly one differing field names the factor; several degrade to 多因子, descriptive only); pairing blocks on tasks and resamples reps for a deterministic seeded bootstrap 95% CI (hand-written statistics, no dependency), reporting per-task deltas (passed criteria and weighted score), n, and refusing to rank when n < 3 or the factor is unknown/multi. Judge consistency reports per-criterion agreement and Cohen's κ across double samples, and llm-draft vs human-final agreement when the final pass exists. Efficiency metrics stay parallel, never summed: active time (summed delegation durationMs), listed price (only when run.meta.pricing records one), delegation rounds (compared only on tasks both sides completed), tokens only within the same model. An expectedNs namespace whose verdicts were all written by `tool:` origins raises a red flag at the top of the summary.

The authoritative verdict source per cell is picked in order (human-final > llm-draft > script, majority across samples per criterion); reps are independent samples and attempts are infrastructure retries — every attempt's verdicts land in results.jsonl, aggregation uses each cell's latest attempt.

## slash and CLI

```sh
/eval run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N]
```

Starting a run is a human action: execute it in a session of the web-eval instance and that session becomes the originSession and the parent of every delegation. No run-class model tool is registered — the write verbs belong to the orchestrator's service face and to people.

```sh
dsh-eval validate <plan.json>             # validate a plan; JSON report on stdout
dsh-eval run <plan.json> --dry-run        # offline rehearsal: validate + template + matrix + order; anything else is refused
dsh-eval template <manifest.yml> [--stages a,b]  # print the generated run template
dsh-eval conditions hash <condition.json> # prints { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # emit results.jsonl + summary.md; JSON summary on stdout
```

Data goes to stdout as JSON, diagnostics to stderr; exit codes 0 ok / 1 failure / 2 usage (matching `dsh-lab`). The CLI builds the kernel directly and needs no host — scripts and mounted plugins behave identically; there is no live parent agent outside a session, so the CLI's `run` is `--dry-run` only.

## Hash rules

- **Condition hash**: sha256 hex (lowercase) of the canonical JSON (keys fully sorted, no whitespace); `notes` excluded.
- **planSha**: sha256 of the canonical JSON of the whole plan document (notes included — an edited comment IS a new plan, which is exactly the "same plan, same program" reading).
- **home.sha**: hash config-suffixed files only (`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`), fed to sha256 as `<relPath>\0<content>\0` in sorted relative-path order. Deny list: `auth.json`, `.env*`; file names containing `token` / `key` / `credential` / `secret` / `password` / `auth` (case-insensitive); the `credentials/`, `oauth/`, `sessions/`, `keys/`, `secrets/` directories whole; symlinks and oversize files (>1 MiB). File content is never logged or printed.
- **materialization.json**: the item's visible-layer files, path-sorted, each with its sha256; the overall sha folds `<path>\0<fileSha>\0` in sorted order — same-task cells can PROVE identical materialization.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — consumes `Context.provide` and `commands`; the three sibling services are probed at run time, a missing one is a refusal, never a boot failure.
- source line (deepseek-harness master): ✅ — same.

Degraded / absent items (kept in sync with `dsh.compat` in package.json):

- Against a local-agent predating T11: the delegation `cwd` is ignored and the child inherits the parent session's cwd — the cell is then refused honestly at collection (submission-rejected), never mis-attributed; with neither `delegationOf` nor a settled read-back, `usage` and `model.observed` are recorded as null and the report's 受试对象一致 invariant degrades to unverifiable rather than assumed.

## Status

I2: T2 offline verbs, T8/T8b orchestrator v0 (template generation, matrix expansion, the stage-one/two run loop, cell anchors, T11 read-back backfill, slash, CLI dry-run), and T10 `report` (results.jsonl / summary.md / the four invariants / paired deltas with bootstrap CIs / judge consistency / parallel efficiency) have landed. Judge (T9), read-only tools (T14), provision (I4), UI (I5) follow the web-eval iteration plan.

## License

[MIT](../../LICENSE)
