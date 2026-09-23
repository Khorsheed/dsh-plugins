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
 *
 * `object` is no longer here either: LaTeXML (arXiv's HTML papers) embeds
 * vector figures as `<object type="image/svg+xml" data="…">`, so the
 * normalizer converts image-typed objects to `<img>` and drops the rest whole.
 */
const DROP_TAGS = new Set([
  'script', 'style', 'template', 'nav', 'header', 'footer', 'aside',
  'form', 'iframe', 'annotation-xml', 'button', 'select', 'input', 'textarea', 'video',
  'audio', 'canvas', 'embed', 'link', 'meta', 'base', 'title',
  // svg is NOT here: capture-rendered pages carry their rescued figures as
  // inline SVG, which normalizeSvg() whitelists per element/attribute. The
  // strip's selector gains the canonical-case members separately (SVG names are
  // case-sensitive in an HTML document).
  'foreignobject',
])

/** The strip selector's exact-case members (SVG camelCase names in an HTML document). */
const DROP_STRIP_EXTRA = ['foreignObject']

/** Inline elements that survive an inline-only pass. */
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'code', 'a', 'sub', 'sup', 'br'])

/**
 * Unwrapped containers that must leave a word boundary behind.
 *
 * Unwrapping a non-whitelist element keeps its children but no longer marks
 * any separation: a capture's outerHTML serialization carries NO inter-tag
 * whitespace, so `<div>A</div><div>B</div>` used to normalize into `AB` —
 * measured live as a composite figure's cards reading as one concatenated
 * run. These block-ish containers (plus any custom element) emit a boundary;
 * inline-ish unknowns keep the old flush behavior.
 */
const UNWRAP_BOUNDARY_TAGS = new Set([
  'div', 'section', 'article', 'main', 'details', 'summary', 'hgroup', 'fieldset', 'center',
])

/**
 * The style properties a figure's containers may keep: layout and paint, never
 * behavior. `position` is further value-gated (no fixed/sticky), `z-index` is
 * bounded, and any `url(…)` must be a same-document fragment — no external
 * loads or script tricks ride an inlined style into the reader.
 */
const FIGURE_STYLE_EXACT: ReadonlySet<string> = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'width', 'height',
  'margin', 'padding', 'gap', 'order', 'color', 'background', 'overflow',
  'text-align', 'vertical-align', 'line-height', 'white-space', 'transform',
  'transform-origin', 'opacity', 'visibility', 'z-index', 'flex', 'grid',
])
const FIGURE_STYLE_PREFIXES = [
  'flex-', 'grid-', 'max-', 'min-', 'margin-', 'padding-', 'gap-',
  'justify-', 'align-', 'place-', 'border', 'font-', 'background-', 'overflow-', 'text-',
] as const

/**
 * Filter one `style` attribute to the figure allowlist.
 *
 * @param style - the attribute's raw value.
 * @returns the kept declarations, or `undefined` when none survive.
 */
