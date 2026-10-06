/**
 * The whitelist sanitizer every ingested chapter passes through (a simplified
 * take on the reader's extraction pipeline): the DOM is walked, and only
 * whitelisted elements survive — `script`/`style`/`iframe` and their kin are
 * dropped whole, transparent layout elements (`div`, `span`, `section`…) are
 * unwrapped to their children, and attributes are reduced to `href` on links
 * (http/https/mailto only) and `src`/`alt` on images (http/https/data only).
 * The output is the normalized HTML every downstream surface (reading view,
 * quoting, quizzing) consumes without adaptation.
 *
 * @module @khorsheed/dsh-library/client/sanitize
 */

/** Elements kept whole (their children are sanitized, the tag survives). */
const KEEP = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'em', 'strong', 'b', 'i', 'u', 's', 'sup', 'sub', 'small', 'mark',
  'a', 'img', 'figure', 'figcaption', 'br', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
])

/** Elements dropped with their whole subtree. */
const DROP = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'noscript',
  'form', 'input', 'button', 'select', 'textarea', 'option',
  'audio', 'video', 'source', 'track', 'canvas', 'svg', 'math',
  'template', 'slot', 'portal',
])

/** Everything else: unwrap — the children are sanitized, the tag dissolves. */

/** The URL schemes a link may carry. */
const LINK_SCHEME = /^(https?:|mailto:)/i

/** The URL schemes an image may carry. */
const IMAGE_SCHEME = /^(https?:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);)/i

/** Sanitize one element's attributes down to the whitelist. */
function sanitizeAttributes(source: Element, target: Element): void {
  if (source.tagName === 'A') {
    const href = source.getAttribute('href')
    if (href !== null && LINK_SCHEME.test(href.trim())) target.setAttribute('href', href.trim())
    return
  }
  if (source.tagName === 'IMG') {
    const src = source.getAttribute('src')
    if (src !== null && IMAGE_SCHEME.test(src.trim())) target.setAttribute('src', src.trim())
    const alt = source.getAttribute('alt')
    if (alt !== null) target.setAttribute('alt', alt)
    return
  }
  if (source.tagName === 'TD' || source.tagName === 'TH') {
    for (const span of ['colspan', 'rowspan'] as const) {
      const value = source.getAttribute(span)
      if (value !== null && /^\d{1,2}$/.test(value)) target.setAttribute(span, value)
    }
  }
}

/** Walk `source`, appending its sanitized counterpart under `target`. */
function sanitizeInto(source: Node, target: Node, doc: Document): void {
  for (const child of [...source.childNodes]) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''))
      continue
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) continue
    const element = child as Element
    const tag = element.tagName.toLowerCase()
    if (DROP.has(tag)) continue
    if (!KEEP.has(tag)) {
      // Transparent: the tag dissolves, the children are sanitized upward.
      sanitizeInto(element, target, doc)
      continue
    }
    const kept = doc.createElement(tag)
    sanitizeAttributes(element, kept)
    sanitizeInto(element, kept, doc)
    target.appendChild(kept)
  }
}

/**
 * Sanitize a chapter's markup.
 * @param html - the parsed chapter's inner markup.
 * @param doc - a document to build the sanitized tree with (the caller's
 *   `document`, or a DOMParser-produced one).
 * @returns the normalized whitelist HTML.
 */
export function sanitizeChapterHtml(html: string, doc: Document = document): string {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const container = parsed.querySelector('div')!
  const out = doc.createElement('div')
  sanitizeInto(container, out, doc)
  return out.innerHTML.trim()
}

/** Whether a sanitized chapter still says anything (a tag-soup page may not). */
export function chapterHasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
