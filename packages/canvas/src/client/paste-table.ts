/**
 * Clipboard → card text: which flavor of a paste lands in the editor.
 *
 * Three sources are worth converting and they arrive differently. A
 * spreadsheet or a web page offers `text/html` — the richest signal, and the
 * only one that survives a page's own table styling — so it is tried first.
 * Plain tab-separated text is the table fallback (a spreadsheet that shipped
 * no HTML, a terminal, a text editor). And rich text that is neither page nor
 * table converts through `htmlToMarkdown` so a rendered copy keeps its
 * formatting — with the honesty check that the converted words match the
 * clipboard's own plain flavor before any markdown replaces it. Anything else
 * is left alone: mangling ordinary pasted prose is a far worse failure than
 * declining to convert.
 *
 * The deliberate restraint is on the plain-text path: it converts only when
 * the shape is unambiguously a table (two or more rows agreeing on a column
 * count of two or more).
 *
 * The paste arm (`choosePaste`) sits ABOVE the table conversion and answers the
 * question the renderer actually asks: the card's format is sniffed from its
 * WHOLE text (`card-format.ts`), never from a flag, so "is this clipboard a
 * page?" is only answerable against the card the paste would produce.
 *
 * @module @khorsheed/dsh-canvas/client
 */

import { detectCardFormat } from '../card-format.ts'

/** One paste's conversion outcome and which source produced it. */
export interface PasteConversion {
  /** The markdown table to insert. */
  readonly markdown: string
  /** Which clipboard representation it came from. */
  readonly source: 'html-table' | 'tsv'
}

/**
 * Parse delimited text into rows, honouring spreadsheet quoting: a field
 * wrapped in `"` may contain the delimiter, newlines, and `""` as a literal
 * quote. `\r` is dropped so CRLF and LF inputs behave identically.
 * @param text - the raw clipboard text.
 * @param delimiter - the field delimiter (tab for TSV).
 * @returns rows of cell strings; trailing fully-empty rows are dropped.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      cell += char
      index += 1
      continue
    }
    if (char === '"') {
      quoted = true
      index += 1
      continue
    }
    if (char === delimiter) {
      row.push(cell)
      cell = ''
      index += 1
      continue
    }
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      index += 1
      continue
    }
    if (char === '\r') {
      index += 1
      continue
    }
    cell += char
    index += 1
  }
  row.push(cell)
  rows.push(row)
  while (rows.length > 0 && rows[rows.length - 1]!.every(entry => entry === '')) rows.pop()
  return rows
}

/** Normalize one cell for a markdown table: one line, literal pipes escaped. */
function cleanCell(value: string): string {
  return value
    .replace(/\r\n?|\n/g, '<br>')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}

/**
 * Render rows as a GitHub-flavored markdown table. The first row becomes the
 * header — markdown tables have no way to express a headerless one, so the
 * convention is stated rather than guessed, and ragged rows are padded.
 * @param rows - cell rows; the first is the header.
 * @returns the markdown table.
 */
export function toMarkdownTable(rows: readonly (readonly string[])[]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const padded = rows.map(row => {
    const cells = row.map(cleanCell)
    while (cells.length < width) cells.push('')
    return cells
  })
  const header = padded[0] ?? []
  const separator = header.map(() => '---')
  const body = padded.slice(1)
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(separator), ...body.map(line)].join('\n')
}

/**
 * Whether plain clipboard text is unambiguously a tab-separated table: two or
 * more rows, two or more columns, and all but at most one row agreeing on the
 * column count (a single ragged row is a trailing artifact, not prose).
 * @param text - the clipboard's `text/plain`.
 * @returns true when converting is safe.
 */
export function looksLikeTsv(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (normalized.length === 0) return false
  const lines = normalized.split('\n')
  if (lines.length < 2) return false
  const counts = lines.map(line => line.split('\t').length)
  const first = counts[0]!
  if (first < 2) return false
  const agreeing = counts.filter(count => count === first).length
  return agreeing >= 2 && agreeing >= lines.length - 1
}

