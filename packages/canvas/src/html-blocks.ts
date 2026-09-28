/**
 * Whole HTML blocks inside a markdown card or manuscript (2026-09-28 review:
 * an agent-drawn `<div style=…>` diagram showed as its raw source, because the
 * host's `MarkdownText` keeps raw HTML literal by design).
 *
 * The split is CONSERVATIVE, like `detectCardFormat`: a block opens only on a
 * line that starts with a block-level tag, and it is taken only when that tag
 * closes further on. Inline HTML inside a paragraph, a tag inside a code fence
 * and an unclosed tag all stay markdown, so ordinary prose never flips into a
 * frame and nothing after a stray `<div>` is swallowed.
 *
 * Runtime-agnostic on purpose: no DOM, no node.
 *
 * @module @khorsheed/dsh-canvas
 */

/** One run of a text: markdown as it was, or one whole HTML block. */
export type TextSegment =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'html'; readonly html: string }

/** Tags that open a block when a line starts with one. */
const BLOCK_TAGS = 'div|figure|table|section|article|aside|details|svg|center|p|blockquote'

/** A line that opens a block: at most three spaces, then a block tag. */
const BLOCK_OPEN = new RegExp(`^ {0,3}<(${BLOCK_TAGS})(?=[\\s>/])`, 'i')

/** A code fence line (``` or ~~~), with its marker. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Where the block opened at `start` ends: the end of the line its tag closes
 * on, or -1 when it never closes.
 */
function blockEndOf(text: string, start: number, tag: string): number {
  const tags = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'gi')
  tags.lastIndex = start
  let depth = 0
  for (let match = tags.exec(text); match !== null; match = tags.exec(text)) {
    if (match[1] === '/') depth -= 1
    else if (match[2] !== '/') depth += 1
    if (depth <= 0) {
      const lineEnd = text.indexOf('\n', match.index + match[0].length)
      return lineEnd === -1 ? text.length : lineEnd
    }
  }
  return -1
}

/**
 * Split a text into markdown runs and whole HTML blocks. A text with no block
 * comes back as one markdown run holding the very same string.
 */
export function splitHtmlBlocks(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let markdownFrom = 0
  let fence: string | null = null
  let lineStart = 0
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)
    const fenceMark = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (fenceMark !== undefined && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null
    } else if (fenceMark !== undefined) {
      fence = fenceMark
    } else {
      const open = BLOCK_OPEN.exec(line)
      const end = open === null ? -1 : blockEndOf(text, lineStart, open[1]!)
      if (end !== -1) {
        const before = text.slice(markdownFrom, lineStart)
        if (before.trim().length > 0) segments.push({ kind: 'markdown', text: before })
        segments.push({ kind: 'html', html: text.slice(lineStart, end).trim() })
        markdownFrom = end + 1
        lineStart = end + 1
        continue
      }
    }
    if (newline === -1) break
    lineStart = newline + 1
  }
  if (segments.length === 0) return [{ kind: 'markdown', text }]
  const rest = text.slice(markdownFrom)
  if (rest.trim().length > 0) segments.push({ kind: 'markdown', text: rest })
  return segments
}

/** The text with each whole HTML block replaced by `mark` (board summaries). */
export function withHtmlBlocksMarked(text: string, mark: string): string {
  const segments = splitHtmlBlocks(text)
  if (segments.length === 1 && segments[0]!.kind === 'markdown') return text
  return segments.map(segment => segment.kind === 'markdown' ? segment.text.replace(/\n+$/, '') : mark).join('\n')
}
