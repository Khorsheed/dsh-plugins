/**
 * The commit details surface: the right pane once a commit is selected —
 * a 48px toolbar (short sha left, copy + open right), then the content in a
 * fixed order: subject → author/time → one-line add/del summary → the file
 * list → the selected file's diff. Branch/repo/dirty are deliberately not
 * repeated (the drawer header already carries them). File rows are 38px with
 * adaptive-path truncation and right-aligned counts.
 */
import { useMemo, type ReactNode } from 'react'
import { IconCopyOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile, CommitInfo, FileDiffResult, ReadFileResult } from '../types.ts'
import type { DetailView } from './store.ts'
import { DetailPane, isDeleted } from './DetailPane.tsx'
import { relativeTime } from './FileTree.tsx'
import css from './CommitDetails.module.css'

/** Props of the commit details. */
export interface CommitDetailsProps {
  /** The selected commit. */
  commit: CommitInfo
  /** The commit's changed files. */
  files: readonly ChangedFile[]
  /** The currently selected file (drives the inline diff), or null. */
  selectedPath: string | null
  /** The fetched diff for the selected file. */
  diff: FileDiffResult | null
  /** The fetched content for the selected file. */
  content: ReadFileResult | null
  detailView: DetailView
  /** Whether the selected file has a change record. */
  hasDiff: boolean
  /** Called when a file row is clicked. */
  onSelectFile: (path: string) => void
  onViewChange: (view: DetailView) => void
  /** Copy the commit sha; resolves true only on acceptance. */
  copySha: (sha: string) => Promise<boolean>
  /** Open the repository folder with the host application. */
  openFolder: () => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The commit details. */
export function CommitDetails({
  commit, files, selectedPath, diff, content, detailView, hasDiff,
  onSelectFile, onViewChange, copySha, openFolder, t,
}: CommitDetailsProps): ReactNode {
  const { added, removed } = useMemo(() => ({
    added: sum(files, 'additions'),
    removed: sum(files, 'deletions'),
  }), [files])

  const selectedFile = selectedPath === null ? undefined : files.find(file => file.path === selectedPath)

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <span className={css.toolbarSha}>{commit.sha}</span>
        <span className={css.toolbarActions}>
          <button type="button" className={css.action} title={t('action.copy')} onClick={() => { void copySha(commit.sha) }}>
            <IconCopyOutline16 />
          </button>
          <button type="button" className={css.action} title={t('action.openFolder')} onClick={openFolder}>
            <IconFolderOpenOutline16 />
          </button>
        </span>
      </div>
      <div className={css.content}>
        <div className={css.subject}>{commit.subject}</div>
        <div className={css.author}>{t('commit.author', { author: commit.author, time: relativeTime(commit.time) })}</div>
        <div className={css.summary}>{t('commit.summary', { count: String(files.length), add: String(added), del: String(removed) })}</div>

        <div className={css.filesHeader}>{t('commit.changedFiles')} <span className={css.filesCount}>{files.length}</span></div>
        <div className={css.files}>
          {files.map(file => (
            <button
              key={file.path}
              type="button"
              className={`${css.fileRow} ${selectedPath === file.path ? css.fileRowSelected : ''}`}
              onClick={() => { onSelectFile(file.path) }}
            >
              <span className={css.filePath} title={file.path}>{file.path}</span>
              <span className={css.fileStats}>
                <span className={css.add}>+{file.additions ?? 0}</span>
                <span className={css.del}>−{file.deletions ?? 0}</span>
              </span>
            </button>
          ))}
        </div>

        {selectedPath !== null && (
          <div className={css.diff}>
            <DetailPane
              path={selectedPath}
              hasDiff={hasDiff}
              untracked={false}
              deleted={isDeleted(selectedFile)}
              detailView={detailView}
              diff={diff}
              content={content}
              loading={false}
              error={null}
              onViewChange={onViewChange}
              t={t}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** Sum a numeric field across changed files (null counts count as 0). */
function sum(files: readonly ChangedFile[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0)
}
