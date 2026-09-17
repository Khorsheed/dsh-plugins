/**
 * Article extraction and rich-text normalization for the browser half.
 *
 * Two exports, one for each shape of input the reader handles:
 *
 * - {@link extractArticle} takes a fetched HTML page and finds its body. The
 *   honest problem here is that which block is "the article" is a heuristic:
 *   this module scores candidate blocks the way readability implementations do
 *   (paragraph mass, minus link mass, with wrapper blocks demoted) and adds the
 *   one signal that a single-language scorer gets wrong — Chinese paragraphs
 *   are short by nature, so a length threshold tuned for English rejects them
 *   and the scorer falls back to the whole page container (measured: 473 <p>
 *   and 56 images instead of the article).
 * - {@link normalizeRichText} takes markup that is ALREADY known to be a body
 *   (a feed's `content:encoded`, or the block extraction selected) and puts it
 *   through a tag whitelist, so the renderer never sees third-party scripts,
 *   styles, forms or event handlers.
 *
 * Everything runs in the browser because the host runtime has no DOM parser at
 * all; nothing here touches the network.
 *
 * @module @khorsheed/dsh-reader/client/extract-article
 */

/** Elements kept in normalized output, mapped to themselves. */
const KEEP_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
  'code', 'strong', 'em', 'b', 'i', 'u', 's', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'sub', 'sup', 'dl', 'dt', 'dd',
])

/** Elements whose entire subtree is dropped (never merely unwrapped). */
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside',
  'form', 'iframe', 'svg', 'math', 'button', 'select', 'input', 'textarea', 'video',
  'audio', 'canvas', 'object', 'embed', 'link', 'meta', 'base', 'title',
])

/** Inline elements that survive an inline-only pass. */
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'code', 'a', 'sub', 'sup', 'br'])

/** Attributes preserved per element (everything else is stripped). */
const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  img: ['src', 'alt'],
}

/** The minimum text length a block must reach to count as a paragraph, by script. */
interface ParagraphThresholds {
  /** Below this a Latin-script block is navigation, not prose. */
  readonly latin: number
  /** Chinese writes far fewer characters per sentence; the bar is lower. */
  readonly cjk: number
}

/** Thresholds tuned so a Chinese and an English article both score their body. */
const THRESHOLDS: ParagraphThresholds = { latin: 40, cjk: 18 }

/** Result of extracting one article page. */
export type ExtractArticleResult =
  | { readonly ok: true; readonly html: string; readonly textLength: number }
  | { readonly ok: false; readonly error: string }

/**
 * Extract the article body from a fetched page.
 *
 * @param pageHtml - the raw HTML the host fetched.
 * @param baseUrl - the page URL, used to absolutize relative links and images.
 * @returns the normalized body HTML, or the reason nothing usable was found.
 */
export function extractArticle(pageHtml: string, baseUrl: string): ExtractArticleResult {
  if (pageHtml.trim().length === 0) return { ok: false, error: 'empty page' }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(pageHtml, 'text/html')
  } catch (error: unknown) {
    return { ok: false, error: `not parseable as HTML: ${errorMessage(error)}` }
  }

  // Strip the noise subtrees BEFORE scoring, so every candidate is measured on
  // the same terms (a sidebar full of links otherwise wins on raw text mass).
  for (const node of Array.from(doc.querySelectorAll([...DROP_TAGS].join(',')))) {
    node.remove()
  }

  const scored = scoreCandidates(doc)
  if (scored === undefined) {
    return { ok: false, error: 'no text-bearing block found' }
  }

  const normalized = normalizeElement(scored.element, baseUrl)
  const textLength = textLengthOf(scored.element)
  if (textLength < 120) {
    return { ok: false, error: `extracted body is too small (${textLength} chars)` }
  }
  return { ok: true, html: normalized, textLength }
}

/**
 * Put trusted-shape markup through the whitelist.
 *
 * Feed bodies take this path: a feed's `content:encoded` is markup from the
 * same publisher as the page, so it earns the same whitelist rather than the
 * extraction heuristic.
 *
 * @param html - markup from a feed or from extraction.
 * @param baseUrl - base for relative URLs (feed bodies usually use absolute ones).
 * @returns whitelisted HTML, or an empty string when nothing survives.
 */
