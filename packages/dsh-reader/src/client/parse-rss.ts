/**
 * Feed parsing for the browser half: RSS 2.0 / Atom → {@link ReaderEntry}.
 *
 * The host half never parses (its runtime has no XML parser at all), so this
 * module is the single owner of the feed vocabulary. It runs against the raw
 * payload the host already stored, which means re-reading a feed costs no
 * network call.
 *
 * Namespaces are matched by LOCAL name, never by prefix: publishers migrated
 * from `content:encoded` to `media:description` to a bare `content` across RSS
 * and Atom without ever agreeing on a prefix, and matching the local name is
 * what lets one reader handle all of them.
 *
 * @module @khorsheed/dsh-reader/client/parse-rss
 */
import {
  stableEntryId,
  summarize,
  type ReaderEntry,
} from '../types.ts'
import { normalizeRichText } from './extract-article.ts'

/** A parsed feed: its own metadata plus one entry per item. */
export interface ParsedFeed {
  /** Feed-level title, when it declares one. */
  readonly title?: string
  /** Feed-declared icon (the publisher's own asset), when present. */
  readonly icon?: string
  readonly entries: readonly ReaderEntry[]
}

/** The two ways a payload can fail to be a feed. */
export type ParseFeedResult =
  | { readonly ok: true; readonly feed: ParsedFeed }
  | { readonly ok: false; readonly error: string }

/** Element local-names that may carry an entry's full body, best first. */
const CONTENT_TAGS = ['encoded', 'content'] as const

/** Element local-names that may carry a short description, best first. */
const SUMMARY_TAGS = ['description', 'summary'] as const

/** Date element local-names, best first. */
const DATE_TAGS = ['pubDate', 'published', 'updated', 'date'] as const

/**
 * Parse one feed payload.
 *
 * A malformed document, a document cut off mid-tag by a size cap, and an HTML
 * error page all arrive here as "not a feed" and are reported as such, never
 * thrown: the caller decides whether to surface or retry.
 *
 * @param raw - the raw payload the host stored for an RSS source.
 * @param sourceId - the source these entries belong to.
 * @returns the parsed feed, or the reason it could not be parsed.
 */
export function parseFeed(raw: string, sourceId: string): ParseFeedResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, error: 'empty payload' }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  } catch (error: unknown) {
    return { ok: false, error: `not parseable as XML: ${errorMessage(error)}` }
  }

  // A `parsererror` element is how DOMParser reports every malformed document —
  // including the one a reader meets most often, a payload cut off mid-tag.
  const parseError = doc.querySelector('parsererror')
  if (parseError !== null) {
    return { ok: false, error: `malformed XML: ${truncate(collapse(parseError.textContent ?? ''), 160)}` }
  }

  const root = doc.documentElement
  if (root === null) return { ok: false, error: 'no document element' }
  const rootName = root.localName.toLowerCase()

  if (rootName === 'rss' || rootName === 'rdf') return parseRssDocument(doc, sourceId)
  if (rootName === 'feed') return parseAtomDocument(doc, sourceId)
  return { ok: false, error: `unsupported root element <${rootName}>` }
}

/**
 * Parse an RSS 2.0 (or RSS 1.0 / RDF) document.
 * @param doc - the parsed document.
 * @param sourceId - owning source id.
 * @returns the feed result.
 */
function parseRssDocument(doc: Document, sourceId: string): ParseFeedResult {
  const channel = doc.querySelector('channel') ?? doc.documentElement
  const entries: ReaderEntry[] = []
  for (const item of Array.from(doc.querySelectorAll('item'))) {
    const entry = readEntry(item, sourceId)
    if (entry !== undefined) entries.push(entry)
  }
  return {
    ok: true,
    feed: {
      ...present('title', elementText(child(channel, 'title'))),
      ...present('icon', channelIcon(channel)),
      entries,
    },
  }
}

/**
 * Parse an Atom document.
 * @param doc - the parsed document.
 * @param sourceId - owning source id.
 * @returns the feed result.
 */
function parseAtomDocument(doc: Document, sourceId: string): ParseFeedResult {
  const feed = doc.documentElement
  const entries: ReaderEntry[] = []
  for (const node of Array.from(feed.getElementsByTagName('entry'))) {
    const entry = readEntry(node, sourceId)
    if (entry !== undefined) entries.push(entry)
  }
  return {
    ok: true,
    feed: {
      ...present('title', elementText(child(feed, 'title'))),
      ...present('icon', elementText(child(feed, 'icon')) ?? elementText(child(feed, 'logo'))),
      entries,
    },
  }
}

