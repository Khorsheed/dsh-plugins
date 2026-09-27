# @khorsheed/dsh-room

English | [中文](README.md)

One session, a whole team of agents — invite DSH, Kimi, Codex or Claude Code members in, @-name them to hand out work, and let a coordinator run the plan while the accept/rework call stays with the human.

Getting several agents onto one piece of work today means copy-pasting between windows, or one-shot subagent calls that forget everything on return. Room makes the session itself the shared place: inviting the first member promotes the current session into a Room and seats the native DSH agent as the initial coordinator, and every member keeps its own native conversation across turns and restarts.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="640" alt="an active Room: member receipts and run rows in the chat flow, with the @-member menu open above the composer">

## Features

- **Collapsible execution and plan capsules** — Background agents sits above the input, showing only its label and a green dot while work runs. Expand for execution state, duration, reported round tokens, targeted Stop and real conversation links; native descendant totals are explicitly labeled as session totals. Plans start with a compact progress list; full review and limits open in the optional host sidebar, with inline fallback.
- **Inviting promotes the session** — no separate "create room" step: invite the first member into any session and it becomes a Room; the native DSH agent joins as the initial coordinator (named `dsh` in new rooms; existing rooms keep their recorded addressing names).
- **@-addressing with fan-out** — leading `@name` tokens address existing members, and several names fan out at once; a mention picked from the completion menu addresses explicitly even mid-sentence, while a hand-typed mention inside prose does not (the menu never creates members). Same-member turns share one queue, different members run concurrently, and durable request identities keep retries from duplicating accepted work.
- **Coordinator handoff** — any prepared member (DSH, Codex, Claude Code, Kimi) can take over via **Set as coordinator** in the Members tab; the handoff record carries the goal, the plan state, open tasks and recent context. A running coordinator cannot be replaced until its current turn settles.
- **Background delegation with correlated reports** — ordinary chat needs no formal plan: the coordinator dispatches a small background task with `room_message` and receives the completion report, correlated, at a turn boundary. Peer notifications between members (`member_message`, trailing `@name` replies) stay behind a human confirm/dismiss gate that never blocks coordinator task reports.
- **Durable goal plans with evidence review** — larger work becomes a formal goal: stages, hierarchical tasks, dependencies, execution attempts, submitted evidence, and explicit acceptance or rework. A finished generation is not accepted by default; dependent tasks unlock only after their prerequisites are accepted. Budgets bound goal-wide concurrency, total and per-task executions, and active goal time (paused time excluded); pause, resume, rebudget, cancel and complete stay human commands. After a restart, unresolved executions are marked uncertain and the plan pauses — reconciliation requires evidence, never a blind re-run.
- **Members keep their native sessions** — the Members tab holds names, providers, roles, working-directory overrides (blank inherits the Room's directory), effective configurations and session links; breadcrumbs and task links open the member's own conversation with its tools, duration and token usage. Room statistics for the native session are not a sum of member spend.
- **Shared model/effort controls** — coordinator and member composers share the core model/effort control; choosing a new configuration mid-run queues it for the next complete turn (tool continuations keep the current one), and frozen evaluation members reject changes. The original native DSH session keeps the host model selector and its semantics — it is not a local-agent member controller.
- **Live output, targeted stop** — members stream native text and reasoning into both their own conversation and the Room; final messages and tool records stay authoritative. Stopping a member interrupts only that member and preserves non-empty partial output with an explicit stopped/failed label, duration and session link; long replies expand from a compact preview.
- **Preset-gated chrome, fail-open** — the **Invite agent** header chip and the **Members** tab appear exactly when the session's preset composition grants the `@khorsheed/dsh-room-tool` row, fail open when the composition cannot be read, and always stay visible inside an existing Room.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="640" alt="the Members tab: the empty state that turns the session into a multi-agent collaboration room, and the session header's Invite agent entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="640" alt="the Members tab: member cards with name, provider, role and model, plus the Set-as-coordinator action">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-room
```

The package mounts its own loader row and browser contribution; restart the web instance to activate. For external CLI members, install the local-agent core and the providers you want alongside it — without them the Room still works with the native DSH coordinator. The model-facing tools (`room_invite` / `room_task` / `room_message`) live in the `@khorsheed/dsh-room-tool` companion and are granted per session preset.

```sh
dsh plugin --profile web remove @khorsheed/dsh-room
```

Uninstalling removes the plugin's surfaces; persisted Room journals stay in their session logs.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ supported with one designed degrade — 0.1.5-rc.1 full-line boot-verified (42 packages including capture, 2026-09-25) through the three compat layers ([preset-registry dual-name probe](../../.agents/notes/implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md), [dual-shape typert codecs](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md), [typert faces carrying zod@4](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md)); `minHost` is pinned at 0.1.5-rc.1. External members require the local-agent family (core + providers), which is not yet published on npm: without it, member preparation, shared model/effort controls and the authenticated member tools answer unavailable, while native DSH Room functionality stays complete. Candidate-tarball fresh-install and upgrade checks on the npm host pass, retaining existing Room state.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.2 — also the 3080 production-verified line) — Session V4 adaptation: the main-agent followup's source moved to the producer-owned kind `room` (V4 native admission refuses the retired `kind: 'plugin'` wrapper at the durable write; a 0.1.5 host's `user/message` admission accepts any non-empty kind, so both lines write durably), and the read side accepts `room`, `plugin:@khorsheed/dsh-room` (the V3→V4 migrated form) and the released V3 wrapper. The `conversation.chat.node` rc.1 contract re-verified (the 5 room renderers touch neither hookContext nor the disclosure factory). DSH/Kimi coordinators, delegation, two-stage review and interruption recovery are exercised end to end — see the [acceptance record](../../docs/acceptance/room-coordinator-2026-09-19.md).

## Known Limitations

- **Peer notifications still need a human confirm** — `member_message` relays and trailing `@name` replies journal as pending until the human confirms or dismisses; only coordinator task reports bypass the gate.
- **External members depend on the local-agent family** — until the family is published and installed, CLI member preparation, shared controls and authenticated member tools degrade to unavailable (structured `local-agent-unavailable` at invite, journaled `failed` runs at dispatch); the native DSH member keeps working.
- **Codex/Claude runtime acceptance is still pending** — DSH and Kimi members have been exercised end to end; Codex/Claude authenticated runs have not, and the full P95 streaming gate remains open — the transport interval alone proves nothing about P95 latency.
- **A persisted Room needs Room to stay mounted** — the `room/*` event vocabulary is registered by the plugin into the session-event catalog (a temporary seam pending an official event-registration API), so a build without the plugin refuses the log by design.
- **Member chrome replicates host visuals** — identity and action styling track the host's chrome and need re-checking when upstream visuals change.
- **Cross-host paint measurement assumes a shared clock** — the local diagnostic does; remote-host measurements need clock alignment.
- **A green model reply does not prove storage landed** — persistence failures surface diagnostically.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The host half is `RoomService`, a Typert Remote service (provided as `room`) owning promotion, roster management, the human @-intake, the notification gate, the task board and run cancellation; dispatch records and first tasks execute through the `DispatchEngine`, durable goals through the `PlanService` (one serialized writer per room). The room's entire state is the session's `room/*` custom-event journal — log-only events: persistence and reload-replay come free, the model never sees them, and a harness without this plugin replays the session safely. Every read folds the journal through a pure replay; every mutation appends and flushes. Cold reads (`isRoom`/`getState`) answer from a persistence inspection without waking an agent; a mutation on a cold room cold-resumes the agent under the preset the log records. An `agent/pre-step` guard keeps a stale client or another input surface from waking the DSH model behind an external coordinator: a native turn must carry an explicit room-sourced dispatch, and user input is rerouted through the room intake or rejected when it cannot be forwarded losslessly.

**Event-vocabulary seam.** The plugin registers its `room/*` types into the session-persistence event catalog at apply time. The registration must land in the toolchain's module instance — a profile-installed plugin would otherwise resolve a second catalog copy and the read path would refuse room logs after restart — so the specifier is computed and resolved at runtime, and a top-level await lets the plugin loader block boot on it. This is a temporary seam pending an official event-registration API.

**Client.** The browser half mounts the generated Remote via `ctx.remote.$mount`, registers the zh/en dictionaries, and feeds a client-side `RoomStore`. Slot entries: the **Invite agent** session-header action (`conversation.session.header.actions`, order 30), the **Members** `conversation.view` tab (order 20; hiding happens at registration level — a hidden tab is unregistered, not an empty body), the `conversation.composer` takeover (priority -10: claims exactly cached-room sessions, yields to pending approval interactions, and renders the dock capsules and stats row itself because their official seats hide with the fallback), and five `conversation.chat.node` renderers (`room-speech` / `room-run` / `room-event` / `room-relay` / `room-task-line`).

**Tool-row split (M4').** The core registers no model-facing tools at the profile root: the `room_invite` / `room_task` / `room_message` factories live in `./tool` and ship untagged; the companion `@khorsheed/dsh-room-tool` mounts the row inside agent-preset compositions (granted per session) and applies its own tool-origin tag. `room_invite` and `room_message` promote the calling session into a room; `room_task` writes the shared board through the same host functions the capsule UI uses. External members reach `room_read` / `room_invite` / `room_message` / `room_plan` through the authenticated family bridge (`receiveMemberCommand`), where room and actor identity are host-owned, never tool arguments.

**Family coupling.** The only coupling to the local-agent family is a probed facade — `ctx.get('localAgent')` plus method-existence duck-typing, with types as type-only imports drift-checked at compile time. An absent facade degrades CLI members (structured `local-agent-unavailable` at invite, journaled `failed` runs at dispatch) and never fails the boot. The notification gate's `receiveMemberMessage` is duck-type-called by the family bridge and runtime-validated across the untyped package boundary.

**Model experience.** The current goal rides the top of the roster section in every member prompt; there is deliberately no blackboard fold — member prompts never consume the room's running log (speech/dispatch events are journaled for UI projection and replay only). Model-facing tools arrive with the session's preset grant, tagged by the companion package.

**Identity triangle.** cordis row id `room` (`cordis.patch.yml`) = `clientBundle('@khorsheed/dsh-room')` (`tsdown.config.ts`) = `src/invariant.ts` `PACKAGE_NAME`. Exports: `.` host service, `/client` (plugin `apply`/`inject` plus the `RoomRemote` type), `/tool` factories, `/types`, `/typert`, `/remote`, `/invariant`.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/room`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
