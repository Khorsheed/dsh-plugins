# Agent Note: quote reference chips and the after-send quote card

Status: implemented

English | [中文](2026-10-18-quote-reference-chips.zh.md)

## Problem

「引用到当前会话」 inserted the quote as raw `> ` markdown text into the composer draft. Three deficits: the composer showed plain prefixed text while the host's composer is a structured editor with inline reference chips; a sent user message kept the raw wire text (user messages render through a rule scanner, not markdown); and the insert's `setDraft(string)` contract wipes any reference chips the draft already held. In rooms the action additionally looked like a no-op — that half is owned by [the room composer machine-draft note](../architecture/2026-10-18-room-composer-machine-draft.md).

## Decision

**The composer insert is a structured reference chip where the host supports it.** The client registers a headless input-trigger source through a deferred `ctx.inject(['inputTriggers'])` arm — `candidates` never produces a row, the source exists only to carry the `quote` reference codec (`src/client/reference.ts`). The deferred arm matters: mount order between client plugins is unconstrained, and the first shipped cut probed `ctx.get('inputTriggers')` once at apply, which on 3080 raced the service and silently degraded every insert to plain text (caught by live verification after deploy). The same deferred arm registers the userText rule. The insert itself rides the scoped `slash/input-insert-reference` bail event at the end-of-draft span, computed in the detect projection (each existing chip folds to one U+FFFC: `end = draft.length − Σ(occurrence.length − 1)`), guarded by the draft-revision CAS with one fresh-snapshot retry. The chip's `ref` is single-line JSON carrying the full clipboard text — the blank-line separator of a non-blank draft included, so deleting the chip removes it too — and the codec's `serialize`/`clipboardText` decode that same payload, so the model receives exactly what the composer showed. A corrupt ref refuses the send (the host's designed surface) rather than silently downgrading.

**Degrade ladder, probe-first:** no `inputTriggers` service (the arm never fires) → plain text; bail declined twice (old host without the listener, a locked phase, a lost CAS race) → the pre-chip `mergedQuoteDraft` + `setDraft` merge. `minHost` is unmoved.

**After send, the quote renders as a card.** The `quote-block` UserTextRule (`src/client/usertext.ts`, order 20 — no official rule competes at a `>` start) matches a line-start-anchored `> ` run closed by EITHER locale's attribution line, and the keyed `conversation.user.text.node` renderer (`QuoteTextNode`) shows an inline-valid card (span with block presentation): body lines without the wire prefix, plus a source row re-localized to the current locale. A host without the userText seam keeps the raw wire text.

**A chip click opens the full-text preview beside the click.** The host routes a chip's single click (collapsed selection, left button, not a double) to the source's `openReference`; this plugin's source decodes the ref and pushes `{ title, body }` to a preview card on the `shell.overlay` seat. The gesture carries no coordinates, so a capture-phase `pointerdown` record in apply anchors the card to the click (centered-over-composer fallback). The ref payload is self-contained `{ text, label }` — pre-label payloads still decode (the preview just falls back to the generic title). Hover has no official seam — the native tooltip keeps showing the label.

**Rooms needed zero quote code.** Once the room composer's draft lives in the official input machine, both insert paths (chip and plain text) work in rooms unchanged; a chip projects to its clipboard text in the room's plain textarea and flattens on edit — the accepted room-side degradation.

## Alternatives considered

- **A styled dock card above the composer** (`conversation.input.dock`, the QueueDock/GoalBar seat): rejected — the host has no submission-transform seam, so dock-held content cannot join the outgoing message; the card would either duplicate the draft text or reach the model never.
- **The composer attachments rail** (`conversation.input.attachments`): rejected — not plugin-writable through any public face (draft-attachment ids are minted by the package-private controller).
- **Plain text only, keep v1**: rejected — the chip and user-text seams are official and shipped; the fallback keeps old hosts whole, so the richer path costs them nothing.
- **A `roomComposer` service probed by quote** (the original room plan): rejected — superseded by binding the room composer's draft to the machine, which fixed three room defects at once; see the linked note.
- **A richer model-only serialization** (e.g. XML-wrapped quote): rejected — the model text must equal the visible text; the card is a presentation concern.

## Consequences

- The quote reads structured at every stage: inline chip in the composer, styled card in the transcript, unchanged `> ` blockquote on the model wire.
- New documented edges: a chip left in a draft after uninstall blocks that draft's send (codec gone — the host refuses rather than downgrades; delete the chip), and room textareas flatten chips on edit.
- The chip path never calls `setDraft`, so inserting a quote no longer wipes the draft's existing chips; the plain-text fallback keeps its pre-chip (wiping) semantics, reachable only where no chips exist or the seam declined.
- Tests: `reference.spec.ts` pins the span math, the prefix-inside-chip rule, the CAS retry, and the codec's refuse-on-corruption; `usertext.spec.tsx` pins both locales, the `from` contract, and the card rendering. `pnpm --filter @khorsheed/dsh-quote run build && pnpm --filter @khorsheed/dsh-quote test` is green (66 tests).
