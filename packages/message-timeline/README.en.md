# dsh-message-timeline

English | [中文](README.md)

A jump-to-message timeline for the dsh web GUI: a floating rail on the chat's left edge with one row per user message. Hover to reveal previews, click to scroll the transcript straight to that message.

<img src="../../docs/screenshots/message-timeline1.png" width="480" alt="floating message timeline along the chat's left edge">

<img src="../../docs/screenshots/message-timeline2.png" width="480" alt="the timeline rests as a thin rail out of sight, expanding on hover">

## Features

- **One row per user message** — tick plus ellipsized one-line preview; steering messages count too (configurable off).
- **Ambient rest state** — only dimmed ticks show until you hover the strip or focus the list.
- **Reading position tracking** — the current position's tick stays lit blue, anchoring to the user message a long answer is replying to.
- **Click to jump** — a row scrolls the transcript to that message; the list follows the reading position.
- **Long-history friendly** — a short list centers vertically; a long one scrolls and pages older history at its top.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

Then restart the web instance. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-message-timeline
```

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; false hides the panel entirely. |
| `includeSteering` | `true` | Count steering messages (user text admitted mid-turn) as rows. |
| `panelWidth` | `360` | Panel width in px (clamped 120–640); shrinks to fit a narrow column, hides entirely when the gutter is too small. |
| `initialPages` | `5` | History pages (50 events each) prefetched on open; older pages load when the panel is scrolled to its top (clamped 1–20). |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **DOM probe coupling** — the panel targets official row attributes and the `[data-conversation-scroll]` scrollport; if the official DOM changes, it hides itself (one `console.warn`) until the probe is updated.
- **Single rendered session** — rows and jumps address only the currently rendered conversation.
- **Loaded history only** — rows cover materialized nodes; older messages arrive one page at a time when the panel is scrolled to its top.
- **No full index view yet** — a searchable message-index tab is planned.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The plugin is purely additive and modifies no official code.

- `src/client/index.ts` — plugin body (`apply`/`inject`)
- `src/client/rail-tracker.ts` — the only DOM the plugin touches: read-only probes plus the jump's scroll write
- `src/client/TimelineRail.tsx` — the panel component
- `src/client/preview.ts` — message content to one-line preview text
- `src/index.ts` — empty host `apply`, anchors the plugin into the host Loader

**Mount & data** — one entry in the official `conversation.session.header.utilities` slot anchors the plugin into the session scope; the panel renders through a body portal with fixed geometry measured from the official scrollport. Rows derive from the framework `useSession` chat snapshot (`s.chat.order` / `s.chat.nodes`), filtered to `user` / `steering` nodes — no store outside the session, no event registration.

**Jump & degradation** — clicking a row finds the transcript row by the official `data-chat-anchor-key` attribute and writes `scrollTop`; the official ChatView treats that as a normal reader move (bottom-follow and scroll memory keep working). The probed attributes are official render output, not a declared API: when they change, the panel hides itself with one `console.warn`; nothing throws and the boot never fails.

**Model experience: none.** The panel reads the session snapshot and scrolls the transcript; it never sends prompts, appends session events, or enters the session log. KV cache effect: none. The `enabled` config turns the plugin off entirely; removing it from cordis.yml removes every surface it adds.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/message-timeline`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
