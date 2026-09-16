# @khorsheed/dsh-quote

Quote anything: select any text anywhere in the app and a small menu floats beside the selection — **Quote to current chat** (into the composer, still editable), **Quote to side chat** (a side-chat ref), **Copy**. A quote is the selected plain text plus a short source label — an opaque chunk: the plugin knows nothing about any other plugin's types, items hide when side-chat/canvas are absent, and the plugin installs and uninstalls alone.

## The selection overlay

- A root-level component on the frame-wide `shell.overlay` seat (registered through `ctx.slots.inject`), listening for app-level selections.
- It reads ONLY `window.getSelection()`'s selected plain text and its bounding rect — never host DOM structure or class names. The one structural judgment is the exclusion the gesture itself requires: a selection inside an input / textarea / contenteditable (editing, not a quote source) or inside the menu itself never triggers it.
- Empty selection → no menu; scroll / resize → the menu hides (the cached viewport rect is stale).
- **Fallback semantics**: when a host redesign defeats the read, the overlay silently never appears — a missing feature with zero breakage (the AGENTS.md last-resort clause), re-verified by hand on every host adaptation.
- Structured content (tables, code blocks) is quoted as plain text — no structure restoration.

## The two delivery targets

| Target | Mechanism | Form |
| --- | --- | --- |
| Quote to current chat | `ctx.sessions.scope(id).get('conversation').input.for(scope).setDraft(...)` (the official input machine; the live draft is merged, never overwritten, never sent) | a `> quote` block with a source annotation, sitting in the composer |
| Quote to side chat | this package's own thin typert Remote (namespace `quote`, verb `addRef`) → the host half probes `ctx.get('sideChat')` → `openWith` (the sanctioned host-to-host seam, a structural mirror — sidechat is never imported) | a ref chip on the context bound to the current session (contextKey = session id); on success the side-chat tab surfaces through the official `sidebarRight.openTab` navigation face (probed, silent without the seat) |
| Copy | the official `writeClipboard` helper | the verbatim text |

Why not side-chat's own Remote: the M2 probe found no client-reachable "queue one pending ref" verb among its wire verbs (`send` starts a whole turn; `quoteMessage` addresses an assistant message by id), so this plugin ships a thin Remote adapting exactly that call.

**Source label**: the current session's display title (best-effort plain text; a generic "Selection" fallback when none). Quotes never link back to the origin position — the annotation stops at "which chat" granularity.

**Degrade matrix**: no current session → both quote items hide (copy stays); `remote.sidechat` or `remote.quote` absent → Quote to side chat hides; a click that still races a missing side-chat service gets the verb's `unavailable` refusal and no-ops silently.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-quote
# remove:
dsh plugin --profile web remove @khorsheed/dsh-quote
```

Restart the host afterwards. The plugin keeps no persistent state of its own, so uninstalling leaves nothing behind (quote blocks already sent and refs already queued belong to their hosts and are not removed).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the `shell.overlay` seat (ui-layout's frame) and the conversation input machine (`conversation.input.for`) both exist on this line, so `minHost` pins 0.1.5-rc.1.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **Seat-probe degrade**: the only surface registers through `ctx.slots.inject` — a host without the overlay seat mounts nothing, and boot is unaffected. A headless profile has no browser consumer; the host half still provides the Remote, whose verb refuses or accepts per its own probe.
- **The selection read is a last-resort DOM anchor**: it reads only `window.getSelection()`'s plain text and rect; if the read itself throws, the fallback is silent disappearance, never a boot failure.
- **Side-chat is a declared optional collaboration**: `dsh.references` declares `@khorsheed/dsh-sidechat` (a data reference, not a dependency); without it the matching menu item hides and everything else works.

## Known Limitations

- **DOM-anchor fragility**: a host redesign can defeat the overlay's judgment — the fallback is silent disappearance. The honest fix is the upstream selection-actions seam, drafted at `docs/upstream-proposals/2026-09-16-selection-actions.md`; this path retires area by area as the seam lands.
- **Quotes are plain-text snapshots**: no link back to the origin position (v1 has no anchor seam); the source annotation only reaches "which chat" granularity (a selection from a canvas card or a file preview is still annotated with the current chat's name — a deliberate best-effort trade-off).
- **Selections inside inputs never trigger** (editing must not fight quoting); code-block/table selections quote as plain text; the menu hides on scroll/resize rather than following (kept simple in v1).
- **No keyboard navigation in the menu**: the overlay is a focus-free toolbar (`role="toolbar"`); keyboard flow is re-evaluated in M2 alongside the upstream seam.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The injectable selection seam**: `src/client/selection.ts` folds "app-level selection → snapshot" into a small `SelectionSource` interface — the real implementation listens to `selectionchange` (suspended mid-drag, evaluated immediately on mouseup, 120ms-debounced for keyboard selection) and to scroll/resize (hide). Component tests drive a manual source and never touch the real `window.getSelection()`. Classification is a pure function (empty / editable / own menu → null).

**Consumed semantics**: actions run on the captured snapshot, never racing the live selection. The menu closes after an action; the click's own mouseup makes the source re-report the same selection, and that one echo is ignored via a consumed marker — the next distinct selection re-arms the menu.

**Route: current chat**: `formatQuoteBlock` (every line `> `-prefixed, the attribution closing the blockquote) merged by `mergedQuoteDraft` — a blank draft is filled directly, a typed draft gets the block appended after one blank line and is never overwritten (the message-tools backfill precedent).

**Route: side chat**: `remote.quote.addRef({ contextKey, label, ref })` → the host half's `openWith` (the side-chat record holds pending refs, folded into the next send and cleared). The verb carries no calling agent: `openWith` owns no session-scoped write, and the side-chat store fences host-side calls on the deployment default mode (the canvas `askAgent` precedent).

**Identity triangle**: the cordis row id `quote`, `clientBundle('@khorsheed/dsh-quote')`, and `src/invariant.ts`'s `PACKAGE_NAME` move together.
</details>

[中文](README.md)