/**
 * Convert the first `<table>` in an HTML fragment to a markdown table.
 *
 * Only the table is taken, not the document: a spreadsheet's clipboard HTML
 * carries the whole sheet plus styling, and a web page's carries its chrome —
 * extracting the table is both more robust than converting the document and
 * the only way to insert the table at the caret without dragging the rest in.
 * A cell spanning columns contributes its text plus the empty slots it covers,
 * so the grid stays rectangular; spans therefore degrade to left alignment.
 *
 * @param html - the clipboard's `text/html`.
 * @returns the markdown table, or null when there is no usable table.
 */
export function htmlTableToMarkdown(html: string): string | null {
  if (html.length === 0 || !/<table[\s>]/i.test(html)) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (table === null) return null
  const rows = rowsOfTable(table)
  if (rows.length < 2) return null
  return toMarkdownTable(rows)
}

/** One table element as cell rows (spans degrade to text plus empty slots). */
function rowsOfTable(table: Element): string[][] {
  const rows: string[][] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells: string[] = []
    for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
      const span = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10)
      cells.push((cell.textContent ?? '').trim())
      for (let extra = 1; extra < span; extra += 1) cells.push('')
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

/**
 * What a rich-text paste converts to. `text` is the conversion's own plain
 * rendering, whitespace-stripped: the caller compares it against the
 * clipboard's `text/plain` and only takes the markdown when the two agree —
 * a conversion that drops words the plain flavor kept is declined, because
 * losing content is the failure this whole module exists to avoid.
 */
export interface MarkupConversion {
  readonly markdown: string
  readonly text: string
}

/** Inline emphasis with its surrounding whitespace kept OUTSIDE the sigils. */
function wrapInline(sigil: string, text: string): string {
  if (text.trim() === '') return text
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  return `${lead}${sigil}${text.trim()}${sigil}${trail}`
}

/** Inline code: fenced wider when the code itself carries a backtick. */
function codeSpan(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  return flat.includes('`') ? `\`\` ${flat} \`\`` : `\`${flat}\``
}

/** One node's inline rendering (bold, italic, code, links, breaks, alt text). */
function inlineOf(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/\s+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const inner = (): string => Array.from(el.childNodes).map(inlineOf).join('')
  switch (el.tagName.toLowerCase()) {
    case 'b': case 'strong': return wrapInline('**', inner())
    case 'i': case 'em': return wrapInline('*', inner())
    case 's': case 'del': case 'strike': return wrapInline('~~', inner())
    case 'code': return codeSpan(el.textContent ?? '')
    case 'a': {
      const text = inner().trim()
      const href = el.getAttribute('href') ?? ''
      // A link worth keeping points somewhere fetchable; an anchor or a
      // javascript: relic collapses to its words.
      return /^https?:\/\//i.test(href) || href.startsWith('mailto:') ? `[${text}](${href})` : text
    }
    case 'br': return '\n'
    case 'img': return el.getAttribute('alt') ?? ''
    default: return inner()
  }
}

/** One list (`ul`/`ol`) as markdown lines, nested lists indented two spaces. */
function listLinesOf(list: Element, depth: number): string[] {
  const ordered = list.tagName.toLowerCase() === 'ol'
  let ordinal = ordered ? Number.parseInt(list.getAttribute('start') ?? '1', 10) - 1 : 0
  const pad = '  '.repeat(depth)
  const lines: string[] = []
  for (const item of Array.from(list.children)) {
    if (item.tagName.toLowerCase() !== 'li') continue
    ordinal += 1
    const marker = ordered ? `${ordinal}.` : '-'
    // An item is its inline words plus any nested lists it carries.
    const words: string[] = []
    const nested: string[] = []
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === 1 && /^(ul|ol)$/i.test((child as Element).tagName)) {
        nested.push(...listLinesOf(child as Element, depth + 1))
      } else {
        words.push(inlineOf(child))
      }
    }
    lines.push(`${pad}${marker} ${words.join('').trim()}`)
    lines.push(...nested)
  }
  return lines
}

