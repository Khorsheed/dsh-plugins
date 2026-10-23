# Agent Note: External CLI members reach a mode's plugin tools through their bridge

Status: implemented

English | [中文](2026-10-23-cli-member-mode-tools.zh.md)

## Problem

An external CLI member (Codex, Claude Code, Kimi) only reached the room tools its member bridge served. A host mode's plugin tools — video editing, datasets, canvas — stayed out of reach, so "let Codex cut this video" meant routing the work through a native DSH member. The owner asked for the CLI itself to carry a mode and use its tools, the way it already uses the room tools.

## Decision

A CLI member may carry a mode (a host agent preset id), chosen at invite (「模式」, default none, locked like a native member's preset). Room records it on the member and answers `memberMode(run)` — the member's preset and working directory — on the duck-typed room gate.

local-agent's `PresetToolHost` gives each member with a mode a model-less stand-in over the member's OWN child session — `{ id, session }`, the only agent fields plugin tools read — scoped with `createScope` and the preset mounted on that scope. The host tool registry keys scoped tools by that identity: `tools.schemas(stand-in)` lists what the preset composed, `tools.execute({ agent: stand-in, … })` runs a call through the normal pipeline (policies, approvals, timeouts). Plugin state (a video project) therefore belongs to the member's session and the mode's panels show there; the session also records the mode (`agent-preset/selected`, as the host does on a preset switch), so per-session plugin visibility follows it and other plugins' session tabs hide. A first listing after a preset's first mount samples the scope until it stops growing (rows register a moment later). Only plugin tools are offered — definitions tagged `Symbol.for('dsh.tool.origin')` with channel `plugin`, minus room's and local-agent's own; the CLI brings its own shell, files and todo.

The member bridge asks the host for those tools on `tools/list` (`{ modeTools: { list: true } }`) and forwards any other tool name as a mode-tool call (`{ modeTools: { call } }`); the member channel authenticates the run token, asks room for the mode and lets the tool host answer. No mode, no room, no host capability, or an unreachable host all degrade to no extra tools.

## Alternatives considered

**Route plugin work to a native DSH member.** Works today but adds a hop and a second session; the owner preferred the CLI owning the work.

**A real dsh agent per member (first slice).** `agents.create` with the preset in its setup worked end to end, but on a separate session: plugin state and panels landed away from the member, and an idle agent on the member's own session would add an agent loop the CLI never uses plus a second writer. The stand-in needs neither.

**Forward every tool of the preset.** Rejected: the CLI's own shell and file tools would collide with dsh's, and dsh-internal tools (todo, compaction) mean nothing to it.

## Consequences

- Verified end to end on prod 3080 with the first slice (a Codex member listed and called the 剪辑 mode's `video_*` tools); the member-session stand-in replaced it.
- `tools/list` now waits for one socket round trip to the host.
- Tests cover listing only plugin tools from one preset agent per member, running a call as that agent and refusing non-plugin names, the channel answering per the room's mode, the bridge degrading without a host, and room recording a CLI member's mode.
