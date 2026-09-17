# RSS detail view — copy link + quote a selected passage: the seam that works

Date: 2026-09-17
Author: `quote-seam` (teammate recon, task-3)
Subject: what `@khorsheed/dsh-rss-reader`'s **article detail view** can do with OFFICIAL host APIs
alone for (a) copy the article link and (b) quote a selected passage into the current
conversation, given that it may **not** take a compile-time dependency on
`@khorsheed/dsh-quote` or `@khorsheed/dsh-sidechat`.

Rules of evidence: every claim is a file path + line number + quoted code. Nothing is
paraphrased from an API that was not read. Where no evidence exists the section says **not
found** and prints the search. Read-only: no build, install, test, or edit beyond this file;
`pnpm` was never invoked.

Host line: `0.1.5-rc.1` (`~/code/deepseek-harness`).

---

## 0. The headline

Three facts decide the whole design, and two of them are not what the brief assumed:

1. **`quote` already covers "select text → quote" for the entire app, RSS pane included.**
   `@khorsheed/dsh-quote` mounts a frame-wide selection menu on `shell.overlay`
   (`packages/quote/src/client/index.ts:129-135`) that reads the window selection and offers
   「引用到当前会话」/「引用到侧边对话」/「复制」. Its only selection filter is "not inside an
   editable, not inside my own menu root" — **there is no target-element filter**
   (`packages/quote/src/client/selection.ts:58-71`). So any article text we render as
   non-editable DOM is quotable through it **with zero RSS-side code**, and `quote` **is
   mounted in the prod profile** (verified below).
2. **There is an official, plugin-facing chip seam** — `ctx.inputTriggers.registerSource()` —
   that lets a third-party plugin contribute an `@` menu source whose picks become inline
   reference chips (`~/code/deepseek-harness/packages/client/ui-input-trigger/src/client/service.ts:53`).
   `ui-reference` (host) and `ui-skill` (host) both use it. This is the answer to "can we attach
   a reference rather than plain text": **yes, without `quote` and without `sidechat`.**
3. **The direct chip-insertion path (`insertReference`) is NOT usable from outside the
   conversation package** — it is CAS-guarded on an internal revision that no public hook
   exposes. Plain `setDraft` is the only public *programmatic* draft write. Details in §2/§3.

---

## 1. How the repo's existing "select text → quote" works today

### 1.1 `packages/quote` — the frame-wide selection menu (the shipped implementation)

The one surface is registered on the frame-wide `shell.overlay` seat at ROOT scope:

```ts
// packages/quote/src/client/index.ts:129-135
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'quote-selection',
    order: 160,
    locale: NS,
    inject: face,
  }, SelectionQuoteMenu)), 'quote: selection menu')
```

The selection read is an explicit last-resort DOM anchor, documented as such:

```ts
// packages/quote/src/client/selection.ts:5-14
 * This IS the repo's last-resort DOM anchor (the side-chat M2 probe found no
 * official selection seam), held to the narrowest honest read: the selected
 * PLAIN TEXT and its bounding rect. The one structural judgment is the
 * exclusion the gesture itself requires — a selection inside an editable
 * (input, textarea, contenteditable) is the user's editing, not a quote
 * source, and a selection inside the menu's own root is the user interacting
 * with the menu. ...
```

```ts
// packages/quote/src/client/selection.ts:58-71
export function classifySelection(
  selection: Selection | null,
  own: (node: Node) => boolean,
): SelectionSnapshot | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (text.trim() === '') return null
  const anchor = selection.anchorNode
  if (anchor !== null && (own(anchor) || isEditable(anchor))) return null
  const focus = selection.focusNode
  if (focus !== null && (own(focus) || isEditable(focus))) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return { text, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
}
```

The source is app-level: `selectionchange` (debounced 120 ms), an immediate pass on `mouseup`,
and unconditional hide on scroll/resize (`packages/quote/src/client/selection.ts:91-137`).

**Consequence for RSS:** quote's menu fires on a selection anywhere in the frame, including
text we render in the right-sidebar detail pane. It is **not** scoped to the file surfaces —
"类似文件那样" is not a per-pane mechanism, it is one global gesture that happens to cover
whatever is on screen. There is no opt-in and no per-plugin registration.

### 1.2 The two quote routes, and what each crosses

