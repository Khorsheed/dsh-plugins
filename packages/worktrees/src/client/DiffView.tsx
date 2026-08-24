/**
 * Unified-diff renderer: colors a raw `git diff` output line-wise (meta
 * headers dim, `-` deletions error-tinted, `+` additions success-tinted,
 * hunk headers muted) and tracks the old/new line numbers from each `@@`
 * hunk header, so the gutter reads like a real diff viewer. There is no
 * official git-diff primitive — DiffBlock renders whole-file old/new sides,
 * which misrepresents a patch — so this component draws the patch with the
 * same token vocabulary.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DiffView.module.css'

/** Body lines shown before the middle collapses. */
const MAX_LINES = 200

/** One classified diff line with its tracked line numbers. */
interface DiffLine {
  kind: 'meta' | 'hunk' | 'add' | 'del' | 'ctx'
  text: string
  /** Old-side line number (null for pure additions / meta rows). */
  old: number | null
  /** New-side line number (null for pure deletions / meta rows). */
  next: number | null
}

/** Classify a unified-diff line. */
function classify(line: string): DiffLine['kind'] {
  if (
    line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ')
    || line.startsWith('new file mode ')
    || line.startsWith('deleted file mode ')
    || line.startsWith('similarity index ')
    || line.startsWith('rename from ')
    || line.startsWith('rename to ')
    || line === '\\ No newline at end of file'
  ) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

/** Parse `@@ -a[,b] +c[,d] @@` into the old/new start line numbers. */
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Classify the full diff into numbered rows. */
function parseDiff(diff: string): DiffLine[] {
  const rows: DiffLine[] = []
  let oldCursor = 0
  let newCursor = 0
  for (const raw of diff.split('\n')) {
    const kind = classify(raw)
    let old: number | null = null
    let next: number | null = null
    if (kind === 'hunk') {
      const match = HUNK.exec(raw)
      oldCursor = match === null ? 0 : Number(match[1])
      newCursor = match === null ? 0 : Number(match[2])
    } else if (kind === 'ctx') {
      old = oldCursor
      next = newCursor
      oldCursor += 1
      newCursor += 1
    } else if (kind === 'del') {
      old = oldCursor
      oldCursor += 1
    } else if (kind === 'add') {
      next = newCursor
      newCursor += 1
    }
    rows.push({ kind, text: raw, old, next })
  }
  return rows
}

/** Props of the diff view. */
export interface DiffViewProps {
  /** Unified diff text, or null (no diff). */
  diff: string | null
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The diff view. */
export function DiffView({ diff, t }: DiffViewProps): ReactNode {
  const [expanded, setExpanded] = useState(false)

  const lines = useMemo<DiffLine[]>(() => {
    if (diff === null || diff === '') return []
    return parseDiff(diff)
  }, [diff])

  if (lines.length === 0) return <div className={css.empty}>{t('detail.noSelection')}</div>

  const shown = expanded ? lines : lines.slice(0, MAX_LINES)
  const collapsed = !expanded && lines.length > MAX_LINES

  return (
    <div className={css.root}>
      <pre className={css.pre}>
        {shown.map((line, index) => (
          <div key={index} className={`${css.line} ${css[`kind_${line.kind}`]}`}>
            <span className={css.num}>{line.old === null ? '' : line.old}</span>
            <span className={css.num}>{line.next === null ? '' : line.next}</span>
            <span className={css.gutter}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
            <span className={css.text}>{line.text === '' ? ' ' : line.text}</span>
          </div>
        ))}
        {collapsed && (
          <button type="button" className={css.more} onClick={() => { setExpanded(true) }}>
            {t('detail.diff')} · {lines.length - MAX_LINES} …
          </button>
        )}
      </pre>
    </div>
  )
}
