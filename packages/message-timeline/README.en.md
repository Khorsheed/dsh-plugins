# @khorsheed/dsh-message-timeline

English | [中文](README.md)

Every message you sent in a long conversation, visible at a glance and one click away.

Once a session gets long, finding that request you made earlier means scrolling all the way up. With Message Timeline, a thin rail appears on the left of the conversation: one tick per message you sent, faded so it stays out of the way. Hover it and it opens into one-line previews; click a line and the conversation scrolls right to it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline1.png" width="640" alt="the message timeline expanded on the conversation's left edge: one row per user message; click a row to jump to it">

## What it does

- **Everything from the first message**: every message you sent in the session is listed with a one-line preview; click an early one that isn't loaded yet and it pages history back first, then lands there.
- **One click to jump back**: click a line and the conversation scrolls to that message.
- **Know where you are**: the tick for your current spot is blue, longer and bold, the rest stay gray; inside a very long reply, it marks the message that reply answers.
- **Messages without text still get a line**: image messages, attachment messages, and automatic turns (restart recovery, scheduled tasks and so on) are labelled and clickable too.
- **Quiet until you need it**: at rest it is a row of faint gray ticks; text appears only on hover or keyboard focus.
- **Works in narrow windows**: with the right sidebar open or the window narrow, it shrinks to a rail on the left and floats out on hover.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline2.png" width="640" alt="the timeline at rest: a faint strip of ticks that stays out of the way and expands on hover">

## Install

In DSH, open Plugins → Add plugin, enter the package name below, and click install:

```
@khorsheed/dsh-basic
```

Message Timeline comes with the Basic Essentials suite. Once installed, open any session with a few turns and you'll see it on the left. It only reads the conversation and never sends anything, so the agent doesn't know it exists.

## Known limits

- It recognizes the official page layout; if a DSH update changes it beyond recognition, the timeline hides itself until the plugin is updated.
- It only works on the session that is currently open.
- A message you sent mid-turn shows up in the list once that turn is loaded.

## Compatibility

Needs DSH 0.1.2-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Where rows come from, how jumping works, the config fields (`enabled`, `includeSteering`, `panelWidth`, `initialPages`), page probes and degradation, and the internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/message-timeline/docs/reference.en.md).
- Entry points: `src/client/index.ts` (the plugin body), `src/client/rail-tracker.ts` (the only place that touches the page structure). Standalone install: `dsh plugin --profile web add @khorsheed/dsh-message-timeline`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