export function normalizeRichText(html: string, baseUrl?: string): string {
  if (html.trim().length === 0) return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  } catch {
    // A non-DOM host (the host half) has no parser: fall back to the
    // text-safe strip so this never throws in an unexpected environment.
    return escapeHtml(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
  }
  const body = doc.body
  if (body === null) return ''
  for (const node of Array.from(body.querySelectorAll([...DROP_TAGS].join(',')))) {
    node.remove()
  }
  return normalizeChildren(body, baseUrl)
}

/** One scored candidate block. */
interface ScoredCandidate {
  readonly element: Element
  readonly score: number
}

/**
 * Score every plausible body container and return the best one.
 *
 * `undefined` means no container carried paragraph-like text at all.
 *
 * @param doc - the document, already stripped of noise subtrees.
 * @returns the winning candidate.
 */
function scoreCandidates(doc: Document): ScoredCandidate | undefined {
  const containers = Array.from(doc.querySelectorAll('div, article, main, section, td, body'))
  let best: ScoredCandidate | undefined
  for (const element of containers) {
    const score = scoreElement(element)
    if (score <= 0) continue
    if (best === undefined || score > best.score) best = { element, score }
  }
  return best
}

/**
 * The readability-style score for one container: paragraph mass, plus a boost
 * for text and images, minus link mass, with `article`/`main` preferred and a
 * wrapper that merely contains a better child demoted.
 *
 * @param element - the candidate container.
 * @returns the score; `0` when the container holds no paragraph-like text.
 */
function scoreElement(element: Element): number {
  let paragraphMass = 0
  let paragraphCount = 0
  let imageCount = 0
  let linkMass = 0

  for (const node of Array.from(element.querySelectorAll('p'))) {
    const text = collapse(node.textContent ?? '')
    if (text.length >= paragraphThreshold(text)) {
      paragraphMass += text.length
      paragraphCount += 1
    }
  }
  if (paragraphCount === 0) return 0

  for (const node of Array.from(element.querySelectorAll('a'))) {
    linkMass += collapse(node.textContent ?? '').length
  }
  for (const node of Array.from(element.querySelectorAll('img'))) {
    // An image counts for a little: article bodies have them, navigation does not.
    if (node.getAttribute('src') !== null) imageCount += 1
  }

  const isCjk = cjkRatio(collapse(element.textContent ?? '')) > 0.2
  const bodyLength = collapse(element.textContent ?? '').length
  let score = paragraphMass + bodyLength * 0.12 + imageCount * 40
  if (isCjk) {
    // Link-heavy Chinese list posts (weekly digests) inflate link mass far more
    // than their prose does; penalize links the same way but expect a lower
    // paragraph bar, which paragraphThreshold already applies.
    score -= linkMass * 0.75
  } else {
    score -= linkMass * 0.55
  }

  if (element.localName === 'article') score *= 1.3
  else if (element.localName === 'main') score *= 1.15

  // A wrapper holding a child with most of the same paragraph mass is not the
  // body — it is the page around the body. Demote it so the inner block wins.
  let bestChildMass = 0
  for (const child of Array.from(element.children)) {
    bestChildMass = Math.max(bestChildMass, paragraphMassOf(child))
  }
  if (bestChildMass > paragraphMass * 0.85) score *= 0.55

  return score
}

/** Paragraph mass alone, for the wrapper-demotion comparison. */
function paragraphMassOf(element: Element): number {
  let mass = 0
  for (const node of Array.from(element.querySelectorAll('p'))) {
    const text = collapse(node.textContent ?? '')
    if (text.length >= paragraphThreshold(text)) mass += text.length
  }
  return mass
}

/** The paragraph bar for a block, chosen by its dominant script. */
function paragraphThreshold(text: string): number {
  return cjkRatio(text) > 0.2 ? THRESHOLDS.cjk : THRESHOLDS.latin
}

/** Fraction of characters that are CJK ideographs. */
function cjkRatio(text: string): number {
  if (text.length === 0) return 0
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
  return (cjk?.length ?? 0) / text.length
}

/** Visible text length of an element. */
function textLengthOf(element: Element): number {
  return collapse(element.textContent ?? '').length
}

/**
 * Normalize one element's subtree into whitelisted HTML.
 *
 * @param element - the container whose children are normalized.
 * @param baseUrl - base for relative URL resolution.
 * @returns the normalized HTML string.
 */
function normalizeElement(element: Element, baseUrl: string | undefined): string {
  return normalizeChildren(element, baseUrl)
}

/** Normalize every child of a node. */
function normalizeChildren(node: Node, baseUrl: string | undefined): string {
  const parts: string[] = []
  for (const child of Array.from(node.childNodes)) {
    const normalized = normalizeNode(child, baseUrl)
    if (normalized.length > 0) parts.push(normalized)
  }
  return parts.join('')
}

