# @khorsheed/dsh-eval-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-eval`: the four **read-only** model-facing tools (`eval_conditions` / `eval_plan_validate` / `eval_run_status` / `eval_cells`) and the `tool:eval` prompt section, **granted per session** — present only in sessions whose agent preset composition names it. Since the preset-visibility rollout (A3) the `/eval` slash command's registration also belongs to this row (landing in the preset's scope layer; the handler and definition stay in the core). The service face (`ctx.dshEval`) and the CLI stay in the core; this row lives in presets, never at the profile root. The third core/companion pair of the tool-row decoupling (M4'③, proposal 2026-08-26).

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: eval-tool
    name: '@khorsheed/dsh-eval-tool'
    config:
      tools: all           # optional; defaults to all
  ```

- **Runs on the core's global service**: what it probes at apply time is **`ctx.dshEval`, never `ctx.eval`** — a `ctx` property named `eval` shadows the global `eval` inside the loader's `with (ctx) { return eval(expr) }`, so any composition mounting such a package blows up on the first `!!js` expression (a real 3171 instance paid for this). When the core (`@khorsheed/dsh-eval`) is not mounted it **silently skips registration** and leaves one log line (degrade: the preset mount never breaks and the composition still mounts, the model simply does not see these five tools); the tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core's `./tool` subpath (`evalToolDefinitions(service)` from `@khorsheed/dsh-eval/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package). Four of the five are reads; the fifth, `eval_plan_draft`, writes exactly two kinds of file — a plan and the new conditions it names — into the session's bound dataset repository working copy, and commits nothing. **Drafting is not starting**: a run is still started by a person with `/eval run` or the plan-review page's 批准并启动, and the other write verbs (materialize / submit / transition / annotate / archive / export) belong to the orchestrator's service face and the human's CLI.

**Config** (optional): `tools` picks the group this row grants. The grouping MOVED here from the core: the core no longer registers any model tool and no longer contributes a prompt section.

| `tools` | Registered |
|---|---|
| `all` (default) | the five tools (four reads + `eval_plan_draft`) |
| `none` | nothing — not even the `tool:eval` prompt section |

There is no finer grouping because there is nothing to group: this row registers no tool that can start, advance, or finally judge anything.

## Install

```sh
# The core still installs globally as before (service face / CLI / /eval slash)
dsh plugin --profile web add @khorsheed/dsh-eval
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-eval-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row (default `all`); the eval pack's `eval` preset (`profiles/web-eval`) names it with `tools: all` too — every mechanism row's tier follows its granting point, so no other preset's sessions in that profile get the tools.

**The fourth read tool, `eval_cells`, arrived with I5 · T46** (a pure tool-face change — nothing host-side moved): the evaluation preset stopped composing mission's companion row (UI spec R6), and `eval_cells` answers per cell what used to need `mission_list` / `mission_get` — bucket, stage and time in it, attempt, the unit's refs, checkpoint names, annotation counts per namespace, and the delegation's child session id, filterable by `bucket` / `task` / `condition`. The projection is computed in the core's service face (`ctx.dshEval.cells`); this row only adapts it. The `tool:eval` prompt section says so too: there are no mission tools on this line, so do not look for them.

**I5 · T35a gave it a second mode**: called with no `run_id` it answers which experiments exist instead — one row per evaluation run and per unstarted plan, with the dataset snapshot, condition count, matrix size, factors, status and progress. The columns come from the very same source the Experiments tab reads (the core's `experiments` projection, one implementation), so the two surfaces cannot disagree; this closes the gap T46 left when `mission_run_list` went away. Ask this way to find a run id, then ask again with one for the cells.

**The fifth tool, `eval_plan_draft`, arrived with I5 · T34, and is this row's only write**: one call writes `plans/<name>.json` and the new condition files it names into the session's bound dataset repository working copy, then validates and answers with the paths and the verdict. Before it, an agent wrote both files with `write` and spelled the contract itself, then validated separately; now it reaches **the same service verb** the interface's 新建实验 form reaches (`ctx.dshEval.draftExperiment`), so a draft a person makes and a draft an agent makes are the same file in the same list and the Experiments tab cannot tell them apart. A new condition is always a **copy**: `new_conditions` names an existing one with `from` and changes only the fields it names (harness / model / endpoint / scope / preset / permissions / reasoning effort — seven since I5 · T58) — two conditions differing in ONE field are a single-factor pair, and a declaration written from scratch differs in however many fields its author forgot to think about. Handing a model this one write is safe for the same reason the others are withheld: a draft is a file and a 草稿 row, it starts nothing, and a person still has to read it and press the button.

**The `repo` argument only restates the binding** (I5 · T58): on `eval_conditions` and `eval_plan_draft` it may only restate this session's datasets binding — a different path is refused, and in an unbound session every `repo` is refused with "ask the person to `/datasets bind`". The narrowing exists because that parameter was the way around the very refusal telling the agent to ask a person, and an agent took it once: it found a checkout several agents share and wrote three files onto somebody else's branch. The human faces (the CLI's `--repo`, `/eval conditions --repo`) are unaffected.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the tools register into the host tools registry and the prompt section is contributed; the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot). With the core absent the row still mounts, it just registers no tool (one log line).
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions and the tool-row mechanism existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — the same tier as the worktrees-tool / room-tool companions, so minHost pins 0.1.5-rc.1.
- **Release order**: a pack that names a companion row needs the companion published / installed first; a row that fails to resolve reports the preset composition `broken` (the instance boots unaffected) rather than degrading silently. This package is host-plane only — it has no browser half (the core's `/eval` slash face and CLI have none either).

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
