# Agent Note: Room store refreshes off the host-pushed live event feed

Status: implemented

English | [中文](2026-08-25-room-live-refresh.zh.md)

## Problem

The client RoomStore refreshed only on its own mutations, on session switches, and on a 2s poll that ran exclusively while a member was running. Journal appends the client never initiated — the main agent's `room_task`/`room_invite` tool calls, the local-agent bridge's `receiveMemberMessage` — reached the dock and panels only at the next refresh, so a room the agent was actively working in looked frozen to the human watching it. Separately, the collapsed task capsule rendered a bare open count (`☑ 1`) with no label, which read as noise next to the labeled goal capsule.

## Decision

The RoomStore subscribes the CURRENT session's live conversation feed (`ctx.sessions.binding(sessionId).session`, an `ObservableSnapshot`) and treats every snapshot nudge as a refresh trigger for the cached room state, debounced at 300ms (`ROOM_LIVE_REFRESH_DEBOUNCE_MS`) so an event burst costs one `getState` pull. This works because the host apiproxy pushes EVERY session event — `room/*` journal appends included — to the client as `session/event` frames, which the client runtime folds into the session's conversation snapshot; the store therefore sees host-side journal writes within a beat, with no new wire surface. The nudge is gated on a known-room verdict (a non-room's snapshot churn never reaches the wire), the attach re-attempts after every completed pull (the runtime mints the session binding lazily, sometimes after the list's current flip), and dispose unsubscribes the feed and drops any pending debounced refresh. The own-mutation refresh and the running-member poll stay as they were — the live feed replaces lag, not the other triggers.

The task capsule always carries its label: with open tasks it reads `任务 3` (and `任务 3 · ●ada 在做` with runners); with zero open tasks it stays the bare `任务` as before. The label reuses the existing `tasks.capsule` dictionary entry, so both locales moved with no new keys.

## Alternatives considered

- **Host cordis event forwarded to the client** (`ctx.emit('room/journal-updated', sessionId)` on the host, `ctx.remote.$on` on the client) — rejected: the only cordis-event→client bridge is the harness's fixed `API_REMOTE_FORWARDED_EVENTS` allowlist, and extending it is an upstream change for a need the existing `session/event` stream already covers.
- **A plugin-owned server-push channel on the room Remote** — rejected: the Typert Remote surface is request/response only; there is no per-namespace push to build on.
- **Poll unconditionally (drop the running-member gate)** — rejected: it taxes every open room with a 2s RPC forever to fix a latency problem the event stream solves precisely, and the live feed makes the poll less necessary, not more.
- **Longer or trailing-only debounce** — the 300ms trailing debounce was chosen as the smallest window that coalesces one journal append's surrounding burst (tool call, result, task edges); during continuous streaming the running-member poll (unchanged) still bounds the worst case.

## Consequences

- A main agent adding a task with `room_task` lands on the dock within ~300ms of the journal append, without a page reload; verified live on the scratch instance (port 3199) with before/after dock screenshots (`scratch-screenshots/`).
- Client specs pin the three behaviors: a live-feed nudge on the current room refreshes exactly once per burst, a non-room's feed is ignored, and dispose unsubscribes and drops a pending nudge (166 package tests green, 3 new).
- The store's test doubles now stub `ctx.sessions.binding`; the production code guards the call with an optional chain so a binding-less double degrades to the pre-live-feed behavior instead of throwing.
