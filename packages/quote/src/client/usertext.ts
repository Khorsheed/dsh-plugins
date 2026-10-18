/**
 * The transcript half of quote-anything: a UserTextRule matching the quote
 * block's wire form — a `> ` line run closed by the localized attribution —
 * in SENT user messages, so the block renders as a styled card through the
 * keyed `conversation.user.text.node` slot instead of raw text. BOTH locale
 * attributions match: a message quoted under one locale keeps its card after
 * a locale switch. The rule reads the text alone (no Facts), so it works
 * under every caller's fact set.
 *
 * @module @khorsheed/dsh-quote/client
 */
import type { UserTextNode, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QuoteRefPayload } from '../types.ts'
import { en, zh } from './locales.ts'

/** The quote-block node payload (declaration-merged into the host's UserTextDataMap). */
export interface QuoteTextNodeData {
  /** The source label parsed out of the attribution line. */
  readonly label: string
  /** The full matched block (the `> `-prefixed lines, attribution line included). */
  readonly text: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** One quote-anything block in a user message (the styled card). */
    'quote-block': QuoteTextNodeData
  }
}

const escapeRe = (source: string): string => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One full-line attribution matcher per locale (`> ` + the template, the
 * `{label}` slot captured). Shared by the block rule below and the chip
 * preview's body/attribution split.
 */
export const ATTRIBUTION_LINES: readonly RegExp[] = [zh, en].map(({ 'quote.attribution': attribution }) =>
  new RegExp(`^> ${escapeRe(attribution).replace('\\{label\\}', '(.+)')}$`))

/**
 * One block matcher per attribution locale: a run of `> ` lines (each but the
 * last newline-terminated) closed by the attribution line, anchored to a line
 * start by a non-consuming lookbehind so a block beginning exactly at `from`
 * still matches. The label capture is the attribution template's `{label}`.
 */
const BLOCKS = ATTRIBUTION_LINES.map(line =>
  new RegExp(`(?<=^|\\n)((?:> ?[^\\n]*\\n)*${line.source.slice(1, -1)})(?=\\n|$)`, 'g'))

/** Strip one wire line's `> ` prefix (`> ` and bare `>` both). */
export const unquoteLine = (line: string): string => line.replace(/^> ?/, '')

/** The chip preview's view data: the label for the title row, the quote body, the click anchor. */
export interface QuotePreviewData {
  /** The chip label (absent on pre-label payloads — the title falls back). */
  readonly title?: string
  /** The quote body: prefix stripped, the attribution line dropped. */
  readonly body: string
  /** The click position the card anchors to (absent = centered over the composer). */
  readonly anchor?: { readonly x: number; readonly y: number }
}

/**
 * Fold a decoded chip payload into preview data: drop the blank-line prefix
 * (a non-blank draft's separator) and the closing attribution line (the title
 * carries the source), and strip every body line's wire prefix.
 */
export function quotePreviewFromRef(decoded: QuoteRefPayload): QuotePreviewData {
  const lines = decoded.text.replace(/^\n+/, '').split('\n')
  const last = lines[lines.length - 1] ?? ''
  const attributed = ATTRIBUTION_LINES.some(line => line.test(last))
  return {
    ...decoded.label === undefined ? {} : { title: decoded.label },
    body: (attributed ? lines.slice(0, -1) : lines).map(unquoteLine).join('\n'),
  }
}

/**
 * The quote-block rule. Order 20 sits after the built-ins (the session
 * reference at 10): no same-start competition exists — a quote block opens
 * with `>`, which no official rule matches — and consuming the whole block
 * keeps an `@` token inside a quote from splitting it.
 */
export const quoteTextRule: UserTextRule<'quote-block'> = {
  id: 'quote-block',
  order: 20,
  match(text, from) {
    let best: UserTextNode<'quote-block'> | undefined
    for (const block of BLOCKS) {
      block.lastIndex = from
      const match = block.exec(text)
      if (match === null) continue
      const node: UserTextNode<'quote-block'> = {
        id: 'quote-block',
        start: match.index,
        end: match.index + match[0].length,
        data: { label: match[2]!, text: match[1]! },
      }
      if (best === undefined || node.start < best.start) best = node
    }
    return best
  },
}
