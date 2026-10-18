/**
 * Shared vocabulary of quote-anything (引用任意内容): the Remote wire payloads
 * and the pure helpers both faces share. The plugin knows NOTHING about any
 * quote source's types: a quote is the selected plain text plus a short
 * source label, an opaque chunk — no DOM structure, no anchor back into the
 * origin document.
 *
 * Runtime-agnostic on purpose: no `node:path`, no DOM. Every helper here is
 * pure and unit-tested.
 *
 * @module @khorsheed/dsh-quote/types
 */

/** One opaque quoted chunk: a label for the chip, the text for the model. */
export interface QuoteRef {
  readonly label: string
  readonly text: string
}

/**
 * `addRef` request: queue one opaque ref on the side-chat context bound to
 * `contextKey` (the current conversation's session id, by the plugin's own
 * convention — the side-chat core treats contextKeys as unparsed strings).
 * `label` doubles as the context's display label on a first quote (the
 * source session's display title, mirrored as plain text).
 */
export interface QuoteAddRefRequest {
  readonly contextKey: string
  readonly label?: string
  readonly ref: QuoteRef
}

/** Domain error vocabulary of the `addRef` verb. */
export type QuoteAddRefError =
  /** The side-chat service is not mounted on this host. */
  | 'unavailable'
  /** The contextKey or the quoted text is blank. */
  | 'empty'
  /** The side-chat seam threw (state write failed). */
  | 'io'

/** `addRef` outcome: the ref queued, or the refusal. */
export type QuoteAddRefOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: QuoteAddRefError }

/* ------------------------------------------------------------------ helpers */

/**
 * Format one quote as a markdown block for the composer: every quoted line
 * prefixed `> `, closed by the localized attribution line inside the same
 * blockquote, so the chunk and its source annotation travel as one unit the
 * user can keep editing before send. Structured content (tables, code) is
 * quoted as plain text — no structure restoration (v1).
 * @param text - the selected plain text.
 * @param attribution - the localized attribution line (already rendered).
 * @returns the quote block, without surrounding blank lines.
 */
export function formatQuoteBlock(text: string, attribution: string): string {
  const lines = text.trim().split('\n').map(line => `> ${line}`)
  return [...lines, `> ${attribution}`].join('\n')
}

/**
 * Merge a quote block into the current composer draft: an empty (or blank)
 * draft is filled directly; a non-empty draft gets the block appended after
 * one blank line — the user's in-progress input is never silently
 * overwritten (the message-tools backfill precedent), and the blank line
 * keeps the blockquote detached from the typed paragraph.
 * @param current - the current composer draft.
 * @param block - the formatted quote block.
 * @returns the next draft.
 */
export function mergedQuoteDraft(current: string, block: string): string {
  return current.trim() === '' ? block : `${current}\n\n${block}`
}

/* ------------------------------------------------- the reference chip wire */

/**
 * The trigger-source name the quote reference chips ride (the
 * `slash/input-insert-reference` payload's `source`). The codec carrying it
 * is registered by the client half; a draft holding a chip while the codec
 * is gone refuses to send rather than silently downgrading (the host's
 * designed behavior for codec-less references).
 */
export const QUOTE_REFERENCE_SOURCE = 'quote'

/**
 * Encode the chip's full clipboard text as the opaque `ref` string the
 * editor persists: single-line JSON (`{v, text}`), so the codec can
 * reconstruct the exact model-facing text from the ref alone — the host's
 * `serialize(ref)`/`clipboardText(ref)` receive nothing else. The blank-line
 * prefix (when the quote appended to a non-blank draft) is part of `text`,
 * so deleting the chip removes it too.
 */
export function encodeQuoteRef(clipboardText: string): string {
  return JSON.stringify({ v: 1, text: clipboardText })
}

/** Inverse of {@link encodeQuoteRef}; undefined on any corruption. */
export function decodeQuoteRef(ref: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(ref)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const text = (parsed as { readonly text?: unknown }).text
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}
