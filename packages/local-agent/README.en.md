# @khorsheed/dsh-local-agent

English | [中文](README.md)

Let DSH hand work to the Kimi Code, Codex, Claude Code, or second DSH on your machine, and manage them all from one card.

This is the core of local-agent delegation; Kimi, Codex, Claude Code, and DSH all run on it. Using several coding agents used to mean switching between terminals, signing in to each, and keeping track of each one's sessions. With it installed, you set up every agent's credential and models on one 「本机 Agent 委派」 (Local Agent Delegation) card on the Plugins page. Hand work off in a session and the sub-session isn't a read-only replay: open it and keep talking. If DSH restarts, unfinished hand-offs pick up again.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="The Local Agent Delegation card on the Plugins page: one section per agent, a status dot showing whether its credential is set, and CLI not detected on agents that aren't installed">

## What it does

- **One card for every local agent**: one section each; expand it to enter the credential, order "Available models", and switch "Resident mode (live)". An agent whose CLI isn't installed is marked "CLI not detected".
- **Keep talking in the sub-session**: open a handed-off sub-session and message the member from the composer at the bottom; it's the same session, and new output appears live.
- **Switch model and effort any time**: right in the sub-session's composer; pick while it's running and it applies on the next round.
- **Survives restarts**: hand-off records stay on your machine, so after DSH restarts an unfinished sub-session can still continue.
- **Stop on demand**: `/local-agent stop <sub-session id>` stops a running hand-off, and `/local-agent list` shows which agents are installed.
- **Your own CLI setup stays untouched**: each agent runs in the plugin's own folder; your existing config, sign-ins, and sessions stay as they are.
- **Local members in a room can ask for help**: in a 协作间 (room), Kimi, Codex, and Claude Code members can ask other sessions too, and the reply comes back to them.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="640" alt="A sub-session handed to a local CLI: output appearing live, with the member composer at the bottom for continuing and switching models">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

This plugin comes with the 「多Agent协作」 (multi-agent) suite, together with the four local agents and the room; the Dev Suite `@khorsheed/dsh-dev-suite` includes it too. Install each agent's CLI (`kimi`, `codex`, `claude`) yourself first. Restart DSH, set up the agents you want on the 「本机 Agent 委派」 card, then start a "开发模式" (dev mode) session and tell the agent "give this to Codex".

## Known limitations

- The CLIs themselves aren't installed for you; one that's missing shows "CLI not detected" on the card.
- Hand-off records only grow; after long use you clean up the plugin folder yourself.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- How an agent registers, delegation call options, model resolution order, named scopes (several sign-ins per agent), in-container delegation, the member channel, and live output are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent/docs/reference.en.md).
- To install it alone, name the core together with at least one agent: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-kimi` (installing a single agent does not bring the core along).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
