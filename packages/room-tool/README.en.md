# @khorsheed/dsh-room-tool

English | [中文](README.md)

The room's multi-agent abilities, in the model's own hands: read the roster, dispatch messages, invite members, write the shared task board — granted per session, absent everywhere else.

`@khorsheed/dsh-room` (the core) turns a plain session into a multi-agent room: the roster, the shared task board and the goal plans all live in the core's service and UI. But the model-facing entry points should not be global. This companion package packs the five room model tools — `room_read` / `room_plan` / `room_invite` / `room_task` / `room_message` — into a tool row an agent preset composes: a preset that names the row gives its sessions the room tools; every other preset's sessions never see them. The second pair of the tool-row decoupling (M4'②, proposal 2026-08-26): community model tool rows live in presets, never at the profile root.

## Features

- **Five model tools, granted per session** — `room_read` reads the roster / coordinator / deliveries / recent outcomes / available providers (read-only, wakes no member); `room_plan` runs formal goals (stages, task dependencies, evidence review, pause/resume); `room_invite` invites a CLI member (callable in any session — it promotes the session into a room); `room_task` writes the shared task board (add/close/update through the very host functions the capsule UI uses, so an agent-opened task is indistinguishable from a human-added one); `room_message` dispatches a message to a member (runs asynchronously, the reply returns as member speech).
- **Zero copied business logic** — the tool-definition factories are exported by the core (`@khorsheed/dsh-room/tool`); this row only registers, tagging each tool with this package as the origin owner so the capability catalog attributes the tools to the mounting row, not the service core.
- **Pending without the core, never broken** — the core service is a declared `inject = ['room']` (the owning-family companion exception): while the core is unmounted the row stays pending (the registry audit shows `waiting for room`), the preset still mounts cleanly and reports no error; once the core provides, the row activates and the five tools register. Registration joins through deferred `ctx.inject(['tools'])`, so mount order can never strand the row.
- **No config, no service, no browser half** — zero `ctx.provide` (the preset-mount isolate-realm rule rejects only service rows; tool rows compose bare, the official `tool-bash` shape); the room UI lives entirely in the core; the invitable provider roster is read from the global room service at call time.
- **Capability-adaptive** — `room_read` registers only when the mounted core implements `readRoomContext`, `room_plan` only when it implements `commandPlan`; on an older core both are absent rather than broken.

## Install

```sh
# The core installs globally as before (room service / members UI / Remotes)
dsh plugin --profile web add @khorsheed/dsh-room
# The companion tool row goes into the same profile (resolvable is enough — it never self-mounts)
dsh plugin --profile web add @khorsheed/dsh-room-tool
```

Restart the web instance, then name the row in the target preset's `agent.cordis.yml` — that preset's sessions get the tools:

```yaml
- id: room-tool
  name: '@khorsheed/dsh-room-tool'
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row; its `install.sh`/`update.sh` drops the preset into `$DSH_HOME/.agent-presets/dev`.

Remove:

```sh
dsh plugin --profile web remove @khorsheed/dsh-room-tool
```

After removal, sessions of presets naming this row simply lose the room tools; the room service and UI come from the core and are unaffected.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot; verified live on 3299 with the row `fiberPhase: active` in the dev preset's 33-row composition). Actual member invites depend on the local-agent family's delegation facade being installed (see the core's compatibility notes).
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset composition existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — minHost pins 0.1.5-rc.1.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.

## Known Limitations

- **Planning and context reading depend on the core's backend** — `room_plan` / `room_read` register only when the mounted core implements `commandPlan` / `readRoomContext`; on an older core both tools are entirely absent.
- **Task-board writes require the current coordinator role** — after a handoff to an external coordinator, the former native coordinator can still read room context, but `room_task` accepts writes only from the current coordinator.
- **A finished run is a submission, not an acceptance** — workers may submit only their own active attempt; acceptance and organization belong to the coordinator or the human; budget changes and uncertain-execution reconciliation require the human.
- **Inviting CLI members needs the local-agent family** — with the delegation facade unmounted, `room_invite` answers with readable error text (`local-agent-unavailable`) instead of throwing, so the model can self-correct.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Shape: a companion row that never self-mounts.** The package deliberately declares no `dsh.bundle`: installing it as a dependency only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) — nothing auto-mounts; the grant entry is a preset's `agent.cordis.yml` naming the row. This is the official tool-row shape — the shipped `tool-bash` rows likewise consume host services and provide none.

**Registration path.** The core's global service is a declared `export const inject = ['room']` (the owning-family companion exception — `COMMUNITY_SERVICE_INJECTORS` in `scripts/check-plugin-independence.ts`): a preset's standing scope mounts at registry-activation time, before the profile's later bundle rows provide the core, so a one-shot `ctx.get` probe at apply saw ABSENT and nothing ever re-ran the row (the rc.1 boot order; observed in production on 3080, 2026-09-27). The declared inject pends the row until the core provides, then the body applies — while pending, the registry audit shows `waiting for room` and the preset mount itself is unaffected; the in-body `ctx.get('room')` guard stays as the defensive direct-call path (tests invoke `apply` without the loader's inject machinery). The tools register through deferred `ctx.inject(['tools'])` rather than an apply-time probe: `ctx.get('tools')` races the tools registry's own mount order and loses (the historical silent-never-registered incident), while `ctx.inject` fires when the registry appears and never fires in a composition without one. Every registration is wrapped in a labelled `ctx.effect` (`room-tool: room_invite tool`, …).

**Origin tag.** The core exports the definitions untagged (the `@khorsheed/dsh-room/tool` contract — attribution belongs to the mounter); this package tags each definition with the `Symbol.for('dsh.tool.origin')`-keyed `{ channel: 'plugin', owner: '@khorsheed/dsh-room-tool' }` before registering. The tag is host-side only and never travels on the model wire.

**Tool semantics.** `room_invite` and `room_message` PROMOTE: calling them in a plain session turns the session into a room instead of rejecting; `room_task` stays gated at execute time — outside a room it answers with readable error text rather than throwing, so the model sees the rejection and self-corrects. Validation failures (member name, task id) come back with the live roster or the open-task list attached, so a retry needs no extra read. External harnesses reuse the same `room_read` / `room_invite` / `room_message` / `room_plan` vocabulary through the authenticated family member bridge (a core feature).

**Exports.** The package exports the plugin body (`apply`, `inject = ['room']`, the cordis diagnostic name `room-tool`) — no Remote, no client bundle; `./locale/*.json` carries the short-name title and description shown in the plugin inventory ("Room Tool" / "Session-granted room member, task, and message tools").

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/room-tool`). Issues and contributions welcome there.