```ts
// packages/quote/src/client/index.ts:100-109
  // 「引用到当前会话」: the message-tools backfill path — resolve the session's
  // scope, read the live draft, and write the merged one back. Every absence
  // (scope gone, conversation service missing) is a silent no-op.
  const insertQuote = (sessionId: SessionId, block: string): void => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    if (scope === undefined) return
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return
    input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  }
```

The side-chat route goes through **quote's own Remote verb** `addRef`, not through any
side-chat client verb:

```ts
// packages/quote/src/remote.ts:8-14 (module doc)
 * The side-chat Remote (M2 audit) has no client-reachable refs verb: its
 * `send` starts a whole turn and its `quoteMessage` addresses an assistant
 * message by id, while this plugin's quote is arbitrary selected text that
 * must land as a PENDING ref. So the route crosses through this thin face,
 * whose host half probes `ctx.get('sideChat')` and calls `openWith` — the
 * sanctioned host-to-host seam (the canvas `askAgent` precedent), mirrored
 * STRUCTURALLY: the sidechat package is never imported ...
```

I verified that audit independently: sidechat's Remote exposes exactly
`getState / listContexts / surfaceHints / send / quoteMessage`
(`packages/sidechat/src/remote.ts:53,59,65,76,87`) — no refs verb.

### 1.3 INBOUND vs OUTBOUND — the distinction the brief asked for

| Direction | Mechanism | Owner | Evidence |
|---|---|---|---|
| **OUTBOUND** (selection → composer text) | `sessions.scope(id).get('conversation').input.for(scope).setDraft(merged)` | official host service, called by quote | `packages/quote/src/client/index.ts:103-109`; `packages/message-tools/src/client/index.ts:122-133` |
| **OUTBOUND** (selection → side-chat pending ref) | `remote.quote.addRef` → host `ctx.get('sideChat').openWith({refs})` | quote's own Remote + sidechat host service | `packages/quote/src/remote.ts:68-85`; `packages/sidechat/src/service.ts:380-400` |
| **OUTBOUND** (candidate pick → inline chip) | `ctx.inputTriggers.registerSource({trigger:'@', name, candidates, onPick, codec})` | official input-trigger service | host `packages/client/ui-input-trigger/src/client/service.ts:53`; `ui-reference` `src/client/index.ts:116` |
| **INBOUND** (click a file chip/mention in a message → open the file) | `chatFileMentions` wrapper | **not an insertion path** — it routes clicks on already-delivered mentions | `packages/ui-file-preview/src/client/index.ts:139-146`; `packages/ui-file-preview/src/client/mentions-wrap.ts:3-21` |

`ui-file-preview`'s `mentions-wrap.ts` is the inbound half only: it wraps
`chatFileMentions` so a resolved mention opens the preview pane. It creates nothing.

### 1.4 Repo-wide search for a second implementation: none

```
$ grep -rn "getSelection" packages/*/src --include=*.ts --include=*.tsx
packages/mobile/src/client/gestures.ts:19:   (a guard: suppress the gesture while text is selected)
packages/quote/src/client/selection.ts:100:  the only real read
```
No other repo plugin implements in-view selection quoting. Every `writeClipboard` call in the
repo (`local-files`, `worktrees`, `message-tools`, `room`, `ui-file-preview`) is a plain
copy-text button, not a selection→quote flow.

**Host-side search for an official selection seam:**

```
$ grep -rln "getSelection" packages/client/*/src --include=*.ts --include=*.tsx
packages/client/ui-conversation/src/client/input/facade.ts        (editor-internal)
packages/client/ui-conversation/src/client/input/editor/projection.ts
packages/client/ui-model-selection/src/client/ModelSelect.tsx     (input-internal)
packages/client/ui-primitives/src/{HoverCard,Menu}.tsx            (menu dismissal)
packages/client/ui-conversation/src/client/skeleton/InputBar.tsx  (caret handling)
```

**Not found: no official app-level text-selection service or slot.** Every hit is internal to
a widget's own editor/menu. This confirms quote's own comment —
`(the side-chat M2 probe found no official selection seam)` — and means an in-pane affordance
must own its own `window.getSelection()` read.

---

## 2. The official composer insertion path, exactly

### 2.1 Resolving the facade

```ts
// packages/quote/src/client/index.ts:103-108 (the canonical call chain)
const scope = ctx.get('sessions')?.scope(sessionId)
const input = scope.get('conversation')?.input.for(scope)
input.setDraft(...)
```

`SessionInputResolver.for(actx)` takes the **session-scoped context**, and the input machine
lives at `ctx.conversation` on that scope (`packages/message-tools/src/client/index.ts:122-133`
is the same chain with explicit errors).

