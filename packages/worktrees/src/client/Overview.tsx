/**
 * The right pane's overview surface: shown when nothing is selected, so the
 * detail column never reads as an empty screen. Renders the worktree summary
 * (branch, HEAD, ahead/behind, dirty) plus the two change segments' counts
 * and a hint to pick a file.
 */
import type { ReactNode } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesResult, SessionSummary } from '../types.ts'
import css from './Overview.module.css'

/** Props of the overview. */
export interface OverviewProps {
  /** The worktree summary (null until loaded). */
  summary: SessionSummary | null
  /** Both change segments (null until loaded). */
  changes: ChangesResult | null
  /** Whether the current mode is the repository browse (different hint). */
  repoMode: boolean
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The overview. */
export function Overview({ summary, changes, repoMode, t }: OverviewProps): ReactNode {
  const uncommitted = changes?.uncommitted ?? []
  const committed = changes?.committed ?? []
  const hasAny = uncommitted.length > 0 || committed.length > 0

  return (
    <div className={css.root}>
      <div className={css.header}>
        <IconBranchOutline16 />
        <span className={css.branch}>{summary?.branch ?? t('summary.detached')}</span>
        {summary !== null && summary.isMain && summary.branch !== 'main' && (
          <span className={css.mainTag}>main</span>
        )}
      </div>
      <div className={css.meta}>
        {summary?.repoName ?? ''} · @{summary?.head ?? ''}
        {summary !== null && ` · ↑${summary.ahead} ↓${summary.behind} · ${summary.dirty} dirty`}
      </div>

      {hasAny ? (
        <div className={css.stats}>
          {uncommitted.length > 0 && (
            <div className={css.stat}>
              <span className={css.statLabel}>{t('group.uncommitted')}</span>
              <span className={css.statValue}>
                {t('overview.untrackedCount', {
                  count: String(uncommitted.length),
                  add: String(sum(uncommitted, 'additions')),
                  del: String(sum(uncommitted, 'deletions')),
                })}
              </span>
            </div>
          )}
          {committed.length > 0 && (
            <div className={css.stat}>
              <span className={css.statLabel}>{t('group.committed')}</span>
              <span className={css.statValue}>
                {t('overview.committedCount', {
                  count: String(committed.length),
                  add: String(sum(committed, 'additions')),
                  del: String(sum(committed, 'deletions')),
                })}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className={css.empty}>{t('overview.empty', { base: summary?.baseRef || 'base' })}</div>
      )}

      <div className={css.hint}>{repoMode ? t('overview.repoHint') : t('overview.hint')}</div>
    </div>
  )
}

/** Sum a numeric field across changed files (null counts count as 0). */
function sum(files: readonly { additions: number | null; deletions: number | null }[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0)
}
