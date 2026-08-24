/**
 * The commit details surface: the right pane's view once a commit is
 * selected in the commits mode — sha, subject, author, relative time, and
 * the commit's changed files as compact rows. Clicking a file opens its
 * per-commit diff.
 */
import type { ReactNode } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile, CommitInfo } from '../types.ts'
import { relativeTime } from './FileTree.tsx'
import css from './CommitDetails.module.css'

/** Props of the commit details. */
export interface CommitDetailsProps {
  /** The selected commit. */
  commit: CommitInfo
  /** The commit's changed files (null until loaded). */
  files: readonly ChangedFile[] | null
  /** Called when a file row is clicked (opens its per-commit diff). */
  onSelectFile: (path: string) => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The commit details. */
export function CommitDetails({ commit, files, onSelectFile, t }: CommitDetailsProps): ReactNode {
  const rows = files ?? []

  return (
    <div className={css.root}>
      <div className={css.header}>
        <IconBranchOutline16 />
        <span className={css.title}>{t('commit.details')}</span>
      </div>
      <div className={css.sha}>{commit.sha}</div>
      <div className={css.subject}>{commit.subject}</div>
      <div className={css.meta}>
        {t('commit.author', { author: commit.author, time: relativeTime(commit.time) })}
      </div>
      <div className={css.count}>
        {t('commits.files', { count: rows.length })}
      </div>
      {rows.length === 0 ? (
        <div className={css.empty}>{t('commit.noFiles')}</div>
      ) : (
        <div className={css.files}>
          {rows.map(file => (
            <button
              key={file.path}
              type="button"
              className={css.fileRow}
              onClick={() => { onSelectFile(file.path) }}
            >
              <span className={`${css.status} ${css[`status_${file.status === '??' ? 'untracked' : file.status}`] ?? ''}`}>
                {file.status === '??' ? '??' : file.status}
              </span>
              <span className={css.filePath}>{file.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
