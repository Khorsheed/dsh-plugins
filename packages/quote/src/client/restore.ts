/**
 * Quote blocks that arrive WHOLE in a draft turn back into chips. A sent
 * quote travels as its plain `> ` block (the codec serializes the chip to
 * exactly that text), so anything that writes a sent message back into the
 * composer — a withdrawal's refill, an edit, a paste of a copied message —
 * lands the raw block. This plugin watches the current session's draft and,
 * when a change inserts a complete block in one step, replaces it with the
 * same reference chip 引用到当前会话 would have inserted. Typing never
 * triggers it: the block must lie inside the span ONE change inserted, and
 * keystrokes insert a character at a time.
 *
 * Plugin-local on purpose: whoever refills the draft needs no knowledge of
 * quotes, and the refill path stays plain text everywhere this plugin is
 * absent.
 * @module @khorsheed/dsh-quote/client
 */
import { encodeQuoteRef, excerptOf, QUOTE_REFERENCE_SOURCE } from '../types.ts'
import type { QuoteBailScope, QuoteInputSnapshot } from './reference.ts'
import { parseAttribution, quoteBlockMatcher, unquoteLine } from './usertext.ts'

/** One block to restore: its clipboard span and the chip it becomes. */
export interface ArrivedBlock {
  /** Clipboard-projection start. */
  readonly start: number
  /** Clipboard-projection end (exclusive; the closing newline included when present). */
  readonly end: number
  /** The chip's clipboard text (exactly the replaced span). */
  readonly clipboardText: string
  /** The source label the attribution names, or the quote body's excerpt for a bare quote. */
  readonly label: string
}

/**
 * The quote blocks a single draft change inserted whole: the change is the
 * span between the common prefix and suffix of the two drafts, and a block
 * counts only when it lies entirely inside that span and outside every
 * existing chip.
 * @param previous - the draft before the change (clipboard projection).
 * @param next - the draft after it.
 * @param chips - the machine's chips in `next` (offset + length; absent offsets skip the overlap check).
 * @returns the blocks to restore, in document order.
 */
export function arrivedBlocks(
  previous: string,
  next: string,
  chips: readonly { readonly offset?: number; readonly length: number }[] = [],
): ArrivedBlock[] {
  if (previous === next) return []
  const limit = Math.min(previous.length, next.length)
  let prefix = 0
  while (prefix < limit && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1
  const insertedEnd = next.length - suffix
  if (insertedEnd - prefix < 4) return []

  const blocks: ArrivedBlock[] = []
  const matcher = quoteBlockMatcher()
  for (let match = matcher.exec(next); match !== null; match = matcher.exec(next)) {
    const start = match.index
    const blockEnd = start + match[0].length
    if (start < prefix || blockEnd > insertedEnd) continue
    if (chips.some(chip => chip.offset !== undefined && chip.offset < blockEnd && chip.offset + chip.length > start)) continue
    // The closing newline rides inside the chip (the insert path's shape),
    // so text typed after the chip keeps its own line.
    const end = next[blockEnd] === '\n' ? blockEnd + 1 : blockEnd
    const lines = match[0].split('\n')
    const attribution = parseAttribution(lines[lines.length - 1] ?? '') ?? {}
    const body = lines.slice(0, -1).map(unquoteLine).join('\n')
    blocks.push({
      start,
      end,
      clipboardText: next.slice(start, end),
      label: attribution.label ?? excerptOf(body),
    })
  }
  return blocks
}

/**
 * Replace each arrived block with a quote chip, last first (so earlier
 * coordinates stay valid). Spans speak the detect projection — every
 * existing chip folds to one character — and each insert re-reads the
 * machine for the current revision.
 * @param scope - the session scope (the bail channel).
 * @param read - the input machine's current snapshot.
 * @param blocks - the blocks {@link arrivedBlocks} found in that snapshot's draft.
 * @param chipLabel - the localized chip label for a source label.
 * @returns how many chips landed.
 */
export function restoreQuoteChips(
  scope: QuoteBailScope,
  read: () => QuoteInputSnapshot,
  blocks: readonly ArrivedBlock[],
  chipLabel: (label: string) => string,
): number {
  let restored = 0
  for (const block of [...blocks].reverse()) {
    const snapshot = read()
    const folded = (snapshot.occurrences ?? [])
      .filter(chip => chip.offset !== undefined && chip.offset < block.start)
      .reduce((sum, chip) => sum + chip.length - 1, 0)
    const label = chipLabel(block.label)
    const applied = scope.bail(scope, 'slash/input-insert-reference', {
      reference: {
        source: QUOTE_REFERENCE_SOURCE,
        ref: encodeQuoteRef(block.clipboardText, label),
        label,
        clipboardText: block.clipboardText,
      },
      span: { start: block.start - folded, end: block.end - folded, draftRev: snapshot.draftRev },
    }) === true
    if (applied) restored += 1
  }
  return restored
}
