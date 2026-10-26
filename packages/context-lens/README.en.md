# @khorsheed/dsh-context-lens

English | [中文](README.md)

Click any turn in the conversation and see exactly what the model received, where the tokens went, and where the time went.

When you're tuning a prompt or building a plugin, the questions are always the same: what actually went into this request? Why did the cache miss? Why was this turn so slow? Until now that meant digging through logs and piecing it together yourself. With the context lens, click the icon next to a turn and the right sidebar lays out every model request in it: where each part of the system prompt came from, how many tools came along, what's history and what's new this time, plus a breakdown of the timing. You can tell at a glance whether too much is being injected, at which character the cache broke, and which step ate the time.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-request.png" width="640" alt="The context lens request view in the right sidebar: turn switcher and session trend on top, cache hits and the prefix diff below, then the system prompt, tools, history and new input broken out">

## What it does

- **Open it from the conversation**: every answer gets an extra icon underneath that jumps to that turn; the icon at the top of the session opens the latest one, and "Jump to the latest turn" always brings you back to the end.
- **See what's in the request**: each request is split into system prompt, tool definitions, history and what's new this time; every part of the system prompt is labeled with where it came from, and you can expand the full text.
- **Find out why the cache broke**: it shows how much really hit the cache, and pinpoints, down to the character, what changed since the previous request.
- **Catch duplicated content**: press "Duplicates only" to pick out the same text sent more than once, counting only the extra copies.
- **See where the time went**: switch to "Timing" and the total splits into model, tool execution and the gaps in between, with a sortable list of how long each tool took.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-timing.png" width="640" alt="The timing view: total, model, tool execution and gap tiles, then a lane per agent and a tool table sorted by execution time">

- **Subagents add up correctly**: each delegated subagent gets its own entry, and its time isn't counted twice in the main conversation.
- **Turns from before you installed it**: when you open it, it fills in earlier turns from the session's record.
- **It only looks**: it never changes what's sent to the model, and what it collects stays in memory rather than being written into the session.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-dev-suite
```

The context lens comes with the Dev Suite, and with 「多Agent协作」 (multi-agent, `@khorsheed/dsh-bundle-local-agent`) too. Then open any session, have one exchange, and click the icon under that answer.

## Known limitations

- A turn that's still running doesn't update live; open it again once it's done.
- For older turns filled in from the session record, the system prompt shows as one block, without where each part came from.
- What you see is the content as assembled before sending, not the raw bytes that finally go to the model provider.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Entry points: `src/index.ts` (capture and service), `src/client/index.ts` (the sidebar panel); `examples/workbench/` previews the panel on made-up data (`pnpm exec tsx packages/context-lens/examples/workbench/serve.mts`).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-context-lens`); it was renamed from the old request-inspector, so when migrating, replace the old package rather than installing both.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
