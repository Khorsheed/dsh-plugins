# @khorsheed/dsh-eval-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-eval`: seven model-facing tools — five **read-only** (`eval_conditions` / `eval_plan_validate` / `eval_run_status` / `eval_cells` / `eval_experiment_get`) and two writes (`eval_plan_draft`, `eval_analysis_write`) — and the `tool:eval` prompt section, **granted per session** — present only in sessions whose agent preset composition names it. Since the preset-visibility rollout (A3) the `/eval` slash command's registration also belongs to this row (landing in the preset's scope layer; the handler and definition stay in the core). The service face (`ctx.dshEval`) and the CLI stay in the core; this row lives in presets, never at the profile root. The third core/companion pair of the tool-row decoupling (M4'③, proposal 2026-08-26).

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: eval-tool
    name: '@khorsheed/dsh-eval-tool'
    config:
      tools: all           # optional; defaults to all
  ```

- **Runs on the core's global service**: the service name is **`dshEval`, never `eval`** — a `ctx` property named `eval` shadows the global `eval` inside the loader's `with (ctx) { return eval(expr) }`, so any composition mounting such a package blows up on the first `!!js` expression (a real 3171 instance paid for this). The core service is a declared `inject = ['dshEval']` (the owning-family companion exception — `COMMUNITY_SERVICE_INJECTORS` in `scripts/check-plugin-independence.ts`): a preset's standing scope mounts at registry-activation time, before the profile's later bundle rows provide the core, so a one-shot `ctx.get` probe at apply saw ABSENT and nothing ever re-ran the row (the rc.1 boot order; observed in production on 3080, 2026-09-27) — the declared inject pends the row until the core provides, then the body applies. While the core (`@khorsheed/dsh-eval`) is unmounted the row stays pending (the registry audit shows `waiting for dshEval`; the preset mount never breaks and the composition still mounts without an error, the model simply does not see these seven tools), and once the core provides, the row activates and the tools and prompt section register; the in-body `ctx.get('dshEval')` guard stays as the defensive direct-call path. The tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core's `./tool` subpath (`evalToolDefinitions(service)` from `@khorsheed/dsh-eval/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package). Five of the seven are reads. `eval_plan_draft` creates one experiment — the plan into the deployment's experiment directory, new conditions into the deployment's condition library (`$DSH_HOME/state/eval/`) — and writes not a byte into the dataset repository; `eval_analysis_write` (I5 · T60, renamed and narrowed in T73) writes exactly one text file, into one experiment's `analysis/`. **Drafting is not starting**: a run is still started by a person with `/eval run` or 批准并启动 on the Design stage, and the other write verbs (materialize / submit / transition / annotate / archive / export) belong to the orchestrator's service face and the human's CLI.

**Config** (optional): `tools` picks the group this row grants. The grouping MOVED here from the core: the core no longer registers any model tool and no longer contributes a prompt section.

| `tools` | Registered |
|---|---|
| `all` (default) | the seven tools (five reads + `eval_plan_draft` + `eval_analysis_write`) |
| `none` | nothing — not even the `tool:eval` prompt section |

There is no finer grouping because there is nothing to group: this row registers no tool that can start, advance, or finally judge anything.

**The sixth tool, `eval_analysis_write`, is the row's second write** (it arrived with I5 · T60 as `eval_repo_write`, writing into the bound dataset repository's pass-through areas; T73 renamed and narrowed it): parameters `experiment` (an experiment id), `path`, `content`, `overwrite`; it writes **one text file** into that experiment directory's `analysis/<path>`, at any depth, and every other path in the experiment directory (the plan, the meta, exports/) is refused with the whitelist quoted back. The dataset repository is out of its reach entirely. Nothing is overwritten without an explicit `overwrite`, and an empty body is refused. The answer says 「在结果对比页可看」: the report page's block ⑤ 「分析初稿」 lists these files (collapsed by default, the newest expanded, names only).

The reason it exists is not "the agent needs to write" but that **the size of the grant should match the size of the act**: at step 8 the agent reads a bundle and writes an analysis draft, and the session's workspace is not where drafts belong — so `write` hit the sandbox and asked a person to escalate to `danger-full-access`, opening the whole machine to save one markdown file (which is what a walkthrough actually did, once). A narrow door makes that approval zero.

