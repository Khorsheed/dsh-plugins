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
 * One block matcher per attribution locale: a run of `> ` lines (each but the
 * last newline-terminated) closed by the attribution line, anchored to a line
 * start by a non-consuming lookbehind so a block beginning exactly at `from`
 * still matches. The label capture is the attribution template's `{label}`.
 */
const BLOCKS = [zh, en].map(({ 'quote.attribution': attribution }) => {
  const attr = escapeRe(attribution).replace('\\{label\\}', '(.+)')
  return new RegExp(`(?<=^|\\n)((?:> ?[^\\n]*\\n)*> ${attr})(?=\\n|$)`, 'g')
})

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
