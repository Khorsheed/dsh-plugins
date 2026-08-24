/**
 * The commit log (commits mode): an IDE-style list of the branch's own
 * commits (`base..HEAD`), each row showing short sha, subject, and relative
 * time. Selecting a commit expands its changed-file tree inline (VS Code
 * Source Control anatomy) and hands file clicks to the detail pane.
 */
import { useMemo, type ReactNode } from 'react'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile, CommitInfo } from '../types.ts'
import { FileTree, relativeTime, type FileTreeItem } from './FileTree.tsx'
import css from './CommitList.module.css'

/** Props of the commit list. */
export interface CommitListProps {
  /** The branch's commits, newest first. */
  commits: readonly CommitInfo[] | null
  /** The selected commit sha, or null. */
  selectedCommit: string | null
  /** The selected commit's files (null until loaded). */
  commitFiles: readonly ChangedFile[] | null
  /** Called when a commit row is clicked (null collapses). */
  onSelectCommit: (sha: string | null) => void
  /** Called when a file inside the selected commit is clicked. */
  onSelectFile: (path: string) => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The commit list. */
export function CommitList({
  commits, selectedCommit, commitFiles, onSelectCommit, onSelectFile, t,
}: CommitListProps): ReactNode {
  const fileGroups = useMemo(() => {
    if (commitFiles === null || commitFiles.length === 0) return []
    const items: FileTreeItem[] = commitFiles.map(file => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    }))
    return [{ key: 'commit', title: t('commits.files', { count: items.length }), count: items.length, items }]
  }, [commitFiles, t])

  if (commits === null || commits.length === 0) {
    return <div className={css.empty}>{t('commits.empty', { base: 'base' })}</div>
  }

  return (
    <div className={css.list}>
      {commits.map(commit => {
        const open = selectedCommit === commit.sha
        return (
          <div key={commit.sha} className={css.commit}>
            <button
              type="button"
              className={`${css.row} ${open ? css.rowOpen : ''}`}
              onClick={() => { onSelectCommit(open ? null : commit.sha) }}
            >
              {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
              <span className={css.sha}>{commit.sha}</span>
              <span className={css.subject}>{commit.subject}</span>
              <span className={css.time}>{relativeTime(commit.time)}</span>
            </button>
            {open && (
              <div className={css.files}>
                <FileTree
                  groups={fileGroups}
                  selectedPath={null}
                  onSelect={onSelectFile}
                  t={t}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