### 2.2 The draft shape and the ONLY public draft write

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:188-215
export interface SessionInput extends InputTarget {
  /** Replace the whole draft (persisted-draft seed and programmatic writes). */
  setDraft(text: string): void
  /** Append ordered browser-owned attachment ids; busy admission phases refuse. */
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned attachment id; busy admission phases refuse. @returns whether the id was removed. */
  removeAttachment(id: DraftAttachmentId): boolean
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneAttachments(ids: readonly DraftAttachmentId[]): void
  submit(mode?: InputSubmitMode): void
  notify(level: 'info' | 'error', text: string): void
  /** Input state store (InputZone currency + decorations read here). */
  readonly state: SnapshotStore<InputState>
}
```

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:329-333
export interface InputState {
  ...
  readonly draft: string
  ...
  readonly attachmentIds: readonly DraftAttachmentId[]
```

So the read is `input.state.getSnapshot().draft` — a plain `string`, with chips flattened to
their `clipboardText` projection (`packages/client/ui-conversation/src/client/input/editor/projection.ts:156-159`,
`:210`, `:224-225`). `setDraft` **replaces the whole draft**, hence the mandatory read-merge:

```ts
// packages/quote/src/types.ts:74-76
export function mergedQuoteDraft(current: string, block: string): string {
  return current.trim() === '' ? block : `${current}\n\n${block}`
}
```

**There is no `insertText`/`appendText`/`replaceRange` on the public `SessionInput`.** The
scoped events `slash/input-insert-text` / `slash/input-insert-reference`
(`contract/input.ts:157,169`) are *bail events* consumed by the hub's internal listeners — a
plugin could emit them, but the reference variant needs a valid `TokenSpan` (below), and the
text variant is strictly weaker than `setDraft`.

### 2.3 Why the chip path cannot be driven from outside the conversation package

`InputTarget` does expose `insertReference`:

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:181-186
export interface InputTarget {
  /** Replace the trigger span with claim.token and enter claimed (span-CAS'd). */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean
  /** Replace the trigger span with one reference chip (span-CAS'd). */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}
```

and the span type looks harmless:

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:16-21
/** Pick-time draft span guarded by the input revision. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}
```

but the implementation CAS-guards on a **package-private revision**:

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts:494-509
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean {
    const phase = this.core.state.phase
    if (phase !== 'plain' && phase !== 'claimed') return false
    if (span.draftRev !== this.rev) return false
    const tail = this.projection.detectText.slice(span.end, span.end + 1)
    let applied = false
    this.applyEdit(() => {
      const nodes = tail === ' '
        ? [$createReferenceChipNode(ref)]
        : [$createReferenceChipNode(ref), $createTextNode(' ')]
      applied = $replaceDetectSpanWithNodes(span, nodes)
    })
    return applied
  }
```

`this.rev` is a private counter bumped only when the projection's content changes
(`facade.ts:146`, `:230-248`). The only places a correct `draftRev` crosses a boundary are the
`@`-pipeline's own two handoffs — `InputTriggerPick.span` (`ui-input-trigger/src/types.ts:113-122`)
and `ComposerKeyboard.caretSpan()`, which is documented as **package-internal**:

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:249-257
 * The InputBar-exclusive keyboard/DOM command face: ... Handed to the composer-bar entry
 * through its own inject — package-internal, never across a plugin boundary.
```

**Verdict:** a third-party plugin cannot construct a valid `TokenSpan` for a programmatic chip
insert; passing a guessed `draftRev` fails the CAS and silently returns `false`. The supported
chip route is **registering a trigger source** (§3), where the pipeline supplies the span.

---

## 3. Can we attach a REFERENCE (chip) rather than plain text? — YES, via `ctx.inputTriggers`

This is the sanctioned, plugin-facing path, and it needs neither `quote` nor `sidechat`.

### 3.1 The service and its registration verb

```ts
// deepseek-harness/packages/client/ui-input-trigger/src/client/service.ts:53-58
  registerSource(src: InputTriggerSource): () => void {
    const { live } = this
    if (live.sources.some(s => s.trigger === src.trigger && s.name === src.name)) {
      throw new Error(`slash source "${src.trigger}${src.name}" is already registered`)
    }
    live.sources.push(src)
```

It is `ctx.inputTriggers`, and the host does not require `inject` for it — the shipped
`ui-reference` probed it:

```ts
// deepseek-harness/packages/client/ui-reference/src/client/index.ts:116-117
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-reference: @ source')
```

`InputTriggerServiceContract` is exported from the package's client entry
(`packages/client/ui-input-trigger/src/client/index.ts:32`), and the service IS mounted in the
web profile:

```yaml
# deepseek-harness/packages/bundle/web-app/cordis.patch.yml:288-289
    - id: ui-input-trigger
      name: '@deepseek-ai/dsh-client-ui-input-trigger'
```
(`@deepseek-ai/dsh-client-ui-input-trigger` is also a real dependency of `bundle/web-app`:
`packages/bundle/web-app/package.json:67`. `dsh-web-app` is bundles[1] of the prod profile.)

### 3.2 What a source must supply for a chip

```ts
// deepseek-harness/packages/client/ui-input-trigger/src/types.ts:131-139
export interface ReferenceCodec {
  /** Clipboard / persistence projection of one reference (e.g. `/name`). */
  clipboardText(ref: string): string
  /** Model serialization of one reference (e.g. `<skill>name</skill>`). */
  serialize(ref: string, signal: AbortSignal): Promise<string>
}
```

```ts
// deepseek-harness/packages/client/ui-input-trigger/src/types.ts:166-180 (pick payload)
export interface InputTriggerPick {
  readonly candidate: InputTriggerCandidate
  readonly session: ClientSessionContext
  readonly position: TriggerPosition
  readonly via: PickVia
  readonly action: PickAction
  /** Settling pick, or the candidate's drill action (Tab / row chevron). */
  readonly span: TokenSpan
  ...
```

and the pick returns the chip payload:

```ts
// deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts:59-66
/** Structured reference inserted by an input-trigger source. */
export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}
```

The host's own `@` source is the minimal worked example — note `codec.serialize` returning the
ref itself for a plain mention:

```ts
// deepseek-harness/packages/client/ui-reference/src/client/index.ts:80-113 (abridged)
      if (value?.kind === 'file') {
        ...
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.fileKind === 'directory' ? `${value.label}/` : value.label,
            appearance: value.fileKind === 'directory' ? 'folder' : 'file',
            clipboardText: value.mention,
          },
        }
      }
      ...
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
```

### 3.3 The honest limits of the chip route

- **The glyph vocabulary is closed:** `ReferenceIconKind = 'session' | 'file' | 'folder'`
  (`packages/client/ui-primitives/src/ReferenceIcon.tsx:7`). An RSS chip must borrow one of
  those three (or omit `appearance`, which renders a literal `@` marker:
  `ReferenceChip.tsx:29-36`). There is no RSS/publisher glyph.
- **It is a composer-driven gesture, not a pane-driven one.** The user types `@`, sees the RSS
  group in the menu, picks an entry → a chip lands. It cannot be triggered by selecting text in
  our detail pane; the pane would have to write an `@` token into the draft for the pipeline to
  find. Chaining "user selects a passage → we insert `@` → a menu opens" is a **2-step
  interaction with a moving user intent** and I would not ship it as the primary affordance.