**The seventh tool, `eval_experiment_get`, is a read added by I5 · T76**: parameter `experiment` (an experiment id, or one of its run ids). It reads one experiment back in one call, the way the lab tab reads it: the list row (name, status word, dataset pin, groups, judges, scale, progress, validation), the newest run's digest (state, cells per bucket, unreleased units, readiness warnings), every run id it has, the names of the analysis files already written into it, and the **answer index**: one entry per task × group × rep (`P0 × high × #1`) with its stage, the checkpoints it reached, and the **names** of the files that attempt handed in. The numbers come from the same reads the page makes (`experiments` / `runStatus` / `cells`), so the two cannot disagree. The index holds no paths: an analysis cites an answer by task × group × rep and file name, where before the agent had to ask the person for a path. It starts, finalizes, provisions, retries and scores nothing, and the human-evaluation exit is not here either.

## Install

```sh
# The core still installs globally as before (service face / CLI / /eval slash)
dsh plugin --profile web add @khorsheed/dsh-eval
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-eval-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The dev pack's dev-mode preset (`profiles/dev/presets/dev`) already carries this row (default `all`); the eval pack's `eval` preset (`profiles/web-eval`) names it with `tools: all` too — every mechanism row's tier follows its granting point, so no other preset's sessions in that profile get the tools.

**The fourth read tool, `eval_cells`, arrived with I5 · T46** (a pure tool-face change — nothing host-side moved): the evaluation preset stopped composing mission's companion row (UI spec R6), and `eval_cells` answers per cell what used to need `mission_list` / `mission_get` — bucket, stage and time in it, attempt, the unit's refs, checkpoint names, annotation counts per namespace, and the delegation's child session id, filterable by `bucket` / `task` / `condition`. The projection is computed in the core's service face (`ctx.dshEval.cells`); this row only adapts it. The `tool:eval` prompt section says so too: there are no mission tools on this line, so do not look for them.

**I5 · T35a gave it a second mode**: called with no `run_id` it answers which experiments exist instead — one row per experiment and per evaluation run (a run no experiment claims is marked 旧运行), with the dataset pin, condition count, matrix size, factors, status and progress. The columns come from the very same source the Experiments tab reads (the core's `experiments` projection, one implementation), so the two surfaces cannot disagree; this closes the gap T46 left when `mission_run_list` went away. Ask this way to find a run id, then ask again with one for the cells.

**`eval_plan_draft` arrived with I5 · T34, the row's first write** (since T74 it also takes three optional arguments, `question` / `expectation` / `answered_when`: the person's question goes into the plan verbatim and the conclusion card answers it; the prompt section says so too): one call creates one experiment (T73): `dataset` is `"<registration id>/<set>"` and `commit` optional; without a commit the version is decided from the tracked branch's latest and the commits same-set, same-condition experiments pin, and candidates whose `items/` or `schemas/` differ refuse the draft as "version is ambiguous" with the list, telling the agent to ask the person with `ask_user_question` and stop if they skip. The plan goes into the experiment directory and new conditions into the library, then it validates and answers with the experimentId and the verdict. Before it, an agent wrote both files with `write` and spelled the contract itself, then validated separately; now it reaches **the same service verb** the interface's 新建实验 form reaches (`ctx.dshEval.draftExperiment`), so a draft a person makes and a draft an agent makes are the same kind of object in the same list and the Experiments tab cannot tell them apart. A new condition is always a **copy**: `new_conditions` names an existing one with `from` and changes only the fields it names (harness / model / endpoint / scope / preset / permissions / reasoning effort — seven since I5 · T58) — two conditions differing in ONE field are a single-factor pair, and a declaration written from scratch differs in however many fields its author forgot to think about. Handing a model this one write is safe for the same reason the others are withheld: a draft is a file and a 草稿 row, it starts nothing, and a person still has to read it and press the button.

**No `repo` argument** (T73): I5 · T58 had narrowed `repo` on `eval_conditions` and `eval_plan_draft` to "may only restate the session binding", because an agent once took that way around — it found a checkout several agents share and wrote three files onto somebody else's branch. T73 removes the parameter together with the binding: the library and the experiments belong to the deployment, a dataset is read only as `<registration id>/<set> @ commit`, and an agent has no path to point anywhere.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the tools register into the host tools registry and the prompt section is contributed; the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot). With the core absent the composition still mounts and the row stays pending (the registry audit shows `waiting for dshEval`); once the core provides, the row activates and registers the tools.
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions and the tool-row mechanism existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — the same tier as the room-tool companion row and its siblings, so minHost pins 0.1.5-rc.1.
- **Release order**: a pack that names a companion row needs the companion published / installed first; a row that fails to resolve reports the preset composition `broken` (the instance boots unaffected) rather than degrading silently. This package is host-plane only — it has no browser half (the core's `/eval` slash face and CLI have none either).

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
