# Agent Note: dsh-eval's model surface is three read tools and deliberately no fourth

Status: implemented

## Problem

web-eval's I2 needed the orchestrator's model surface (task T14). A planning agent has to see three things before it can draft anything: which conditions the dataset repository declares and how ready each one is, whether the plan it just drafted survives validation, and where a run it is analysing currently stands. Until now it could see none of them — `validatePlan` existed only behind the CLI and the service face, and condition readiness and run progress had no reader at all, so an agent asked to propose an experiment had to be told the answers by a person reading `dsh-eval validate` output aloud.

The hard part is not the reading, it is the not-writing. The profile's tool-opening rule (`profiles/web-eval/README.md`「工具按域开放」, architecture §1) says the agent appears twice in an experiment — drafting a plan and analysing a bundle — and needs read and draft, nothing more; the executing period has no agent at all, and the judge is a delegation rather than a session with tools. A preset cannot subtract a tool that the profile layer registered, so a package that registers a write tool has forced it on every composition that mounts it. Meanwhile the run loop's whole service face is write verbs, and frozen decision 1 makes starting a run a human approval act.

## Decision

The package registers exactly three model tools, all reads, tagged `{channel: 'plugin', owner: '@khorsheed/dsh-eval'}`:

- **`eval_conditions`** — every condition the dataset repository declares, each with harness, declared model, condition sha, readiness (`ready` / `unready` / `missing`), whether `conditions/<id>.lock.json` exists and still matches the declaration, which nullable contract fields are still unresolved, and the diagnostics behind that verdict. `repo` defaults to the calling session's datasets binding, and the binding's dataset whitelist is enforced: asking for a set the human did not admit is refused, not quietly read.
- **`eval_plan_validate`** — `validatePlan` at a given path: `ok`, `errors` (the plan cannot run), `warnings` (not resolved yet), and the resolved condition shas.
- **`eval_run_status`** — one run's `run.meta` digest (planSha, pinned commit, evalVersion, conditions, seeded execution order, start time, budget, expectedNs, the readiness warnings the run recorded) plus one row per cell: task, condition, rep, attempt, state, mission's projection bucket, the latest `orchestrator` annotation's kind and time, and how many `submission-rejected` annotations the cell accumulated.

There is deliberately no fourth. An agent that could start a run could start one the human never approved, and every write verb the orchestrator owns — materialize, delegate, submit, transition, annotate, archive, export, finalize — stays on the service face and the human's CLI. The configuration knob is `tools: 'all' | 'none'` (default `all`) with no finer grouping, because there is nothing to group: this package registers no write tool to turn off. `none` exists so a composition can mount the orchestrator purely as a service and CLI.

**Readiness has one owner.** `resolveConditionReadiness(id, root)` was lifted out of `validatePlan`'s internals and exported; `eval_conditions` calls the same function. Two readers deciding independently what "ready" means is exactly the drift the condition lock exists to prevent, so `dsh-eval validate` and `eval_conditions` cannot disagree.

**The tools arrive by deferred injection, not by an apply-time probe.** `ctx.inject(['tools'], …)` (and, nested inside it, `ctx.inject(['systemPrompt'], …)` for the `tool:eval` prompt section) — never `ctx.get('tools')` at apply time. The probe races the tool registry's own mount order on a real composition tree and loses: the tools would silently never register, and because the slash and service faces still mount, nothing would report the absence. room and worktrees each shipped this same fix after hitting it. The static `inject` export therefore stays `['commands']`: the slash face is still the only hard requirement, and a composition with no tool registry keeps the slash, CLI, and service faces and boots.

**The rendering is the whole document.** What a tool's `render` emits is what the model reads, so all three render the answer as pretty JSON rather than a summary line — a condition's sha and unresolved list, a plan's diagnostics, and a run's per-cell rows are the answer the caller asked for, and a summary would answer the same question a second time and worse. The datasets read tools and `mission_get` render the same way; a test pins it.

**The mission ledger is read through a structural face.** `MissionReadFace` (runStatus + get) sits beside the existing `MissionFace`, deliberately separate because the run loop and the reader need different slices — the loop needs the current attempt's state, the reader needs the annotations the loop wrote. eval imports nothing from any `@khorsheed/*` package; a composition with no mission service gets a sentence saying run records live in the mission ledger, not a crash and not an empty answer.

`run.meta.conditions` is digested rather than echoed: since T8b each entry carries the whole condition document, and `eval_run_status` reduces it to `{id, sha, harness, model}` so a four-condition run does not spend the model's context on four full declarations it can fetch from `eval_conditions` when it wants them.

## Alternatives considered

**Expose `run` as a model tool guarded by an approval flag.** Rejected: frozen decision 1 makes starting a run a human act, and an approval prompt is a different thing from a human deciding to start an experiment. The slash command already is the approval.

**Group the tools by verb class (`tools: 'read' | 'all' | 'none'`), matching the shape datasets and mission will need.** Rejected as vocabulary for a distinction this package does not have: with no write tools registered, `read` and `all` would name the same set, and a config value that is a synonym today becomes a lie the day a write tool appears. If one ever does, adding the group then is a smaller change than retracting a meaningless one now.

**Let `eval_conditions` read the conditions through the datasets service's read verbs.** Rejected: `conditions/` is a sibling of `items/`, not a dataset layer, so the layer whitelist does not describe it and the datasets read path does not address it. The tool reads the directory itself and honours the one binding fact that does apply — the dataset-id whitelist.

**Resolve a bare plan name against the bound repository (`plans/<name>.json`).** Rejected: the guess has several plausible expansions and fails opaquely when it picks the wrong one. `eval_conditions` reports the repository path, so the model can compose the path itself, and `~` expansion is the only convenience kept.

**Render each tool as a one-line summary, the way `mission_run_status` renders bucket counts.** Rejected once the live instance showed what it costs: the agent asked for the run's status received `run … · plan 568fa8fe · commit 9f1c0d48` and two cell lines, and could not see the conditions, the seeded order, or the readiness warnings the run recorded. mission can summarise because `mission_get` sits next to it with the detail; these three tools have no such sibling.

**Give `eval_run_status` the whole `mission.runStatus` payload plus full annotations.** Rejected: the raw payload includes every annotation of every attempt, judge samples and verdict bodies included. The digest answers "where is this run" — a cell's evidence is `mission_get`'s job, and that tool is already open in this domain.

**Report a missing mission service as an empty run.** Rejected: "no cells" and "no ledger to ask" are different facts, and conflating them would let an agent conclude a run had not started.

## Consequences

- A planning agent can now do the T14 loop unaided: list conditions, draft a condition or plan as a data file, validate it, hand it to the human, and watch the run the human started. Drafting still happens through ordinary file writes — no condition-authoring tool exists, and the `eval-planning` skill (T28) is what will guide that drafting.
- `resolveConditionReadiness` and `unresolvedFields` are now public API of the package, so the I5 condition-registry view can build on the same readiness verdict rather than a third implementation.
- The package gained two peer dependencies (`@deepseek-ai/dsh-tools` for `defineTool`, `@deepseek-ai/schemastery` for the config schema). Both are runtime imports, so neither is optional.
- `eval_run_status` reads whatever run records exist, including runs written by an older orchestrator: `run.meta` fields it cannot find come back null rather than throwing, and a mission the ledger cannot resolve degrades to "no annotations" instead of failing the whole projection.
- Verified against the real ledger: the T8b two-cell run in the `~/.dsh-lab` instance projects both cells as `archived`, each with its latest `delegation` annotation and zero rejections.
