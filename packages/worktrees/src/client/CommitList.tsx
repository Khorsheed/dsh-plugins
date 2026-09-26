/**
 * The commit log (commits mode): a fast-scan list of the branch's own
 * commits (`base..HEAD`). The header shows the count and how far the branch
 * leads its base; each 50px row carries the title (weight 500) and a second
 * line of short sha · file count with the time right-aligned. Commits are not
 * tree nodes — no expand arrows, no per-row dividers; rows separate by a 2px
 * gap and the selected row gets a light-blue surface with a 2px left accent.
 */
import type { ReactNode } from 'react'
import { IconPanelLeftOutlineMedium } from './icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitInfo } from '../types.ts'
import { relativeTime } from './FileTree.tsx'
import css from './CommitList.module.css'

/** Props of the commit list. */
export interface CommitListProps {
  /** The commit log rows, newest first. */
  commits: readonly CommitInfo[] | null
  /** The selected commit sha, or null. */
  selectedCommit: string | null
  /** When given, renders a collapse-to-rail toggle at the right of the header. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Called when a commit row is clicked. */
  onSelectCommit: (sha: string) => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** Extract a short branch label from a `%D` decoration, e.g.
 * `HEAD -> main, origin/main` → `main`; empty when the commit has no ref. */
function branchLabel(decorations: string): string {
  if (decorations === '') return ''
  const cleaned = decorations
    .replace(/HEAD -> /g, '')
    .split(',')
    .map(part => part.trim().replace(/^origin\//, ''))
    .filter(Boolean)
  return cleaned[0] ?? ''
}

/** The commit list. */
export function CommitList({
  commits, selectedCommit, collapsed, onToggleCollapse, onSelectCommit, t,
}: CommitListProps): ReactNode {
  if (commits === null || commits.length === 0) {
    return <div className={css.empty}>{t('commits.empty', { base: 'base' })}</div>
  }

  const fileLabel = (count: number): string => t('commits.files', { count: String(count) })

  return (
    <div className={css.list}>
      <div className={css.header}>
        <span className={css.title}>{t('mode.commits')}</span>
        <span className={css.headerRight}>
          <span className={css.leading}>{t('commits.recent', { count: String(200) })}</span>
          {onToggleCollapse !== undefined && (
            <button
              type="button"
              className={css.collapseButton}
              title={collapsed ? t('tree.expand') : t('tree.collapse')}
              onClick={onToggleCollapse}
            >
              <IconPanelLeftOutlineMedium />
            </button>
          )}
        </span>
      </div>
      <div className={css.rows}>
        {commits.map(commit => {
          const selected = selectedCommit === commit.sha
          const branch = branchLabel(commit.branches)
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
                {branch !== '' && <span className={css.rowBranch}>{branch}</span>}
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
