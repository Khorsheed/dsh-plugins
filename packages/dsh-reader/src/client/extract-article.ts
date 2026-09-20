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
  // The presentation MathML subset: arXiv's HTML papers (LaTeXML) carry their
  // formulas as `<math alttext="…">`, and the render target (Chromium ≥ 153)
  // renders this subset natively — no script, no font download. Anything NOT
  // in this list (`mglyph`, `mpadded`, …) is unwrapped to its children, which
  // for a formula is its readable text.
  'math', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'msup', 'msub', 'msubsup',
  'mfrac', 'msqrt', 'mroot', 'mspace', 'mtable', 'mtr', 'mtd', 'munder',
  'mover', 'munderover', 'semantics', 'annotation',
])

/**
 * Elements whose entire subtree is dropped (never merely unwrapped).
 *
 * `noscript` is deliberately NOT here: its subtree is where the standard no-JS
 * image fallback lives (`<noscript><img src="real.jpg"></noscript>` behind a
 * lazy-loading script), and dropping it wholesale loses pictures whose URL is
 * right there in the static markup. The normalizer recovers that image and
 * drops everything else a noscript carries.
 *
 * `annotation-xml` IS here while `math` is not: the presentation MathML subset
 * renders natively, but an `annotation-xml` with `encoding="text/html"` parses
 * its children as HTML — the one MathML-shaped HTML-injection vector — so the
 * subtree never reaches the normalizer.
 */
const DROP_TAGS = new Set([
  'script', 'style', 'template', 'nav', 'header', 'footer', 'aside',
  'form', 'iframe', 'svg', 'annotation-xml', 'button', 'select', 'input', 'textarea', 'video',
  'audio', 'canvas', 'object', 'embed', 'link', 'meta', 'base', 'title',
])

/** Inline elements that survive an inline-only pass. */
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'code', 'a', 'sub', 'sup', 'br'])

/**
 * Attributes preserved per element (everything else is stripped).
 *
 * The `img` row documents what an emitted image carries; the img branch of
 * `normalizeNode` builds that tag itself, because the source URL is RESOLVED
 * (lazy-loading attributes, srcset, a picture's sources) rather than copied.
 */
const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  img: ['src', 'alt', 'referrerpolicy'],
  // `alttext` is the formula's plain-text twin (accessibility and a readable
  // fallback), `display` marks block math (the pane scrolls it horizontally).
  // Everything else — event handlers, `href` on <mi>, style hooks — is stripped.
  math: ['alttext', 'display'],
}

/**
 * Where lazy-loading scripts stash the real URL when `src` is a placeholder.
 *
 * Ordered by how often each name carries the article's image; the list is kept
 * tight on purpose — an attribute nobody publishes buys nothing but surface.
 */
const LAZY_IMAGE_ATTRIBUTES = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-actualsrc'] as const

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
  | {
    readonly ok: true
    readonly html: string
    readonly textLength: number
    /**
     * How many figures had to be dropped because the page DRAWS them.
     *
     * Measured on the acceptance instance's transformer-circuits.pub paper:
     * `<figure data-fignum="2">` contains an empty `<div class='intro-structural'>`
     * and a caption, and the illustration is rendered by the page's own scripts.
     * A fetch runs no scripts, so what arrives is a caption describing a picture
     * that is not there. Dropping the empty figure and saying so beats leaving a
     * bare caption the reader will read as "the plugin lost my image".
     */
    readonly scriptFigures?: number
  }
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

  const scriptFigures = countScriptFigures(scored.element)
  trimLeadingChrome(scored.element, doc)
  // The title block is a custom element, so it has no tag of its own: the
  // normalizer UNWRAPS it and its `<br>`s land at the front of the body. Four
  // blank lines before the first paragraph is not content by any reading, and
  // stripping the head of the string is independent of where they came from.
  const normalized = normalizeElement(scored.element, baseUrl).replace(/^(?:\s|<br[^>]*>)+/i, "")
  const textLength = textLengthOf(scored.element)
  if (textLength < 120) {
    return { ok: false, error: `extracted body is too small (${textLength} chars)` }
  }
  return {
    ok: true,
    html: normalized,
    textLength,
    ...(scriptFigures === 0 ? {} : { scriptFigures }),
  }
}

/**
 * Drop the page's own title block and masthead from the top of the body.
 *
 * Measured on the acceptance instance's transformer-circuits.pub paper: the
 * extracted body opened with an empty logo link, the site name, the article
 * title **twice** (the page carries two `<h1>`s), three `<br>`s, and only then
 * the byline. The detail view already renders the entry title above the body,
 * so the reader saw the same heading three times before any prose — reported as
 * "why does it fetch repeated content at the start".
 *
 * Two narrow rules, both text-based: a top-level heading that repeats the
 * document title (or the body's own first heading) goes, and the leading
 * masthead (links and whitespace before the first heading or real paragraph)
 * goes with it. Anything that carries prose stops the walk, so a byline,
 * abstract or section heading is never touched.
 *
 * @param root - the element the body was extracted from (mutated in place).
 * @param doc - the parsed document, for its title.
 */
