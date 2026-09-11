# @khorsheed/dsh-datasets-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-datasets`: the eight model-facing `datasets_*` tools and the `datasets:tools` prompt section, **granted per session** — present only in sessions whose agent preset composition names it. The service (`ctx.datasets`), the CLI, `/datasets`, and the 数据集 tab all stay in the core; this row lives in presets, never at the profile root. The third core/companion pair of the tool-row decoupling (M4'③, proposal 2026-08-26).

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: datasets-tool
    name: '@khorsheed/dsh-datasets-tool'
    config:
      tools: authoring     # optional; defaults to all
  ```

- **Runs on the core's global service**: probes `ctx.get('datasets')` at apply time — when the core (`@khorsheed/dsh-datasets`) is not mounted it **silently skips registration** and leaves one log line (degrade: the preset mount never breaks and the composition still mounts, the model simply does not see these tools); the tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core's `./tool` subpath (`datasetToolDefinitions(service, options)` from `@khorsheed/dsh-datasets/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package).

**Config** (optional): `tools` picks the group this row grants. The grouping MOVED here from the core: the core no longer registers any model tool and no longer contributes a prompt section.

| `tools` | Registered |
|---|---|
| `read` | the six read verbs: `datasets_list` / `datasets_show` / `datasets_describe` / `datasets_read` / `datasets_snapshot` / `datasets_validate` |
| `authoring` | read plus `datasets_put_item` (drafting into the working tree; `git commit` stays the human's) |
| `all` (default) | authoring plus `datasets_worktree_path` (whole-layer materialization, which writes a managed worktree) |
| `none` | nothing — not even the `datasets:tools` prompt section |

The four tiers are one containment chain; **an eval domain wants `authoring`**: a planning agent reads and authors items, while whole-layer materialization is the orchestrator's action.

## Install

```sh
# The core still installs globally as before (service / CLI / slash / 数据集 tab)
dsh plugin --profile web add @khorsheed/dsh-datasets
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-datasets-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row (default `all`); the eval pack's `eval` preset (`profiles/web-eval`) names it with `tools: authoring` — no other preset's sessions in that profile get the tools at all.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the tools register into the host tools registry and the prompt section is contributed; the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot). With the core absent the row still mounts, it just registers no tool (one log line).
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions and the tool-row mechanism existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — the same tier as the worktrees-tool / room-tool companions, so minHost pins 0.1.5-rc.1.
- **Release order**: a pack that names a companion row needs the companion published / installed first; a row that fails to resolve reports the preset composition `broken` (the instance boots unaffected) rather than degrading silently.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
