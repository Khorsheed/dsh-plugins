# Agent Note: ui-panel-kit — one panel layout, adapted by width, with shared type tokens

Status: implemented

## Problem

On a phone walkthrough (2026-10-06) the canvas, file list, file preview and inspiration-space panels each used their own type sizes, greys, segmented controls and chip styles, and stacked up to five rows of controls before content. Every plugin was designed for a desktop sidebar and merely stretched to full width on a phone; the mobile package adapts the shell, not panel interiors, and cannot reach into them safely from outside. Plugins also must stay independently installable, so nothing they render may require `@khorsheed/dsh-mobile`.

## Decision

A new source-plane library, `@khorsheed/dsh-client-ui-panel-kit` (`packages/client-ui-panel-kit`, `private`, `dsh.composition.component: source-plane-library`), shaped exactly like `ui-content-preview`: consumers import `./src/client/*` and tsdown inlines it into each plugin's own `lib/client.js`. It registers nothing and has no bundle of its own; `check-plugin-independence` lists it in `NO_OWN_PATCH` beside ui-content-preview.

It carries three things:

- **Type tokens** `--dsh-panel-text-title` / `-body` / `-meta` / `-reading` and `--dsh-panel-reading-line-height`, always read with the desktop value as the `var()` fallback (`panelVar(role)`). The kit never defines them. `@khorsheed/dsh-mobile` sets touch values under `html[data-dsh-mobile] body` (title and reading follow `--mobile-text`, body 15px, meta 13px, line height 1.7) without importing the kit; a mobile test pins both the rule and the absent dependency.
- **Width as the layout axis.** `PanelRoot` declares the `dsh-panel` size container; plugin CSS writes `@container dsh-panel (max-width: 560px)` for its compact layout, the breakpoint ContentPane and local-files already use. `usePanelCompact` measures the same width (inclusive 560) for components that change structure.
- **Shared compact controls.** `PanelHeader` (priority-ordered icon actions: 2 inline when compact, 4 when wide, the rest in the host's `Menu` behind ⋯, no ⋯ when everything fits, `pinned` to keep one inline), `UnderlineTabs` (the mobile panel-tab treatment, roving focus skipping disabled tabs), `ChipRow` (one chip style, caller-owned selection policy), `ListRow` (primary-coloured names, accent-tint selection). Colours come only from `--dsw-alias-*`; `pointer: coarse` raises rows to 44px and icon buttons to 40×40. Icons are inlined artwork in the generated-module format.

Touch is a separate axis from width: a narrow desktop pane gets the compact layout at desktop sizes; a phone gets both.

## Alternatives considered

- **Two layouts per plugin (web and mobile).** Rejected: narrow desktop panes would stay broken, and the two would drift.
- **Ship the components with mobile at runtime (a service plugins fetch).** Rejected: every plugin would still need a fallback UI for mobile's absence (two layouts again), narrow desktop panes would not benefit, and it adds load-order and version coupling.
- **Put them in `ui-content-preview`.** Rejected: that package is a preview kernel with a declared retirement path, and most consumers (canvas, the reader, eval) preview no files.

## Consequences

- Each consuming plugin carries its own copy of the kit; a kit change reaches users only when each consumer rebuilds and ships, so styles can differ briefly between plugins until a release wave evens them out.
- Font-size tuning is one edit in mobile's stylesheet, with no plugin changes.
- No plugin consumes the kit yet; `AdaptiveSplit` moves in from ui-content-preview in the first adoption round (file preview and file list).