/**
 * Normalize one node: text is escaped, whitelisted elements are rebuilt with a
 * filtered attribute set, anything else is unwrapped (its children survive) or
 * dropped entirely.
 *
 * @param node - the node to normalize.
 * @param baseUrl - base for relative URL resolution.
 * @returns the normalized HTML for this node.
 */
function normalizeNode(node: Node, baseUrl: string | undefined): string {
  if (node.nodeType === 3 /* text */) {
    const text = node.textContent ?? ''
    // Collapse runs of whitespace: HTML source formatting is not content, and
    // the renderer re-wraps lines itself.
    return escapeHtml(text.replace(/\s+/g, ' '))
  }
  if (node.nodeType !== 1 /* element */) return ''

  const element = node as Element
  const tag = element.localName.toLowerCase()
  if (DROP_TAGS.has(tag)) return ''
  // Cloudflare's email obfuscation: the visible text is a placeholder that its
  // own script decodes at runtime. We never run that script, so keeping the
  // element would ship a literal "[email protected]" into the reader — a real
  // artifact seen in the Chinese fixture. Drop it instead.
  if (element.hasAttribute('data-cfemail') || (element.getAttribute('class') ?? '').includes('__cf_email__')) return ''

  if (tag === 'img') {
    const src = absolutize(element.getAttribute('src'), baseUrl)
    if (src === undefined) return ''
    const alt = element.getAttribute('alt')
    return `<img src="${escapeAttribute(src)}"${alt === null ? '' : ` alt="${escapeAttribute(alt)}"`}>`
  }
  if (tag === 'br') return '<br>'
  if (tag === 'hr') return '<hr>'

  const inner = normalizeChildren(element, baseUrl)
  if (!KEEP_TAGS.has(tag)) return inner
  if (tag === 'a') {
    const href = absolutize(element.getAttribute('href'), baseUrl)
    // An anchor without a usable target keeps its text but loses the link, so
    // the renderer never emits a dead or hostile href.
    if (href === undefined) return inner
    return `<a href="${escapeAttribute(href)}" rel="noopener noreferrer" target="_blank">${inner}</a>`
  }
  const attributes = (KEPT_ATTRIBUTES[tag] ?? [])
    .map(name => {
      const value = element.getAttribute(name)
      return value === null ? '' : ` ${name}="${escapeAttribute(value)}"`
    })
    .join('')
  return `<${tag}${attributes}>${inner}</${tag}>`
}

/**
 * Turn an inline-only rendering of a node into plain text-safe markup. Feed
 * summaries use this shape when the caller wants emphasis but no blocks.
 *
 * @param html - markup.
 * @returns normalized inline markup.
 */
export function normalizeInline(html: string): string {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  } catch {
    return escapeHtml(html.replace(/<[^>]*>/g, ''))
  }
  const body = doc.body
  if (body === null) return ''
  return serializeInline(body).trim()
}

/**
 * Serialize a node's children as inline-only markup: text is escaped, inline
 * elements are rebuilt, a `<br>` becomes a space, and every block element is
 * flattened (its content survives, its structure does not).
 *
 * @param node - the node whose children are serialized.
 * @returns inline markup.
 */
function serializeInline(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      out += escapeHtml((child.textContent ?? '').replace(/\s+/g, ' '))
      continue
    }
    if (child.nodeType !== 1 /* element */) continue
    const tag = (child as Element).localName.toLowerCase()
    if (DROP_TAGS.has(tag)) continue
    if (tag === 'br') {
      out += ' '
      continue
    }
    const inner = serializeInline(child)
    // Blocks and links are flattened: the summary carries the words, not the
    // structure. Emphasis survives because it is cheap and often meaningful.
    if (!INLINE_TAGS.has(tag) || tag === 'a') {
      out += inner
      continue
    }
    out += `<${tag}>${inner}</${tag}>`
  }
  return out
}

/** Resolve a possibly-relative URL against the page URL; reject unsafe schemes. */
function absolutize(value: string | null, baseUrl: string | undefined): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (baseUrl === undefined) return undefined
  try {
    return new URL(trimmed, baseUrl).toString()
  } catch {
    return undefined
  }
}

/** Collapse whitespace and trim. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Escape text for HTML output. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

/** Coerce an unknown thrown value into a message (duplicated to keep this leaf module dependency-free). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
