/**
 * Clipboard → card text: which flavor of a paste lands in the editor.
 *
 * Two sources are worth converting and they arrive differently. A spreadsheet
 * or a web page offers `text/html` — the richest signal, and the only one that
 * survives a page's own table styling — so it is tried first. Plain
 * tab-separated text is the fallback (a spreadsheet that shipped no HTML, a
 * terminal, a text editor). Anything else is left alone: mangling ordinary
 * pasted prose is a far worse failure than declining to convert.
 *
 * The deliberate restraint is on the plain-text path: it converts only when the
 * shape is unambiguously a table (two or more rows agreeing on a column count
 * of two or more). Space-aligned tables — PDFs, plain-text dumps — never
 * auto-convert; the view offers an explicit selection-based action for those.
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
  if (rows.length < 2) return null
  return toMarkdownTable(rows)
}

/**
 * Convert whitespace-aligned text (columns separated by runs of two or more
 * spaces) to a markdown table. This is the explicit selection action's path —
 * never the automatic one.
 * @param text - the selected text.
 * @returns the markdown table, or null when it does not look like a table.
 */
export function spaceAlignedToMarkdown(text: string): string | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim().length > 0)
  if (lines.length < 2) return null
  const rows = lines.map(line => line.trim().split(/ {2,}/))
  if (rows.some(row => row.length < 2)) return null
  return toMarkdownTable(rows)
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
export type PasteArm = 'page' | 'table' | 'plain' | 'words' | 'markup'

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
 * holds prose would leave tags that render as nothing but tags. That case
 * falls back to the clipboard's plain flavor: the page's words survive, its
 * markup does not. A table is the one shape worth pulling out of the markup
 * even then, which is `convertPaste`'s job.
 * @param html - the clipboard's HTML flavor ('' when it carried none).
 * @param plain - the clipboard's text flavor.
 * @param mergedWith - the card text the candidate would produce.
 * @returns what to insert; `plain` and `words` mean "let the browser paste".
 */
export function choosePaste(html: string, plain: string, mergedWith: (candidate: string) => string): PasteChoice {
  const markup = html.trim()
  const pageShaped = detectCardFormat(markup) === 'html'
  const becomesPage = pageShaped && detectCardFormat(mergedWith(markup)) === 'html'
  const table = convertPaste(markup, plain)
  // A spreadsheet ships the SAME grid twice: sheet soup as markup, TSV as text.
  // When the text flavor reads as a table too, the grid is the clipboard's
  // whole content and markdown beats any page reading of the soup. A table
  // inside a real page is the other case: the page wins, table and all.
  if (table !== null && (looksLikeTsv(plain) || !becomesPage)) return { arm: 'table', text: table.markdown }
  if (becomesPage) return { arm: 'page', text: markup }
  if (plain.trim() === '') {
    // Nothing but markup on the clipboard: dead-as-markup still beats lost.
    return { arm: 'markup', text: markup }
  }
  // A page that loses its markup says why (its words did land); rich text that
  // was never a page has nothing to explain, so the browser pastes silently.
  return { arm: pageShaped ? 'words' : 'plain', text: plain }
}
