# dsh-message-timeline

English | [中文](README.md)

Every message you sent in a long conversation — visible at a glance, one click to jump back.

Once a session gets long, finding that requirement you mentioned three messages ago means scrolling up forever. This plugin parks a timeline on the chat's left edge: one row per message you sent, with a one-line preview. At rest it's just a strip of dimmed ticks that stays out of the way; hover to expand it, and clicking a row scrolls the transcript straight to that message. It only reads the session and never sends anything — the model doesn't notice it at all.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline1.png" width="640" alt="the expanded message timeline on the chat's left edge: one row per user message, click a row to jump to it">

## Features

- **One row per user message, the whole session listed from the first one** — tick plus ellipsized one-line preview; the host `turnOutline` projection names every started turn directly, no paging required. Clicking a not-yet-loaded older message pages history back to that turn before landing (its tick pulses while paging). Steering messages count too (configurable off), and message-tools edited/restored bubbles keep a row. Withdrawn originals are not listed (their transcript row is hidden, so a click could never reach them).
- **Textless rows stay listed and jumpable** — automated turns (restart recovery, scheduled jobs) show their trigger card's text once loaded, and fall back to a "Turn N" label while unloaded; image/attachment-only inputs are labelled "Image message" / "Attachment message". After jumping to an automated turn, the selection stays on that turn instead of moving to the next user message.
- **Ambient rest state** — only dimmed grey ticks show until you hover the strip or focus the list.
- **Reading position tracking** — the current position's tick stays blue and lengthened with bold text (defaulting to the latest message while nothing is selected); every other row rests grey. A long answer anchors the lit tick to the user message it replies to.
- **Click to jump** — a loaded row scrolls the transcript straight to it; an outline row goes through the session's jump loader and lands on the freshly loaded message.
- **Long-history friendly** — a short list centers vertically; a long one scrolls, its bottom-most row flush with the chat input box; goal/todo dock cards never push the timeline up. Assemblies without the turn-outline unit fall back to window paging: a few pages prefetch on open, and older history loads when the panel is scrolled to its top.
- **Never covers the message flow** — the panel's width is capped by the scrollport's left gutter; a gutter too small for the minimum width hides it rather than overlapping the transcript.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline2.png" width="640" alt="the timeline at rest: a strip of dimmed ticks that stays out of the way, expanding on hover">

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
| `initialPages` | `5` | Window-paging fallback only: history pages (50 events each) prefetched on open (clamped 1–20). When the host serves the turnOutline projection the list starts whole and this does nothing. |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes.
- Degraded item: the whole-session list relies on the host `turnOutline` projection (`@deepseek-ai/dsh-session-turn-outline`, mounted by the official web bundle since 0.1.2-alpha.3 — below the minHost floor). An assembly without the unit falls back to window paging: older history loads page by page, fully functional, but the first message appears only once paged in.

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **DOM probe coupling** — the panel targets official row attributes and the `[data-conversation-scroll]` scrollport; if the official DOM changes, it hides itself (one `console.warn`) until the probe is updated.
- **Best-effort width fallback** — while the message-flow probe is unanswered, the panel renders at a capped fraction of the scrollport instead of hiding, so it may overlap the flow until the probe recovers; with a healthy probe the width never crosses the flow's left edge.
- **Single rendered session** — rows and jumps address only the currently rendered conversation.
- **The outline is turn-grained** — the projection keeps only each turn's first-prompt preview: steering rows appear once their turn pages into the window; a turn whose first message was withdrawn stays listed per the outline (matching the official turn rail), and confirming it lands on the turn's nearest visible row.
- **No full index view yet** — a searchable message-index tab is planned.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The plugin is purely additive and modifies no official code.

- `src/client/index.ts` — plugin body (`apply`/`inject`)
- `src/client/rail-tracker.ts` — the only DOM the plugin touches: read-only probes, the reading-position resolution, plus the jump's scroll write
- `src/client/TimelineRail.tsx` — the panel component
- `src/client/outline.ts` — the `turnOutline` wire narrow (absent or damaged values both read as "capability absent")
- `src/client/rows.ts` — the merge of loaded-window rows with outline rows (single interleaving pass, transcript-ordered)
- `src/client/timeline-kinds.ts` — the single source of truth for which node kinds are rows and which carry a hidden span
- `src/client/hidden-spans.ts` — folds the message-tools withdraw/edit spans so covered originals are dropped as dead rows
- `src/client/preview.ts` — message content to one-line preview text
- `src/index.ts` — empty host `apply`, anchors the plugin into the host Loader

**Mount & data** — one entry in the official `conversation.session.header.utilities` slot anchors the plugin into the session scope; the panel renders through a body portal with fixed geometry measured from the official scrollport. Rows merge two sources: the host `turnOutline` projection (the `useProjection` standard seat — one entry per started turn: its number, its `turn/start` seq, and a 50-char first-prompt preview) lists every turn of the session, and the loaded window (`useChat`'s `order` / `nodes`) overlays richer previews, steering rows, and message-tools bubbles for the turns it covers (`message-tools-edited`/`message-tools-restored` bubbles the host order does not always surface are appended from the node store). A bubble for a withdrawn original is dropped (its row is hidden by the DOM hider, so a click could never reach it), and appended bubbles are sorted by their anchor seq so the newest message is always last. Without the projection, the window rows alone carry the list.

**Jump & degradation** — clicking a loaded row finds the transcript row by the official `data-chat-anchor-key` attribute and writes `scrollTop`; the official ChatView treats that as a normal reader move (bottom-follow and scroll memory keep working). Clicking an outline row goes through the session's jump loader (`ISession.loadThrough`, since 0.1.2-alpha.3): history pages back through the turn's `turn/start` seq, and the rail lands the moment the row materializes; when paging stalls or the turn is unreachable (e.g. its first message was withdrawn), it lands on the nearest visible row after the turn instead. The probed attributes are official render output, not a declared API: when they change, the panel hides itself with one `console.warn`; nothing throws and the boot never fails. The panel's width is capped by the scrollport's left gutter so it never covers the message flow; while the flow probe is unanswered (an official structure change) the width degrades to a capped fraction of the scrollport as a best-effort fallback — the panel may then overlap the flow until the probe recovers.

**Model experience: none.** The panel reads the session snapshot and scrolls the transcript; it never sends prompts, appends session events, or enters the session log. KV cache effect: none. The `enabled` config turns the plugin off entirely; removing it from cordis.yml removes every surface it adds.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/message-timeline`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
