# Agent Note: Room——父 agent 缺位与 room_invite 注册时序修复

Status: implemented

English | [中文](2026-08-19-room-live-parent-agent.zh.md)

## Problem

End-to-end acceptance of the room plugin (scratch profile, real kimi CLI dispatch) surfaced two defects that unit benches — which stub `agents`/`tools` before mounting the service — could not see:

1. **A room was born without its agent, so no CLI dispatch could ever run.** `createRoom` minted the session through bare `ctx.sessions.create`; the local-agent delegation facade resolves the dispatch parent through `ctx.agents.get` (live agents only — a harness hard constraint), and nothing in the room flow ever made the room session's agent live: the web client resumes an agent only on `session.prompt`, and the room composer takes over all sends. Every `@ada` settled `failed` within milliseconds. After a host restart the same gap widened: the session left the live store entirely, so every Remote answered `session-not-found` and the roster/blackboard could not be read back at all.

2. **`room_invite` never registered on the real composition tree.** The constructor probed the tools registry with an apply-time `ctx.get('tools')` — a race against the registry's own mount order that the probe loses on the real tree (only `subagent_kimi`, registered through a static `inject`, was present). The unit bench passed because it provides the stub before `ctx.plugin(RoomService)`.

## Decision

1. **A room is created through the agent factory** (`ctx.agents.create` with preset composition probed from `agentPresets`, mirroring apiproxy's `session.create`: the resolved preset id goes on the session header, the mount happens in the factory `setup`). A fresh room therefore has a live main agent — exactly like a UI-created session — which anchors every CLI-member dispatch.

2. **A mutating Remote on a cold room cold-resumes its agent first** (`ctx.agents.resume` with the preset resolved from the session's *log* via `resolveSessionPreset` — a blank-window switch wins over the header), deduplicated per session (`resumes` map), with failures surfaced as a new closed-union member `resume-failed`. The resume republishes session + agent, so the mutation then proceeds against the live session. Read-only remotes (`isRoom`/`getState`) stay side-effect-free: a cold room answers from a `sessionPersistence.inspect` of its durable log (attaching and resuming nothing), so opening any session in the UI never spins up an agent.

3. **Tool registration uses deferred injection** (`ctx.inject(['tools'], …)`, the `SessionStore`/`typert` precedent): the callback fires when the registry appears and never fires in a composition without one — degrading to no model-facing invitation path without ever failing the boot.

## Alternatives considered

- **Ensure liveness inside the DispatchEngine only** (leave `createRoom` bare) — rejected: cold-resuming an agent onto a session the store still holds collides with the factory's publish path (`session already exists`); creation through the factory makes the live-agent invariant hold from birth, and the resume path then only ever sees genuinely cold sessions.
- **Reattach cold rooms enter-only (`sessions.enter`, the local-agent child-session recipe)** — rejected for the room's own session: a later `agents.resume` must publish the session itself, and an enter-only attachment blocks it. Enter-only remains right for CLI child sessions (no agent ever sits on them); the room session owns a real agent.
- **Static `inject = ['tools']`** — rejected: a tools-less composition would fail room's mount outright; deferred injection keeps the degrade-don't-explode property.

## Consequences

- `RoomFailure` gains `resume-failed` (message-carrying); the client's `failureText` default branch already renders it.
- Room session ids become `session-<uuid>` (minted by the caller, the apiproxy shape) instead of the store's sequential `session-<n>`.
- New official peer dependencies: `@deepseek-ai/dsh-agent-presets` (preset resolution/mount, `resolveSessionPreset`) and `@deepseek-ai/dsh-session-persistence` (the `inspect` probe); both are probed at the service level and degrade to the pre-fix behavior when absent.
- A pre-fix room (live session, no agent, same boot) still fails dispatch loud — the journal already carries those `failed` runs; the fix does not attempt in-place repair.
- Not covered by this change: the sidebar `+ New room` flow passes no `cwd`, and the kimi provider requires the parent session's `cwd` — UI-created rooms need the client's workspace/cwd inheritance (the NewRoomAction comment already flags it) before CLI dispatch works from the browser.
