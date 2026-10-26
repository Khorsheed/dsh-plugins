# @khorsheed/dsh-local-agent-kimi

English | [中文](README.md)

Hand work to the Kimi Code on your machine: watch it work live, get the result back in your session, and keep the conversation going.

Getting Kimi Code to help used to mean opening a terminal, pasting things in, and carrying the result back yourself. With this plugin you say "give this part to Kimi" in a session, and the agent hands the task, with its requirements, to Kimi Code on your machine. Kimi's thinking, tool calls, and replies show up live in a sub-session, and the result comes back with its real usage and time. Kimi runs in its own separate folder; your existing Kimi setup and sessions are never touched.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="The Kimi section of the Local Agent Delegation card: auth status, endpoint and API key, available models, resident-mode switch">

## What it does

- **Hand it off in one sentence**: tell the agent which part goes to Kimi; it writes up the brief, and the result comes back to your session.
- **See the work as it happens**: the sub-session lists Kimi's thinking, tool calls, and replies step by step, and they're still there after a page refresh.
- **Keep talking, no cold start**: not happy with the result? Have the agent follow up, or open the sub-session and message Kimi yourself; it's the same Kimi session.
- **Paste a key and go**: enter the endpoint and API key on the settings card, press "Save credential", then "Verify endpoint & list models" to check it connects.
- **Pick your models**: under "Available models", tick models the endpoint offers and drag to reorder; the top one is the default. You can also switch model and reasoning effort inside a sub-session.
- **Resident mode is faster**: turn on "Resident mode (live)" and the Kimi process stays up, streaming output into the sub-session; stopping doesn't restart it.
- **Look back at past hand-offs**: `/kimi sessions` lists the tasks you gave Kimi, and `/kimi session <id>` turns one into a readable record.

## Install

First install the Kimi Code CLI yourself (`kimi` runs in your terminal); the plugin doesn't install it. Then in DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

Kimi comes with the 「多Agent协作」 (multi-agent) suite; all the local agents share one core, so on its own it won't work. If you mostly write code, the Dev Suite `@khorsheed/dsh-dev-suite` includes it too. Restart DSH, then on the Plugins page open the 「本机 Agent 委派」 (Local Agent Delegation) card, expand the Kimi section, and fill in the endpoint and API key.

Handing work to Kimi happens in a mode that grants delegation, such as "开发模式" (dev mode): start a new session, pick that mode, and tell the agent "give this to Kimi". Not seeing Kimi delegation in other modes is expected.

## Known limitations

- Only an endpoint plus API key is supported (a Kimi coding-platform key or a relay key); Kimi membership web sign-in is not.
- Kimi still writes a few empty process records into your `~/.kimi-code`; config, credentials, and sessions stay in the plugin's own folder.
- The `/kimi` commands only work in web sessions.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Config keys, the default-model order, the scoped home, where the endpoint credential is stored, the resident driver, and in-container delegation are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-kimi/docs/reference.en.md).
- To install it alone, name the core too: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-kimi`; the delegation tool is granted by a mode and won't appear unless a mode names it.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