function figureStyle(style: string | null): string | undefined {
  if (style === null) return undefined
  const kept: string[] = []
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (prop.length === 0 || value.length === 0) continue
    if (!FIGURE_STYLE_EXACT.has(prop) && !FIGURE_STYLE_PREFIXES.some(prefix => prop.startsWith(prefix))) continue
    // Value gates: no external loads, no script tricks, no pinning/overlay.
    if (/javascript:|expression\s*\(|behavior\s*:/i.test(prop + ':' + value)) continue
    if (/url\(/i.test(value) && !svgValueSafe(value)) continue
    if (prop === 'position' && !/^(static|relative|absolute)$/i.test(value)) continue
    if (prop === 'z-index' && (!/^\d+$/.test(value) || Number(value) > 5)) continue
    kept.push(`${prop}: ${value}`)
  }
  return kept.length === 0 ? undefined : kept.join('; ')
}

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
     * The article's own title, when one is recoverable: the body's first
     * heading, else the document's `<title>`. A saved link's card upgrades from
     * the URL-derived label to this — the wall is where "which paper was this"
     * gets answered.
     */
    readonly title?: string
    /**
     * A short plain-text excerpt (the first substantial paragraph, truncated at
     * the card's measure), captured with the title.
     */
    readonly excerpt?: string
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

  // `<title>` is in DROP_TAGS, so read the document title before the strip
  // below removes the element it is computed from.
  const docTitle = doc.title ?? ''

  // Strip the noise subtrees BEFORE scoring, so every candidate is measured on
  // the same terms (a sidebar full of links otherwise wins on raw text mass).
  for (const node of Array.from(doc.querySelectorAll([...DROP_TAGS, ...DROP_STRIP_EXTRA].join(',')))) {
    node.remove()
  }

  const scored = scoreCandidates(doc)
  if (scored === undefined) {
    return { ok: false, error: 'no text-bearing block found' }
  }

  const scriptFigures = countScriptFigures(scored.element)
  // Read the title and excerpt BEFORE the chrome trim: the body's own first
  // heading is exactly what the trim removes (the pane renders the title
  // itself), and the excerpt wants the first prose paragraph either way.
  const title = articleTitleOf(scored.element, docTitle)
  const excerpt = articleExcerptOf(scored.element)
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
    ...(title === undefined ? {} : { title }),
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(scriptFigures === 0 ? {} : { scriptFigures }),
  }
}

/**
 * The article's own title, when one is recoverable.
 *
 * The body's first `<h1>` wins (on every measured shape it is the post's name);
 * the document `<title>` is the fallback (it often carries a site-name suffix,
 * which is why it does not lead). Capped and collapsed; empty reads as absent.
 *
 * @param root - the element the body was extracted from (pre-chrome-trim).
 * @param docTitle - the document's `<title>`, read before the noise strip.
 * @returns the title, or `undefined`.
 */
function articleTitleOf(root: Element, docTitle: string): string | undefined {
  const heading = collapse(root.querySelector('h1')?.textContent ?? '')
  const title = heading.length > 0 ? heading : collapse(docTitle)
  return title.length === 0 ? undefined : truncateText(title, 200)
}

/**
 * A short excerpt for the card: the first paragraph substantial enough to be
 * prose by the scorer's own per-script rule, at the card's measure.
 *
 * @param root - the element the body was extracted from.
 * @returns the excerpt, or `undefined` when no paragraph qualifies.
 */
function articleExcerptOf(root: Element): string | undefined {
  for (const p of Array.from(root.querySelectorAll('p'))) {
    const text = collapse(p.textContent ?? '')
    if (text.length >= paragraphThreshold(text)) return truncateText(text, 280)
  }
  return undefined
}

/** Truncate plain text at a cap with an ellipsis. */
function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
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
 * subtree counts as content — a formula-only figure's picture IS its markup —
 * and so does an image-typed `<object>` (the LaTeXML vector-figure shape).
 * A composite of styled containers carries its content as TEXT (a capture-
 * rendered figure is a diagram plus property cards): enough non-caption words
 * means the figure is here, even with no raster or vector island.
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
    if (figure.querySelector('img, svg, canvas, video, picture, math, object[type^="image/"]') !== null) continue
    // A composite of styled containers CARRIES its content in the markup (a
    // capture-rendered figure is boxes of text): what is not the caption is
    // the figure's own words, and enough of them means the picture is here.
    const own = Array.from(figure.children)
      .filter(child => child.localName !== 'figcaption')
      .map(child => child.textContent ?? '')
      .join('')
    if (collapse(own).length >= 20) continue
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
  for (const node of Array.from(body.querySelectorAll([...DROP_TAGS, ...DROP_STRIP_EXTRA].join(',')))) {
    node.remove()
  }
  // Same edge trim as normalizeElement: boundaries at the extremes are dead.
  return normalizeChildren(body, baseUrl).trim()
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
  // Edge trim: the unwrap boundary leaves a dead newline at either extreme,
  // which renders as nothing and would only dirty the stored body's bytes.
  return normalizeChildren(element, baseUrl).trim()
}

