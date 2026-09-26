# @khorsheed/dsh-mission-tool

English | [中文](README.md)

The companion tool row of `@khorsheed/dsh-mission`: the twelve model-facing `mission_*` tools and the `tool:mission` prompt section, **granted per session** — present only in sessions whose agent preset composition names it. Since the preset-visibility rollout (A3) the `/mission` slash command's registration also belongs to this row (landing in the preset's scope layer; the handler and definition stay in the core). The service face, CLI, and the 任务 tab all stay in the core; this row lives in presets, never at the profile root. The third core/companion pair of the tool-row decoupling (M4'③, proposal 2026-08-26).

## Shape: a companion package that never self-mounts

- **Registers tools, provides NO service** (zero `ctx.provide`) — the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare (the official `tool-bash` shape).
- **Declares no `dsh.bundle`**: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts. Granting happens by naming the row in a preset's `agent.cordis.yml`:

  ```yaml
  - id: mission-tool
    name: '@khorsheed/dsh-mission-tool'
    config:
      tools: read          # optional; defaults to all
  ```

- **Runs on the core's global service**: the core service is a declared `inject = ['mission']` (the owning-family companion exception — `COMMUNITY_SERVICE_INJECTORS` in `scripts/check-plugin-independence.ts`). A preset's standing scope mounts at registry-activation time, before the profile's later bundle rows provide the core, so a one-shot `ctx.get` probe at apply saw ABSENT and nothing ever re-ran the row (the rc.1 boot order; observed in production on 3080, 2026-09-27) — the declared inject pends the row until the core provides, then the body applies. While the core (`@khorsheed/dsh-mission`) is unmounted the row stays pending (the registry audit shows `waiting for mission`; the preset mount never breaks and the composition still mounts without an error, the model simply does not see these tools), and once the core provides, the row activates and the tools and prompt section register; the in-body `ctx.get('mission')` guard stays as the defensive direct-call path. The tools register through deferred `ctx.inject(['tools'])` (the mount-order race lesson), so compositions without a tools registry are equally safe.
- The tool-definition factory is exported by the core's `./tool` subpath (`missionToolDefinitions(service, tier)` from `@khorsheed/dsh-mission/tool`) — zero copied business logic; the origin tag's owner is THIS package (attribution follows the mounting package).

**Config** (optional): `tools` picks the group this row grants. The grouping MOVED here from the core: the core no longer registers any model tool and no longer contributes a prompt section.

| `tools` | Registered |
|---|---|
| `all` (default) | all twelve `mission_*` tools |
| `read` | `mission_run_list` / `mission_run_status` / `mission_list` / `mission_get` |
| `none` | nothing — not even the `tool:mission` prompt section |

## Install

```sh
# The core still installs globally as before (service face / CLI / slash / 任务 tab)
dsh plugin --profile web add @khorsheed/dsh-mission
# The companion only needs to be resolvable in the profile's node_modules
dsh plugin --profile web add @khorsheed/dsh-mission-tool
# Then add the row above to the target preset's agent.cordis.yml
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row (default `all`); the eval pack's `eval` preset (`profiles/web-eval`) names it with `tools: read` — no other preset's sessions in that profile get the tools at all.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the tools register into the host tools registry and the prompt section is contributed; the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot). With the core absent the composition still mounts and the row stays pending (the registry audit shows `waiting for mission`); once the core provides, the row activates and registers the tools.
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions and the tool-row mechanism existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — the same tier as the worktrees-tool / room-tool companions, so minHost pins 0.1.5-rc.1.
- **Release order**: a pack that names a companion row needs the companion published / installed first; a row that fails to resolve reports the preset composition `broken` (the instance boots unaffected) rather than degrading silently.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.
