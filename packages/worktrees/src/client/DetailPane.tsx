/**
 * The detail pane: the selected file's diff or current content, mirroring
 * ui-file-preview's FilePreviewPane shape. The header is a two-line title bar
 * (filename + language tag on the first line with the preview/source toggle
 * and copy button; the relative path on the second line). The content view
 * renders Markdown (.md/.markdown/.mdx) as a rendered preview by default via
 * the official MarkdownText, with a 预览/源码 toggle back to the raw code
 * block. Files with no change record (repo browse) and untracked files only
 * offer the content view.
 */
import { useState, type ReactNode } from 'react'
import {
  CodeBlock, IconChevronLeftOutline14, IconCopyOutline16, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile, FileDiffResult, LocalImageResult, ReadFileResult } from '../types.ts'
import { basenameOf, dirnameOf, isHtmlFile, isMarkdown, languageFor } from './language.ts'
import type { DetailView } from './store.ts'
import { DiffView } from './DiffView.tsx'
import { HtmlPreview } from './HtmlPreview.tsx'
import { ImagePreview } from './ImagePreview.tsx'
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
  /** The fetched inline image (null unless the selected file is an image). */
  image?: LocalImageResult | null
  /** Whether a fetch is in flight. */
  loading: boolean
  /** Human-readable fetch failure, or null. */
  error: string | null
  /** Called when the view toggle changes. */
  onViewChange: (view: DetailView) => void
  /** Copy the raw content to the clipboard; resolves true only on acceptance. */
  onCopy?: ((text: string) => Promise<boolean>) | undefined
  /** When given and a file is selected, renders a back button to leave the
   * file view (e.g. back to the commit's file list). */
  onBack?: (() => void) | undefined
  /** When true, the pane is nested inside an already-padded container (e.g.
   * a commit's file list) — the path header then relies on the parent's 24px
   * inset instead of adding its own, so the path stays on the same 24px
   * baseline as the surrounding text. */
  embedded?: boolean
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** The detail pane. */
export function DetailPane({
  path, hasDiff: _hasDiff, untracked, deleted, detailView, diff, content, image, loading, error, onViewChange, onBack, onCopy, embedded = false, t,
}: DetailPaneProps): ReactNode {
  void _hasDiff
  // Preview-vs-source for the content view; a Markdown file defaults to the
  // rendered preview, everything else to the raw source.
  const [showPreview, setShowPreview] = useState<boolean | null>(null)
  // Post-copy "copied" confirmation window.
  const [copied, setCopied] = useState(false)

  if (path === '') {
    return <div className={css.placeholder}>{t('detail.noSelection')}</div>
  }

  const contentDisabled = deleted
  const markdown = isMarkdown(path)
  const html = isHtmlFile(path)
  const lang = languageFor(path)
  // A null showPreview means "default": Markdown/HTML → preview, else source.
  const defaultPreview = markdown || html
  const sourceMode = defaultPreview ? showPreview === false : showPreview !== true
  const previewMode = !sourceMode

  const body = ((): ReactNode => {
    if (loading) return <div className={css.placeholder}>{t('state.loading')}</div>
    if (error !== null) return <div className={css.placeholder}>{t('state.error', { message: error })}</div>
    if (deleted) return <div className={css.placeholder}>{t('detail.deleted')}</div>
    if (image !== null && image !== undefined) {
      return <ImagePreview path={path} src={image.dataUrl} />
    }
    if (untracked) {
      if (content === null) return <div className={css.placeholder}>{t('detail.untracked')}</div>
      const raw = content.content
      return (
        <div className={css.untrackedView}>
          <div className={css.untrackedNote}>{t('detail.untrackedNote')}</div>
          {html
            ? <div className={css.htmlRender}><HtmlPreview path={path} content={raw} /></div>
            : markdown
              ? <div className={css.mdRender}><MarkdownText text={raw} /></div>
              : <CodeBlock className={css.code} code={raw} lang={languageFor(path)} />}
        </div>
      )
    }
    if (detailView === 'diff') {
      return diff === null ? <div className={css.placeholder}>{t('detail.noSelection')}</div> : <DiffView diff={diff.diff} t={t} />
    }
    if (content === null) return <div className={css.placeholder}>{t('state.loading')}</div>
    const raw = content.content
    if (previewMode) {
      if (html) return <div className={css.htmlRender}><HtmlPreview path={path} content={raw} /></div>
      if (markdown) return <div className={css.mdRender}><MarkdownText text={raw} /></div>
    }
    return <CodeBlock className={css.code} code={raw} lang={languageFor(path)} />
  })()

  const basename = basenameOf(path)
  const dirname = dirnameOf(path)

  const doCopy = (): void => {
    if (content === null || onCopy === undefined) return
    void onCopy(content.content).then(ok => {
      if (ok) {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, 1200)
      }
    })
  }

  return (
    <div className={css.root}>
      <div className={`${css.titleBar} ${embedded ? css.headerEmbedded : ''}`}>
        <div className={css.titleRow}>
          {onBack !== undefined && (
            <button type="button" className={css.back} title={t('detail.back')} onClick={onBack}>
              <IconChevronLeftOutline14 />
            </button>
          )}
          <span className={css.title} title={basename}>
            {basename}
            {markdown && <span className={css.langTag}>MD</span>}
            {lang !== undefined && !markdown && <span className={css.langTag}>{lang}</span>}
          </span>
          <span className={css.titleActions}>
            {detailView === 'diff' ? (
              <span className={css.toggle}>
                <button
                  type="button"
                  className={`${css.viewButton} ${detailView === 'diff' ? css.viewActive : ''}`}
                  onClick={() => { onViewChange('diff') }}
                >
                  {t('detail.diff')}
                </button>
                <button
                  type="button"
                  className={`${css.viewButton} ${detailView !== 'diff' ? css.viewActive : ''}`}
                  disabled={contentDisabled}
                  onClick={() => { onViewChange('content') }}
                >
                  {t('detail.content')}
                </button>
              </span>
            ) : (
              <span className={css.seg}>
                <button
                  type="button"
                  className={`${css.segButton} ${previewMode ? css.segActive : ''}`}
                  onClick={() => { setShowPreview(true) }}
                >
                  {t('detail.preview')}
                </button>
                <button
                  type="button"
                  className={`${css.segButton} ${sourceMode ? css.segActive : ''}`}
                  onClick={() => { setShowPreview(false) }}
                >
                  {t('detail.source')}
                </button>
              </span>
            )}
            {onCopy !== undefined && content !== null && (
              <button type="button" className={css.copy} title={copied ? t('action.copied') : t('action.copy')} onClick={doCopy}>
                <IconCopyOutline16 />
                {copied && <span className={css.copied}>{t('action.copied')}</span>}
              </button>
            )}
          </span>
        </div>
        {dirname !== '' && <div className={css.pathLine} title={path}>{dirname}</div>}
      </div>
      <div className={css.body}>{body}</div>
    </div>
  )
}

/** Whether a changed file was deleted in its segment. */
export function isDeleted(file: ChangedFile | undefined): boolean {
  return file?.status === 'D'
}
