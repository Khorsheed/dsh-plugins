# @khorsheed/dsh-message-timeline

English | [中文](README.zh.md)

Message timeline plugin, browser half: a flat floating timeline over the left edge of the chat scrollport — one row per loaded user message (including steering messages admitted mid-turn, opt-out), each a tick plus an ellipsized one-line preview, with no frame and no visible scrollbar. At rest only the dimmed ticks show, reading as ambient markers, and only the narrow tick strip is pointer-sensitive — crossing the list on the way to the sidebar never lights it. The current reading position's tick stays blue — inside a long assistant answer it anchors to the user message being answered (the latest message until the tracker answers); hovering the strip or keyboard-focusing the list reveals every row's text, with the reading position still the brightest. Clicking a row scrolls the transcript to that message; the list follows the reading position, so a newly sent message keeps its lit row in view; a short list centers vertically in the message area below the tab strip, a long one scrolls invisibly and pages older history at its top; the panel is always on while the chat view shows, and the `enabled` config turns the plugin off entirely.

The plugin is purely additive and modifies no official code:

- **Mount** — one entry in the official `conversation.session.header.utilities` seat (a right-aligned optional-utility slot) anchors the plugin into the session scope; the panel itself renders through a body portal with `position: fixed` geometry measured from the official `[data-conversation-scroll]` scrollport.
- **Data** — the rows are derived from the framework `useSession` chat snapshot (`s.chat.order` / `s.chat.nodes`), filtered to `user` / `steering` nodes. No store outside the session, no event registration.
- **Jump** — clicking a row finds the transcript row by the official `data-chat-anchor-key` attribute and writes `scrollTop`; the official ChatView treats that programmatic scroll as a normal reader move (bottom-follow and scroll memory keep working).
- **Degradation** — the probed attributes are official render output, not a declared API. When they change, the panel hides itself with one `console.warn`; nothing throws and the boot never fails (`slots.inject` drops the contribution when the seat's declaration disappears).

Composing the plugin out of cordis.yml removes every surface it adds.

The `/client` exports are the plugin body (`apply`/`inject`), the `TimelineRail` component, the store factory, and the injected face types.

## Model Experience

None. The panel reads the session snapshot and scrolls the transcript; it never sends prompts, appends session events, or enters the session log.

#### KV Cache effect

None.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; false hides the panel entirely. |
| `includeSteering` | `true` | Count steering messages (user text admitted mid-turn) as rows. |
| `panelWidth` | `360` | Timeline panel width in px (clamped 120–640). |
| `initialPages` | `5` | History pages (50 events each) prefetched when the panel opens; older pages load on demand when the panel is scrolled to its top (clamped 1–20). |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **DOM probe coupling** — the panel targets the official row attributes `data-chat-anchor-key` / `data-chat-flow-kind` and the `[data-conversation-scroll]` scrollport. If the official DOM structure changes, the panel hides itself (one `console.warn`) until the probe is updated; there is no legacy-compat path by design.
- **Single rendered session** — the tracker follows the one currently rendered conversation, so rows and jumps address that session only.
- **Loaded history only** — rows cover materialized nodes. On a chat view the panel pulls history pages until the first user message materializes (a huge assistant turn can push every user message past the loaded event window) and up to `initialPages` total; older messages then arrive one page at a time when the panel is scrolled to its top (`conversation.loadOlder()`).
- **No full index view yet** — a second `conversation.view` tab with a searchable message index is planned, reusing the same snapshot filter and jump path.