function trimLeadingChrome(root: Element, doc: Document): void {
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const title = normalize(doc.title ?? '')
  const firstHeading = root.querySelector('h1, h2, h3')
  const ownTitle = firstHeading === null ? '' : normalize(firstHeading.textContent ?? '')
  for (const heading of Array.from(root.querySelectorAll('h1, h2'))) {
    const text = normalize(heading.textContent ?? '')
    if (text.length === 0) continue
    if (text === title || (ownTitle.length > 0 && text === ownTitle)) heading.remove()
  }
  // The masthead walk: drop leading nodes until something that IS content —
  // a stop tag, a picture, or 40+ characters of prose. The site header on the
  // measured page is a `<div>` holding a logo `<svg>` (no img), so pictures are
  // counted by `img`/`figure`, never by `svg` alone.
  let node = root.firstElementChild
  while (node !== null) {
    const next = node.nextElementSibling
    const tag = node.localName
    const text = normalize(node.textContent ?? '')
    if (ROOT_STOPS.has(tag)) break
    if (node.querySelector('img, picture, canvas, video, figure') !== null) break
    if (text.length >= 40) break
    node.remove()
    node = next
  }
  // The page's title block is a custom element (`<d-title>`): it has no tag in
  // the whitelist, so its leftovers are flattened INTO the body — and its own
  // leading `<br>`s then become the body's first nodes. Trim them down the left
  // spine, which is where "the article starts with four blank lines" comes from.
  let spine: Element | null = root
  while (spine !== null) {
    let child = spine.firstElementChild
    while (child !== null && child.localName === 'br') {
      const following = child.nextElementSibling
      child.remove()
      child = following
    }
    spine = spine.firstElementChild
  }
}

/**
 * Tags that mean real content has begun; the masthead walk stops there.
 *
 * Deliberately excludes `div`/`section`/`header`: those are exactly the wrappers
 * a masthead hides in, and a wrapper is judged by what it holds instead.
 */
const ROOT_STOPS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote', 'pre', 'ul', 'ol'])

/**
 * Count the figures whose picture is not in the markup.
 *
 * "No picture" means no `<img>`, `<svg>`, `<canvas>`, `<video>` or `<picture>`
 * anywhere inside: the page renders that illustration at runtime. A `<math>`
 * subtree counts as content — a formula-only figure's picture IS its markup.
 *
 * The figures themselves are KEPT, caption included. Dropping them was tried
 * and reverted: a caption is text the page published — it says what the figure
 * shows and carries its number — and hiding it turns "this picture cannot be
 * fetched" into "this paragraph lost its data". The count travels to the detail
 * view, which explains once, above the body, why the captions below have no
 * picture under them.
 *
 * @param root - the element the body was extracted from.
 * @returns the number of figures whose picture the fetch could not bring.
 */
function countScriptFigures(root: Element): number {
  let count = 0
  for (const figure of Array.from(root.querySelectorAll('figure'))) {
    if (figure.querySelector('img, svg, canvas, video, picture, math') !== null) continue
    count += 1
  }
  return count
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
    // An image counts for a little: article bodies have them, navigation does
    // not. One inside a <noscript> is the no-JS fallback for a picture the
    // markup already holds — counting the duplicate would double the boost.
    if (node.closest('noscript') !== null) continue
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
    const src = imageSrc(element, baseUrl)
    if (src === undefined) return ''
    return emitImg(src, element.getAttribute('alt'))
  }
  // A <picture> is one image with several spellings: the first usable <source>
  // srcset, else the fallback <img>. Emitting one normalized <img> is the whole
  // point — the whitelist has no picture/source, so keeping the wrapper would
  // either duplicate the image or lose it.
  if (tag === 'picture') return pictureImg(element, baseUrl)
  // The standard no-JS fallback: a lazy-loading script hides the real image in
  // a <noscript>, and a fetch runs no scripts — so the ONLY copy the static
  // markup holds lives here. Recover that image; drop everything else a
  // noscript carries (the "please enable JavaScript" text is not content).
  if (tag === 'noscript') return noscriptImg(element, baseUrl)
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
 * Serialize one normalized image.
 *
 * `referrerpolicy="no-referrer"` is emitted, never copied: the sites that
 * lazy-load are also the ones whose CDNs answer a hotlink with a 403, and the
 * reader has no page context to refer from anyway.
 */
function emitImg(src: string, alt: string | null): string {
  return `<img src="${escapeAttribute(src)}"${alt === null ? '' : ` alt="${escapeAttribute(alt)}"`} referrerpolicy="no-referrer">`
}

