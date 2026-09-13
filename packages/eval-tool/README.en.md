# @khorsheed/dsh-eval-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-eval`: the four **read-only** model-facing tools (`eval_conditions` / `eval_plan_validate` / `eval_run_status` / `eval_cells`) and the `tool:eval` prompt section, **granted per session** — present only in sessions whose agent preset composition names it. The service face (`ctx.dshEval`), the CLI, and the `/eval` slash command stay in the core; this row lives in presets, never at the profile root. The third core/companion pair of the tool-row decoupling (M4'③, proposal 2026-08-26).

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: eval-tool
    name: '@khorsheed/dsh-eval-tool'
    config:
      tools: all           # optional; defaults to all
  ```

- **Runs on the core's global service**: what it probes at apply time is **`ctx.dshEval`, never `ctx.eval`** — a `ctx` property named `eval` shadows the global `eval` inside the loader's `with (ctx) { return eval(expr) }`, so any composition mounting such a package blows up on the first `!!js` expression (a real 3171 instance paid for this). When the core (`@khorsheed/dsh-eval`) is not mounted it **silently skips registration** and leaves one log line (degrade: the preset mount never breaks and the composition still mounts, the model simply does not see these four tools); the tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core's `./tool` subpath (`evalToolDefinitions(service)` from `@khorsheed/dsh-eval/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package). All four tools are reads: a run is started by a person with `/eval run`, and the write verbs (materialize / submit / transition / annotate / archive / export) belong to the orchestrator's service face and the human's CLI.

**Config** (optional): `tools` picks the group this row grants. The grouping MOVED here from the core: the core no longer registers any model tool and no longer contributes a prompt section.

| `tools` | Registered |
|---|---|
| `all` (default) | the four read-only tools |
| `none` | nothing — not even the `tool:eval` prompt section |

There is no finer grouping because there is nothing to group: this row registers no write tool at all.

## Install

```sh
# The core still installs globally as before (service face / CLI / /eval slash)
dsh plugin --profile web add @khorsheed/dsh-eval
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-eval-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row (default `all`); the eval pack's `eval` preset (`profiles/web-eval`) names it with `tools: all` too — every mechanism row's tier follows its granting point, so no other preset's sessions in that profile get the tools.

**The fourth tool, `eval_cells`, arrived with I5 · T46** (a pure tool-face change — nothing host-side moved): the evaluation preset stopped composing mission's companion row (UI spec R6), and `eval_cells` answers per cell what used to need `mission_list` / `mission_get` — bucket, stage and time in it, attempt, the unit's refs, checkpoint names, annotation counts per namespace, and the delegation's child session id, filterable by `bucket` / `task` / `condition`. The projection is computed in the core's service face (`ctx.dshEval.cells`); this row only adapts it. The `tool:eval` prompt section says so too: there are no mission tools on this line, so do not look for them.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the tools register into the host tools registry and the prompt section is contributed; the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot). With the core absent the row still mounts, it just registers no tool (one log line).
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions and the tool-row mechanism existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — the same tier as the worktrees-tool / room-tool companions, so minHost pins 0.1.5-rc.1.
- **Release order**: a pack that names a companion row needs the companion published / installed first; a row that fails to resolve reports the preset composition `broken` (the instance boots unaffected) rather than degrading silently. This package is host-plane only — it has no browser half (the core's `/eval` slash face and CLI have none either).

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
