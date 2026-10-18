# @khorsheed/dsh-quote

English | [中文](README.md)

Quote anything you see — select any text and the little menu floating beside the selection sends it to the current chat, to a side chat, or to the clipboard in one click.

To follow up on a passage from an assistant reply or a file preview, you used to copy, switch, and paste by hand. This plugin floats an action menu beside any selection in the app: **Quote to current chat** (the selected text lands in the composer as a quote block with a source label — editable, never auto-sent), **Quote to side chat** (queued as a pending side-chat ref), **Copy**; other plugins add their own rows through the `ctx.quoteActions` registry (see [Contributing menu actions](#contributing-menu-actions-other-plugins)). A quote is the selected plain text plus a short source label — an opaque chunk: the plugin knows nothing about any other plugin's types, items hide when side-chat is absent, and the plugin installs and uninstalls alone.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-1.png" width="640" alt="the floating action menu beside a selection in an assistant reply: quote to current chat, quote to side chat, copy">

## Features

- **Menu on any selection** — select text anywhere outside inputs and a small toolbar floats beside the selection; selections inside inputs or the menu itself never trigger, and scroll or resize hides it.
- **Quote to current chat** — on host lines with the reference-chip seam the selection becomes a structured inline chip in the composer draft (the label carries the source; at submit this plugin's own codec serializes it back to the annotated `> quote` block; hosts without the seam, or a declined insert, fall back to the plain-text block): a blank draft is filled directly, a typed draft gets the quote appended after one blank line — never overwritten, never sent. Room sessions work the same way (the room composer's draft IS the official input machine's draft).
- **Styled card after send** — in sent messages the quote block is matched by this plugin's `quote-block` user-text rule and rendered through the keyed slot as a card with a source row (both locales' attributions match; the card's source row follows the current locale). A host without the user-text seam keeps the raw text.
- **Quote to side chat** — the selection queues as a pending side-chat ref on the context bound to the current session (contextKey = session id); on success the side-chat tab surfaces in the right sidebar.
- **Copy** — the verbatim text via the official `writeClipboard` helper.
- **Extensible menu rows** — other plugins register their own action rows through the `ctx.quoteActions` registry (the canvas package, say, registering "Save as canvas card"), receiving the same opaque `{ text, label, sessionId }` payload; the menu never learns where an action delivers to.
- **Probe-and-degrade everywhere** — the overlay seat, the current session, side-chat, and both Remote namespaces are probed one by one: whatever is absent hides its menu item (or the whole menu), and every composition boots.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-2.png" width="640" alt="the same action menu floating over a selection inside the file preview panel: quote to current chat, quote to side chat, copy">

## The selection overlay

- A root-level component on the frame-wide `shell.overlay` seat (registered through `ctx.slots.inject`), listening for app-level selections.
- It reads ONLY `window.getSelection()`'s selected plain text and its bounding rect — never host DOM structure or class names. The one structural judgment is the exclusion the gesture itself requires: a selection inside an input / textarea / contenteditable (editing, not a quote source) or inside the menu itself never triggers it.
- Empty selection → no menu; scroll / resize → the menu hides (the cached viewport rect is stale).
- **Fallback semantics**: when a host redesign defeats the read, the overlay silently never appears — a missing feature with zero breakage (the AGENTS.md last-resort clause), re-verified by hand on every host adaptation.
- Structured content (tables, code blocks) is quoted as plain text — no structure restoration.

## The two delivery targets

| Target | Mechanism | Form |
| --- | --- | --- |
| Quote to current chat | the official input machine: the `slash/input-insert-reference` scoped event inserts a structured reference chip (this plugin's codec serializes it back to the quote block at submit; a missing seam or a declined insert falls back to a `setDraft` plain-text merge) — never overwritten, never sent | a reference chip (or the fallback `> quote` block) with a source annotation, sitting in the composer |
| Quote to side chat | this package's own thin typert Remote (namespace `quote`, verb `addRef`) → the host half probes `ctx.get('sideChat')` → `openWith` (the sanctioned host-to-host seam, a structural mirror — sidechat is never imported) | a ref chip on the context bound to the current session (contextKey = session id); on success the side-chat tab surfaces through the official `sidebarRight.openTab` navigation face (probed, silent without the seat) |
| Copy | the official `writeClipboard` helper | the verbatim text |

Why not side-chat's own Remote: the M2 probe found no client-reachable "queue one pending ref" verb among its wire verbs (`send` starts a whole turn; `quoteMessage` addresses an assistant message by id), so this plugin ships a thin Remote adapting exactly that call.

**Source label**: the current session's display title (best-effort plain text; a generic "Selection" fallback when none). Quotes never link back to the origin position — the annotation stops at "which chat" granularity.

**Degrade matrix**: no current session → both quote items hide (copy stays); `remote.sidechat` or `remote.quote` absent → Quote to side chat hides; a click that still races a missing side-chat service gets the verb's `unavailable` refusal and no-ops silently.

## Contributing menu actions (other plugins)

The menu is extensible: the browser half `ctx.provide`s an action registry, **`ctx.quoteActions`**, at the very top of its apply (the ui-shortcuts `ctx.shortcuts` precedent). Any plugin can register its own row into the selection menu — the canvas package, say, registering "Save as canvas card":

```ts
// In-repo consumers: ctx.get probe + structural mirror + declare
// '@khorsheed/dsh-quote' in the manifest's dsh.references (a data reference,
// not a dependency). External npm consumers may import the types directly —
// '@khorsheed/dsh-quote/client' exports QuoteActionContribution & friends.
const registry = ctx.get('quoteActions')
if (registry !== undefined) {
  ctx.effect(() => registry.registerAction({
    id: 'my-plugin.save',                                // '<plugin>.<action>' convention; a duplicate id throws at registration
    label: () => t('menu.save'),                         // re-evaluated at every menu open — close over your own locale face
    // icon: <MyIcon />,                                 // optional; the menu stands a generic icon in
    available: target => target.sessionId !== undefined, // optional visibility gate; re-evaluated per open
    run: (target) => { void save(target.text) },          // the menu closes before this runs
  }), 'my-plugin: quote action')
}
```

- **The target is an opaque payload**: `{ text, label, sessionId }` — the selected plain text, the best-effort source label (the current session's display title, else "Selection"), and the current session id (`undefined` when none; gate the row yourself via `available`). The registry never learns where an action delivers to, just as this plugin never learns a quote source's types.
- **Order**: the three built-in rows (current chat / side chat / copy) always lead; contributed rows follow in registration order.
- **Degrade**: quote absent → the probe misses and the action never appears (silent — never `inject` this service); your plugin absent → its rows are absent. Neither side breaks.
- **Timing**: registration is boot-time; a probe that misses at apply means quote is not installed or loaded after your plugin — treat it as the degrade.
- **Robustness**: a contribution's `label` / `available` / `run` throwing is only logged — the label degrades to the id, the gate degrades to hidden, the run is swallowed; the menu never goes down.
- The full contract lives in `src/client/registry.ts`.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-quote
```

Restart the web instance to activate. The plugin keeps no persistent state of its own, so uninstalling leaves nothing behind (quote blocks already sent and refs already queued belong to their hosts and are not removed).

```sh
dsh plugin --profile web remove @khorsheed/dsh-quote
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the `shell.overlay` seat (ui-layout's frame) and the conversation input machine (`conversation.input.for`) both exist on this line, so `minHost` pins 0.1.5-rc.1.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; no other surface changes.
- **Seat-probe degrade**: the only surface registers through `ctx.slots.inject` — a host without the overlay seat mounts nothing, and boot is unaffected. A headless profile has no browser consumer; the host half still provides the Remote, whose verb refuses or accepts per its own probe.
- **The selection read is a last-resort DOM anchor**: it reads only `window.getSelection()`'s plain text and rect; if the read itself throws, the fallback is silent disappearance, never a boot failure.
- **Side-chat is a declared optional collaboration**: `dsh.references` declares `@khorsheed/dsh-sidechat` (a data reference, not a dependency); without it the matching menu item hides and everything else works.
- **The chip is a probed degrade**: with `ctx.inputTriggers` absent (no codec carrier) or the insert declined (an old host without the listener, a draft-revision race, a locked phase), the route falls back to the plain-text `> quote` block — same behavior as before; `minHost` is unmoved.
- **The after-send card**: the `uiConversation.userText` registry and the keyed `conversation.user.text.node` seat live on the 0.2.x line; on older hosts a sent message simply keeps its raw wire text (a plain `> ` block) — sending is unaffected.
- **Room sessions**: the room plugin's composer draft IS the official input machine's draft (since 2026-10), so quotes land in the room composer — a chip projects to its text form in the room's plain textarea and flattens on edit (a deliberate degrade). Under an older room plugin the quote writes the invisible official draft instead (it looks like a no-op); upgrading the room plugin fixes it.

## Known Limitations

- **DOM-anchor fragility**: a host redesign can defeat the overlay's judgment — the fallback is silent disappearance. The honest fix is the upstream selection-actions seam, drafted at `docs/upstream-proposals/2026-09-16-selection-actions.md`; this path retires area by area as the seam lands.
- **Quotes are plain-text snapshots**: no link back to the origin position (v1 has no anchor seam); the source annotation only reaches "which chat" granularity (a selection from a canvas card or a file preview is still annotated with the current chat's name — a deliberate best-effort trade-off).
- **Selections inside inputs never trigger** (editing must not fight quoting); code-block/table selections quote as plain text; the menu hides on scroll/resize rather than following (kept simple in v1).
- **No keyboard navigation in the menu**: the overlay is a focus-free toolbar (`role="toolbar"`); keyboard flow is re-evaluated in M2 alongside the upstream seam.
- **Chips are atomic**: the quoted text is not editable character-by-character in the composer (the plain-text fallback path is); Backspace removes a chip whole. A chip left in a draft after uninstalling this plugin blocks the send by host design (delete the chip to recover — text is never silently downgraded).
- **Chips flatten in rooms**: the room composer is a plain textarea — a chip projects to its clipboard text there and flattens to plain text on the first edit.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The injectable selection seam**: `src/client/selection.ts` folds "app-level selection → snapshot" into a small `SelectionSource` interface — the real implementation listens to `selectionchange` (suspended mid-drag, evaluated immediately on mouseup, 120ms-debounced for keyboard selection) and to scroll/resize (hide). Component tests drive a manual source and never touch the real `window.getSelection()`. Classification is a pure function (empty / editable / own menu → null).

**Consumed semantics**: actions run on the captured snapshot, never racing the live selection. The menu closes after an action; the click's own mouseup makes the source re-report the same selection, and that one echo is ignored via a consumed marker — the next distinct selection re-arms the menu.

**Route: current chat**: `formatQuoteBlock` (every line `> `-prefixed, the attribution closing the blockquote) is the canonical text form. On hosts with the reference seam the insert rides the `slash/input-insert-reference` scoped bail event: the chip's `ref` encodes the full clipboard text (blank-line prefix included), and the codec's `serialize`/`clipboardText` decode that same payload, so the model receives exactly what the composer showed; span coordinates speak the detect projection (existing chips fold to one char), and a declined revision CAS re-reads the snapshot and retries once. Without the seam — or after two declines — the route falls back to the `mergedQuoteDraft` plain-text merge: a blank draft is filled directly, a typed draft is appended after one blank line and never overwritten (the message-tools backfill precedent).

**The after-send card**: the `quote-block` user-text rule (`src/client/usertext.ts`) anchors a `> ` line run plus the (either-locale) attribution line at line starts; the node payload is plain JSON `{ label, text }`, and the keyed renderer (`QuoteTextNode`) strips the wire prefixes and re-renders the source row in the current locale. The rule's order 20 follows the official built-ins; no official rule competes at a `>` start.

**Route: side chat**: `remote.quote.addRef({ contextKey, label, ref })` → the host half's `openWith` (the side-chat record holds pending refs, folded into the next send and cleared). The verb carries no calling agent: `openWith` owns no session-scoped write, and the side-chat store fences host-side calls on the deployment default mode (the canvas `askAgent` precedent).

**The action registry**: `ctx.quoteActions` (`src/client/registry.ts`) is provided at the very top of the client apply; registration appends, disposal removes, and the menu subscribes through `useSyncExternalStore`, so hot adds/removals land in the same frame. `list()`'s reference stays stable between mutations, serving directly as the getSnapshot.

**Main-session detection (across host shapes)**: host 0.1.6-alpha.2 retired `SessionListState.current` in favor of the `retainedBy.mainView` count on each summary; the menu probes the count first and falls back to the legacy field, so the npm line and the source line share one code path.

**Identity**: the cordis row id `quote` and `clientBundle('@khorsheed/dsh-quote')` move together.

**Exports**: `/client` exports the plugin body (`apply`/`inject`), `SelectionQuoteMenu`, `QuoteActionRegistryRuntime`, and the registry/selection-seam types; the host export is `QuoteRemoteService`, and the `/types` subpath carries the wire payload types.
</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/quote`). Issues and contributions welcome there.