/**
 * Resolve the URL an image actually loads, past the lazy-loading tricks.
 *
 * The order is the order of trust: a real `src` first (a `data:` URI there is
 * the classic 1px placeholder and counts as ABSENT — the real URL is in the
 * attributes), then the lazy-loading attributes, then the best `srcset`
 * candidate. Only when nothing usable remains is the image dropped.
 *
 * @param element - the `<img>` element.
 * @param baseUrl - base for relative URL resolution.
 * @returns the absolute URL, or `undefined`.
 */
function imageSrc(element: Element, baseUrl: string | undefined): string | undefined {
  const src = element.getAttribute('src')
  if (src !== null && !/^\s*data:/i.test(src)) {
    const resolved = absolutize(src, baseUrl)
    if (resolved !== undefined) return resolved
  }
  for (const name of LAZY_IMAGE_ATTRIBUTES) {
    const resolved = absolutize(element.getAttribute(name), baseUrl)
    if (resolved !== undefined) return resolved
  }
  return bestSrcset(element.getAttribute('srcset'), baseUrl)
}

/**
 * The largest candidate of a `srcset` list.
 *
 * Candidates are ranked by their descriptor's number — `800w` beats `400w`,
 * `2x` beats `1x`, a bare URL is the smallest. The two descriptor kinds are
 * never meaningfully mixed in one list, so one ranking serves both.
 *
 * @param value - the srcset attribute, or null.
 * @param baseUrl - base for relative URL resolution.
 * @returns the absolute URL of the biggest candidate, or `undefined`.
 */
function bestSrcset(value: string | null, baseUrl: string | undefined): string | undefined {
  if (value === null) return undefined
  const candidates: string[] = []
  for (const piece of value.split(',')) {
    const previous = candidates[candidates.length - 1]
    // A data: URL carries a comma of its own (`data:image/png;base64,…`), so a
    // naive split cuts it in two — and the payload tail then parses as a
    // candidate that can WIN. Rejoin the halves: the whole candidate is
    // rejected as a scheme below, but its tail must never stand alone.
    if (previous !== undefined && /^\s*data:[^,]*$/i.test(previous)) {
      candidates[candidates.length - 1] = `${previous},${piece}`
      continue
    }
    candidates.push(piece)
  }
  let best: { readonly url: string; readonly score: number } | undefined
  for (const candidate of candidates) {
    const parts = candidate.trim().split(/\s+/)
    const raw = parts[0]
    if (raw === undefined || raw === '') continue
    const url = absolutize(raw, baseUrl)
    if (url === undefined) continue
    const descriptor = parts[1]
    const size = descriptor === undefined ? Number.NaN : Number.parseFloat(descriptor)
    const score = Number.isFinite(size) ? size : 0
    if (best === undefined || score > best.score) best = { url, score }
  }
  return best?.url
}

/**
 * Resolve a `<picture>` to its one normalized `<img>`, or to nothing.
 *
 * @param element - the `<picture>` element.
 * @param baseUrl - base for relative URL resolution.
 * @returns the normalized image HTML, or an empty string.
 */
function pictureImg(element: Element, baseUrl: string | undefined): string {
  const fallback = Array.from(element.children).find(child => child.localName === 'img')
  const alt = fallback?.getAttribute('alt') ?? null
  for (const source of Array.from(element.children)) {
    if (source.localName !== 'source') continue
    const url = bestSrcset(source.getAttribute('srcset'), baseUrl)
    if (url !== undefined) return emitImg(url, alt)
  }
  if (fallback !== undefined) {
    const url = imageSrc(fallback, baseUrl)
    if (url !== undefined) return emitImg(url, alt)
  }
  return ''
}

/**
 * Recover the no-JS fallback image a `<noscript>` carries, when it carries one.
 *
 * A fetched page parses with scripting disabled, so the content is usually
 * already elements; a parse with scripting on holds the same markup as TEXT
 * instead, and then it is parsed here a second time. Either way, anything that
 * is not a usable image is dropped, exactly as before.
 *
 * @param element - the `<noscript>` element.
 * @param baseUrl - base for relative URL resolution.
 * @returns the normalized image HTML, or an empty string.
 */
function noscriptImg(element: Element, baseUrl: string | undefined): string {
  let img = element.querySelector('img')
  if (img === null) {
    const text = element.textContent ?? ''
    if (!/<img[\s/>]/i.test(text)) return ''
    try {
      img = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html').querySelector('img')
    } catch {
      return ''
    }
  }
  if (img === null) return ''
  const src = imageSrc(img, baseUrl)
  if (src === undefined) return ''
  return emitImg(src, img.getAttribute('alt'))
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
    // A noscript's fallback image means nothing in an inline summary; the rest
    // of its content ("please enable JavaScript") was never content at all.
    if (tag === 'noscript') continue
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
