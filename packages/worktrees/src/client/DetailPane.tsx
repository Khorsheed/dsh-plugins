/**
 * The detail pane: the selected file's diff or current content, mirroring
 * ui-file-preview's FilePreviewPane shape (a `diff | content` view toggle,
 * official CodeBlock for content, this repo's DiffView for patches). Files
 * with no change record (repo browse) and untracked files only offer the
 * content view.
 */
import type { ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile, FileDiffResult, ReadFileResult } from '../types.ts'
import type { DetailView } from './store.ts'
import { DiffView } from './DiffView.tsx'
import css from './DetailPane.module.css'

/** Props of the detail pane. */
export interface DetailPaneProps {
  /** The selected file's path ('' when none). */
  path: string
  /** Whether the file has any change record (drives the diff view's availability). */
  hasDiff: boolean
  /** Whether the file is untracked (no diff by construction). */
  untracked: boolean
  /** Whether the file was deleted from the work tree (content unavailable). */
  deleted: boolean
  /** The active detail view. */
  detailView: DetailView
  /** The fetched diff (null until loaded). */
  diff: FileDiffResult | null
  /** The fetched content (null until loaded). */
  content: ReadFileResult | null
  /** Whether a fetch is in flight. */
  loading: boolean
  /** Human-readable fetch failure, or null. */
  error: string | null
  /** Called when the view toggle changes. */
  onViewChange: (view: DetailView) => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The detail pane. */
export function DetailPane({
  path, hasDiff, untracked, deleted, detailView, diff, content, loading, error, onViewChange, t,
}: DetailPaneProps): ReactNode {
  if (path === '') {
    return <div className={css.placeholder}>{t('detail.noSelection')}</div>
  }

  const diffDisabled = !hasDiff
  const contentDisabled = deleted

  const body = ((): ReactNode => {
    if (loading) return <div className={css.placeholder}>{t('state.loading')}</div>
    if (error !== null) return <div className={css.placeholder}>{t('state.error', { message: error })}</div>
    if (deleted) return <div className={css.placeholder}>{t('detail.deleted')}</div>
    if (untracked) {
      return content === null
        ? <div className={css.placeholder}>{t('detail.untracked')}</div>
        : <CodeBlock className={css.code} code={content.content} />
    }
    if (detailView === 'diff') {
      return diff === null ? <div className={css.placeholder}>{t('detail.noSelection')}</div> : <DiffView diff={diff.diff} t={t} />
    }
    return content === null
      ? <div className={css.placeholder}>{t('state.loading')}</div>
      : <CodeBlock className={css.code} code={content.content} />
  })()

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.path} title={path}>{path}</span>
        <span className={css.toggle}>
          <button
            type="button"
            className={`${css.viewButton} ${detailView === 'diff' ? css.viewActive : ''}`}
            disabled={diffDisabled}
            onClick={() => { onViewChange('diff') }}
          >
            {t('detail.diff')}
          </button>
          <button
            type="button"
            className={`${css.viewButton} ${detailView === 'content' ? css.viewActive : ''}`}
            disabled={contentDisabled}
            onClick={() => { onViewChange('content') }}
          >
            {t('detail.content')}
          </button>
        </span>
      </div>
      <div className={css.body}>{body}</div>
    </div>
  )
}

/** Whether a changed file was deleted in its segment. */
export function isDeleted(file: ChangedFile | undefined): boolean {
  return file?.status === 'D'
}
