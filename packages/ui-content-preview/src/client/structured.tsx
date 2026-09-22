/**
 * Structured previews for the shared content pane: file types whose document
 * form is richer than source render a structured view. JSON files render
 * through the official JsonTree inspector (collapsible, keyboard-accessible,
 * copy actions); CSV/TSV files render as a GFM table through the official
 * MarkdownText pipeline. Both degrade to the plain code view when parsing
 * fails or the content is too large, so a preview never breaks — it only gets
 * richer when the structure is actually readable. The locale chrome arrives as
 * a {@link StructuredLabels} object; see labels.ts.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import type { ReactNode } from 'react'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StructuredLabels } from './labels.ts'

/** JSON tree cap: beyond this many source chars the parsed tree is too heavy. */
const JSON_TREE_MAX_CHARS = 150_000
/** Table cap: beyond these a delimited file stays in the code view. */
const TABLE_MAX_ROWS = 500
const TABLE_MAX_COLS = 40

/** File types that render a structured/rendered preview (not just source). */
const STRUCTURED_EXTENSIONS = new Set(['.json', '.jsonc', '.csv', '.tsv'])

/** Whether a path has any preview form beyond the source code view. */
export function hasStructuredPreview(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? false : STRUCTURED_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Parse one text read as JSON for the tree preview (objects/arrays only). */
export function jsonTreeData(content: string): object | unknown[] | null {
  if (content.length > JSON_TREE_MAX_CHARS) return null
  try {
    const value: unknown = JSON.parse(content)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** Parse a delimited (CSV/TSV) text into rows, handling quoted fields. */
export function parseDelimited(content: string, delimiter: string): string[][] | null {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const ch = content.charAt(i)
    if (inQuotes) {
      if (ch === '"') {
        if (content.charAt(i + 1) === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content.charAt(i + 1) === '\n') i++
      row.push(field); field = ''
      if (row.some(cell => cell !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(cell => cell !== '')) rows.push(row)
  if (rows.length === 0) return null
  const cols = Math.max(...rows.map(r => r.length))
  if (rows.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS) return null
  return rows
}

/** Escape one cell for a GFM table. */
function tableCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ')
}

/** Build a GFM markdown table from parsed rows (first row = header). */
export function toMarkdownTable(rows: readonly string[][]): string {
  const width = Math.max(...rows.map(r => r.length))
  const render = (row: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => tableCell(row[i] ?? '')).join(' | ')} |`
  const header = render(rows[0] ?? [])
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
  const body = rows.slice(1).map(render)
  return [header, separator, ...body].join('\n')
}

/**
 * The structured preview for one path/content, or null when the file type has
 * no richer form (or its structure is unreadable — the caller keeps the code
 * view).
 * @param path - the file's display path (extension decides the form).
 * @param content - the text content.
 * @param labels - the consumer-built locale chrome (JsonTree + MarkdownText).
 * @returns a ReactNode (JsonTree or a markdown-table MarkdownText), or null.
 */
export function structuredPreview(path: string, content: string, labels: StructuredLabels): ReactNode | null {
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot).toLowerCase()
  if (ext === '.json' || ext === '.jsonc') {
    const data = jsonTreeData(content)
    return data === null ? null : <JsonTree data={data} label={path} labels={labels.json} />
  }
  if (ext === '.csv' || ext === '.tsv') {
    const rows = parseDelimited(content, ext === '.tsv' ? '\t' : ',')
    return rows === null ? null : <MarkdownText text={toMarkdownTable(rows)} labels={labels.markdown} />
  }
  return null
}