/** One node's block rendering: the lines a markdown renderer blocks the same way. */
function blocksOf(node: Node, depth: number): string[] {
  if (node.nodeType === 3) {
    const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    return text === '' ? [] : [text]
  }
  if (node.nodeType !== 1) return []
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const heading = /^h([1-6])$/.exec(tag)
  if (heading !== null) {
    const text = inlineOf(el).trim()
    return text === '' ? [] : [`${'#'.repeat(Number(heading[1]))} ${text}`]
  }
  switch (tag) {
    case 'ul': case 'ol': {
      const lines = listLinesOf(el, depth)
      return lines.length === 0 ? [] : [lines.join('\n')]
    }
    case 'blockquote': {
      const inner = blocksOfChildren(el, depth).join('\n\n')
      if (inner === '') return []
      return [inner.split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')]
    }
    case 'pre': {
      const code = (el.textContent ?? '').replace(/\n+$/, '')
      return code.trim() === '' ? [] : [`\`\`\`\n${code}\n\`\`\``]
    }
    case 'hr': return ['---']
    case 'table': {
      const rows = rowsOfTable(el)
      return rows.length >= 2 ? [toMarkdownTable(rows)] : [inlineOf(el).trim()]
    }
    case 'script': case 'style': case 'template': case 'noscript': return []
    case 'div': case 'section': case 'article': case 'main':
    case 'header': case 'footer': case 'figure': case 'aside': case 'body':
      return blocksOfChildren(el, depth)
    default: {
      // Paragraphs, captions, and any inline element standing at block level.
      const text = inlineOf(el).trim()
      return text === '' ? [] : [text]
    }
  }
}

/** Tags that flow inline — everything else a clipboard sends blocks. */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'em', 'font', 'i', 'img', 'kbd',
  'mark', 'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'u', 'wbr',
])

/** A text node, or an element that lives inside a paragraph's flow. */
function isInlineNode(node: Node): boolean {
  return node.nodeType === 3
    || (node.nodeType === 1 && INLINE_TAGS.has((node as Element).tagName.toLowerCase()))
}

/**
 * A container's children as blocks. Consecutive inline nodes — text runs,
 * emphasis, links — belong to ONE paragraph, so they accumulate until a real
 * block flushes them; without the run, `<b>粗</b>的话` would paste as two.
 */
function blocksOfChildren(el: Element, depth: number): string[] {
  const blocks: string[] = []
  let run: string[] = []
  const flush = (): void => {
    const text = run.join('').replace(/[ \t]{2,}/g, ' ').trim()
    run = []
    if (text !== '') blocks.push(text)
  }
  for (const child of Array.from(el.childNodes)) {
    if (isInlineNode(child)) {
      run.push(inlineOf(child))
      continue
    }
    flush()
    blocks.push(...blocksOf(child, depth))
  }
  flush()
  return blocks
}

/**
 * Convert clipboard HTML to markdown — the rich-text arm, for copies from a
 * rendered surface (a chat message, a web article) whose formatting the plain
 * flavor silently drops. Conservative by construction: headings, emphasis,
 * code, links, lists, quotes, fences, and tables convert; everything else
 * degrades to its words; scripts and styles never survive.
 * @param html - the clipboard's `text/html`.
 * @returns the markdown and its plain rendering, or null for empty markup.
 */
export function htmlToMarkdown(html: string): MarkupConversion | null {
  if (!/<[a-zA-Z]/.test(html)) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const junk of Array.from(doc.body.querySelectorAll('script,style,template,noscript'))) junk.remove()
  const markdown = blocksOfChildren(doc.body, 0)
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const text = (doc.body.textContent ?? '').replace(/\s+/g, '')
  if (markdown === '' || text === '') return null
  return { markdown, text }
}

/** Whether the markup's whole meaningful payload is one table (a lone grid). */
function tableIsAlone(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const junk of Array.from(doc.body.querySelectorAll('script,style,template,noscript'))) junk.remove()
  const meaningful = Array.from(doc.body.childNodes).filter(node =>
    node.nodeType === 1 || (node.nodeType === 3 && (node.nodeValue ?? '').trim() !== ''))
  return meaningful.length === 1 && (meaningful[0] as Element).tagName === 'TABLE'
}

/** Whitespace-blind comparison: line-break conventions differ, words do not. */
function sameWords(a: string, b: string): boolean {
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
}

