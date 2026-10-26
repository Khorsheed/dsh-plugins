/**
 * The markdown preview's media layer: what a README's raw HTML and relative
 * destinations need before the official renderer can show them.
 *
 * The official renderer deliberately parses no HTML — raw HTML stays literal
 * text. READMEs, though, routinely spell their screenshots as `<img>` (to set
 * a width) inside `<p align="center">`. {@link rewriteHtmlMedia} turns exactly
 * that vocabulary — `<img>`, an `<a>` around it, and the alignment wrappers —
 * into markdown image/link syntax the renderer already handles safely; every
 * other tag stays literal, and nothing inside code (fences, indented blocks,
 * inline spans) is touched, so a README that DOCUMENTS an `<img>` tag still
 * shows the tag. The rewrite feeds only the rendered face; the source face and
 * the editor keep the file's own text.
 *
 * {@link resolveDocPath} maps a destination as authored in the document to a
 * path in the SURFACE's own path space (absolute for local files,
 * repo-relative for worktrees, cwd-relative for session files): relative
 * destinations resolve against the document's directory.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import { dirnameOf } from './language.ts'

/** A fence opener: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** Alignment wrappers that only position their content (dropped, content kept). */
const WRAPPER_TAG = /<\/?(?:p|div|center|picture)\b[^>]*>|<source\b[^>]*>/gi
/** One HTML attribute: name = "double" | 'single' | bare. */
const ATTRIBUTE = /([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

/** Decode the handful of entities an attribute value realistically carries. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, '\'').replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Attributes of one start tag, lower-cased names, entity-decoded values. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of tag.matchAll(ATTRIBUTE)) {
    attributes.set(match[1]!.toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

/** A markdown destination: bare when safe, angle-bracketed when it has spaces or parentheses. */
function destination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : url
}

/** Link/alt text with markdown's bracket and backslash metacharacters escaped. */
function label(text: string): string {
  return text.replace(/[\\[\]]/g, match => `\\${match}`)
}

/** Rewrite the media tags of one stretch of text that is known not to be code. */
function rewriteSegment(text: string): string {
  let out = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const attributes = attributesOf(tag)
    const src = attributes.get('src')
    if (src === undefined || src.trim() === '') return tag
    return `![${label(attributes.get('alt') ?? '')}](${destination(src.trim())})`
  })
  // An anchor whose content is now plain markdown (typically a linked image).
  out = out.replace(/<a\b([^>]*)>([^<]*)<\/a>/gi, (tag, attrs: string, inner: string) => {
    const href = attributesOf(attrs).get('href')
    return href === undefined || href.trim() === '' ? tag : `[${inner.trim()}](${destination(href.trim())})`
  })
  return out.replace(WRAPPER_TAG, '')
}

/** Apply `fn` to every stretch of one non-code line outside its inline code spans. */
function mapOutsideInlineCode(line: string, fn: (segment: string) => string): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = line.indexOf('`', at)
    if (open < 0) break
    let run = open
    while (line[run] === '`') run++
    const ticks = line.slice(open, run)
    // The span closes on a backtick run of exactly the same length.
    let close = line.indexOf(ticks, run)
    while (close >= 0 && (line[close + ticks.length] === '`' || line[close - 1] === '`')) {
      close = line.indexOf(ticks, close + 1)
    }
    if (close < 0) break
    out += fn(line.slice(at, open)) + line.slice(open, close + ticks.length)
    at = close + ticks.length
  }
  return out + fn(line.slice(at))
}

