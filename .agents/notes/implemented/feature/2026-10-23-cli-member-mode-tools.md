# Agent Note: External CLI members reach a mode's plugin tools through their bridge

Status: implemented

English | [中文](2026-10-23-cli-member-mode-tools.zh.md)

## Problem

An external CLI member (Codex, Claude Code, Kimi) only reached the room tools its member bridge served. A host mode's plugin tools — video editing, datasets, canvas — stayed out of reach, so "let Codex cut this video" meant routing the work through a native DSH member. The owner asked for the CLI itself to carry a mode and use its tools, the way it already uses the room tools.

## Decision

A CLI member may carry a mode (a host agent preset id), chosen at invite (「模式」, default none, locked like a native member's preset). Room records it on the member and answers `memberMode(run)` — the member's preset and working directory — on the duck-typed room gate.

local-agent's `PresetToolHost` keeps, per member with a mode, one dsh agent created through `agents.create` with the preset mounted in its setup, which never runs a model turn. It exists because the host tool registry keys scoped tools by agent: `tools.schemas(agent)` lists what the preset composed, `tools.execute({ agent, … })` runs a call through the normal pipeline (policies, approvals, timeouts). Only plugin tools are offered — definitions tagged `Symbol.for('dsh.tool.origin')` with channel `plugin`, minus room's and local-agent's own; the CLI brings its own shell, files and todo.

The member bridge asks the host for those tools on `tools/list` (`{ modeTools: { list: true } }`) and forwards any other tool name as a mode-tool call (`{ modeTools: { call } }`); the member channel authenticates the run token, asks room for the mode and lets the tool host answer. No mode, no room, no host capability, or an unreachable host all degrade to no extra tools.

## Alternatives considered

**Route plugin work to a native DSH member.** Works today but adds a hop and a second session; the owner preferred the CLI owning the work.

**Create the CLI child session itself as the preset agent's session.** Would put plugin state (a video project) and the mode's panels on the member's own session and mark its mode for plugin visibility in one move; it touches how the host's subagent machinery creates that session, so this first slice uses a separate model-less session and leaves the unification for after the end-to-end check.

**Forward every tool of the preset.** Rejected: the CLI's own shell and file tools would collide with dsh's, and dsh-internal tools (todo, compaction) mean nothing to it.

## Consequences

- First slice, verified end to end on prod 3080 before widening. Plugin state lands in the preset agent's own session, not the member's; tools that ask the human through dsh's interactive flow, and the mode's skills (to be installed through each CLI's own skill mechanism), are not wired yet.
- `tools/list` now waits for one socket round trip to the host.
- Tests cover listing only plugin tools from one preset agent per member, running a call as that agent and refusing non-plugin names, the channel answering per the room's mode, the bridge degrading without a host, and room recording a CLI member's mode.