/**
 * Decide what a paste should become, or that it should be left alone.
 * @param html - the clipboard's `text/html`.
 * @param text - the clipboard's `text/plain`.
 * @returns the conversion to insert, or null to let the browser paste normally.
 */
export function convertPaste(html: string, text: string): PasteConversion | null {
  const fromHtml = htmlTableToMarkdown(html)
  if (fromHtml !== null) return { markdown: fromHtml, source: 'html-table' }
  if (looksLikeTsv(text)) {
    return { markdown: toMarkdownTable(parseDelimited(text.replace(/\r\n?/g, '\n'), '\t')), source: 'tsv' }
  }
  return null
}

/**
 * Which clipboard flavor a paste into a card's editor should insert. `plain`
 * and `words` both mean "the browser does the inserting" — they differ only in
 * whether the card owes the user an explanation.
 */
export type PasteArm = 'page' | 'table' | 'formatted' | 'plain' | 'words' | 'markup'

/** One paste's decision: what to insert, and which arm decided it. */
export interface PasteChoice {
  readonly arm: PasteArm
  readonly text: string
}

/**
 * Decide what a paste into a card's editor should insert.
 *
 * `mergedWith` is the whole point of the signature: the renderer sniffs a
 * card's ENTIRE text (see the module doc of `card-format.ts`), so the
 * clipboard's markup may only be taken as a page when the card it would
 * produce STILL reads as one page — a web page pasted into a card that already
 * holds prose would leave tags that render as nothing but tags.
 *
 * Below the page, three fates compete for the markup. A table that IS the
 * clipboard's payload (a spreadsheet ships the grid twice, markup plus TSV; a
 * lone `<table>` says the same without the text flavor) lands as a markdown
 * table. Rich text — a rendered chat message, a web article's paragraphs —
 * converts through `htmlToMarkdown`, but only when the conversion's own words
 * match the plain flavor exactly: formatting is worth keeping, dropped words
 * never are. What survives neither check keeps the old behavior — the browser
 * pastes the text flavor, and a page that loses its markup says why.
 * @param html - the clipboard's HTML flavor ('' when it carried none).
 * @param plain - the clipboard's text flavor.
 * @param mergedWith - the card text the candidate would produce.
 * @returns what to insert; `plain` and `words` mean "let the browser paste".
 */
export function choosePaste(html: string, plain: string, mergedWith: (candidate: string) => string): PasteChoice {
  const markup = html.trim()
  const pageShaped = detectCardFormat(markup) === 'html'
  // A whole document keeps its page fate; a fragment prefers markdown, because
  // a copied paragraph or chat answer is prose, not a page.
  const wholeDocument = /^<!doctype\s+html[\s>]/i.test(markup) || /^<(html|head|body)[\s>]/i.test(markup)
  const becomesPage = pageShaped && detectCardFormat(mergedWith(markup)) === 'html'
  const table = convertPaste(markup, plain)
  if (table !== null && (looksLikeTsv(plain) || (!becomesPage && tableIsAlone(markup)))) {
    return { arm: 'table', text: table.markdown }
  }
  if (becomesPage && wholeDocument) return { arm: 'page', text: markup }
  const formatted = htmlToMarkdown(markup)
  if (formatted !== null && sameWords(formatted.text, plain)) {
    // The words survive whole: take the markdown when it carries more than the
    // text flavor (formatting), and let the browser paste when it does not.
    return formatted.markdown === plain
      ? { arm: 'plain', text: plain }
      : { arm: 'formatted', text: formatted.markdown }
  }
  if (plain.trim() === '') {
    // Nothing but markup on the clipboard: the converted words still beat
    // dead-as-markup, and dead-as-markup still beats lost.
    if (formatted !== null) return { arm: 'formatted', text: formatted.markdown }
    return { arm: 'markup', text: markup }
  }
  // A fragment that keeps its page shape and could not convert honestly still
  // lands as markup — the iframe renders it; the words arm is for documents.
  if (becomesPage) return { arm: 'page', text: markup }
  return { arm: wholeDocument ? 'words' : 'plain', text: plain }
}
