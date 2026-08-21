# dsh-message-timeline

English | [中文](README.zh.md)

A jump-to-message timeline for the dsh web GUI: a flat floating rail along the left edge of the chat scrollport — one row per loaded user message, a tick plus an ellipsized one-line preview. At rest only the dimmed ticks show, reading as ambient markers; hovering the strip or keyboard-focusing the list reveals every row's text, the current reading position stays lit blue, and clicking a row scrolls the transcript straight to that message. No model-visible effects, no patches to official code.

<img src="docs/screenshots/02-message-timeline.png" width="480" alt="floating message timeline along the chat's left edge">

## Features

- **One row per user message** — tick plus one-line preview; steering messages admitted mid-turn are included (configurable off).
- **Ambient rest state** — only the dimmed ticks show, and only the narrow tick strip is pointer-sensitive: crossing the list on the way to the sidebar never lights it.
- **Reading position tracking** — the current position's tick stays blue and brightest; inside a long assistant answer it anchors to the user message being answered.
- **Click to jump** — a row scrolls the transcript to that message; the list follows the reading position, so a newly sent message keeps its lit row in view.
- **Long-history friendly** — a short list centers vertically below the tab strip; a long one scrolls invisibly and pages older history at its top.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

Then restart the web instance. Uninstall removes every surface the plugin adds:

```sh
dsh plugin --profile web remove @khorsheed/dsh-message-timeline
```

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; false hides the panel entirely. |
| `includeSteering` | `true` | Count steering messages (user text admitted mid-turn) as rows. |
| `panelWidth` | `360` | Preferred timeline panel width in px (clamped 120–640); the panel's right edge never crosses the message flow, so a narrow column shrinks the panel (long text ellipsizes), and a left gutter too small for 120px hides the panel entirely. |
| `initialPages` | `5` | History pages (50 events each) prefetched when the panel opens; older pages load on demand when the panel is scrolled to its top (clamped 1–20). |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **DOM probe coupling** — the panel targets the official row attributes `data-chat-anchor-key` / `data-chat-flow-kind` and the `[data-conversation-scroll]` scrollport. If the official DOM structure changes, the panel hides itself (one `console.warn`) until the probe is updated; there is no legacy-compat path by design.
- **Single rendered session** — the tracker follows the one currently rendered conversation, so rows and jumps address that session only.
- **Loaded history only** — rows cover materialized nodes. On a chat view the panel pulls history pages until the first user message materializes (a huge assistant turn can push every user message past the loaded event window) and up to `initialPages` total; older messages then arrive one page at a time when the panel is scrolled to its top (`conversation.loadOlder()`).
- **No full index view yet** — a second `conversation.view` tab with a searchable message index is planned, reusing the same snapshot filter and jump path.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The plugin is purely additive and modifies no official code:

- **Mount** — one entry in the official `conversation.session.header.utilities` seat (a right-aligned optional-utility slot) anchors the plugin into the session scope; the panel itself renders through a body portal with `position: fixed` geometry measured from the official `[data-conversation-scroll]` scrollport.
- **Data** — the rows are derived from the framework `useSession` chat snapshot (`s.chat.order` / `s.chat.nodes`), filtered to `user` / `steering` nodes. No store outside the session, no event registration.
- **Jump** — clicking a row finds the transcript row by the official `data-chat-anchor-key` attribute and writes `scrollTop`; the official ChatView treats that programmatic scroll as a normal reader move (bottom-follow and scroll memory keep working).
- **Degradation** — the probed attributes are official render output, not a declared API. When they change, the panel hides itself with one `console.warn`; nothing throws and the boot never fails (`slots.inject` drops the contribution when the seat's declaration disappears).

The panel is always on while the chat view shows, and the `enabled` config turns the plugin off entirely. Composing the plugin out of cordis.yml removes every surface it adds.

The `/client` exports are the plugin body (`apply`/`inject`), the `TimelineRail` component, the store factory, and the injected face types. The host half is an empty `apply` that only anchors the plugin into the host cordis.yml / Loader.

**Model experience: none.** The panel reads the session snapshot and scrolls the transcript; it never sends prompts, appends session events, or enters the session log. KV cache effect: none.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/message-timeline`). Issues and contributions welcome there.
