# @khorsheed/dsh-room

English | [中文](README.zh.md)

Room turns a normal DSH session into a shared conversation with a coordinator and invited members. It uses public plugin services and slots; no host source changes are required. Inviting the first member promotes the current session into a Room and seats its native DSH agent as the initial coordinator.

## Conversation and coordination

Bare messages go directly to the selected coordinator. Initially this is the native DSH agent. After inviting and preparing a DSH, Codex, Claude Code or Kimi member, the human can select **Set as coordinator** in the members tab. Handoff records include the goal, member roster and recent context. A running coordinator cannot be replaced until its current turn settles.

Leading `@name` tokens address existing members; several names fan out. The completion menu never creates members. A menu-picked mention explicitly addresses that member even inside a sentence; a hand-typed mention inside prose does not. Same-member turns share core's whole-turn queue, while different members can run concurrently. Requests have durable identities so retries do not duplicate accepted work.

Ordinary chat needs no formal plan. The coordinator can use `room_message` for a small background task, continue the conversation, and receive a correlated completion report automatically at a turn boundary. `room_read`, `room_invite`, `room_message` and `room_plan` are exposed to external members through the authenticated family bridge. General peer notifications through `member_message` or a trailing `@name` reply retain the separate human confirm/dismiss gate; this gate does not block coordinator task reports.

## Goals and review

For larger work, the coordinator or human can create a formal goal. The goal panel shows stages, hierarchical tasks, dependencies, execution attempts, submitted evidence and explicit acceptance or rework. A completed generation is not automatically accepted. Dependent tasks become eligible only after their prerequisites are accepted. Rework records a reason and starts another attempt within budget.

Budgets bound concurrency, total attempts, per-task attempts and active execution time. The human can pause/resume, adjust budgets, review evidence, cancel, or complete an accepted plan. After restart, unresolved execution is marked uncertain and the plan pauses; reconciliation requires evidence rather than blindly repeating work. Simple chat tasks remain visible separately from formal goal progress.

## Members, models and output

The members tab keeps names, providers, roles, working directories, effective configurations and session links. A working-directory override is passed to the family facade; blank inherits the Room directory. Each member retains its native conversation across turns and restarts. Breadcrumbs, task links and the members page still open that conversation with its tools, duration and token usage. Room statistics for the native session are not a sum of every member's spend.

The coordinator composer and member composer use the same core model/effort control. Model directories retain native identifiers, aliases, display names and supported reasoning choices; configured candidates and historical observations are labeled separately. Incomplete or unavailable directories remain explicit. Choosing a configuration while busy queues it for the next complete turn, including tool continuations; core owns current/pending state, revisions, cancellation and retry. Frozen evaluation members reject configuration changes. The original native DSH session still uses the host model selector and its semantics; it is not a local-agent member controller.

Live members stream native text and reasoning into both their own conversation and Room. Final messages and tool records remain authoritative. A targeted Stop interrupts only that member, preserving nonempty partial output with an explicit stopped/failed label, duration and child-session link. Long Room replies can expand from a compact preview. No P95 latency guarantee follows from the transport interval alone; measured acceptance is tracked separately.

## Install

```sh
dsh plugin add @khorsheed/dsh-room
```

The package mounts its own loader row and browser contribution. Install the local-agent core and desired providers alongside it for external members. Native DSH model-facing tools belong to the `@khorsheed/dsh-room-tool` companion, granted through the session's preset composition. The invite header and members tab follow that grant, fail open when inventory cannot be read, and remain available for an existing Room. Uninstalling removes the plugin's surfaces.

## Compatibility

- npm host line (`@deepseek-ai/dsh@0.1.5-rc.1`): degraded until this local-agent family is published and installed. The currently unpublished family is required for external coordinator preparation, shared controls and authenticated member tools; without it those operations return an unavailable result. Native DSH Room functionality remains available.
- Source host line (deepseek-harness `183f08e9c6`, `0.1.5-rc.1`): the worktree composition builds and passes isolated preflight. DSH/Kimi real coordinator, delegation, two-stage review and interruption recovery have been exercised. Fresh installation and upgrade of the candidate tarballs also pass against the npm host above, retaining the old Room state. Codex/Claude authenticated runtime acceptance and the full latency gate remain outstanding; see the [acceptance record](../../docs/acceptance/room-coordinator-2026-09-19.md).

Room registers its `room/*` vocabulary in the active loader's session-event catalog so durable journals can be read after restart. Core similarly registers member stream checkpoints. A persisted Room requires Room to remain mounted. This is a temporary compatibility seam pending an official event registration API.

## Limits

General peer notification relays still require human confirmation. A native DSH session's model selector has host-defined turn semantics. Remote-host paint measurements require clock alignment; the local diagnostic assumes a shared clock. Member identity/action styling replicates host chrome and needs maintenance when upstream visuals change. Storage failures are surfaced diagnostically and cannot be ruled out by a successful model response.
