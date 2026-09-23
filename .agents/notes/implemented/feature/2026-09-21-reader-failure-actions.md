# Agent Note: a failed fetch carries its reason AND its action

Status: implemented

## Problem

The [fetch-state propagation fix](../bug-fix/2026-09-20-reader-fetch-state-propagation.md) made the five-state pill honest — a card knows its fetch failed and why — but stopped at display: the reason lived in a hover tooltip, and the pill's only answer to every failure was the same click-to-retry. That is wrong per cause, which is the whole point of the classification: retrying a bot wall is a crawler with a grudge (`isRetryablePreviewFailure` says only `unreachable` may retry on a timer), while telling a reader whose network blinked "failed" with no retry is its own lie. The [ingest proposal](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md) §3 (D5) asks for the full loop: failure is a first-class state with a reason line AND an action button per cause — and a slot for the future capture package's rendered fetch.

Two adjacent gaps rode along: the script-figure notice's only way out was the external 「阅读原文」 even on hosts that ship the in-app Sidebar Browser (0.1.6-alpha.2), and the add dialog's link-only verdict explained the reason but offered no gesture.

## Decision

One principle everywhere: **the action belongs to the cause**. The recorded `failureCode` — host-classified, the only derivation — picks it.

- **Card failed state** (the wall): the reason is a visible line under the pill, not a tooltip (`previewReason` already turns the code into the reader's sentence; it now renders). The pill's gesture follows the taxonomy: `unreachable` (or an unclassified failure) retries, as before; `blocked` / `login` / `unsupported-type` / `unreadable` opens the page in a real browser instead of retrying; `http` / `empty` / `redirected` are final — the pill becomes a plain indicator with no click, because none of retrying, opening or waiting changes the answer. The hover title says which.
- **The add dialog's link-only verdict** carries the URL it saved, and for the browser-solvable causes (bot wall, login, not-a-web-page, unreadable) shows the 「在浏览器打开原文」 action right in the verdict — the moment the reader learns WHY is the moment they can act on it. `unreachable` and `http` get none: re-pressing 抓取 is the retry, and the sentence already says so.
- **"A real browser" means the in-app one when the host has it.** `browserTabAvailable()` / `openBrowserTab(url)` join the pane's injected face, probed LIVE at render/gesture time through the tab-type registry (`ctx.get('sidebarRightTabs')?.get('browser')`, the ui-chat pattern at 0.1.6-alpha.2) plus the navigation face, wrapped so a missing session binding can never throw. Absent (0.1.5) or refused → the ordinary external link, same spot. The script-figure notice uses it too.
- **The capture slot**: the script-figure notice gains a 「渲染抓取」 action that renders ONLY when a `capture` Remote probes present (`ctx.get('remote.capture')?.render`, structural). M0 ships no such package (it is the proposal's M1), so the slot is invisible by default; the flow behind it is complete — render the URL, run the returned HTML through the SAME whitelist extractor (captured markup is never rendered raw), store the body — so M1 is the capture package alone, with zero reader-side rewiring.

## Alternatives considered

**One universal retry gesture.** That is the status quo and it is wrong per cause: a wall answers the same way forever, and the backfill policy already refuses to retry it automatically — the manual pill contradicting that policy is the same bug wearing a UI.
**The reason stays in the tooltip.** The proposal is explicit: a failure the reader must hover to understand reads as "failed for no reason". The card's text box stays fixed-height; the reason line lives in the pill row, which already wraps.
**Probing the Sidebar Browser at apply time.** Registration order is not guaranteed (the reader's `apply` can run before ui-sidebar-browser's), so the probe is per-render `ctx.get` — cheap, always current, and the same shape canvas and quote already use for `openTab('sidechat')`.
**A visible-but-disabled 渲染抓取 button advertising M1.** A control that cannot work is worse than none (the translation globe's rule); the slot simply does not exist until a capture Remote does.
**The capture flow refetches through the seam after rendering.** Pointless: render's whole product is the HTML — extracting and storing it directly is the one round trip, and the body then rides every existing path (cache, translation, quoting).

## Consequences

- Every failure the reader can see now answers "what do I do about it" — retry, open in a browser, or nothing-by-design — instead of offering the one gesture that fits only the network case.
- The five-state model and the host's annotation stay the single source of truth; nothing here adds a state, only surfaces.
- `openBrowserTab` is the third consumer of the repo's structural `openTab` mirror (after canvas and quote); when an official typed seam arrives the three migrate together.
- The capture probe is dead code by construction today — exercised only by the specs that mount a mock Remote — and becomes live the moment `@khorsheed/dsh-capture` (M1) mounts its namespace. No reader release is needed for that day.

## Testing

`packages/dsh-reader` — new cases red-first against the pre-change pane:

- `tests/ReaderPane.client.spec.tsx`: the script-figure notice opens the in-app browser tab when the seam probes present (label flips to 「在浏览器打开原文」, `openExternal` untouched), falls back externally when the in-app open refuses; the failed card shows the reason line, retries when the code is `unreachable`, opens the browser for `blocked`, and is a dead-certain indicator (no role=button) for `http`; the verdict for a link-only add carries the open-in-browser action and fires it with the pasted URL; 渲染抓取 is absent without a capture Remote and, with a mocked one, renders→extracts→stores the body on click.