- **`serialize` failure blocks the send** ("failure blocks the send — never a silent downgrade
  to the clipboard text", `types.ts:126-129`). An RSS codec must be total and must not fetch:
  resolve the entry from the plugin's own client store and return text; on a miss, return a
  plain-text fallback rather than rejecting.
- The repo's independence rule is satisfied: the trigger service is an **official host
  package**, not a sibling plugin. This is the same class of edge as quoting's
  `@deepseek-ai/dsh-client-ui-layout` peer for `shell.overlay`.

---

## 4. Clipboard — the official helper

```ts
// deepseek-harness/packages/client/ui-primitives/src/clipboard.ts:11-23
export async function writeClipboard(text: string): Promise<boolean> {
  // lib.dom types clipboard non-optional, but insecure contexts omit it —
  // that runtime gap is exactly what this guard detects.
  /* oxlint-disable-next-line typescript/no-unnecessary-condition */
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied permissions / iframe policy — do not claim success.
      return false
    }
  }
```

Degradation: `execCommand('copy')` best-effort when the async API is missing
(`clipboard.ts:24-46`), else `false` — **it never throws**, so callers show their own success
state. Repo precedent for calling it and rendering the outcome:

```ts
// packages/quote/src/client/index.ts:123
    copyText: writeClipboard,
```
```ts
// packages/ui-file-preview/src/client/index.ts:27,210
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
...
      copyPath: (path: string) => writeClipboard(resolveWorkspacePath(sessionCwd(sessionId), path)),
```

**This is a pure official-API path: no `quote`, no `sidechat`, no extra peer dependency** —
`@deepseek-ai/dsh-client-ui-primitives` is already in the RSS package's `dsh.client.inject`
list and peerDependencies.

---

## 5. Selection mechanics in shipped code — and the positioning recipe

**Found, exactly one implementation:** `packages/quote`. The recipe to copy:

- **The read** — `classifySelection(selection, own)` (`selection.ts:58-71`, quoted in §1.1):
  reject collapsed/blank, reject selections whose anchor OR focus is inside
  `input, textarea, [contenteditable]:not([contenteditable="false"])`, reject selections inside
  our own menu root, then capture `{text, rect: getRangeAt(0).getBoundingClientRect()}`.
- **The wiring** — `createSelectionSource(win)` (`selection.ts:91-137`): listen
  `selectionchange` (debounced `SETTLE_MS = 120`, skipped mid-drag), an immediate pass on
  `mouseup` via `setTimeout(…, 0)` because "the selection settles after the mouseup handlers —
  read next tick", and hide on `scroll`/`resize` because "the cached viewport rect is stale".
  The teardown removes every listener; the source is created per registration with
  `createSelectionSource(window)` (`index.ts:112`).
- **The own-root exclusion** — the component attaches its own root through `attachRoot`
  (`SelectionMenu.tsx:70-75`), so clicking a menu button never re-arms the menu.
- **The consumed-echo filter** — acting on a snapshot marks it consumed and ignores the one
  re-report the click's own `mouseup` produces (`SelectionMenu.tsx:58-66`, `:93-97`). Without
  this the menu reopens on every click.
- **The affordance** — a floating `position: fixed` card: `z-index: 1100`,
  `background: var(--dsw-specific-menu)`, `border-radius: 16px`,
  `box-shadow: var(--dsw-elevation-prominent)`, `user-select: none`, `pointer-events: auto`
  (`SelectionMenu.module.css:5-20`). Two-pass placement: render `visibility: hidden`, measure
  `offsetWidth/offsetHeight`, then clamp to an 8 px viewport margin, centered on the selection
  and flipped below when there is no room above (`SelectionMenu.tsx:79-89`).
- **The testability seam** — the source is injected, so component tests drive snapshots
  directly and "never touch the real `window.getSelection()`" (`contract.ts:8-11`); the real
  source has an `attachRoot` and a test's manual source simply does not
  (`SelectionMenu.tsx:68-75`).

**Not found: a host-provided selection affordance or slot.** Searches run:
`grep -rn "getSelection" packages/client/*/src`; `grep -rn "selectionchange" packages/client/*/src`;
`grep -rn "Selection" packages/client/ui-slots/src packages/client/ui-layout/src`. Every hit is
widget-internal. So an in-pane menu means owning ~140 lines of read/wiring plus ~60 lines of
menu — which is exactly what `quote` owns today, and why duplicating it has a real cost.

---

## 6. Degrade path, and the recommendation

### 6.1 Degradation matrix for the RSS detail view

| Capability | Needs | Absent → |
|---|---|---|
| Copy article link / copy a passage | `writeClipboard` (official primitives) | returns `false`; show a "copy failed" state, never throw |
| Quote a passage → current conversation (plain text) | `sessions` + `conversation` input machine (official) | no scope / no conversation ⇒ silent no-op (`quote`'s own contract) |
| Quote whole entry → current conversation | same as above | same |
| Attach a chip for an entry | `ctx.inputTriggers` + our `@` source (official) | no service ⇒ register nothing; gesture absent |
| Send a ref to side chat | **`sideChat` host service** (ours, probed) or quote's `addRef` | button hidden; nothing to degrade to |
| Frame-wide menu over our article text | `@khorsheed/dsh-quote` installed | gesture absent; our in-pane menu still works |

### 6.2 Recommendation — the calls the RSS detail view should make

**(1) Copy link — plain official, zero optional plugins.**
```ts
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
await writeClipboard(entry.link)   // never throws; render the boolean outcome
```

**(2) Quote a selected passage → current conversation — plain official, zero optional plugins.**
The only reliable programmatic draft write is `setDraft` (the chip path is unreachable from
outside, §2.3). Implement **our own in-pane floating menu** (copy quote's `classifySelection` +
`createSelectionSource` + placement recipe, §5 — ~200 lines, all repo-owned), and on click:
```ts
const scope = ctx.get('sessions')?.scope(sessionId)
const input = scope?.get('conversation')?.input.for(scope)
if (input === undefined) return                    // silent no-op, quote's contract
input.setDraft(mergeDraft(input.state.getSnapshot().draft, block))
```
with `block` = `` > ``-prefixed lines + an attribution line carrying the entry title and link,
and `mergeDraft` = the 3-line blank-line append (`quote/src/types.ts:74-76`, reimplemented in
20 lines rather than imported — no compile-time edge on `quote`).

**(3) Whole-entry quote — identical machinery, no selection required.** Same
`setDraft`-with-merge call, block built from the entry's title/link/summary. Zero optional
plugins. This is also the natural action-row button on a **card**, while (2) is the
selection-triggered affordance in the **detail** view.

**(4) Send to side chat — the only path that needs another plugin to be present, and it must
not be a compile-time edge.** Two options, both structural:
- *Preferred, self-contained:* give RSS its own host-side probe of
  `ctx.get('sideChat')` and call
  `openWith({contextKey: sessionId, label, refs: [{label, text}]})`
  (`packages/sidechat/src/service.ts:380-400`; `SideChatOpenInput` at
  `packages/sidechat/src/types.ts:35-50`; `SideChatRef = {label, text}` at `:17-20`, capped at
  `MAX_REFS_PER_CONTEXT = 20`). Declared in `dsh.references`, mirrored structurally, never
  imported. This is what quote does, minus the extra hop.
- *Alternative:* call quote's shipped verb `remote.quote.addRef({contextKey, label, ref:{label,text}})`
  (`packages/quote/src/remote.ts:73-85`) via `ctx.get('remote.quote')` with a mirrored type —
  fewer lines, but it makes RSS's side-chat feature **dependent on quote being installed**,
  which the brief wants to avoid. Use only if the team prefers not to own the probe.

In both cases the button hides when the capability probe fails, exactly as quote's
`sideChatAvailable()` does (`packages/quote/src/client/index.ts:96-98`).

### 6.3 What I recommend AGAINST

- **Do not duplicate the frame-wide menu's routes as a second global overlay.** If `quote` is
  installed (it is, in the prod profile), the user already gets select→quote over our article
  text. A second overlay would mean two menus for one selection.
- **Do not build the chip route as the primary "quote a passage" gesture** (§3.3): it is
  composer-driven, the glyph set is closed, and serialization failure blocks the send.
- **Do not emit `slash/input-insert-reference` directly** — it needs a `draftRev` we cannot
  obtain (§2.3).

### 6.4 Recommendation on emitting engine affordances

For the "select a passage" gesture the detail view should render article text as plain,
selectable, non-editable DOM (`<p>`/`<blockquote>`, no `contenteditable`) so that (a) the
frame-wide `quote` menu covers it for free when installed, and (b) our in-pane menu (2) is the
independent path when it is not. Both routes can coexist for the same selection; the in-pane
one is scoped to our pane root, so the two menus differ in where they anchor.

---

## 7. Uncertainties (stated, not guessed)

1. **Two overlapping menus.** I verified there is no opt-out API on `quote`'s selection source
   (it excludes only editables and its own root, `selection.ts:45-48`, `:93`). I did **not**
   run the app, so I cannot state how the two menus visually interact when both are present —
   only that both will mount and both will respond to the same selection. This is a UX decision
   for the team, not a code fact I can settle by reading.
2. **`ui-skill`'s source on `@`** proves multiple sources on one trigger coexist
   (`service.ts:96` filters by trigger and sorts by `order`), but I did not read ui-skill's
   source end-to-end, so I have not verified group-ordering behavior in the menu.
3. **`serialize` rejection semantics** are documented ("failure blocks the send") but I did not
   read the submit attempt's call site, so I cannot say what the user sees on failure.
4. **The `@`-sourced chip inside a *sent* message** renders through whatever codec the source
   registered; I did not trace how a sent chip is re-rendered in the transcript (only that
   chips carry `source`/`ref`/`label`/`clipboardText` and a `codec` is consulted per occurrence).
5. **RSS package manifest work** if the chip route is chosen: `@deepseek-ai/dsh-client-ui-input-trigger`
   must be added to `dsh.client.inject` and peerDependencies — I did not check that package's
   export map beyond the root `./client` entry used by `bundle/web-app`.
