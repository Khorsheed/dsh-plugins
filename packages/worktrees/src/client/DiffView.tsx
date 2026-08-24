/**
 * Unified-diff renderer styled to the official DiffBlock card anatomy
 * (ui-primitives): the markdown code-block surface, 12px radius, the code
 * font, a bold path header, `- `/`+ ` prefixes in the error/success state
 * tokens, a floating copy control, and a `└ +A -R · N file(s)` footer.
 * The official DiffBlock itself draws whole-file old/new sides, which
 * misrepresents a patch, so this component renders the actual unified diff
 * in the same visual vocabulary. The body keeps `white-space: pre` and
 * scrolls horizontally — a diff is read by its indentation.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DiffView.module.css'

/** Body lines shown before the middle collapses. */
const MAX_LINES = 200

/** One classified diff line. */
interface DiffLine {
  kind: 'path' | 'meta' | 'hunk' | 'add' | 'del' | 'ctx'
  text: string
}

/** Classify a unified-diff line. */
function classify(line: string): DiffLine['kind'] {
  if (line.startsWith('diff --git ')) return 'path'
  if (
    line.startsWith('index ')
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

/** Split a patch into rows plus the +/- totals. */
function parseDiff(diff: string): { rows: DiffLine[]; added: number; removed: number } {
  const rows: DiffLine[] = []
  let added = 0
  let removed = 0
  for (const raw of diff.split('\n')) {
    const kind = classify(raw)
    if (kind === 'add') added += 1
    else if (kind === 'del') removed += 1
    rows.push({ kind, text: raw })
  }
  return { rows, added, removed }
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
  const [copied, setCopied] = useState(false)

  const parsed = useMemo(() => {
    if (diff === null || diff === '') return null
    return parseDiff(diff)
  }, [diff])

  if (parsed === null) return <div className={css.empty}>{t('detail.noSelection')}</div>

  const shown = expanded ? parsed.rows : parsed.rows.slice(0, MAX_LINES)
  const collapsed = !expanded && parsed.rows.length > MAX_LINES
  const fileCount = diff === null ? 0 : 1

  const onCopy = (): void => {
    if (diff === null) return
    void writeClipboard(diff).then(ok => {
      if (ok) {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, 1200)
      }
    })
  }

  return (
    <div className={css.block}>
      <button type="button" className={css.copyButton} onClick={onCopy} aria-label={copied ? t('action.copied') : t('action.copy')}>
        {copied ? t('action.copied') : t('action.copy')}
      </button>
      <pre className={css.body}>
        {shown.map((line, index) => (
          <div key={index} className={`${css.line} ${css[`kind_${line.kind}`]}`}>
            {line.text === '' ? ' ' : line.text}
          </div>
        ))}
        {collapsed && (
          <button type="button" className={css.more} onClick={() => { setExpanded(true) }}>
            {t('detail.diff')} · {parsed.rows.length - MAX_LINES} …
          </button>
        )}
      </pre>
      <div className={css.footer}>
        └ +{parsed.added} −{parsed.removed} · {fileCount} {t('commits.files', { count: fileCount })}
      </div>
    </div>
  )
}