/** Normalize every child of a node. */
function normalizeChildren(node: Node, baseUrl: string | undefined, inFigure = false): string {
  const parts: string[] = []
  for (const child of Array.from(node.childNodes)) {
    const normalized = normalizeNode(child, baseUrl, inFigure)
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
function normalizeNode(node: Node, baseUrl: string | undefined, inFigure = false): string {
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
  // LaTeXML embeds vector figures as image-typed objects: an image in every
  // sense that matters here. Any other object (a PDF, a movie) keeps the old
  // DROP behavior — subtree and fallback content alike.
  if (tag === 'object') return objectImg(element, baseUrl)
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
  // Capture-rendered pages carry their rescued figures as inline SVG with
  // styles inlined onto the elements; the subset walker below keeps the chart
  // and strips the injection-shaped members (script, foreignObject, SMIL).
  if (tag === 'svg') return normalizeSvg(element)
  if (tag === 'br') return '<br>'
  if (tag === 'hr') return '<hr>'

  const inner = normalizeChildren(element, baseUrl, inFigure || tag === 'figure')
  // A figure's composite layout IS its content (a capture-rendered figure is a
  // diagram plus property cards built from styled containers), so inside one
  // the div/span boxes survive as elements with their allowlisted style —
  // everywhere else they unwrap, as before.
  if (inFigure && (tag === 'div' || tag === 'span')) {
    const style = figureStyle(element.getAttribute('style'))
    // A kept container with neither text nor style is a shell, not a layout.
    if (inner.trim().length === 0 && style === undefined) return ''
    return `<${tag}${style === undefined ? '' : ` style="${escapeAttribute(style)}"`}>${inner}</${tag}>`
  }
  if (!KEEP_TAGS.has(tag)) {
    // Unwrapped block-ish containers leave a word boundary: capture's
    // serialization carries no inter-tag whitespace, and two sibling cards
    // must never concatenate into one run of text.
    return UNWRAP_BOUNDARY_TAGS.has(tag) || tag.includes('-') ? `\n${inner}\n` : inner
  }
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
function emitImg(src: string, alt: string | null, dimensions: { readonly width?: string; readonly height?: string } = {}): string {
  const width = dimensions.width === undefined ? '' : ` width="${dimensions.width}"`
  const height = dimensions.height === undefined ? '' : ` height="${dimensions.height}"`
  return `<img src="${escapeAttribute(src)}"${alt === null ? '' : ` alt="${escapeAttribute(alt)}"`}${width}${height} referrerpolicy="no-referrer">`
}

/** An integer dimension worth carrying onto the emitted image (nothing else is trusted). */
function dimensionAttr(value: string | null): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  return /^[1-9]\d{0,4}$/.test(trimmed) ? trimmed : undefined
}

/**
 * Resolve an `<object>` to a normalized `<img>`, or to nothing.
 *
 * Only `type="image/…"` objects with a fetchable `data` address qualify — that
 * is the LaTeXML figure shape (`<object type="image/svg+xml" data="fig.svg"
 * width height>`). The page's own width/height ride along when they are plain
 * integers: an image with known dimensions is the difference between a stable
 * layout and the growing document the reading-position note is about. The
 * fallback children an object may carry are dropped with it — they duplicate
 * the caption, not the picture.
 */
function objectImg(element: Element, baseUrl: string | undefined): string {
  const type = (element.getAttribute('type') ?? '').trim()
  if (!/^image\//i.test(type)) return ''
  const src = absolutize(element.getAttribute('data'), baseUrl)
  if (src === undefined) return ''
  const width = dimensionAttr(element.getAttribute('width'))
  const height = dimensionAttr(element.getAttribute('height'))
  return emitImg(src, element.getAttribute('alt'), {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  })
}

/* --------------------------------------------------------- the SVG subset */

/**
 * Inline SVG: the chart markup a capture-rendered page carries.
 *
 * The capture package (the ingest proposal's M1) returns the RENDERED page:
 * figures the origin site paints with scripts arrive as inline SVG with the
 * computed styles inlined onto the elements. Keeping a static subset is what
 * lets those figures into the body at all. The rules:
 *
 * - a fixed element set (shapes, text, defs/clip/mask/pattern, gradients,
 *   `use`/`symbol`), looked up case-insensitively and emitted in the canonical
 *   SVG casing — the HTML parser's foreign-content adjustment already gave us
 *   that casing, and the emitted string is re-parsed as HTML downstream;
 * - `<script>`, `<foreignObject>` (the HTML-injection vector inside SVG) and
 *   every SMIL element (`animate`, `set`, …) drop with their subtrees — a
 *   static figure needs none of them;
 * - attributes come from one whitelist (geometry, presentation, the inlined
 *   `style`, paint-server/clip refs, and `id` — `url(#…)` and `href="#…"` point
 *   at it), and any value containing `url(` must reference a same-document
 *   fragment, so no external paint server, font or pixel loads;
 * - `use`/`textPath` keep `href` only when it IS a fragment (`#…`) — an
 *   external reference drops the element (and legacy `xlink:href` normalizes
 *   to `href`).
 *
 * No per-element size cap: the body's own size machinery (the fetch cap, the
 * sidecar threshold) bounds the whole markup, and a chart's `<path>` data is
 * the content the cap exists to bound.
 */

/** Canonical SVG names by lowercase form (the parser adjusts them; garbage may not). */
const SVG_TAGS: ReadonlyMap<string, string> = new Map(
  [
    'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'textPath', 'defs', 'clipPath', 'mask', 'pattern',
    'linearGradient', 'radialGradient', 'stop', 'use', 'symbol', 'marker', 'desc',
  ].map(name => [name.toLowerCase(), name]),
)

/** Subtree-dropped inside SVG: script-capable or animated. (`title` collides with the HTML drop.) */
const SVG_DROP = new Set(['script', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set'])

/** Attributes kept on SVG elements; everything else (event handlers included) is stripped. */
const SVG_ATTRIBUTES: readonly string[] = [
  'id',
  // geometry
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points',
  'width', 'height', 'viewBox', 'transform', 'dx', 'dy',
  // presentation
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'fill-rule', 'clip-rule', 'text-anchor', 'font-size', 'font-family',
  'font-weight', 'font-style', 'dominant-baseline', 'textLength', 'letter-spacing',
  // the capture pipeline's inlined computed style (CSS is non-executable)
  'style',
  // references and paint servers
  'clip-path', 'mask', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform',
  'patternContentUnits', 'spreadMethod', 'preserveAspectRatio', 'startOffset',
  'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'refX', 'refY',
  'marker-start', 'marker-mid', 'marker-end',
]

/** A kept value may only reference this same document: every `url(` must open a `#` fragment. */
function svgValueSafe(value: string): boolean {
  const refs = value.match(/url\(/gi)
  if (refs === null) return true
  return refs.length === (value.match(/url\(\s*['"]?#/gi) ?? []).length
}

/** The whitelisted attributes of one SVG element, in the whitelist's order. */
function svgAttributes(element: Element): string {
  const parts: string[] = []
  for (const name of SVG_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value === null || !svgValueSafe(value)) continue
    parts.push(` ${name}="${escapeAttribute(value)}"`)
  }
  return parts.join('')
}

/** One SVG subtree → whitelisted markup (or empty). */
function normalizeSvg(element: Element): string {
  const name = element.localName.toLowerCase()
  if (SVG_DROP.has(name)) return ''
  const canonical = SVG_TAGS.get(name)
  if (canonical === undefined) return normalizeSvgChildren(element)
  if (canonical === 'use' || canonical === 'textPath') {
    // A fragment reference only: an external one drops the element outright.
    const href = (element.getAttribute('href') ?? element.getAttribute('xlink:href'))?.trim()
    if (href === undefined || !/^#\S+$/.test(href)) return ''
    return `<${canonical} href="${escapeAttribute(href)}"${svgAttributes(element)}>${normalizeSvgChildren(element)}</${canonical}>`
  }
  return `<${canonical}${svgAttributes(element)}>${normalizeSvgChildren(element)}</${canonical}>`
}

/** Every child of an SVG node: text is escaped, elements walk the subset. */
function normalizeSvgChildren(element: Element): string {
  const parts: string[] = []
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      parts.push(escapeHtml((child.textContent ?? '').replace(/\s+/g, ' ')))
      continue
    }
    if (child.nodeType !== 1 /* element */) continue
    parts.push(normalizeSvg(child as Element))
  }
  return parts.join('')
}

/**
 * The payload size that separates a real inlined figure from a 1px tracking
 * placeholder. A transparent-gif placeholder is ~70 characters of base64; the
 * smallest real chart is thousands — the threshold sits far from both, so no
 * borderline page ever decides anything. (transformer-circuits.pub inlines its
 * real figures as multi-hundred-KB data URIs; the old all-data:-is-placeholder
 * rule deleted them.)
 */
export const DATA_IMAGE_MIN_PAYLOAD = 512

/** The image types a kept data: URI may declare. */
const DATA_IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp|svg\+xml|avif)$/i

/**
 * A `data:` URI worth keeping as an image, or `undefined` (which reads as
 * ABSENT — the caller falls through to the lazy-loading attributes).
 *
 * The gate is MIME plus payload size; base64 payloads are whitespace-stripped
 * because pages line-wrap them (a raw newline inside an emitted attribute is
 * legal HTML, but the stripped form is what browsers parse either way).
 */
export function substantiveDataImage(value: string): string | undefined {
  const match = /^\s*data:([^;,]+)((?:;[^;,]+)*),([\s\S]*)$/i.exec(value)
  if (match === null) return undefined
  const [, mime, parameters, payload] = match
  if (mime === undefined || payload === undefined || !DATA_IMAGE_MIME.test(mime)) return undefined
  const body = /;base64/i.test(parameters ?? '') ? payload.replace(/\s+/g, '') : payload
  if (body.length < DATA_IMAGE_MIN_PAYLOAD) return undefined
  return `data:${mime}${parameters ?? ''},${body}`
}

/**
 * Resolve the URL an image actually loads, past the lazy-loading tricks.
 *
 * The order is the order of trust: a real `src` first (a `data:` URI there is
 * the classic 1px placeholder and counts as ABSENT — UNLESS it is a substantive
 * inlined image, see {@link substantiveDataImage}), then the lazy-loading
 * attributes, then the best `srcset` candidate. Only when nothing usable
 * remains is the image dropped.
 *
 * @param element - the `<img>` element.
 * @param baseUrl - base for relative URL resolution.
 * @returns the absolute URL, or `undefined`.
 */
function imageSrc(element: Element, baseUrl: string | undefined): string | undefined {
  const src = element.getAttribute('src')
  if (src !== null) {
    if (/^\s*data:/i.test(src)) {
      const inlined = substantiveDataImage(src)
      if (inlined !== undefined) return inlined
    } else {
      const resolved = absolutize(src, baseUrl)
      if (resolved !== undefined) return resolved
    }
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
    // candidate that can WIN. Rejoin the halves: the whole candidate is then
    // judged by the same gate as any src (a substantive inlined image is kept,
    // a placeholder is not), but its tail must never stand alone.
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
    // A data: candidate is judged by the same gate as a data: src.
    const url = /^\s*data:/i.test(raw) ? substantiveDataImage(raw) : absolutize(raw, baseUrl)
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
    // An object's fallback text and a chart's text labels are the same chrome.
    if (tag === 'noscript' || tag === 'object' || tag === 'svg') continue
    if (tag === 'br') {
      out += ' '
      continue
    }
    const inner = serializeInline(child)
    // Blocks and links are flattened: the summary carries the words, not the
    // structure. Emphasis survives because it is cheap and often meaningful.
    // The trailing space is the word boundary the block used to mark — two
    // flattened siblings must never read as one word (the composite-figure bug).
    if (!INLINE_TAGS.has(tag) || tag === 'a') {
      out += `${inner} `
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