/**
 * Read one `<item>` / `<entry>` element.
 *
 * Both dialects differ only in where they put the link and what they call the
 * date, so one reader handles both.
 *
 * @param element - the item or entry element.
 * @param sourceId - owning source id.
 * @returns the entry, or `undefined` when the element carries no title or link.
 */
function readEntry(element: Element, sourceId: string): ReaderEntry | undefined {
  const title = elementText(child(element, 'title'))
  const link = resolveLink(element)
  const displayTitle = title ?? link
  if (displayTitle === undefined) return undefined

  const guid = elementText(child(element, 'id')) ?? elementText(child(element, 'guid'))
  const body = bestBody(element)
  const summary = bestSummary(element) ?? body

  const id = stableEntryId({
    title: displayTitle,
    ...(link !== undefined ? { link } : {}),
    ...(guid !== undefined ? { guid } : {}),
  })
  const tags = readTags(element)
  const author = readAuthor(element)

  return {
    id,
    sourceId,
    title: displayTitle,
    ...present('link', link),
    ...present('author', author),
    ...present('publishedAt', readDate(element)),
    ...(tags.length > 0 ? { tags } : {}),
    ...present('summary', summarize(summary, 320)),
    ...present('contentHtml', body),
  }
}

/**
 * The best available body for the detail view.
 *
 * `content:encoded` / `content` win when present. When a feed ships only a
 * description, that description IS the body the reader has — treating it as
 * body-only would leave the detail view empty for every feed that does not
 * publish full text, which is most of them.
 */
function bestBody(element: Element): string | undefined {
  for (const name of [...CONTENT_TAGS, ...SUMMARY_TAGS]) {
    const raw = firstDescendantText(element, name)
    if (raw === undefined) continue
    const normalized = normalizeRichText(decodeEntities(raw))
    if (normalized.length > 0) return normalized
  }
  return undefined
}

/** The best available short description as plain text. */
function bestSummary(element: Element): string | undefined {
  for (const name of SUMMARY_TAGS) {
    const raw = firstDescendantText(element, name)
    if (raw === undefined) continue
    const text = stripTags(decodeEntities(raw))
    if (text.length > 0) return text
  }
  return undefined
}

/** Feed-level icon: RSS `<image><url>`, Atom `<icon>`. */
function channelIcon(channel: Element | null): string | undefined {
  if (channel === null) return undefined
  const image = child(channel, 'image')
  const candidates = [
    image === null ? undefined : elementText(child(image, 'url')),
    elementText(child(channel, 'icon')),
    elementText(child(channel, 'logo')),
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && /^https?:\/\//i.test(candidate)) return candidate
  }
  return undefined
}

