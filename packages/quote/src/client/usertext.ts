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
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QuoteRefPayload } from '../types.ts'
import { en, zh } from './locales.ts'

/** The quote-block node payload (declaration-merged into the host's UserTextDataMap). */
export interface QuoteTextNodeData {
  /** The source label parsed out of the attribution line (absent on a bare quote). */
  readonly label?: string
  /** The locator parsed out of the attribution line (absolute path, URL), when present. */
  readonly ref?: string
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

/** A template's body as a pattern, each `{slot}` captured. */
const templatePattern = (template: string): string =>
  escapeRe(template).replace('\\{label\\}', '(.+)').replace('\\{ref\\}', '(.+)')

/** One attribution form: its line pattern (no anchors) and how to read its captures. */
interface AttributionForm {
  readonly pattern: string
  readonly read: (match: RegExpExecArray) => { readonly label?: string; readonly ref?: string }
}

/**
 * Every attribution form, per locale — located (label + locator) BEFORE plain
 * so a located line never reads as a label swallowing its locator, then the
 * bare form of a sourceless quote. BOTH locales match: a message quoted under
 * one locale keeps its card after a locale switch.
 */
const FORMS: readonly AttributionForm[] = [zh, en].flatMap(dict => [
  { pattern: templatePattern(dict['quote.attributionAt']), read: m => ({ label: m[1]!, ref: m[2]! }) },
  { pattern: templatePattern(dict['quote.attribution']), read: m => ({ label: m[1]! }) },
  { pattern: escapeRe(dict['quote.attributionBare']), read: () => ({}) },
])

const FORM_LINES = FORMS.map(form => ({ line: new RegExp(`^> ${form.pattern}$`), read: form.read }))

/**
 * Parse one wire line as an attribution: its label/locator, or undefined when
 * the line is not an attribution (an ordinary quoted line).
 */
export function parseAttribution(line: string): { readonly label?: string; readonly ref?: string } | undefined {
  for (const form of FORM_LINES) {
    const match = form.line.exec(line)
    if (match !== null) return form.read(match)
  }
  return undefined
}

/**
 * The block matcher: a run of `> ` lines (each but the last
 * newline-terminated) closed by any attribution line, anchored to a line
 * start by a non-consuming lookbehind so a block beginning exactly at `from`
 * still matches. The closing line is re-parsed by {@link parseAttribution}.
 */
const BLOCK = new RegExp(`(?<=^|\\n)(?:> ?[^\\n]*\\n)*> (?:${FORMS.map(form => form.pattern).join('|')})(?=\\n|$)`, 'g')

/** Strip one wire line's `> ` prefix (`> ` and bare `>` both). */
export const unquoteLine = (line: string): string => line.replace(/^> ?/, '')

/** The chip preview's view data: the label for the title row, the quote body, the click anchor. */
export interface QuotePreviewData {
  /** The chip label (absent on pre-label payloads — the title falls back). */
  readonly title?: string
  /** The quote body: prefix stripped, the attribution line dropped. */
  readonly body: string
  /** The locator the model receives (absolute path, URL), when the quote carries one. */
  readonly location?: string
  /** The click position the card anchors to (absent = centered over the composer). */
  readonly anchor?: { readonly x: number; readonly y: number }
}

/**
 * Fold a decoded chip payload into preview data: drop the blank-line prefix
 * (a non-blank draft's separator) and the closing attribution line (the title
 * carries the source, the location row its locator), and strip every body
 * line's wire prefix.
 */
export function quotePreviewFromRef(decoded: QuoteRefPayload): QuotePreviewData {
  const lines = decoded.text.replace(/^\n+/, '').split('\n')
  const attribution = parseAttribution(lines[lines.length - 1] ?? '')
  return {
    ...decoded.label === undefined ? {} : { title: decoded.label },
    body: (attribution === undefined ? lines : lines.slice(0, -1)).map(unquoteLine).join('\n'),
    ...attribution?.ref === undefined ? {} : { location: attribution.ref },
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
    BLOCK.lastIndex = from
    const match = BLOCK.exec(text)
    if (match === null) return undefined
    const block = match[0]
    const attribution = parseAttribution(block.slice(block.lastIndexOf('\n') + 1)) ?? {}
    return {
      id: 'quote-block',
      start: match.index,
      end: match.index + block.length,
      data: { ...attribution, text: block },
    }
  },
}
