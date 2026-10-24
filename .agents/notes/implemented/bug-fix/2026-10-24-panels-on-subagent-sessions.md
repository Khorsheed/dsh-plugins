# Agent Note: Mode panels read a subagent's session by id

Status: implemented

English | [中文](2026-10-24-panels-on-subagent-sessions.zh.md)

## Problem

A room CLI member works in the member's own child session. With a mode attached, the mode's panels show in that session — and failed there: the game tab read 「读不到游戏状态：session "…" is owned by subagent routing」. The panels' Remote methods took a wire `agent` lookup parameter. The host's session controller configures the `agent` and `session` lookups to refuse every identity owned by subagent routing (`hasApiSessionSubagentOwner`: any `origin: 'subagent'` header) and points callers at subagent delivery. That fence is for driving a session, but it also blocked read-only panels. A CLI member's session has no Agent in the registry at all.

## Decision

Panel methods take the session id as a plain first parameter and resolve it with a per-package `src/panel-session.ts` (`panelSession(ctx, sessionId)`). An attached session answers directly, subagent ones included. Anything else goes through the host's own configured `session` lookup (`ctx.typert.lookups.get('session').resolve`), so an ordinary cold session still resumes and the host's refusals still surface as before. The client wire shape is unchanged: the session id was already the first positional argument.

Converted:
- game: every session method.
- canvas and canvas-novel: the mutating methods.
- library: the two session-bound methods, which only need the id.
- file-preview: list, turnFiles, read, reveal and openExternal. Its image route now also takes an attached session when there is no Agent.
- worktrees: the session-bound reads.

Left on the `agent` lookup, because a subagent session has no agent of its own to act on:
- worktrees `switchWorktree` and `directAgent`.
- sidechat `send` and `quoteMessage`, which spawn from the calling agent.
- eval `approve`, which delegates through the run's live parent agent.

## Alternatives considered

**Change the host fence.** Not ours to change: the fence is deliberate, and a host change goes through the upstream pipeline. Reads on subagent sessions may be worth proposing upstream later.

**One shared helper package.** Rejected for an eleven-line function: every plugin must install and run alone, and a shared runtime dependency for this would add a cross-package edge.

**A plugin-registered lookup key.** Rejected: a lookup key can be registered only once per host, so independent plugins cannot each own one, and the wire type symbol would need a declaration in every package.

## Consequences

- A panel opened on a room CLI member's or a native subagent's session reads that session's state; gestures that write fence on that session.
- A cold subagent session that is not attached still fails as before (the host lookup refuses it).
- Tests: `game/tests/panel-session.spec.ts` covers the attached, resumed and refused paths. The six packages' Remote tests now pass session ids through an attached-session double.
