/**
 * The quote reference chip path (引用到当前会话's structured form): the quote
 * rides into the composer as a real reference chip on the host's
 * `slash/input-insert-reference` scoped bail event (the ui-input-trigger
 * pipeline's own emitter is the precedent), and serializes back to exactly
 * its visible text at submit through the codec below.
 *
 * Everything here is a STRUCTURAL MIRROR of the host seam — the
 * ui-input-trigger service (`ctx.inputTriggers`) is probed, never imported,
 * so a composition without it degrades to the plain-text path
 * (`mergedQuoteDraft` + `setDraft`), and the chip route additionally falls
 * back whenever the host declines the insert (an old host without the
 * listener, a draft-revision race, a locked phase).
 *
 * @module @khorsheed/dsh-quote/client
 */
import { decodeQuoteRef, encodeQuoteRef, QUOTE_REFERENCE_SOURCE } from '../types.ts'

/** The host's TokenSpan, mirrored (pick-time draft span guarded by the input revision). */
export interface QuoteTokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** The host's ReferenceInsert, mirrored (a structured reference chip). */
export interface QuoteReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly clipboardText: string
}

/** The `slash/input-insert-reference` payload, mirrored. */
export interface QuoteInsertReferenceRequest {
  readonly reference: QuoteReferenceInsert
  readonly span: QuoteTokenSpan
}

/** The scoped bail channel the chip insert rides (the session scope's Context). */
export interface QuoteBailScope {
  bail(self: unknown, event: string, payload: QuoteInsertReferenceRequest): unknown
}

/** The input-machine state slice the chip math needs (occurrences absent on old hosts). */
export interface QuoteInputSnapshot {
  readonly draft: string
  readonly draftRev: number
  readonly occurrences?: readonly { readonly length: number }[]
}

/** The session input face the chip path reads. */
export interface QuoteChipInput {
  readonly state: { getSnapshot(): QuoteInputSnapshot }
}

/**
 * The quote codec: both projections decode the same payload, so the model
 * receives exactly the text the composer showed (chip range → its clipboard
 * text, prefix included). A corrupt ref REFUSES the send (the host surfaces
 * the error and restores the draft) — never a silent downgrade.
 */
export const quoteReferenceCodec = {
  clipboardText: (ref: string): string => decodeQuoteRef(ref) ?? ref,
  serialize: async (ref: string): Promise<string> => {
    const text = decodeQuoteRef(ref)
    if (text === undefined) throw new Error('@khorsheed/dsh-quote: corrupt quote reference chip')
    return text
  },
}

/**
 * The headless trigger source carrying the codec: `candidates` never
 * produces a row, so no menu group ever renders and no adjudication hook
 * participates — the source exists because the submit-time serializer
 * resolves codecs by source name and refuses codec-less references.
 */
export const quoteTriggerSource = {
  trigger: '@',
  name: QUOTE_REFERENCE_SOURCE,
  candidates: async (): Promise<readonly never[]> => [],
  onPick: (): undefined => undefined,
  codec: quoteReferenceCodec,
} as const

/** The `ctx.inputTriggers` slice this plugin probes, mirrored. */
export interface QuoteInputTriggersMirror {
  registerSource(source: typeof quoteTriggerSource): () => void
}

/**
 * Insert the quote as one reference chip at the end of the draft. The span
 * speaks the DETECT projection (each existing chip folds to one U+FFFC) while
 * the published `draft` is the clipboard projection (each chip spans its full
 * `length`), hence the fold in the end coordinate. The blank-line separator
 * of a non-blank draft rides INSIDE the chip's clipboard text, so deleting
 * the chip removes it too.
 *
 * One retry: the span's `draftRev` CAS declines an insert that raced a
 * keystroke, and a fresh snapshot immediately re-arms it.
 *
 * @param scope - the session scope (the bail channel).
 * @param input - the session's input machine face.
 * @param block - the formatted quote block (`formatQuoteBlock` output).
 * @param chipLabel - the chip's inline label (localized).
 * @returns whether the chip landed; false arms the caller's plain-text fallback.
 */
export function insertQuoteChip(scope: QuoteBailScope, input: QuoteChipInput, block: string, chipLabel: string): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = input.state.getSnapshot()
    const folded = (snapshot.occurrences ?? []).reduce((extra, occurrence) => extra + occurrence.length - 1, 0)
    const detectEnd = snapshot.draft.length - folded
    const clipboardText = `${snapshot.draft.trim() === '' ? '' : '\n\n'}${block}`
    const applied = scope.bail(scope, 'slash/input-insert-reference', {
      reference: {
        source: QUOTE_REFERENCE_SOURCE,
        ref: encodeQuoteRef(clipboardText),
        label: chipLabel,
        clipboardText,
      },
      span: { start: detectEnd, end: detectEnd, draftRev: snapshot.draftRev },
    }) === true
    if (applied) return true
  }
  return false
}
