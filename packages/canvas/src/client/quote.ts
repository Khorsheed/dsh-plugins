/**
 * The words a card becomes when it is quoted into the main conversation (the
 * 2026-09-27 review: 「与 Agent 对谈」 and 「开始写作」 write into the session's
 * own input instead of priming a side chat).
 *
 * The quote lands in the user's input box, in front of the user, before it
 * reaches any model, so it is written for both readers: a markdown blockquote
 * of the card's words, then an attribution line naming the canvas, the
 * category and the card id, which is the handle the main session's canvas
 * tools take. An HTML card is a pointer, never the document, and a long card
 * is cut with its full length stated rather than dropped silently.
 *
 * The conversation input's `setDraft` REPLACES the whole draft, so the writer
 * read-merges first ({@link mergedDraft}, the same rule the reader and quote
 * packages follow).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { cardTitleOf, detectCardFormat } from '../card-format.ts'
import type { BoardCard } from '../types.ts'
import type {} from './locales.ts'

/** Longest run of one card's words a quote carries (the input box is not a dump). */
export const MAX_QUOTE_CARD_CHARS = 1200

/** Most comments one card's quote carries: the newest ones, like the prompt's thread. */
export const MAX_QUOTE_COMMENTS = 8

/** Prefix every line of a block with `> ` (an empty line keeps the bare marker). */
function blockquote(text: string): string {
  return text.split('\n').map(line => (line.length > 0 ? `> ${line}` : '>')).join('\n')
}

/**
 * One card as a quote block.
 * @param t - the canvas dictionary (the attribution's words follow the UI's language).
 * @param card - the card being quoted.
 * @param where - the canvas's title and the card's category as the board names it.
 * @returns the markdown block.
 */
export function cardQuoteOf(
  t: TranslateNS<'canvas'>,
  card: BoardCard,
  where: { readonly canvasTitle: string; readonly kindLabel: string },
): string {
  const lines: string[] = []
  if (detectCardFormat(card.text) === 'html') {
    lines.push(t('quote.html', { title: cardTitleOf(card.text), count: String(card.text.length) }))
  } else if (card.text.trim().length > 0) {
    const text = card.text.trim()
    lines.push(text.length > MAX_QUOTE_CARD_CHARS
      ? `${text.slice(0, MAX_QUOTE_CARD_CHARS)}…\n${t('quote.truncated', { count: String(text.length) })}`
      : text)
  }
  const strokes = card.draw?.length ?? 0
  if (strokes > 0) lines.push(t('quote.draw', { strokes: String(strokes) }))
  const comments = card.comments.slice(-MAX_QUOTE_COMMENTS)
  for (const comment of comments) {
    lines.push(t('quote.comment', {
      who: comment.author === 'agent' ? t('comment.agent') : t('comment.user'),
      text: comment.text,
    }))
  }
  const attribution = t('quote.source', { canvas: where.canvasTitle, kind: where.kindLabel, id: card.id })
  return `${blockquote(lines.join('\n\n'))}\n\n${attribution}`
}

/**
 * Several cards as one draft block, in the order given.
 * @param t - the canvas dictionary.
 * @param cards - the cards, each with the category name the board shows.
 * @param canvasTitle - the canvas they sit on.
 * @returns the blocks, a blank line apart.
 */
export function cardsQuoteOf(
  t: TranslateNS<'canvas'>,
  cards: readonly { readonly card: BoardCard; readonly kindLabel: string }[],
  canvasTitle: string,
): string {
  return cards.map(({ card, kindLabel }) => cardQuoteOf(t, card, { canvasTitle, kindLabel })).join('\n\n')
}

/**
 * One agent comment as a quote, for 「追问」: the comment is the thing being
 * answered, and its card is named so the agent knows where to reply.
 * @param t - the canvas dictionary.
 * @param text - the comment's words.
 * @param card - the card it hangs on.
 * @param canvasTitle - the canvas the card sits on.
 * @returns the markdown block.
 */
export function commentQuoteOf(t: TranslateNS<'canvas'>, text: string, card: BoardCard, canvasTitle: string): string {
  const title = cardTitleOf(card.text) || card.id
  return `${blockquote(text.trim())}\n\n${t('quote.commentSource', { canvas: canvasTitle, card: title, id: card.id })}`
}

/**
 * Merge a block into the draft as it stands: a non-empty draft keeps its
 * words and gets a blank line before the block.
 * @param draft - the draft as it stands.
 * @param block - the block to append.
 * @returns the draft to write back.
 */
export function mergedDraft(draft: string, block: string): string {
  const kept = draft.replace(/\s+$/, '')
  return kept.length === 0 ? block : `${kept}\n\n${block}`
}
