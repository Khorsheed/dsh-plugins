# dsh-eval

English | [中文](README.md)

**The offline half of the web-eval orchestrator: the dataseek contract schemas, plan/condition validation, deterministic condition & scoped-home hashing, and the bundle report.** It declares and checks, and it only reads bundles — `run` / `provision` belong to the orchestrator's executing half (landing from I2 on). No client half, no inject, no sibling-plugin dependencies: it installs and runs alone.

## What it owns

Three contract schemas plus one lock record (full text in [dataset-authoring-protocol §6](../../docs/dataset-authoring-protocol.md); in code they live in the single `src/schema.ts` module, and tests pin doc and code against drift):

| Schema | What it is |
|---|---|
| `dataseek.condition/1` | The subject under test: harness, model declaration, permissions (per-harness vocabulary), scoped-home hash, env key names |
| `dataseek.plan/1` | All inputs of one run: items × conditions × reps × stages × order × budget × judge × expected verdict sources |
| `dataseek.verdict/1` | Verdict output: the format both probes and judges emit |
| `dataseek.condition-lock/1` | The material record of a condition hash and its scoped home; a plan's shas resolve from here |

The validator follows the field decisions I1 froze: null in a condition's nullable fields (`harness.version`, `model.declared`, `model.endpoint`, `home.sha`) means "unresolved", listed as a warning; `plan.conditions` carries condition IDs, shas resolve from `conditions/<id>.lock.json`, a missing lock means "not ready" (also a warning — blocking belongs to the pre-run readiness gate); `judge` may be absent, and when it is, `expectedNs` must not contain `llm-draft`; a plan carries no template field.

## Service face `ctx.eval`

| Method | What it does |
|---|---|
| `validatePlan(planPath)` | Validates the plan schema and semantics (judge ≠ players, judge/expectedNs cross-check, budget bounds), resolves condition declarations and locks, lints stage schemas. Data problems come back as diagnostics (`errors` / `warnings`, each with a stable code); it never throws |
| `hashCondition(condition)` | Condition hash = sha256 of the canonical JSON (sorted keys, no whitespace), `notes` excluded (editing a comment is not a new factor). Throws `EvalContractError` on an invalid document |
| `hashHome(homeDir)` | Scoped-home content hash: config-suffixed files only, credential-shaped paths skipped via the deny list; content feeds the digest and is never returned or printed |
| `report(bundleDir, {out?})` | Turns a self-contained mission export bundle into `results.jsonl` + `summary.md` (next section). Reads only the bundle; writes `<bundleDir>/report/` by default, overwriting on re-run (a report is derived state; the bundle itself stays append-only) |

## The report (`report`)

Input: a mission export bundle (manifest.json, run.json, missions/<id>/attempt-N/{meta,annotations,artifacts}, dataset/<layer>/). Output: two files.

- **results.jsonl** — one verdict per line: `{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`. `weight` appears only when the bundle's dataset layers carry a rubric with weights; `stage` comes from the annotation record's stage field (the verdict contract itself has no stage — null when unrecorded).
- **summary.md** — opens by checking the four invariants (same materialization / same environment fingerprint / same subject / same procedure). **If any one fails or cannot be established, the report prints fact tables only — no comparison.** When comparison is allowed: factors are derived by pairwise-diffing the condition documents recorded in run.meta.conditions (exactly one differing field names the factor; several degrade to 多因子, descriptive only); pairing blocks on tasks and resamples reps for a deterministic seeded bootstrap 95% CI (hand-written statistics, no dependency), reporting per-task deltas (passed criteria and weighted score), n, and refusing to rank when n < 3 or the factor is unknown/multi. Judge consistency reports per-criterion agreement and Cohen's κ across double samples, and llm-draft vs human-final agreement when the final pass exists. Efficiency metrics stay parallel, never summed: active time (summed delegation durationMs), listed price (only when run.meta.pricing records one), delegation rounds (compared only on tasks both sides completed), tokens only within the same model. An expectedNs namespace whose verdicts were all written by `tool:` origins raises a red flag at the top of the summary.

The authoritative verdict source per cell is picked in order (human-final > llm-draft > script, majority across samples per criterion); reps are independent samples and attempts are infrastructure retries — every attempt's verdicts land in results.jsonl, aggregation uses each cell's latest attempt.

## CLI

```sh
dsh-eval validate <plan.json>             # validate a plan; JSON report on stdout
dsh-eval conditions hash <condition.json> # prints { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # emit results.jsonl + summary.md; JSON summary on stdout
```

Data goes to stdout as JSON, diagnostics to stderr; exit codes 0 ok / 1 failure / 2 usage (matching `dsh-lab`). The CLI builds the kernel directly and needs no host — scripts and mounted plugins behave identically.

## Hash rules

- **Condition hash**: sha256 hex (lowercase) of the canonical JSON (keys fully sorted, no whitespace); `notes` excluded.
- **home.sha**: hash config-suffixed files only (`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`), fed to sha256 as `<relPath>\0<content>\0` in sorted relative-path order. Deny list: `auth.json`, `.env*`; file names containing `token` / `key` / `credential` / `secret` / `password` / `auth` (case-insensitive); the `credentials/`, `oauth/`, `sessions/`, `keys/`, `secrets/` directories whole; symlinks and oversize files (>1 MiB). File content is never logged or printed.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — consumes only `Context.provide`; no host capability dependency.
- source line (deepseek-harness master): ✅ — same.

Degraded / absent items (kept in sync with `dsh.compat` in package.json): none. The report only reads bundles and consumes no host capability. The executing verbs (`run` / `readiness` / `generateTemplate` / `provision`) do not exist yet — see "Status".

## Status

I2 · T2: the offline verbs and the contract are final. I2 · T10: `report` (results.jsonl / summary.md / the four invariants / paired deltas with bootstrap CIs / judge consistency / parallel efficiency) has landed. The rest of the executing half follows the web-eval iteration plan (run/readiness in I2, provision in I4, UI in I5).

## License

[MIT](../../LICENSE)
