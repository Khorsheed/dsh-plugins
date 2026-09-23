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

// Re-exported so consumers (the pane, the store, the selectors) can name the
// parsed entry without also importing the wire vocabulary module.
export type { ReaderEntry }
import { normalizeRichText } from './extract-article.ts'

/** A parsed feed: its own metadata plus one entry per item. */
export interface ParsedFeed {
  /** Feed-level title, when it declares one. */
  readonly title?: string
  /** Feed-declared icon (the publisher's own asset), when present. */
  readonly icon?: string
  /**
   * True when the payload was cut off and this feed is a salvage of it: the
   * entries below are real, but they are not all of them.
   */
  readonly incomplete?: boolean
  /**
   * Why the payload is incomplete, in the parser's own words — the host seam's
   * size cap, or a document that simply stops mid-tag.
   */
  readonly incompleteReason?: string
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
  // and the one a reader meets most often is not exotic at all: the host seam
  // caps a payload at ~100,000 characters, and a cap that lands mid-tag makes
  // the WHOLE document malformed. (Measured on the acceptance instance: a
  // 646,905-character feed arrived as exactly 100,000 characters with one
  // complete `<item>` and one cut in half — every entry was lost to one missing
  // `</rss>`.)
  //
  // So a malformed document is not the end: what closed before the cut is
  // still perfectly good XML, and it is recovered below.
  const parseError = doc.querySelector('parsererror')
  if (parseError !== null) {
    const salvage = salvageDocument(trimmed, sourceId, `malformed XML: ${truncate(collapse(parseError.textContent ?? ''), 160)}`)
    if (salvage !== undefined) return salvage
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
  const content = bestContent(element)
  const body = content ?? bestBody(element)
  // The body IS only the feed's summary when no content element supplied one:
  // the browser half needs that distinction to know a fetch is still owed.
  const summaryOnly = content === undefined && body !== undefined
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
    ...(summaryOnly ? { summaryOnly: true } : {}),
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
/**
 * The feed's own FULL-TEXT element, when it publishes one.
 *
 * Distinct from {@link bestBody} on purpose. `bestBody` falls back to the
 * `<description>`/`<summary>` field so the detail view is never empty for a
 * feed that publishes nothing else — but that fallback is a SUMMARY, and a
 * caller that cannot tell the two apart concludes the entry already has its
 * text. That is exactly how a 167-character summary was rendered as the whole
 * article and why neither the backfill nor opening it ever fetched the page.
 *
 * @param element - the `<item>` / `<entry>`.
 * @returns the rich body, or `undefined` when the feed ships only a summary.
 */
function bestContent(element: Element): string | undefined {
  for (const name of CONTENT_TAGS) {
    const raw = firstDescendantText(element, name)
    if (raw === undefined) continue
    const normalized = normalizeRichText(decodeEntities(raw))
    if (normalized.length > 0) return normalized
  }
  return undefined
}

/** The fallback body (the feed's own summary), used when no content element exists. */
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

/* --------------------------------------------------------------- salvage */

/**
 * Recover what the payload did manage to say, instead of reporting nothing.
 *
 * Complete `<item>` / `<entry>` blocks are re-parsed as fragments (they are
 * valid XML on their own). The block the cut landed inside is repaired on a
 * best-effort basis and returned as a PARTIAL entry, which is what makes the
 * detail view's "content shown in part" note honest rather than decorative: the
 * text exists, it simply stops early, and the note plus the original-page
 * button are how the reader gets the rest.
 *
 * @param raw - the malformed payload.
 * @param sourceId - owning source id.
 * @param reason - the parser's complaint, carried onto the result.
 * @returns the salvaged feed, or `undefined` when not even one entry was found.
 */
function salvageDocument(raw: string, sourceId: string, reason: string): ParseFeedResult | undefined {
  const entries: ReaderEntry[] = []
  const feedTitle = firstMatch(raw, /<title[^>]*>([\s\S]{0,300}?)<\/title>/i)
  // The document's own root attributes carry the namespace declarations, and a
  // fragment is only parseable with them: `<content:encoded>` inside the item
  // makes the WHOLE fragment malformed XML when `xmlns:content` is missing —
  // which is exactly how the first salvage attempt lost a complete 42 KB item.
  const rootAttrs = /<rss[^>]*>/i.exec(raw)?.[0]?.replace(/^<rss/i, '').replace(/>$/, '')
    ?? /<feed[^>]*>/i.exec(raw)?.[0]?.replace(/^<feed/i, '').replace(/>$/, '')
    ?? ''

  for (const tag of ['item', 'entry'] as const) {
    // Complete blocks, in document order.
    const complete = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi')
    const partial = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*$`, 'i')
    // Everything a complete block covers, so the trailing scan only looks at
    // what is left after the last one.
    let cursor = 0
    for (const match of raw.matchAll(complete)) {
      const entry = readEntryFragment(match[0], sourceId, false, rootAttrs)
      if (entry !== undefined) entries.push(entry)
      cursor = (match.index ?? 0) + match[0].length
    }
    const rest = raw.slice(cursor)
    const trailing = partial.exec(rest)
    if (trailing !== null) {
      const entry = readEntryFragment(trailing[0], sourceId, true, rootAttrs)
      if (entry !== undefined) entries.push(entry)
    }
    if (entries.length > 0) break
  }

  if (entries.length === 0) return undefined
  return {
    ok: true,
    feed: {
      ...present('title', feedTitle),
      incomplete: true,
      incompleteReason: reason,
      entries,
    },
  }
}

/**
 * Parse one entry fragment.
 *
 * A complete block is parsed as-is. A partial one is repaired first: every tag
 * still open at the cut is closed, so the text before the cut stays readable
 * instead of vanishing with the malformed markup.
 *
 * @param xml - the block's markup (complete or partial).
 * @param sourceId - owning source id.
 * @param partial - true when the block was cut off.
 * @param rootAttrs - the document root's attributes (its namespace declarations).
 * @returns the entry, or `undefined` when it carries no title and no link.
 */
function readEntryFragment(xml: string, sourceId: string, partial: boolean, rootAttrs: string): ReaderEntry | undefined {
  // A complete block needs no repair. A cut-off one gets its still-open tags
  // closed so the half before the cut survives as text.
  const candidates = partial ? [repairMarkup(xml), xml] : [xml]
  for (const candidate of candidates) {
    const wrapped = `<root${rootAttrs}>${candidate}</root>`
    let doc: Document
    try {
      doc = new DOMParser().parseFromString(wrapped, 'application/xml')
    } catch {
      continue
    }
    if (doc.querySelector('parsererror') !== null) continue
    const element = doc.documentElement.firstElementChild
    if (element === null) continue
    const entry = readEntry(element, sourceId)
    if (entry === undefined) continue
    if (!partial) return entry
    return { ...entry, partial: true }
  }
  if (!partial) return undefined
  // The repair did not produce parseable XML (closing every open tag is not
  // always enough). The fragment nevertheless states its own fields, and they
  // are readable straight out of the markup — which is what keeps a cut-off
  // entry openable instead of dropping it.
  return readFragmentFields(xml, sourceId)
}

/**
 * Read a cut-off fragment's fields out of its raw markup.
 *
 * Deliberately shallow: each field is the fragment's OWN element, matched
 * without crossing `>` or `<`, and the body is the item-level description field
 * (or the CDATA block it wraps). Nested markup inside the body cannot fake a
 * match, because every pattern here stops at the next angle bracket.
 *
 * @param xml - the cut-off fragment.
 * @param sourceId - owning source id.
 * @returns the partial entry, or `undefined` when it names neither a title nor a link.
 */
function readFragmentFields(xml: string, sourceId: string): ReaderEntry | undefined {
  const title = elementTextRaw(xml, 'title')
  const link = elementTextRaw(xml, 'link') ?? /<link[^>]*href=["']([^"']+)["']/i.exec(xml)?.[1]
  const displayTitle = title ?? link
  if (displayTitle === undefined) return undefined

  const summaryText = stripTags(decodeEntities(elementTextRaw(xml, 'description') ?? ''))
  const body = salvageBody(xml)
  return {
    id: stableEntryId({ title: displayTitle, ...(link !== undefined ? { link } : {}) }),
    sourceId,
    title: displayTitle,
    ...present('link', link),
    ...present('author', elementTextRaw(xml, 'creator') ?? elementTextRaw(xml, 'author')),
    ...present('publishedAt', readDateRaw(xml)),
    // A short item description is a fine card excerpt; a long one is body text
    // that happens to sit in the description field, and belongs in the detail
    // view only.
    ...(summaryText.length > 0 && summaryText.length <= 320 ? { summary: summaryText } : {}),
    ...(body !== undefined ? { contentHtml: body } : {}),
    partial: true,
  }
}

/** One element's own text, read without crossing an angle bracket. */
function elementTextRaw(xml: string, localName: string): string | undefined {
  const match = new RegExp(`<${localName}[^>]*>([^<]*)<`, 'i').exec(xml)
  const value = decodeEntities(match?.[1] ?? '').trim()
  return value.length > 0 ? value : undefined
}

/** A fragment's date field, in whichever dialect it declares one. */
function readDateRaw(xml: string): string | undefined {
  for (const name of DATE_TAGS) {
    const raw = elementTextRaw(xml, name)
    if (raw === undefined) continue
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return undefined
}

/**
 * The readable body a cut-off fragment still carries.
 *
 * Two shapes cover what publishers actually ship: markup that made it through
 * the cut (normalized as usual), and a CDATA/CDATA-like block whose closing
 * `]]>` survived even though the element that wraps it did not — the common
 * shape for a feed whose item body is one long `<description><![CDATA[…]`.
 *
 * @param xml - the fragment.
 * @returns normalized markup, or `undefined` when nothing readable is left.
 */
function salvageBody(xml: string): string | undefined {
  // Every `<description` in the fragment, as prefixes of it. The item-level
  // field is the EARLIEST one and therefore the LONGEST prefix — the cue that
  // separates it from markup nested inside the body, which is full of its own
  // `<figure><figcaption><description>`-shaped content.
  const starts = [...xml.matchAll(/<description[^>]*>/gi)].map(match => match.index ?? 0)
  const source = starts.length === 0 ? xml : xml.slice(Math.min(...starts))
  const cdata = /<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)/.exec(source)?.[1]
  if (cdata !== undefined && cdata.trim().length > 0) {
    const normalized = normalizeRichText(cdata)
    if (normalized.length > 0) return normalized
  }
  const markup = /<(?:p|div|article|section)\b[\s\S]*$/i.exec(source)?.[0]
  if (markup === undefined) return undefined
  const repaired = repairMarkup(markup)
  const normalized = normalizeRichText(repaired)
  return normalized.length > 0 ? normalized : undefined
}

/**
 * Close the tags a truncated fragment left open, so its readable half survives.
 *
 * Deliberately conservative: it only appends closers, never rewrites or drops
 * text. If the result still does not parse, the caller falls back to reading
 * the fragment's title and link out of the raw markup.
 *
 * @param xml - the fragment.
 * @returns the fragment with closers appended.
 */
function repairMarkup(xml: string): string {
  // 1. Drop a dangling `<` or a half-written tag at the very end.
  let repaired = xml.replace(/<[^>]*$/, '')
  // 2. Close an unterminated CDATA section — the common case for a feed whose
  //    item body is one long CDATA block.
  const cdataOpens = (repaired.match(/<!\[CDATA\[/g) ?? []).length
  const cdataCloses = (repaired.match(/\]\]>/g) ?? []).length
  for (let index = 0; index < cdataOpens - cdataCloses; index++) repaired += ']]>'
  // 3. Trim back to the last `>`, so the scan below sees only whole tags.
  const lastGt = repaired.lastIndexOf('>')
  if (lastGt < 0) return repaired
  repaired = repaired.slice(0, lastGt + 1)
  // 4. Close every still-open element, innermost first.
  const open: string[] = []
  for (const match of repaired.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    if (selfClosing === '/' || name === undefined || name.startsWith('!') || name.startsWith('?')) continue
    if (closing === '/') {
      const at = open.lastIndexOf(name)
      if (at >= 0) open.splice(at, 1)
    } else {
      open.push(name)
    }
  }
  return repaired + open.reverse().map(name => `</${name}>`).join('')
}

/** The first capture of a pattern, or `undefined`. */
function firstMatch(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text)
  const value = match?.[1]?.trim()
  return value !== undefined && value.length > 0 ? value : undefined
}
