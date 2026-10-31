# Agent Note: native dsh sub-members leave the room; a dsh command-line member takes their place

Status: implemented

## Problem

The room had two ways to bring dsh in as a member. A **native sub-member** (`kind: 'native'`, added 2026-10-23 with the room-formation work) was a child session plus agent inside the host process that composed a chosen preset. A **dsh command-line member** (`local-agent-dsh`, provider `dsh-cli`) is a separate sub-dsh process that reaches the room and its mode through the same member bridge as Codex, Claude Code and Kimi.

Every room feature had to be built twice: once for bridge members, once for the in-process native path. The 2026-10-29 room desk was built only for bridge members, which left native members a gap. Meanwhile the native member was the weaker of the two:

- it could not coordinate;
- its mode and model were locked at creation;
- in 45 days of rooms on 3080 (22 rooms) it was never invited once.

Kimi was invited 17 times, Codex 16, Claude Code 14 and the dsh command-line member once.

This is a different thing from the room's own dsh: the `main-agent` member is the room session itself. It receives and coordinates whenever no external coordinator is set, and it stays.

## Decision

The user decided on 2026-10-29 to retire native sub-members.

- **Invite.** `RoomInviteRequest` loses `kind`, and every invite makes a CLI member. The invite dialog drops the 原生 dsh 子成员 option, its hints and its preset-only branch. The mode picker that remains is the CLI member's: it defaults to the room's mode and offers 不带模式.
- **Replay.** An older journal's `room/member-added` with `kind: 'native'` is left off the roster. Its speech rows stay in the transcript, and nothing dispatches to it, routes as it or cancels it. `RoomMemberAddedEvent.kind` keeps `'native'` so those journals still type; `RoomMember.kind` is `'main-agent' | 'cli'`.
- **Removed.** The dispatch path (`nativeAgent`, `runNativeMember`); the room-tool routing of a child session into its parent room (`nativeRoute` and its callers in invite, message, help, read and plan); the native coordinator refusal; the native cancel branch; and the locale keys used only by native members.
- **The successor's gap closed.** A dsh command-line member now gets its mode's skills, like the other CLIs: local-agent's `mode-skills.ts` writes them to `$DSH_HOME/skills/dsh-<name>/SKILL.md`, which is the sub-dsh's `user-dsh` skill root.

## Alternatives considered

- **Keep native members and port each new room feature to them.** That is a second path for every feature, kept for a member type nobody invited, which could not coordinate or change its mode.
- **Hide the invite option but keep the code.** This would leave about a hundred dormant branches that still had to compile and be reasoned about in every room change, for journals that do not exist on 3080.
- **Migrate old native members to dsh command-line members.** There was nothing to migrate, and a native member's history lives in an in-process session that a sub-dsh cannot resume.

## Consequences

The room has one member path, the bridge, plus its own agent. Every member capability (mode tools, skills, the desk, approvals, coordination, model switching) now comes from one place.

What is given up:

- A dsh member is now a separate process, not an in-process agent.
- Like every bridge member, it gets the mode's plugin tools and skills but not the mode's system-prompt sections.
- A community journal that did invite native members shows their old rows, but those members are no longer on the roster.

## Testing

- `room`: `native-member.host.spec.ts` now pins the retirement. The host presets still list as modes, and an undeclared one is rejected. An older journal's native member is off the roster, a message to it fails, and nothing is created or mounted for it.
- `room` members client spec: the mode dropdown defaults to none, there is no native option, and the invite carries only the CLI provider and the mode.
- `local-agent`: `harnessSkillsDir('dsh', home)` is `<home>/skills`.
