/**
 * Card content format detection: whether a card's text is HTML or markdown.
 * Format is deliberately decoupled from card KIND — a reference or document
 * card may carry either, and the renderer picks from the text, never from a
 * flag.
 *
 * The heuristic is CONSERVATIVE by design — it misses real HTML rather than
 * misjudging markdown: inline HTML inside markdown stays markdown (only
 * whole-document or whole-fragment shapes qualify), so a code block full of
 * tags never flips a card into the sandboxed frame.
 *
 * Runtime-agnostic on purpose: no DOM, no node. Every helper here is pure
 * and unit-tested.
 *
 * @module @khorsheed/dsh-canvas
 */
import { documentHeadingOf } from './types.ts'

/** The content formats a card can render as. */
export type CardFormat = 'markdown' | 'html'

/** Longest extracted HTML document title, in code units. */
export const MAX_HTML_TITLE_LENGTH = 80

/**
 * A line-level markdown block marker (heading, list item, quote, fence) —
 * one of these anywhere means markdown wins, whatever the tags look like.
 */
const MD_BLOCK = /(^|\n)\s*(#{1,6}\s|[-*+]\s|>\s|```)/

/** Tags whose mere presence inside markdown prose must not flip the format. */
const INLINE_ONLY_TAGS = /<(code|em|strong|a|span|b|i|u|s|mark|small|sub|sup|kbd|abbr|cite|q)\b/i

/** Decode the few entities an HTML title realistically carries. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * Detect a card text's format. Whole documents (`<!doctype html>`,
 * `<html>`, `<head>`, `<body>` openers) are always HTML; fragments qualify
 * only when they are nothing but markup: they start with `<`, end with `>`,
 * carry at least two open/close tag pairs, hold no line-level markdown block
 * marker, and are not merely inline HTML inside prose. Everything else is
 * markdown.
 * @param text - the card's full text.
 * @returns the format to render with.
 */
export function detectCardFormat(text: string): CardFormat {
  const trimmed = text.trim()
  if (trimmed === '') return 'markdown'
  if (/^<!doctype\s+html[\s>]/i.test(trimmed)) return 'html'
  if (/^<html[\s>]/i.test(trimmed)) return 'html'
  if (/^<(head|body)[\s>]/i.test(trimmed)) return 'html'
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    if (MD_BLOCK.test(trimmed)) return 'markdown'
    if (INLINE_ONLY_TAGS.test(trimmed) && !/<(div|table|ul|ol|p|section|article|figure|video|img|h[1-6])\b/i.test(trimmed)) {
      return 'markdown'
    }
    // Count opening tags that have their close anywhere after them (nested
    // pairs count each — a fragment document is markup all the way down).
    let pairs = 0
    for (const match of trimmed.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
      const tag = match[1]!.toLowerCase()
      if (new RegExp(`</${tag}\\s*>`, 'i').test(trimmed.slice(match.index + match[0].length))) pairs += 1
    }
    if (pairs >= 2) return 'html'
  }
  return 'markdown'
}

/**
 * Extract an HTML document's `<title>` for display (a card's own heading
 * heuristic). Decodes the basic entities and caps the length; absent or
 * empty reads as undefined.
 * @param text - the card's full text.
 * @returns the title, or undefined.
 */
export function htmlTitleOf(text: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)
  if (match === null) return undefined
  const title = decodeEntities(match[1]!.replace(/\s+/g, ' ').trim())
  if (title === '') return undefined
  return title.slice(0, MAX_HTML_TITLE_LENGTH)
}

/** Longest plain-text fallback title (the chip's and the prompt's agree on it). */
export const MAX_PLAIN_TITLE_LENGTH = 36

/**
 * A card's first line with any tags stripped — the fallback title before the
 * length cap. A one-line HTML document's first line IS the markup, and
 * truncating markup would still leak markup, so this strips rather than trusts.
 * @param text - the card's full text.
 * @returns one line of plain text ('' when the card holds none).
 */
export function plainTitleOf(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length > 0) ?? ''
  const stripped = plainInline(firstLine.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
  return stripped === '' ? firstLine : stripped
}

/**
 * One line with its inline markdown marks dropped: emphasis, strikethrough,
 * code spans, links and images keep their words and lose their syntax. A name
 * is plain text (a crumb, a tab, a chip, the model's card list), so `**雨夜**`
 * must read 雨夜 there. Line-level markers (`#`, `-`, `>`) are left alone: they
 * are part of what a non-document card literally says.
 * @param line - one line of markdown.
 * @returns the same line as plain text.
 */
export function plainInline(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * A card's display title, from its text alone: the HTML `<title>` when it has
 * one, else the first plain line, capped.
 *
 * Lives here rather than in the prompt renderer because BOTH sides name a card
 * this way: the model-facing summary, and the detail tab's chip (stage ⑧),
 * which must not drift from what the agent is told the card is.
 * @param text - the card's full text.
 * @returns a single-line title ('' for an empty card).
 */
export function cardTitleOf(text: string): string {
  return htmlTitleOf(text) ?? plainTitleOf(text).slice(0, MAX_PLAIN_TITLE_LENGTH)
}

/**
 * The name a person sees for a card — a tab, a crumb, a source chip. A
 * markdown document is named by its heading, never by its raw `#` line (the
 * board face already does this); anything else by {@link cardTitleOf}.
 * @param card - the card's kind and text.
 * @returns a single-line name ('' for an empty card).
 */
export function cardNameOf(card: { readonly kind: string; readonly text: string }): string {
  if (card.kind === 'document' && detectCardFormat(card.text) !== 'html') {
    const heading = documentHeadingOf(card.text)?.title
    if (heading !== undefined && heading !== '') return plainInline(heading)
  }
  return cardTitleOf(card.text)
}
