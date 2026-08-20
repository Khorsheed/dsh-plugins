/**
 * Structured previews for file types whose document form is richer than raw
 * source: JSON files render through the official JsonTree inspector (the same
 * tree the RPC payload panel uses — collapsible, keyboard-accessible, with
 * copy actions), and CSV/TSV files render as a table through the official
 * MarkdownText pipeline (its GFM table styling). Both degrade to the plain
 * code view when parsing fails or the content is too large, so a file preview
 * never breaks — it only gets richer when the structure is actually readable.
 * A content search bypasses all of this: the pane switches to the raw
 * matched-lines view, so hits stay visible regardless of rendering.
 * @module @khorsheed/dsh-client-ui-file-preview
 */

import type { ReactNode } from 'react'
import { JsonTree, MarkdownText, type JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** JSON tree cap: beyond this many source chars the parsed tree is too heavy; keep the code view. */
const JSON_TREE_MAX_CHARS = 150_000
/** Table caps: beyond these a delimited file stays in the code view (the host read cap bounds it anyway). */
const TABLE_MAX_ROWS = 500
const TABLE_MAX_COLS = 40

/** Localized JsonTree labels over the plugin's `filePreview` namespace. */
export function jsonTreeLabels(t: TranslateNS<'filePreview'>): JsonTreeLabels {
  return {
    copyValue: t('json.copyValue'),
    copyJson: t('json.copyJson'),
    copyPath: t('json.copyPath'),
    copyPrettyJson: t('json.copyPrettyJson'),
    copyCompactJson: t('json.copyCompactJson'),
    copied: t('json.copied'),
    copyFailed: t('json.copyFailed'),
    collapseNode: t('json.collapseNode'),
    expandNode: t('json.expandNode'),
    copyButtonTitle: action => t('json.copyButtonTitle', { action }),
  }
}

/**
 * Parse one text read as JSON for the tree preview. Only plain objects and
 * arrays within the size cap qualify; scalars (a bare number/string/null) and
 * any parse failure — including `.jsonc` comment syntax — fall back to the
 * code view.
 * @param content - the read's text content.
 * @returns the parsed object/array, or null when it is not tree-shaped.
 */
export function jsonTreeData(content: string): object | unknown[] | null {
  if (content.length > JSON_TREE_MAX_CHARS) return null
  try {
    const value: unknown = JSON.parse(content)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Parse a delimited (CSV/TSV) text into rows, handling double-quoted fields
 * with escaped quotes and embedded commas. Blank lines are dropped.
 * @param content - the read's text content.
 * @param delimiter - the field separator (`,` for CSV, `\t` for TSV).
 * @returns rows of unquoted field strings, or null when empty or oversized.
 */
export function parseDelimited(content: string, delimiter: string): string[][] | null {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const ch = content.charAt(i)
    if (inQuotes) {
      if (ch === '"') {
        if (content.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content.charAt(i + 1) === '\n') i++
      row.push(field)
      field = ''
      if (row.some(cell => cell !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some(cell => cell !== '')) rows.push(row)
  if (rows.length === 0) return null
  const cols = Math.max(...rows.map(r => r.length))
  if (rows.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS) return null
  return rows
}

/** Escape one cell for a GFM table: pipes escaped, line breaks collapsed. */
function tableCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ')
}

/**
 * Build a GFM markdown table from parsed rows (the first row becomes the
 * header) for the official MarkdownText renderer.
 * @param rows - parsed fields, already within the table caps.
 * @returns a markdown table string.
 */
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
 * The structured preview for one text read, or null when the file type has no
 * richer form (or its structure is unreadable — the caller keeps the code view).
 * @param path - the read's display path (extension decides the candidate form).
 * @param content - the read's text content.
 * @param t - the locale seat for the JsonTree labels.
 * @returns a ReactNode (JsonTree or a markdown-table MarkdownText), or null.
 */
export function structuredPreview(
  path: string,
  content: string,
  t: TranslateNS<'filePreview'>,
): ReactNode | null {
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot).toLowerCase()
  if (ext === '.json' || ext === '.jsonc') {
    const data = jsonTreeData(content)
    return data === null ? null : <JsonTree data={data} labels={jsonTreeLabels(t)} />
  }
  if (ext === '.csv' || ext === '.tsv') {
    const rows = parseDelimited(content, ext === '.tsv' ? '\t' : ',')
    return rows === null ? null : <MarkdownText text={toMarkdownTable(rows)} />
  }
  return null
}
