# @khorsheed/dsh-room

English | [中文](README.md)

Turn one session into a room: bring in a few agents, @ a name to hand out work, and stay in the loop to make the calls.

Getting several agents to work on one thing used to mean copying text between windows and keeping track yourself of who had done what. With the room installed, invite the first member and the session becomes a room: dsh itself acts as coordinator, splitting the work, handing it out and collecting the results, while Kimi, Codex, Claude Code or another dsh join as members who each do their part and pass messages to one another. What you get is one place that shows who is doing what, how far along it is and what it cost — and accepting the work is still your call.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="560" alt="A room in progress: member replies and run rows in the chat, with the @ member menu open above the input">

## What it does

- **Inviting starts the room**: click "＋ Invite agent" in the session header and pick the member, mode, model and effort; once the first one joins, the session is a room — nothing else to create. New members use the room's own mode by default.
- **@ someone and it's theirs**: @ one member or several and they start at once; their answers appear in the room as they write, and you can stop just one of them. Every member keeps its own session, one click away.
- **Ask a session outside the room**: the @ menu also lists other sessions and other rooms — pick one and the coordinator asks it for help. Members can ask on their own too, Kimi and Codex members included. The first time a session you never @-ed is asked, it waits for your OK; the reply comes back to the room, and a request that waits too long turns amber.
- **Members ask, you click to answer**: when a member needs a decision from you, a "someone asks you" card appears in the room — pick an option or type a line.
- **Every task at a glance**: above the input, "N tasks running"; open it to see who is working on each task, how far it got and what it used. Anything that needs you is marked amber, and you can stop a whole task or a single step.
- **The team on one page**: "Team" on the members page draws who hands work to whom between you, the coordinator and the members, and what each is busy with. An outside session you keep asking can be added with "Add to members", so next time you just @ it.
- **The calls it makes for you are on record**: whether a new message is a new task or belongs to a running one, and when a member's result goes to the coordinator, the room decides itself — each decision leaves a line on the timeline, and "View decision" shows why. To turn this off, use "Automatic decisions" in the room's Collaboration settings.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="560" alt="Members page: the empty state offering to turn the session into a multi-agent room, and the session header's Invite agent entry">

- **You stay in charge**: any member can take over with "Set as coordinator"; in the Collaboration settings you can have messages between members wait for your OK, or "Pause the room" so new member messages queue up and go out in order once you resume.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="560" alt="Members page: member cards (name, provider, role, model) with the Set as coordinator action">

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click install:

```
@khorsheed/dsh-room
```

It also comes with 开发套件 (the dev suite), 剪辑套件 (the video suite), 游戏开发套件 (the game dev suite) and 多Agent协作 (the multi-agent bundle). Once installed, open a session in "开发模式" (dev mode), "剪辑模式" (editing mode) or "游戏开发模式" (game dev mode) and click "＋ Invite agent" in the session header. Not seeing that entry in other modes is expected.

## Known limitations

- Inviting Kimi, Codex or Claude Code also needs 多Agent协作 (`@khorsheed/dsh-bundle-local-agent`); without it you can only invite dsh's own members.
- Archived sessions don't appear in the @ menu and can't be asked for help — unarchive one first.
- Room sessions depend on this plugin: once it is uninstalled, earlier room sessions can't be read.

## Compatibility

Requires DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (the room service), `src/tool.ts` (the room tools agents use), `src/client/index.ts` (the UI). Installed on its own (`dsh plugin --profile web add @khorsheed/dsh-room`), the room tools must be granted by a mode, and the entry shows only in that mode's sessions.
- The coordinator and dispatch flow, event journal, tools, compatibility details and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/room/docs/reference.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — issues and contributions go there; changes are in [CHANGELOG.md](CHANGELOG.md).
