# @khorsheed/dsh-worktrees-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-worktrees`: the model-facing `worktrees` tool (list / switch / create / remove git worktrees), **granted per session** — present only in sessions whose agent preset composition names it. The first link of the single-instance multi-mode chain (proposal 2026-08-26): community model tool rows live in presets, never at the profile root.

## Shape: a companion package that never self-mounts

- **Registers a tool, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: worktrees-tool
    name: '@khorsheed/dsh-worktrees-tool'
  ```

- **Runs on the core's global service**: probes `ctx.get('worktrees')` at apply time — when the core (`@khorsheed/dsh-worktrees`) is not mounted it silently skips registration (degrade, never breaks the preset mount); the tool registers through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core (`defineWorktreesTool(service)` from `@khorsheed/dsh-worktrees/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package).

## Install

```sh
# The core still installs globally as before (badge / sidebar tab / service / Remote)
dsh plugin --profile web add @khorsheed/dsh-worktrees
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-worktrees-tool
# Then add the row above to the target preset's agent.cordis.yml
# (copy the shipped standard preset and edit)
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row; its `install.sh`/`update.sh` drops the preset into `$DSH_HOME/.agent-presets/dev`.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot); with the package removed, the naming preset's composition reports `broken` (a row-resolution message) while the instance boots unaffected (verified live on 3299).
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — minHost pins 0.1.5-rc.1.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
