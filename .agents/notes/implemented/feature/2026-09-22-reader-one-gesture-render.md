# Agent Note: reader — one gesture runs the whole fetch pipeline

Status: implemented

## Problem

Two seams in the entry-body flow were measured at acceptance (2026-09-22, on the widget-snapshot build):

1. **Two clicks for one intent.** A link that needs rendering made the reader click「抓取」(plain fetch lands the pre-JS shell with the script-figure notice) and then「渲染抓取」 — the shell is never what the click wanted, and the second click is a pure ritual.
2. **「重新抓取」 destroyed rendered bodies.** It always plain-fetched, replacing a render-captured body with the page's pre-JS shell — and the widget-snapshot change made it worse, because a successful render hides the notice (and with it the render action), leaving no way back at all.

Underneath both sits one question: which acts authorize a render? The [capture note](2026-09-21-capture-rendered-fetch.md) gated renders on "an explicit user click"; the two clicks existed because that gate was read as "a click on the render button specifically", which is ceremony, not security.

## Decision

**One rule: an explicit user gesture aimed at one entry runs the whole pipeline — plain fetch, and if the answer is a script-figure shell, the rendered fetch continues on its own.** The gestures are: adding a link, the card's「抓取」, the card menu's fetch, opening an entry, and the detail view's「重新抓取」. Background paths (scheduled feed refresh, the backfill sweep) never escalate — that is what keeps the reader from crawling other people's sites with a browser. The gesture-gate's security content is unchanged: the render still only follows a user act naming that entry, and the per-site allow record still accrues.

- **Escalation** lives in `maybeAutoRender` (`packages/dsh-reader/src/client/ReaderPane.tsx`): capture Remote probed present + link + `scriptFigures > 0` → `captureBody`. It fires once per entry per pane session (`autoRenderTriedRef`); a failed render leaves the notice with a manual「渲染抓取」retry, and reopening does not refire. The notice line becomes the progress line (`detail.rendering`) while a render is in flight.
- **The `rendered` body flag** (types/store/service/contract: stored with the body, returned by `getEntryBody`) is what「重新抓取」routes on: a rendered entry re-renders. Plain fetches never set it, so their bodies keep the plain route. Bodies stored before the flag existed are indistinguishable from plain ones — they plain-fetch once, land on the shell, and the auto-escalation heals them into a flagged rendered body (no migration; the pipeline is the migration).
- The refetch button reads `captureBusy` too: a re-render takes minutes and a button that looks dead for minutes reads as broken.

## Alternatives considered

**Keep the two-click split (the render action stays separate).** The split's only content was the gesture accounting, and "the fetch click plus the render click" authorizes nothing the fetch click alone did not — the reader fetches the URL either way. What it cost was every script-heavy page being a two-click chore and the rendered-body destruction bug above.
**Auto-render on background paths too (feed refresh, backfill).** That is the crawler the host's fetch comment already refuses ("one entry, one fetch, on the reader's request") with a hundred-MB browser attached. Never.
**A settings toggle for the escalation.** Added surface for a behavior that has no measured opponent; the capture package's absence remains the master switch (nothing probes, nothing escalates). Add the toggle when a deployment actually asks.
**Detect old rendered bodies heuristically (snapshot markers, inlined-style density).** Marker sniffing works only for post-snapshot builds and misreads hand-written pages; the explicit flag plus heal-through-pipeline is exact and needs no archaeology.

## Consequences

- The script-figure flow is: open/抓取 → notice with progress line → rendered body swaps in. Failures keep the retry. Queue-busy and refusals surface through the same error line as any capture failure.
- Every explicit-gesture fetch of a shell page now costs a render (minutes, one Chrome) — intended, because the shell was never the intent; the once-per-entry-per-session guard and the body cache bound it.
- The capture note's permission bullet reads today as "explicit per-entry gesture", which this arc widened from "the render button's own click"; the [widget-snapshot note](2026-09-22-capture-widget-snapshots.md) owns the render output side.

## Testing

`packages/dsh-reader` — 422 tests green locally: the capture-flow client test is now the auto-render test (open → shell fetch → captureRender fires with no second click; store carries `rendered: true` + `scriptFigures: 0`), a failure case pins the loop guard plus the manual retry, and a routing case pins「重新抓取」→ render (in-flight button state included, plain fetch never called). The boot suite round-trips the `rendered` flag alongside the explicit-zero count. 3199 end-to-end: one click from shell to 23-snapshot body, re-「重新抓取」 re-rendered server-side (site render count 7→8) without dropping the on-screen body.
