/**
 * The overview surface: the right pane when nothing is selected, so the
 * detail column never reads as an empty screen. It deliberately does NOT
 * repeat the branch/repo/short-SHA/ahead-behind/dirty — the drawer header
 * already carries those — and instead shows just a title, one inline stat
 * line, and a hint: title → stats (8px) → hint (22px).
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesResult, SessionSummary } from '../types.ts'
import css from './Overview.module.css'

/** Props of the overview. */
export interface OverviewProps {
  /** The worktree summary (null until loaded). */
  summary: SessionSummary | null
  /** Both change segments (null until loaded). */
  changes: ChangesResult | null
  /** Whether the current mode is the repository browse (different title/hint). */
  repoMode: boolean
  /** Repo file count for the repository browse mode (ignored in changes mode). */
  repoCount?: number
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The overview. */
export function Overview({ changes, repoMode, repoCount, t }: OverviewProps): ReactNode {
  const uncommitted = changes?.uncommitted ?? []
  const committed = changes?.committed ?? []
  const totalFiles = repoMode ? (repoCount ?? 0) : uncommitted.length + committed.length

  return (
    <div className={css.root}>
      <div className={css.title}>{repoMode ? t('overview.repoTitle') : t('overview.changesTitle')}</div>
      <div className={css.stats}>
        {repoMode
          ? t('overview.repoStats', { count: formatCount(totalFiles) })
          : t('overview.stats', {
            count: formatCount(totalFiles),
            add: formatCount(sum(uncommitted, 'additions') + sum(committed, 'additions')),
            del: formatCount(sum(uncommitted, 'deletions') + sum(committed, 'deletions')),
          })}
      </div>
      <div className={css.hint}>{repoMode ? t('overview.repoHint') : t('overview.hint')}</div>
    </div>
  )
}

/** Sum a numeric field across changed files (null counts count as 0). */
function sum(files: readonly { additions: number | null; deletions: number | null }[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0)
}

/** Format a number with thousands separators (1,054). */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
