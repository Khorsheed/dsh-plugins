/**
 * The commit log (commits mode): a fast-scan list of the branch's own
 * commits (`base..HEAD`). The header shows the count and how far the branch
 * leads its base; each 50px row carries the title (weight 500) and a second
 * line of short sha · file count with the time right-aligned. Commits are not
 * tree nodes — no expand arrows, no per-row dividers; rows separate by a 2px
 * gap and the selected row gets a light-blue surface with a 2px left accent.
 */
import type { ReactNode } from 'react'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitInfo } from '../types.ts'
import { relativeTime } from './FileTree.tsx'
import css from './CommitList.module.css'

/** Props of the commit list. */
export interface CommitListProps {
  /** The branch's commits, newest first. */
  commits: readonly CommitInfo[] | null
  /** The selected commit sha, or null. */
  selectedCommit: string | null
  /** How many commits the branch leads its base (the header's `领先 main N`). */
  ahead: number
  /** When given, renders a collapse-to-rail toggle at the right of the header. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Called when a commit row is clicked. */
  onSelectCommit: (sha: string) => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The commit list. */
export function CommitList({
  commits, selectedCommit, ahead, collapsed, onToggleCollapse, onSelectCommit, t,
}: CommitListProps): ReactNode {
  if (commits === null || commits.length === 0) {
    return <div className={css.empty}>{t('commits.empty', { base: 'base' })}</div>
  }

  const fileLabel = (count: number): string => t('commits.files', { count: String(count) })

  return (
    <div className={css.list}>
      <div className={css.header}>
        <span className={css.title}>{t('mode.commits')} <span className={css.count}>{commits.length}</span></span>
        <span className={css.headerRight}>
          {ahead > 0 && <span className={css.leading}>{t('commits.leading', { base: 'main', count: String(ahead) })}</span>}
          {onToggleCollapse !== undefined && (
            <button
              type="button"
              className={css.collapseButton}
              title={collapsed ? t('tree.expand') : t('tree.collapse')}
              onClick={onToggleCollapse}
            >
              <IconPanelLeftOutline16 />
            </button>
          )}
        </span>
      </div>
      <div className={css.rows}>
        {commits.map(commit => {
          const selected = selectedCommit === commit.sha
          return (
            <button
              key={commit.sha}
              type="button"
              className={css.row}
              aria-selected={selected}
              onClick={() => { onSelectCommit(commit.sha) }}
            >
              <span className={css.subject}>{commit.subject}</span>
              <span className={css.rowMeta}>
                <span className={css.sha}>{commit.sha}</span>
                <span className={css.fileCount}>· {fileLabel(commit.files)}</span>
                <span className={css.time}>{relativeTime(commit.time)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