/** Rewrite one non-code line's media tags, leaving its inline code spans untouched. */
function rewriteLine(line: string): string {
  const rewritten = mapOutsideInlineCode(line, rewriteSegment)
  const trimmed = rewritten.trim()
  // A multi-line anchor leaves its bare open/close tags on their own lines:
  // the image between them still shows, the link does not.
  if (/^(?:<a\b[^>]*>|<\/a>)$/i.test(trimmed)) return ''
  if (rewritten === line) return line
  // Lines that held only tags are re-emitted flush-left: indentation that was
  // HTML layout must not turn the image into an indented code block.
  return trimmed === '' ? '' : (/^\s*<|^\s*!\[/.test(line) ? trimmed : rewritten)
}

/**
 * Rewrite a markdown document's HTML media into markdown syntax (see the
 * module doc for the exact vocabulary). Code is never touched.
 * @param text - the markdown source.
 * @returns the text the rendered face should parse.
 */
export function rewriteHtmlMedia(text: string): string {
  if (!/<(?:img|a|p|div|center|picture|source)\b/i.test(text)) return text
  return mapProseLines(text, rewriteLine)
}

/** Apply `fn` to every non-blank line that is not code (fences and indented blocks skipped). */
function mapProseLines(text: string, fn: (line: string) => string): string {
  const lines = text.split('\n')
  let fence: string | null = null
  let indentedCode = false
  let previousBlank = true
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const blank = line.trim() === ''
    if (fence !== null) {
      const close = FENCE.exec(line)
      if (close !== null && close[1]![0] === fence[0] && close[1]!.length >= fence.length && line.trim() === close[1]) fence = null
    } else if (FENCE.test(line)) {
      fence = FENCE.exec(line)![1]!
    } else {
      // An indented code block starts after a blank line and runs while
      // lines stay indented (blank lines inside it included).
      indentedCode = /^(?: {4}|\t)/.test(line) ? (indentedCode || previousBlank) : (blank && indentedCode)
      if (!indentedCode && !blank) lines[index] = fn(line)
    }
    previousBlank = blank
  }
  return lines.join('\n')
}

/** One inline markdown image: alt, then a bare or <angle> destination, then an optional title. */
const MARKDOWN_IMAGE = /!\[((?:\\.|[^\\\]])*)\]\(\s*(<[^>\n]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

/**
 * Replace every inline image whose destination failed to load with a link to
 * that destination, so a broken image says so — and offers the address —
 * instead of silently showing its alt text. An image already inside a link
 * (a linked badge) becomes the link's text instead: links do not nest.
 * Code is never touched.
 * @param text - markdown (after {@link rewriteHtmlMedia}).
 * @param failed - whether one destination, as authored, failed.
 * @param describe - the link text for one failed image, given its alt (or file name).
 * @returns the text with failed images turned into links.
 */
export function linkFailedImages(text: string, failed: (destination: string) => boolean, describe: (name: string) => string): string {
  if (!text.includes('![')) return text
  return mapProseLines(text, line => mapOutsideInlineCode(line, segment => segment.replace(
    MARKDOWN_IMAGE,
    (match: string, alt: string, token: string, offset: number, whole: string) => {
      const target = token.startsWith('<') ? token.slice(1, -1) : token
      if (!failed(target)) return match
      const name = alt.replace(/\\(.)/g, '$1').trim() || target.split(/[\\/]/).pop() || target
      const shown = label(`⚠ ${describe(name)}`)
      return whole[offset - 1] === '[' ? shown : `[${shown}](${token})`
    },
  )))
}

/** Whether a destination names a URL (scheme or protocol-relative) rather than a path. */
function isUrl(value: string): boolean {
  return /^[\\/]{2}/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
}

/**
 * Resolve one destination authored in a document to a path in the surface's
 * own path space. Relative destinations resolve against the document's
 * directory; `.`/`..` segments normalize; a relative path climbing above its
 * root, a URL, or a fragment-only/empty destination resolves to nothing.
 * @param docPath - the document's path (absolute, or relative to the surface's root).
 * @param value - the destination as the renderer hands it over.
 * @returns the resolved path, or undefined.
 */
export function resolveDocPath(docPath: string, value: string): string | undefined {
  let target = value.trim()
  const cut = target.search(/[?#]/)
  if (cut >= 0) target = target.slice(0, cut)
  try {
    target = decodeURIComponent(target)
  } catch {
    // A malformed escape names no file unambiguously.
    return undefined
  }
  if (target === '' || isUrl(target) || /[\u0000-\u001f]/.test(target)) return undefined
  const absolute = target.startsWith('/')
  const base = absolute ? '' : dirnameOf(docPath)
  const rooted = absolute || docPath.startsWith('/')
  const segments: string[] = []
  for (const segment of `${base}/${target}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0) segments.pop()
      else if (!rooted) return undefined
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) return undefined
  return `${rooted ? '/' : ''}${segments.join('/')}`
}

/** Whether an image destination already names something the renderer shows unaided. */
export function isRenderableImageUrl(value: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(value.trim())
}
