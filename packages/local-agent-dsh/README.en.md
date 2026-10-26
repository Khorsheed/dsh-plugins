# @khorsheed/dsh-local-agent-dsh

English | [中文](README.md)

Hand a subtask to a second, separately running DSH on your machine: it has its own sessions and settings, the result comes back to your session, and you can keep the conversation going.

Some subtasks deserve a clean DSH: none of the current session's context, its own session history, and no way to disturb the instance you're using. With this plugin, turn on "DeepSeek delegation" in settings and the agent can hand such subtasks to a separate DSH started on your machine. Its output shows up live in a sub-session, the result comes back to you, and you can keep working in the same sub-session afterwards.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-dsh.png" width="640" alt="The expanded DSH section: credentials follow the current DSH, the "DeepSeek delegation" switch on, the default-model picker and the resident-mode switch">

## What it does

- **Off by default, on when you want it**: with the switch off nothing changes; turn on "DeepSeek delegation" in the DSH section of the 「本机 Agent 委派」 (Local Agent Delegation) card and the agent can hand subtasks to it, no restart needed.
- **No separate sign-in**: it uses the model and key you picked in your current DSH, and the card shows whether that credential works.
- **Kept apart**: the second DSH's sessions, settings, and state live in their own folder; they never show up in your session list or change your current instance.
- **See the work as it happens**: its output appears in the sub-session as it runs.
- **Keep talking**: have the agent follow up, or open the sub-session and message it yourself; it's the same session on the second DSH.
- **Choose the model**: pick one under "Default model" on the card and every hand-off uses it; leave it blank to follow your current DSH's default.
- **Resident mode is faster**: turn on "Resident mode (live)" and the second DSH stays up; stopping doesn't kill it.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

This plugin comes with the 「多Agent协作」 (multi-agent) suite; all the local agents share one core, so on its own it won't work. The Dev Suite `@khorsheed/dsh-dev-suite` includes it too. Restart DSH, open the 「本机 Agent 委派」 card on the Plugins page, expand the DSH section, turn on "DeepSeek delegation", then tell the agent in a session "hand this subtask to the local DSH".

## Known limitations

- There's no separate sign-in: the second DSH can only use the model credentials set up in your current DSH.
- The `/dsh` commands only work in web sessions.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Config keys, how the sub-profile is prepared, permission levels, default-model resolution, the resident driver, and in-container delegation are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-dsh/docs/reference.en.md).
- To install it alone, name the core too: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh`; the second DSH itself comes from `@khorsheed/dsh-local-agent-dsh-headless`, installed automatically alongside.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
