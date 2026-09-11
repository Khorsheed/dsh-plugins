# @khorsheed/dsh-room-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-room`: the model-facing room tool trio (`room_invite` / `room_task` / `room_message` — invite CLI members, write the shared task board, dispatch messages to members), **granted per session** — present only in sessions whose agent preset composition names it. The second core/companion pair of the tool-row decoupling (M4'②, proposal 2026-08-26): community model tool rows live in presets, never at the profile root.

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: room-tool
    name: '@khorsheed/dsh-room-tool'
  ```

- **Runs on the core's global service**: probes `ctx.get('room')` at apply time — when the core (`@khorsheed/dsh-room`) is not mounted it silently skips registration (degrade, never breaks the preset mount); the tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The three tool-definition factories are exported by the core (`roomInviteTool` / `roomTaskTool` / `roomMessageTool` from `@khorsheed/dsh-room/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package). The row takes no config — the invitable provider roster is read from the global room service at call time.

## Install

```sh
# The core still installs globally as before (room service / members UI / Remotes)
dsh plugin --profile web add @khorsheed/dsh-room
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-room-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row; its `install.sh`/`update.sh` drops the preset into `$DSH_HOME/.agent-presets/dev`.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot; verified live on 3299 with the row `fiberPhase: active` in the dev preset's 33-row composition). Actual member invites depend on the local-agent family's delegation facade (see the core's compatibility notes).
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: the session-plugins inventory view is 0.1.5 presentation — minHost pins 0.1.5-rc.1.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
