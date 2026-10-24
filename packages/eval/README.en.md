# @khorsheed/dsh-eval

English | [中文](README.md)

Put several local agent harnesses through the same question set: draft an experiment, approve the run, judge automatically, review by hand, and get a report that only draws conclusions when the comparison holds.

You want to know whether a different harness, model or preset answers the same questions better — and running things by hand and comparing by impression does not tell you: the environments drift apart, the grading standard moves, and nobody flags self-judging bias. This plugin is the orchestrator behind the evaluation mode. In a session you ask the agent to draft an experiment (which dataset, which comparison groups, how many runs per cell); in the 实验室 (Experiments) view you check readiness and approve; it then delegates each cell to Codex, Claude Code, Kimi or dsh, scores the answers with the dataset's own probes and blind LLM judges, and leaves the final verdict to you on a side-by-side blind review page. The results page checks five validity conditions first — if any fails it reports the facts and gives no ranking.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="The Experiments list: experiments grouped as needs-you / running / finished, each card showing the dataset version, comparison groups, progress and one primary button">

## Features

- **Experiments are deployment-level objects** — an experiment pins one registered dataset at a fixed commit; the plan, the condition library, analysis drafts and exports are written to the instance's own state directory, and the dataset repository is read-only.
- **Four stages, one primary action per page** — the Experiments view is organized as Design · Run records · Results · Human review, each page topped by a status bar and the button for the next step; a global 「实验室」 panel in the left sidebar shows the same view without a session.
- **One real delegation before the run** — after approval every comparison group and judge first runs one minimal delegation, so expired credentials, a mismatched model or a dead network are caught before the first cell is spent, with the original error in the readiness checklist.
- **Starting a run is a human act** — only `/eval run`, 批准并启动 on the Design page, or the CLI starts one; a run is a background job that survives closing the tab, and `job_kill` is the one way to cancel it.
- **Two machine verdict sources plus a human one** — the dataset's probes write `script`, de-fingerprinted double-sampled blind LLM judges write `llm-draft`, and you write `human-final` on the review page; a judge may share the player's model, but who judged each cell and whether it was self-judged goes into the report.
- **Optional container units** — when the plan carries a `unit` segment, each cell runs in an isolated `@khorsheed/dsh-lab` container with its environment fingerprint recorded; without one it runs in host directories.
- **A conclusion-first, calibrated report** — the results page leads with the conclusion card and the five validity checks, then the criterion × group table, paired differences with bootstrap confidence intervals, and a side-by-side efficiency table; when the data cannot carry it (n < 3, several factors, uneven verdict coverage) it says "not rankable".
- **Side-by-side blind review** — the answers to one question are laid out next to each other, de-fingerprinted, with judges shown only as "Judge A / B"; final verdicts are append-only and every verdict needs evidence.
- **The model only reads and drafts** — the agent gets five read tools, `eval_plan_draft` and `eval_analysis_write`; starting a run, provisioning, finalize and the final verdict have no model tool.
- **The mission ledger is built in** — the former `@khorsheed/dsh-mission` is folded in: the `mission` service, the `dsh-mission` command and the release gate mount with this package.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="The results page: the conclusion card and 'validity checks 5/5' on top, the criterion × group table and paired differences below">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="The human review page: several de-fingerprinted answers to one question side by side, each column with its criteria table, Judge A / B drafts and scoring inputs">

## Install

The recommended install is the whole evaluation mode — datasets, container units, this plugin and the local-agent delegation family in one go, plus the evaluation-mode preset:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

You can also install this plugin alone:

```sh
dsh plugin --profile web add @khorsheed/dsh-eval
```

Restart the web instance to apply. Installed alone, starting a run needs `@khorsheed/dsh-datasets` and the local-agent family present (a missing one is a refusal that names it, never a boot failure); a plan with a `unit` segment also needs `@khorsheed/dsh-lab`. The model tools are not mounted at the profile root: they are the package's `./tool` composition entry, granted by name in an agent preset (the evaluation-mode preset already does):

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.2`): ✅ — consumes `Context.provide` and `commands`; the three sibling services are probed at run time, a missing one is a refusal, never a boot failure. Since T82 only host 0.2.0 and later are supported (minHost 0.2.0-rc.2) — 0.1.x hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ — same (verifiedHost: 0.2.1-rc.1, live-smoked on a web-eval temp instance; host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface change).

The full list of degraded / absent items (kept in sync with `dsh.compat` in package.json) is in the [reference](docs/reference.en.md#compatibility-degraded-and-absent-items).

## Known limitations

- **The container path is serial** — a run with a `unit` segment runs one cell at a time (`concurrency: 1`), and the number of units is bounded by lab's `maxConcurrentUnits`.
- **A stopped run cannot be resumed** — a cancelled or stalled run can only be re-run as a new run from the same plan; the old one stays as evidence.
- **A state directory is required** — experiments and the condition library live under `$DSH_HOME/state/eval/`; an instance without `DSH_HOME` can only list runs, and experiment actions refuse with an explanation.
- **Measuring the capability face needs capability-catalog in the instance** — without it a condition declaring a preset still gets a lock, but without a capability record, and readiness refuses it; a CLI-only `validate` cannot see the capability face.
- **Session hand-offs rely on host 0.2.0 doors** — actions in the global panel that need a session (let the Agent organize, approve) open a new session; when the host lacks the interface they fall back to the clipboard or answer "could not open a new session".
- **The browser UI is web-only** — TUI and headless compositions get the service face, `/eval` and the CLI.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The service is named `dshEval` (deliberately not `eval`, so it never shadows the global `eval` the config loader evaluates with). The host half is the orchestrator: it validates the three dataseek contracts (condition / plan / verdict) and the condition lock, generates the run template deterministically from the dataset manifest, expands the task × condition × rep matrix and shuffles it by seed, then per cell materializes the task, delegates to local-agent, collects the answer, advances the ledger with `submit` / `transition`, judges, archives, passes the release gate, and finally exports the bundle. The four upstream services (`datasets` / `mission` / `localAgent` / `lab`) are probed through `ctx.get` at run time; a missing one is a refusal that names it, never a boot failure.

**Fairness.** Condition hashes, scoped-home hashes, materialization hashes and the environment-class fingerprint let the report check four invariants (same task / same environment / same subject / same program) plus the per-pair "verdict coverage" check; `conditions provision` is the only writer of a lock, anchoring it after the declaration has been checked against reality once.

**Report.** `report` reads only the self-contained bundle mission exports and writes `results.jsonl`, `summary.md` and `usage.jsonl`; the verdict source is chosen per criterion as human-final > llm-draft > script, and polarity and weights come from the weight table derived at export time.

**Client.** The Experiments tab (self-hiding by preset grant, fail-open), the global 「实验室」 panel and the experiment card on the `eval_plan_draft` tool row all read and write only through eval's own Remote; the browser half imports no sibling package.

Deep reference:

- [Orchestrator, runs and judging reference](docs/reference.en.md) — contracts, the run loop, the container path, readiness, provisioning, judging, the experiment object, the service face, the report, model tools, CLI, hash rules and the development history
- [UI reference](docs/ui.en.md) — the Experiments tab, the four stage pages, the answer view, the session card, visual and copy conventions, the global panel
- [The mission ledger (formerly dsh-mission)](docs/mission/README.en.md)
- [Dataset authoring protocol §6](../../docs/dataset-authoring-protocol.en.md) — the full condition / plan / verdict contracts

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/eval`). Please file issues and contributions there. License: [MIT](../../LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
