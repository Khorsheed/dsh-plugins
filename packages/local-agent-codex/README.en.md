# @khorsheed/dsh-local-agent-codex

English | [中文](README.md)

Hand coding tasks to the Codex on your machine: watch it work live, get the result back in your session, and keep the conversation going.

Some jobs you simply want Codex to do, and that used to mean running it in a terminal and carrying the result back yourself. With this plugin you say "give this to Codex" in a session, and the agent hands the task to Codex on your machine. Its reasoning, tool calls, and file changes show up live in a sub-session, and the result comes back with its real usage and time. Codex runs in its own separate folder; your existing `~/.codex` config, sign-in, and sessions are never touched.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex.png" width="640" alt="The expanded Codex section: Codex signed in with its version, endpoint, API key, "Verify endpoint & list models" and the available-models list">

## What it does

- **Hand it off in one sentence**: tell the agent which part goes to Codex; it writes up the brief, and the result comes back to your session.
- **See the work as it happens**: reasoning, commands, and changed files appear live in the sub-session, and you can stop it any time.
- **Keep talking, even after a restart**: have the agent follow up, or open the sub-session and message Codex yourself; it's the same Codex thread, and it picks up again after DSH restarts.
- **Paste a key and go**: enter the endpoint and API key on the settings card (an official platform key or a relay key), press "Save credential", then "Verify endpoint & list models" to check it connects.
- **Pick your models**: under "Available models", tick and drag to reorder; the top one is the default. You can also switch model and reasoning effort inside a sub-session.
- **Resident mode is faster**: turn on "Resident mode (live)" and the Codex process stays up, streaming output into the sub-session; stopping doesn't kill it, and after a crash it resumes the same thread.

## Install

First install the Codex CLI yourself (`codex` runs in your terminal); the plugin doesn't install it. Then in DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

Codex comes with the 「多Agent协作」 (multi-agent) suite; all the local agents share one core, so on its own it won't work. If you mostly write code, the Dev Suite `@khorsheed/dsh-dev-suite` includes it too. Restart DSH, then on the Plugins page open the 「本机 Agent 委派」 (Local Agent Delegation) card, expand the Codex section, and fill in the endpoint and API key.

Handing work to Codex happens in a mode that grants delegation, such as "开发模式" (dev mode): start a new session, pick that mode, and tell the agent "give this to Codex". Not seeing Codex delegation in other modes is expected.

## Known limitations

- Only an endpoint plus API key is supported; signing in with a ChatGPT subscription is not.
- Nobody is there to approve Codex's requests: actions that would need your OK are refused outright rather than asking you.
- The `/codex` commands only work in web sessions.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Config keys (sandbox, default model, resident mode), where the endpoint credential is stored, custom endpoints, read-back, and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-codex/docs/reference.en.md).
- To install it alone, name the core too: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`; the delegation tool is granted by a mode and won't appear unless a mode names it.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