/** The publication date, trying the names both dialects use. */
function readDate(element: Element): string | undefined {
  for (const name of DATE_TAGS) {
    const text = elementText(child(element, name)) ?? firstDescendantText(element, name.toLowerCase())
    if (text === undefined) continue
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return undefined
}

/** Author name: Atom `<author><name>` or RSS `<author>` / `<dc:creator>`. */
function readAuthor(element: Element): string | undefined {
  const author = child(element, 'author')
  const nested = author === null ? undefined : elementText(child(author, 'name'))
  const direct = elementText(author)
  return nested ?? firstDescendantText(element, 'creator') ?? direct
}

/** Category text: RSS `<category>`, Atom `<category term="…">`. */
function readTags(element: Element): readonly string[] {
  const tags: string[] = []
  for (const node of Array.from(element.children)) {
    if (node.localName !== 'category') continue
    const value = (node.getAttribute('term') ?? node.textContent ?? '').trim()
    if (value.length > 0 && !tags.includes(value)) tags.push(value)
  }
  return tags
}

/**
 * Resolve an entry link. Atom keeps it in a `href` attribute (with `rel`
 * selecting the readable one); RSS keeps it in element text; a permalink
 * `guid` is the last resort.
 */
function resolveLink(element: Element): string | undefined {
  const anchors = Array.from(element.children).filter(node => node.localName === 'link')
  const preferred = anchors.find(node => node.getAttribute('rel') === 'alternate')
    ?? anchors.find(node => node.getAttribute('rel') === null)
    ?? anchors[0]
  const href = preferred?.getAttribute('href')?.trim()
  if (href !== undefined && href.length > 0) return href
  const text = elementText(preferred ?? null)
  if (text !== undefined) return text

  const guid = child(element, 'guid')
  if (guid?.getAttribute('isPermaLink') === 'false') return undefined
  const guidText = elementText(guid)
  return guidText !== undefined && /^https?:\/\//i.test(guidText) ? guidText : undefined
}

/** A direct child by local name (namespace prefixes ignored). */
function child(element: Element | null, localName: string): Element | null {
  if (element === null) return null
  for (const node of Array.from(element.children)) {
    if (node.localName === localName) return node
  }
  return null
}

/** The text of the nearest descendant with this local name. */
function firstDescendantText(element: Element, localName: string): string | undefined {
  const direct = child(element, localName)
  if (direct !== null) return elementText(direct)
  for (const node of Array.from(element.getElementsByTagName('*'))) {
    if (node.localName === localName) return elementText(node)
  }
  return undefined
}

/** Element text with whitespace collapsed, or `undefined` when empty. */
function elementText(element: Element | null | undefined): string | undefined {
  const text = collapse(element?.textContent ?? '')
  return text.length > 0 ? text : undefined
}

/**
 * Decode the entity subset feeds actually use, in ONE left-to-right pass, then
 * apply a second pass only when the result still looks like escaped markup.
 *
 * The single pass matters: `&amp;lt;` means the literal text `&lt;`, so a chain
 * of blanket replaces (or repeated decoding) would turn it into `<` and then
 * into a tag. Scanning left to right and consuming `&amp;` first keeps `&lt;`,
 * which is exactly what a publisher who escaped their markup twice intended.
 *
 * @param input - raw element text.
 * @returns decoded text.
 */
export function decodeEntities(input: string): string {
  const once = decodeOnce(input)
  // A second pass is only justified when the once-decoded text contains a
  // COMPLETE escaped element — an opening tag and its matching close. That is
  // what a publisher who escaped their whole body twice produces, and requiring
  // the pair is what keeps two other texts intact: `&amp;lt;` (the literal
  // `&lt;`, which the publisher escaped deliberately) and a lone `&lt;b&gt;`
  // (a single tag meant as text).
  if (/&lt;([a-z][a-z0-9]*)[^<]*&gt;[\s\S]*&lt;\/\1\s*&gt;/i.test(once)) return decodeOnce(once)
  return once
}

/** The named entities feeds use, mapped to their replacement. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

/** One decoding pass: scan left to right, consuming the longest match first. */
function decodeOnce(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('&', index)
    if (start === -1) {
      out += text.slice(index)
      break
    }
    out += text.slice(index, start)
    const end = text.indexOf(';', start + 1)
    // A `&` with no terminator, or one absurdly far away, is literal text.
    if (end === -1 || end - start > 12) {
      out += '&'
      index = start + 1
      continue
    }
    const body = text.slice(start + 1, end)
    const replacement = replacementFor(body)
    if (replacement === undefined) {
      out += text.slice(start, end + 1)
    } else {
      out += replacement
    }
    index = end + 1
  }
  return out
}

/** The replacement for one entity body, or `undefined` when it is not an entity. */
function replacementFor(body: string): string | undefined {
  const lower = body.toLowerCase()
  const named = NAMED_ENTITIES[lower]
  if (named !== undefined) return named
  const hex = /^#x([0-9a-f]+)$/i.exec(body)
  if (hex !== null) return codePoint(Number.parseInt(hex[1] ?? '', 16))
  const dec = /^#(\d+)$/.exec(body)
  if (dec !== null) return codePoint(Number.parseInt(dec[1] ?? '', 10))
  return undefined
}

/** A code point as a character, ignoring invalid and surrogate values. */
function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return ''
  if (value >= 0xd800 && value <= 0xdfff) return ''
  return String.fromCodePoint(value)
}

/** Strip tags to plain text (used for summaries, where markup is unwanted). */
function stripTags(html: string): string {
  return collapse(html.replace(/<[^>]*>/g, ' '))
}

/** Collapse whitespace and trim. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Truncate for an error message only. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/** Coerce an unknown thrown value into a message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build an object with one optional key, or nothing when the value is absent. */
function present<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>
}
