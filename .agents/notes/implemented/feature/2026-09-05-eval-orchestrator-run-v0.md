# Agent Note: eval orchestrator run v0 — generated templates and the stage-one/two run loop

Status: implemented

English | [中文](2026-09-05-eval-orchestrator-run-v0.zh.md)

## Problem

I1 walked one evaluation cell through the host by hand (the dataseek-eval repo's `docs/i1-walk-log.md`: ≈5h, template written by hand, materialization by `cp`, prompts by copy-paste, submissions by CLI). The offline contract half of `@khorsheed/dsh-eval` (validate / hash, T2) could describe a plan but not execute one. Without an executor, every pilot cell re-commits the same manual labor and re-invites the same mistakes (the walk log's G2/G10 class), and the frozen fairness decisions (prompt bytes, seeded order, active-minute budget, per-cell isolation) stay promises instead of program.

## Decision

`packages/eval` gains the executing half as of I2·T8, covering stages one and two with host directories instead of containers (lab enters at I3), no judge (T9), no report (T10):

- **The template is generated, never stored.** `generateTemplate(manifestPath)` turns the suite manifest's stages into the state machine `pending → ws-ready → stage-<n>… → judged/halted → archived → releasable → released`: the earliest edge carries the run-meta schema-check, each stage's OUTGOING edge carries its structured-schema check, a `halt_on` stage gains a `→ halted` edge pointing at the conventional `schemas/<stageId>-halted.json`, and entering `releasable` carries the non-empty-archive file-check. A test pins the output item-for-item against the I1 hand-written `templates/bench-v1.json`. Stage states are named `stage-<n>` by manifest position (the hand-written template's own convention); the orchestrator writes the generated template beside the plan (`plans/<plan>.template.json`), so its relative `../schemas/…` guard paths resolve exactly like the hand-written one.
- **The run starts from a session.** `ctx.eval.run(planPath, options)` is the body; `/eval run` (the invoking session = originSession = delegation parent) is the only live entry, and the CLI's `run` is `--dry-run`-only (offline: validate, generate, expand, order — no services needed). No run-class model tool exists. The three upstream services are probed per call; a missing one is a refusal naming it.
- **Per-cell isolation via the delegation `cwd`.** Cells materialize into `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`: the item's visible layer (listed via `datasets.show`, fetched via `datasets.read`, with `worktree_path` pinning the commit — the display→object path mapping lives behind `read`, so copying straight from the worktree would have re-implemented the register), plus `materialization.json` (sorted per-file sha256 + overall sha, indexed as a `materialization` artifact). The cell directory rides the delegation options as `cwd`; the field is a structural superset of today's `DelegationCallOptions`, so a facade without T11's option ignores it and the cell fails honestly at collection (missing stage files → submission-rejected) instead of mis-attributing output.
- **Prompts and advancing are byte-exact and mechanical.** Prompt = `prompts/<stage>.md` bytes + `\n` + `task.md` bytes, sha256 into the orchestrator ns; stage outputs are collected from the cell directory and submitted against the INTENDED edge (`submit --to`), the halt check (`halt_on.field === halt_on.equals`) selects `halted`; usage/observed-model stay null until T11.
- **Failure taxonomy.** Infrastructure failures (spawn error, facade throw, result rejection, timeout via `cancel` against the per-cell cumulative active budget) open a new attempt with `retry(reason, 'infrastructure')`, budget 1 by default; schema violations and missing stage outputs are `submission-rejected` — no retry, the cell stops in its current state. The default run stops at `archived` (verdicts/ is empty until T9 and G2 refuses empty directories); `released` requires an explicit `--finalize` that the archive gate still polices.

Two task-brief fields are not expressible in the frozen `dataseek.plan/1` (`additionalProperties: false`): `plan.retry.infrastructure` and `plan.exports`. They ride the run options (`retryInfrastructure` default 1, `exportsDir` default `<dataset repo>/exports`) until a protocol revision adds them; run.meta records everything the brief asked for (planSha over the canonical plan document, planPath, evalVersion = package version + repo HEAD short sha, snapshot, condition shas, order seed + sequence, concurrency, startedAt).

`js-yaml` becomes the package's first runtime dependency (manifests are YAML; the deny-list hash rules keep credentials out of every other path, and manifest parsing reads the same files the author reviews in git).

## Finding: the service name could not be `eval`

The first real-instance boot failed loud: `cannot get property "eval" without inject`, raised while interpolating local-agent's `!!js dshHomePath(…)` config expression. The loader evaluates `!!js` with `with (ctx) { return eval(expr) }` — a provided ctx property named `eval` shadows the global `eval` in that scope, so ANY `!!js` expression in ANY composition mounting the plugin dies (mount order cannot save it: the callee name is resolved before the expression runs). The cordis service was renamed `dshEval`; the package name, the loader entry id `eval`, and the `/eval` slash command are unaffected. This is a naming law for future services: never provide a name a `with`-scope could shadow — a JavaScript global above all.

## Alternatives considered

**Keep the hand-written template and validate it against the manifest.** Rejected: the template is derivable data (architecture.md step 7 says so explicitly); storing it re-opens the drift the walk log already hit (G10's notation migration), and a second source of truth would need its own lint. Generation plus an equivalence test keeps bench-v1.json as the pinned reference without making it an input.

**Copy the item's visible files straight from the `worktree_path` directory.** Rejected: with `register` re-homing files, the worktree contains OBJECT paths while the service exposes display paths — reconstructing the mapping means duplicating the registry logic outside datasets. Listing via `show` and fetching via `read` (explicit visible layer) keeps the layer ceiling in the service that owns it; the worktree still pins the commit and records the source.

**Refuse runs when a condition lock is missing (full readiness gate now).** Rejected for v0: the I1-walk dataset intentionally carries unresolved fields (no lock, null home.sha), and the brief's real-run acceptance uses it as-is. A missing lock is recorded as a warning and the fresh hash is used; a STALE lock is refused, because that is a real integrity break, not an unresolved declaration. The full gate lands with provision (I4), where home.sha can actually be verified.

**Classify child failures (`error` / `max-tokens` stop reasons) as outcome, not infrastructure.** Rejected for v0: under exec drive a CLI crash and a model refusal are indistinguishable from the outside, and the brief's policy list (spawn failure, facade error, timeout) has no bucket for them. They retry within the infrastructure budget and skip past it — a later task can split the taxonomy once the walk data says how often each case fires.

## Consequences

The orchestrator is now the only writer of evaluation runs: materialization, submission, transitions, and the archive copy all flow through one deterministic program, and every delegation carries its prompt sha, duration, and child session id into the orchestrator ns — the record T9 (judge) and T10 (report) consume is already being written. The cost: eval now parses YAML (a real dependency), duplicates a minimal guard-enforcement model in its tests (fakes mirror mission's semantics; a divergence could make a green test mask a red gate — mitigated by the real-instance acceptance run), and the per-cell `cwd` promise is only as good as the installed local-agent family — until T11 merges, the real instance must either run with the temp-branch facade or accept honest collection failures. Cell budget accounting is cumulative per cell across attempts (the brief's literal reading), so an exhausted budget cannot be reset by retrying.

## Related

- [web-eval install source mode](2026-09-04-web-eval-install-source-mode.md) — how the 23-member profile (eval joined with this change) installs from source.
- [local-agent eval effective-settings snapshots](2026-09-04-local-agent-eval-effective-settings.md) — the read side of the condition hash; T11's observedModel extends the same delegation records this loop consumes.
