/**
 * The quote-block transcript card (`conversation.user.text.node`, key
 * 'quote-block'): the styled rendering of a quote-anything block in a sent
 * user message. The UserText pipeline renders nodes inside an inline span,
 * so the card is a span with block presentation — valid inline content.
 *
 * @module @khorsheed/dsh-quote/client
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this plugin's UserTextDataMap merge ('quote-block').
import type {} from './usertext.ts'
import type {} from './locales.ts'
import css from './QuoteTextNode.module.css'

/** Full props of the 'quote-block' keyed user-text node renderer. */
export type QuoteTextNodeProps =
  PropsRuntime<'conversation.user.text.node', 'quote-block'>
  & PropsLocale<'quote'>

/** Strip one wire line's `> ` prefix (`> ` and bare `>` both). */
const unquote = (line: string): string => line.replace(/^> ?/, '')

/** The quote-block transcript card. */
export function QuoteTextNode({ node, t }: QuoteTextNodeProps): ReactNode {
  const lines = node.data.text.split('\n')
  // The attribution line closes the wire block; the card renders the source
  // row itself, localized to the CURRENT locale (the wire line keeps the
  // insertion-time locale).
  const body = lines.slice(0, -1).map(unquote).join('\n')
  return (
    <span className={css.quote}>
      <span className={css.body}>{body}</span>
      <span className={css.source}>{t('card.source', { label: node.data.label })}</span>
    </span>
  )
}
