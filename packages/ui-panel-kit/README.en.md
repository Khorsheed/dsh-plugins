# @khorsheed/dsh-client-ui-panel-kit

English | [中文](README.md)

> **Internal source-plane library, not published.** The package is `private: true`; plugins inline it at build time and it never exists on its own at runtime.

The shared base for community plugin panels: a set of type tokens with desktop defaults, a panel root that declares its width as a size container, and the compact controls every panel needs. The goal is that each plugin writes **one interface** that adapts to the panel width it is given — a desktop sidebar dragged narrow, a floating pane and a phone all run the same code. The spec is the panel-responsive-spec proposal (2026-10-06).

**This is not a plugin.** It registers no slot, service or locale and has no loader row or client bundle of its own. Plugins declare it as a `workspace:*` dependency and import `@khorsheed/dsh-client-ui-panel-kit/src/client/…` directly; each plugin's tsdown client bundle inlines it into its own `lib/client.js`. Zero runtime coupling: every plugin still installs and uninstalls on its own.

## Contents

- **Type tokens** — `--dsh-panel-text-title` (14), `-body` (13), `-meta` (12), `-reading` (14), `--dsh-panel-reading-line-height` (1.65); the numbers are the desktop defaults. The kit **never defines** these properties; it only reads them with their defaults (`panelVar('body')` → `var(--dsh-panel-text-body, 13px)`). With `@khorsheed/dsh-mobile` installed, touch screens get larger values; without it, panels keep desktop sizes. Plugins never depend on mobile.
- **`PanelRoot` / `usePanelCompact`** — the panel root declares the `dsh-panel` size container, so plugin CSS enters the compact layout with `@container dsh-panel (max-width: 560px)`; components that change STRUCTURE (not just style) read the same width as a compact flag.
- **`PanelHeader`** — optional back, a title, a meta note, and priority-ordered icon actions. A compact panel shows at most 2 inline, a wide one at most 4; the rest fold into ⋯ (the host's `Menu`), and when everything fits there is no ⋯ at all.
- **`UnderlineTabs`** — underline segmented switching in the same treatment as the mobile panel tabs (bold active label, 2.5px accent rule), with arrow / Home / End roving focus that skips disabled tabs; each tab may carry a `badge` (beside the label, outside the underline), `trailing` puts the row's ⋯ or layout toggle on the same row sharing one bottom rule, and the row is 44px tall on a coarse pointer.
- **`ChipRow`** — filter chips in one style: accent tint when pressed, outline at rest; optional count and colour dot; the row scrolls sideways and is always one row tall; `tools` holds the row's icon buttons, pinned right and outside the chip scroll.
- **`ListRow`** — icon, primary-coloured title, meta, trailing element; selection is an accent tint; a button when `onSelect` is given.
- **`AdaptiveSplit`** — a retained master/detail layout (moved in from ui-content-preview at P1): side by side when wide; at 560px or less an open detail replaces the master, and back returns to the master as it was. A detail with its own title bar sets `backInDetail` and draws the back control there via `useAdaptiveSplitBack()`, saving a row on narrow screens. From the repository root, `node packages/ui-panel-kit/examples/adaptive-split/serve.mjs` serves a standalone preview of the real component with mock data.
- **`browserOnHost()`** — whether the page is open on the host machine itself (hostname localhost / 127.0.0.1 / ::1; an unreadable location counts as on-host). A gesture that launches a program on the host (Finder, an IDE, a native folder dialog) should hide when the page is reached remotely (moved in from ui-content-preview on 2026-10-06).

`PanelHeader` actions can be `pinned` (always inline), `menuOnly` (⋯ only — an informational row such as the full path) or `pressed` (a toggle's on state); `PanelRoot` accepts a function child that receives the compact state.

Colours come only from the host's `--dsw-alias-*` properties, so both themes follow automatically; on touch (`pointer: coarse`) rows are at least 44px and icon buttons 40×40.

## Usage

```ts
import { PanelRoot, PanelHeader, UnderlineTabs, ChipRow, ListRow, panelVar } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
```

Copy comes from the caller: the kit owns no locale namespace, and every visible string and accessible name (`moreLabel`, `backLabel`, each action's `label`) is passed in.

## Install

**Not installed as a plugin.** It has no mountable row, so `dsh plugin add` on it does nothing. It arrives at build time with the plugins that consume it.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the only official runtime import is ui-primitives' `Menu` (the ⋯ list), present on the 0.1.5-rc.1 line, the same import ui-content-preview carries; icons are inlined SVG.
- Source line (deepseek-harness master): ✅ (verifiedHost: `0.2.1-rc.1`) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes; a source-plane library registers no slot / service / locale / row; its compatibility surface is `Menu`'s type export.
