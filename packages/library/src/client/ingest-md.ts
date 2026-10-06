/**
 * Markdown / plain-text ingestion: split a text into chapters on its heading
 * hierarchy and render a minimal, whitelist-shaped HTML per chapter. The
 * renderer is deliberately small — headings, paragraphs, list items, fenced
 * code, blockquotes, and the two inline emphases; a Markdown book that uses
 * more keeps its text, unbeautified (ingestion never fails on markup it does
 * not know).
 *
 * @module @khorsheed/dsh-library/client/ingest-md
 */

/** One split chapter. */
export interface MarkdownChapter {
  readonly title: string
  readonly html: string
}

/** The result of splitting a Markdown text. */
export type MarkdownIngest =
  | { readonly ok: true; readonly chapters: readonly MarkdownChapter[] }
  | { readonly ok: false; readonly error: 'empty' }

/** Escape the three characters HTML text must not carry raw. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The minimal inline renderer: code spans, bold, italic, links. */
function renderInline(text: string): string {
  let out = escapeText(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return out
}

/** Render one chapter's Markdown lines to whitelist-shaped HTML. */
export function renderMarkdownBlock(lines: readonly string[]): string {
  const out: string[] = []
  let paragraph: string[] = []
  let list: 'ul' | 'ol' | null = null
  let fence: string[] | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = (): void => {
    if (list === null) return
    out.push(`</${list}>`)
    list = null
  }
  const flushBlocks = (): void => {
    flushParagraph()
    flushList()
  }

  for (const line of lines) {
    if (fence !== null) {
      if (/^```/.test(line.trim())) {
        out.push(`<pre><code>${escapeText(fence.join('\n'))}</code></pre>`)
        fence = null
      } else {
        fence.push(line)
      }
      continue
    }
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) {
      flushBlocks()
      fence = []
      continue
    }
    if (trimmed === '') {
      flushBlocks()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading !== null) {
      flushBlocks()
      // Chapter bodies start at h3: h1/h2 are the book/part's own, and the
      // reading view draws its own heading.
      const level = Math.min(heading[1]!.length + 2, 6)
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`)
      continue
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed)
    if (unordered !== null) {
      flushParagraph()
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${renderInline(unordered[1]!)}</li>`)
      continue
    }
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed)
    if (ordered !== null) {
      flushParagraph()
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${renderInline(ordered[1]!)}</li>`)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote !== null) {
      flushBlocks()
      out.push(`<blockquote>${renderInline(quote[1]!)}</blockquote>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushBlocks()
      out.push('<hr>')
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  if (fence !== null) out.push(`<pre><code>${escapeText(fence.join('\n'))}</code></pre>`)
  flushBlocks()
  return out.join('\n')
}

/**
 * Split a Markdown text into chapters on its headings. The split level is the
 * shallowest heading level that names more than one thing: a level seen once
 * is the document's own title, not a chapter (so `# Title` + `## Chapter …`
 * splits on `##`, while `# A` + `# B` splits on `#`). Content before the first
 * split heading (the title line included) opens the first chapter. A document
 * with no headings is one chapter.
 * @param text - the Markdown source.
 * @returns the chapters, or `empty` when the text says nothing.
 */
export function splitMarkdown(text: string): MarkdownIngest {
  const lines = text.split(/\r?\n/)
  if (lines.every(line => line.trim() === '')) return { ok: false, error: 'empty' }

  const headingOf = (line: string): { level: number; title: string } | null => {
    const match = /^(#{1,6})\s+(\S.*)$/.exec(line.trim())
    return match === null ? null : { level: match[1]!.length, title: match[2]!.trim() }
  }
  const levels = lines.flatMap(line => {
    const heading = headingOf(line)
    return heading === null ? [] : [heading.level]
  })

  if (levels.length === 0) {
    return { ok: true, chapters: [{ title: '全文', html: renderMarkdownBlock(lines) }] }
  }

  const topLevel = Math.min(...levels)
  const countAt = (level: number): number => levels.filter(candidate => candidate === level).length
  const splitLevel = countAt(topLevel) > 1 ? topLevel
    : countAt(topLevel + 1) > 0 ? topLevel + 1
    : topLevel

  const chapters: { title: string; lines: string[] }[] = []
  let current: { title: string; lines: string[] } | null = null
  const preamble: string[] = []
  for (const line of lines) {
    const heading = headingOf(line)
    if (heading !== null && heading.level === splitLevel) {
      if (current !== null) chapters.push(current)
      current = { title: heading.title, lines: [] }
      continue
    }
    if (current === null) preamble.push(line)
    else current.lines.push(line)
  }
  if (current !== null) chapters.push(current)

  // Content ahead of the first split heading (the document title, front
  // matter) opens the first chapter rather than vanishing.
  if (preamble.some(line => line.trim() !== '') && chapters.length > 0) {
    chapters[0]!.lines.unshift(...preamble)
  }

  const rendered = chapters
    .map(chapter => ({ title: chapter.title, html: renderMarkdownBlock(chapter.lines) }))
    .filter(chapter => chapter.html !== '' || chapter.title !== '')
  if (rendered.length === 0) return { ok: false, error: 'empty' }
  return { ok: true, chapters: rendered }
}
