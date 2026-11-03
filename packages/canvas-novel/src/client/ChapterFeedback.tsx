import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { bodyFingerprint } from '../types.ts'
import {
  locateChapterFeedback, MAX_FEEDBACK_QUOTE, MAX_FEEDBACK_TEXT,
  type ChapterFeedbackBatch, type ChapterFeedbackIdea,
} from '../chapter-feedback.ts'
import type { ConversationDraftReceipt, NovelSurfaceProps } from './contract.ts'
import { chapterSelectionFromRange, type ChapterSelection } from './chapter-selection.ts'
import { useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

export interface ChapterFeedbackMark extends ChapterFeedbackIdea {
  readonly archived?: boolean
}

interface CommentState {
  readonly sessionId: NonNullable<NovelSurfaceProps['sessionId']>
  readonly selection: ChapterSelection | null
  readonly rect: DOMRect
}

export function ChapterFeedback(props: NovelSurfaceProps & {
  readonly n: number
  readonly chapterTitle: string
  readonly body: string
  readonly bodyHash?: string | undefined
  readonly enabled: boolean
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCountChange: (count: number) => void
  readonly children: (ideas: readonly ChapterFeedbackMark[]) => ReactNode
}): ReactNode {
  const { canvasId, n, body, sessionId, remote, rev, navigate, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.chapterFeedback({ canvasId, n }), `chapter-feedback:${canvasId}:${n}`, rev)
  const workspace = useRef<HTMLDivElement>(null)
  const receipts = useRef(new Map<string, ConversationDraftReceipt>())
  const undoTimer = useRef<number | undefined>(undefined)
  const [comment, setComment] = useState<CommentState | null>(null)
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<ChapterFeedbackIdea | null>(null)
  const bodyHash = props.bodyHash ?? bodyFingerprint(body) ?? ''
  const active = read.state === 'ready' && read.value.ok ? read.value.ideas : []
  const batches = read.state === 'ready' && read.value.ok ? read.value.batches : []
  const open = batches.find(batch => batch.status !== 'archived')
  const archived = batches.filter(batch => batch.status === 'archived')
  const marks: ChapterFeedbackMark[] = [
    ...active,
    ...batches.flatMap(batch => batch.ideas.map(idea => ({ ...idea, ...(batch.status === 'archived' ? { archived: true as const } : {}) }))),
  ]

  const openSelection = (requestedSession: CommentState['sessionId']): void => {
    if (!props.enabled) return
    const root = workspace.current?.querySelector<HTMLElement>('[data-novel-prose]')
    const selection = window.getSelection()
    if (root == null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) return
    const found = chapterSelectionFromRange(body, root, selection.getRangeAt(0))
    if (found === undefined) return
    if (found.quote.length > MAX_FEEDBACK_QUOTE) {
      setNotice(t('feedback.selectionTooLong'))
      props.onOpenChange(true)
      return
    }
    setNotice(null)
    setCommentText('')
    setComment({ sessionId: requestedSession, selection: found, rect: found.rect })
  }

  useEffect(() => {
    if (!props.enabled || sessionId === undefined || props.registerChapterComment === undefined) return
    return props.registerChapterComment(canvasId, n, openSelection)
  })

  useEffect(() => {
    props.onCountChange(active.length + (open?.ideas.length ?? 0))
  }, [active.length, open?.ideas.length, props.onCountChange])

  useEffect(() => {
    if (open?.status !== 'drafted' || sessionId === undefined || props.watchChapterFeedback === undefined) return
    return props.watchChapterFeedback(sessionId, canvasId, open.id)
  }, [open?.id, open?.status, sessionId, canvasId, props.watchChapterFeedback])

  useEffect(() => () => { if (undoTimer.current !== undefined) window.clearTimeout(undoTimer.current) }, [])

  if (api === undefined) return <div className={css.feedbackLayout}><div className={css.feedbackReading}>{props.children([])}</div></div>

  const saveComment = async (): Promise<void> => {
    if (comment === null || commentText.trim() === '') return
    setBusy(true)
    setNotice(null)
    try {
      const selected = comment.selection
      const result = await api.addChapterFeedback(comment.sessionId, {
        canvasId, n,
        text: commentText.trim(),
        baseBodyHash: bodyHash,
        ...(selected === null ? {} : {
          quote: selected.quote,
          start: selected.start,
          end: selected.end,
          before: selected.before,
          after: selected.after,
        }),
      })
      if (!result.ok || !result.value.ok) { setNotice(t('error.generic', { message: result.ok ? result.value.error ?? '' : result.error.message })); return }
      setComment(null)
      setCommentText('')
      window.getSelection()?.removeAllRanges()
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  const fill = async (): Promise<void> => {
    if (sessionId === undefined || open !== undefined || active.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const prepared = await api.prepareChapterFeedback(sessionId, { canvasId, n })
      if (!prepared.ok || !prepared.value.ok || prepared.value.batchId === undefined || prepared.value.text === undefined) {
        setNotice(t('error.generic', { message: prepared.ok ? prepared.value.error ?? '' : prepared.error.message }))
        return
      }
      const batchId = prepared.value.batchId
      const receipt = props.fillConversation?.(sessionId, prepared.value.text) ?? false
      if (receipt === false) {
        await api.recallChapterFeedback(sessionId, { canvasId, n, batchId })
        setNotice(t('feedback.noConversation'))
        return
      }
      receipts.current.set(batchId, receipt)
      props.watchChapterFeedback?.(sessionId, canvasId, batchId)
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  const recall = async (batch: ChapterFeedbackBatch): Promise<void> => {
    if (sessionId === undefined || batch.write !== undefined) return
    setBusy(true)
    setNotice(null)
    try {
      const receipt = receipts.current.get(batch.id)
      if (receipt !== undefined) props.restoreConversationDraft?.(sessionId, receipt)
      const result = await api.recallChapterFeedback(sessionId, { canvasId, n, batchId: batch.id })
      if (!result.ok || !result.value.ok) { setNotice(t('error.generic', { message: result.ok ? result.value.error ?? '' : result.error.message })); return }
      receipts.current.delete(batch.id)
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (idea: ChapterFeedbackIdea): Promise<void> => {
    if (sessionId === undefined) return
    const result = await api.deleteChapterFeedback(sessionId, { canvasId, n, id: idea.id })
    if (!result.ok || !result.value.ok) { setNotice(t('feedback.failed')); return }
    if (undoTimer.current !== undefined) window.clearTimeout(undoTimer.current)
    setDeleted(idea)
    undoTimer.current = window.setTimeout(() => { setDeleted(null) }, 6000)
    navigate.refresh()
  }

  const undo = async (): Promise<void> => {
    if (sessionId === undefined || deleted === null) return
    const result = await api.restoreChapterFeedback(sessionId, { canvasId, idea: deleted })
    if (!result.ok || !result.value.ok) { setNotice(t('feedback.failed')); return }
    setDeleted(null)
    navigate.refresh()
  }

  const jumpTo = (idea: ChapterFeedbackIdea): void => {
    const found = locateChapterFeedback(idea, body)
    const marker = found === undefined ? null : workspace.current?.querySelector(`[data-idea-id="${idea.id}"]`)
    if (marker == null) { setNotice(t('feedback.quoteMissing')); return }
    marker.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const position = comment === null ? undefined : (() => {
    const bounds = workspace.current?.getBoundingClientRect()
    if (bounds === undefined) return { left: 12, top: 12 }
    const above = comment.rect.top - bounds.top - 290
    return {
      left: Math.max(12, Math.min(comment.rect.left - bounds.left, bounds.width - 392)),
      top: comment.rect.bottom + 300 < window.innerHeight || above < 12 ? comment.rect.bottom - bounds.top + 10 : above,
    }
  })()

  return (
    <div className={css.feedbackLayout} ref={workspace}>
      {props.open && (
        <div className={css.feedbackDock}>
          <section id={`chapter-feedback-${canvasId}-${n}`} className={css.chapterFeedback} role="region" aria-label={t('feedback.title')} onKeyDown={event => { if (event.key === 'Escape') props.onOpenChange(false) }}>
            <div className={css.feedbackHead}>
              <h3>{t('feedback.title')}<span>{active.length + (open?.ideas.length ?? 0)}</span></h3>
              <div className={css.feedbackHeadActions}>
                {sessionId !== undefined && <button type="button" disabled={busy} onClick={(event: MouseEvent<HTMLButtonElement>) => { setNotice(null); setCommentText(''); setComment({ sessionId, selection: null, rect: event.currentTarget.getBoundingClientRect() }) }}>{t('feedback.addGeneral')}</button>}
                <button type="button" aria-label={t('feedback.close')} onClick={() => { props.onOpenChange(false) }}>{t('feedback.close')}</button>
              </div>
            </div>
            {active.length > 0 && <Button size="sm" variant="primary" disabled={busy || open !== undefined} onClick={() => { void fill() }}>{t('feedback.fill', { count: active.length })}</Button>}
            {active.length === 0 && open === undefined && <p className={css.feedbackEmpty}>{t('feedback.empty')}</p>}
            {open !== undefined && (
              <div className={css.feedbackStatus}>
                {open.notice !== undefined
                  ? <p>{t(`feedback.${open.notice}`)}</p>
                  : open.status === 'drafted'
                    ? <p>{t('feedback.drafted')}</p>
                    : <p>{t('feedback.sending', { count: open.ideas.length, n })}</p>}
                {open.write === undefined && <button type="button" disabled={busy} onClick={() => { void recall(open) }}>{t('feedback.recall')}</button>}
              </div>
            )}
            <div className={css.feedbackList}>
              {active.map(idea => (
                <article key={idea.id} className={css.feedbackIdea}>
                  {idea.quote !== undefined && <button type="button" className={css.feedbackQuote} onClick={() => { jumpTo(idea) }}>“{idea.quote}”</button>}
                  <p>{idea.text}</p>
                  <footer><span>{t('feedback.pending')}</span><button type="button" onClick={() => { void remove(idea) }}>{t('feedback.delete')}</button></footer>
                </article>
              ))}
            </div>
            {deleted !== null && <div className={css.feedbackUndo}><span>{t('feedback.deleted')}</span><button type="button" onClick={() => { void undo() }}>{t('feedback.undo')}</button></div>}
            {notice !== null && comment === null && <p className={css.feedbackNotice}>{notice}</p>}
            <details className={css.feedbackArchive}>
              <summary>{t('feedback.archive')}<span>{archived.length}</span></summary>
              {archived.map(batch => (
                <section key={batch.id} className={css.feedbackArchivedBatch}>
                  <h4>{t('feedback.batchDone', { count: batch.ideas.length })}</h4>
                  <p>{t('feedback.completedAt', { time: formatTime(batch.completedAt) })}</p>
                  {batch.submittedText !== undefined && <details className={css.feedbackRequest}><summary>{t('feedback.request')}</summary><pre>{batch.submittedText}</pre></details>}
                  {batch.ideas.map(idea => (
                    <div key={idea.id} className={css.feedbackArchivedIdea}>
                      {idea.quote !== undefined && <blockquote>“{idea.quote}”</blockquote>}
                      <p>{idea.text}</p>
                    </div>
                  ))}
                </section>
              ))}
            </details>
          </section>
        </div>
      )}
      <div className={css.feedbackReading}>{props.children(marks)}</div>
      {comment !== null && position !== undefined && (
        <section className={css.feedbackPopover} style={position} role="dialog" aria-label={comment.selection === null ? t('feedback.recordGeneral') : t('feedback.record')}>
          <h3>{comment.selection === null ? t('feedback.recordGeneral') : t('feedback.record')}</h3>
          {comment.selection !== null && <blockquote>{comment.selection.quote}</blockquote>}
          <textarea autoFocus maxLength={MAX_FEEDBACK_TEXT} value={commentText} onChange={event => { setCommentText(event.target.value) }} placeholder={t('feedback.commentPlaceholder')} aria-label={t('feedback.commentPlaceholder')} />
          {notice !== null && <p className={css.feedbackNotice}>{notice}</p>}
          <div className={css.feedbackPopoverActions}>
            <button type="button" disabled={busy} onClick={() => { setComment(null) }}>{t('feedback.cancel')}</button>
            <Button size="sm" variant="primary" disabled={busy || commentText.trim() === ''} onClick={() => { void saveComment() }}>{t('feedback.save')}</Button>
          </div>
        </section>
      )}
    </div>
  )
}

function formatTime(value: string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
