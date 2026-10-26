# @khorsheed/dsh-local-agent-claude-code

English | [中文](README.md)

Hand coding tasks to the Claude Code on your machine: its thinking, tool calls, and replies stream back live, and you can keep the conversation going.

Getting Claude Code to help used to mean opening a terminal, pasting things in, and carrying the result back yourself. With this plugin you say "give this to Claude Code" in a session, and the agent hands the task to Claude Code on your machine. Its thinking, tool calls, and replies show up live in a sub-session, and the result comes back to you. The tokens each call used and the model that actually ran are recorded as real numbers. Claude Code runs in its own separate folder; your existing `~/.claude` config and sign-in are never touched.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude.png" width="560" alt="The expanded Claude Code section: Claude Code signed in with its version, endpoint, API key, Auth Token and the available-models list">

## What it does

- **Hand it off in one sentence**: tell the agent which part goes to Claude Code; it writes up the brief, and the result comes back to your session.
- **Streams back live**: thinking, tool calls, and replies appear in the sub-session as they happen; stop midway and the finished part and its usage are kept.
- **Clear accounting**: each call's usage is recorded on its own in the sub-session, so Context Lens shows where every call's tokens went.
- **Keep talking, no cold start**: have the agent follow up, or open the sub-session and message it yourself; it's the same Claude Code session.
- **Paste a key and go**: enter the endpoint and API key (or Auth Token) on the settings card, press "Save credential", then "Verify endpoint & fetch models" to check it connects.
- **Pick your models**: under "Available models", tick and drag to reorder; the top one is the default. You can also switch model and reasoning effort inside a sub-session.
- **Resident mode is faster**: turn on "Resident mode (live)" and the Claude Code process stays up; stopping doesn't kill it, and after a crash it resumes the same session.

## Install

First install the Claude Code CLI yourself (`claude` runs in your terminal); the plugin doesn't install it. Then in DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

Claude Code comes with the 「多Agent协作」 (multi-agent) suite; all the local agents share one core, so on its own it won't work. If you mostly write code, the Dev Suite `@khorsheed/dsh-dev-suite` includes it too. Restart DSH, then on the Plugins page open the 「本机 Agent 委派」 (Local Agent Delegation) card, expand the Claude Code section, and fill in the endpoint and key.

Handing work to Claude Code happens in a mode that grants delegation, such as "开发模式" (dev mode): start a new session, pick that mode, and tell the agent "give this to Claude Code". Not seeing it in other modes is expected.

## Known limitations

- Only an endpoint plus key is supported; there is no web sign-in.
- With a wrong key, Claude Code keeps retrying first (about 8 minutes in testing) before it fails, and the card shows the credential as rejected only after that round ends.
- The `/claude-code` commands only work in web sessions.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Config keys, the available-models list, where the endpoint credential is stored, the live stream mirror, and usage read-back are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-claude-code/docs/reference.en.md).
- To install it alone, name the core too: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code`; the delegation tool is granted by a mode and won't appear unless a mode names it.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
