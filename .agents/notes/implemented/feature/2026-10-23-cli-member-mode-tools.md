# Agent Note: External CLI members reach a mode's plugin tools through their bridge

Status: implemented

English | [中文](2026-10-23-cli-member-mode-tools.zh.md)

## Problem

An external CLI member (Codex, Claude Code, Kimi) only reached the room tools its member bridge served. A host mode's plugin tools — video editing, datasets, canvas — stayed out of reach, so "let Codex cut this video" meant routing the work through a native DSH member. The owner asked for the CLI itself to carry a mode and use its tools, the way it already uses the room tools.

## Decision

A CLI member may carry a mode (a host agent preset id), chosen at invite (「模式」, default none, locked like a native member's preset). Native and CLI members pick the mode from one dropdown, named as the host's own mode selector names them (`presetDisplayText` with the host's `settings.agentPreset` dictionary: 标准模式, PTC 模式 …). Room records it on the member and answers `memberMode(run)` — the member's preset and working directory — on the duck-typed room gate.

local-agent's `PresetToolHost` gives each member with a mode a model-less stand-in over the member's OWN child session — `{ id, session }`, the only agent fields plugin tools read — scoped with `createScope` and the preset mounted on that scope. The host tool registry keys scoped tools by that identity: `tools.schemas(stand-in)` lists what the preset composed, `tools.execute({ agent: stand-in, … })` runs a call through the normal pipeline (policies, approvals, timeouts). Plugin state (a video project) therefore belongs to the member's session and the mode's panels show there; the session also records the mode (`agent-preset/selected`, as the host does on a preset switch), so per-session plugin visibility follows it and other plugins' session tabs hide. A first listing after a preset's first mount samples the scope until it stops growing (rows register a moment later). Only plugin tools are offered — definitions tagged `Symbol.for('dsh.tool.origin')` with channel `plugin`, minus room's and local-agent's own; the CLI brings its own shell, files and todo.

The member bridge asks the host for those tools on `tools/list` (`{ modeTools: { list: true } }`) and forwards any other tool name as a mode-tool call (`{ modeTools: { call } }`); the member channel authenticates the run token, asks room for the mode and lets the tool host answer. No mode, no room, no host capability, or an unreachable host all degrade to no extra tools.

**Mode skills, the CLI's own way.** The skills a mode contributes — visible in the member's scope, absent from the global skill view (e.g. the 剪辑 mode's `video-studio`) — are written into the member's harness home on each tool listing as `skills/dsh-<name>/SKILL.md` (frontmatter `name`, `description`), the layout Codex (`$CODEX_HOME`), Claude Code (`$CLAUDE_CONFIG_DIR`) and Kimi (`$KIMI_CODE_HOME`, its auto-discovered user skill directory) load; an unchanged file is not rewritten. A harness home is shared by every member of that CLI, so the description says the skill applies only alongside the mode's tools. Installation is best-effort and never affects the listing.

## Alternatives considered

**Route plugin work to a native DSH member.** Works today but adds a hop and a second session; the owner preferred the CLI owning the work.

**A real dsh agent per member (first slice).** `agents.create` with the preset in its setup worked end to end, but on a separate session: plugin state and panels landed away from the member, and an idle agent on the member's own session would add an agent loop the CLI never uses plus a second writer. The stand-in needs neither.

**Forward every tool of the preset.** Rejected: the CLI's own shell and file tools would collide with dsh's, and dsh-internal tools (todo, compaction) mean nothing to it.

## Consequences

- Verified end to end on prod 3080 with the first slice (a Codex member listed and called the 剪辑 mode's `video_*` tools); the member-session stand-in replaced it.
- `tools/list` now waits for one socket round trip to the host.
- A skill written during a run's first listing may only be picked up from the CLI's next turn, depending on when the CLI scans its skill directory.
- Approvals ask in the room. A mode tool's call runs the registry's normal approval (`approval.request`, honoring the member session's approval policy); local-agent registers the first `approval/request` answerer (`prepend`), recognizes its own stand-ins and hands the question to the room gate (`askMemberApproval`). Room journals `room/approval`, shows 「⚠ coco 要你确认：调用 video_render」 with 允许一次 / 拒绝 in the conversation, counts it under 需要处理, and answers the waiting call (`answerApproval`); the call's cancellation closes it as cancelled, and an approval no waiting call stands behind (a restart) expires on the next room access. Anything else — other agents, no room — passes to the next answerer. The released-log reader does not require an open step for approval events.
- A member's first round can ask before the room knows its child session: Claude Code lists MCP tools when the process spawns, inside `facade.start`, before room journals the child session id (Codex only lists when it needs a tool, so it never hit this). Room's `memberMode` therefore falls back to the one member of that provider whose first start is in flight (`DispatchEngine.startingMembers`); two such starts at once stay ambiguous and get no mode. A listing that finds no mode now writes a `mode: false` line to `mode-tools.jsonl`.
- Tests cover listing only plugin tools from one preset agent per member, running a call as that agent and refusing non-plugin names, the channel answering per the room's mode, the bridge degrading without a host, and room recording a CLI member's mode.
