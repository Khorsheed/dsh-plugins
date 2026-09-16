/**
 * The card-detail reader: the right-Sidebar canvas tab after M1.5. It
 * follows the board's selection through the shared store (`useSelection`,
 * fed by `hooks.selection`) and renders the one card the board last opened:
 * kind + status + source + times in the header, the FULL text through
 * `MarkdownText` (the board shows only the summary), the comment thread
 * (readable and postable), the ghost proposal's ✓/✗, and the attachment
 * area (url → link; file → the official document preview via
 * `ctx.sidebarRight.openResource`).
 *
 * The edit toggle swaps the rendered body for the pad's editor invariants
 * (CardTextarea: uncontrolled, IME composition as a hard stop, ⌘⏎ or blur
 * saves through `patchCard`, and this root stays the one scroll container),
 * then returns to reading.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconCloseOutline16, IconCodeOutline16,
  IconDatabaseOutline16, IconEditOutline16, IconLinkOutline14, IconListPenOutline16,
  IconQuestionOutline14, IconRefreshOutline14, IconRightUpOutline14, IconSparkle16,
  MarkdownText, type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  documentHeadingOf,
  type BoardCard, type BoardMutationResult, type CanvasBoard, type CanvasError,
} from '../../types.ts'
import type { CanvasDetailProps } from '../contract.ts'
import { CardTextarea } from '../space/CardTextarea.tsx'
import css from './CanvasDetailView.module.css'

/** How long a transient toast stays up. */
const TOAST_MS = 2200

/** The kind icon set (the board's own vocabulary). */
const KIND_ICONS = {
  fragment: IconListPenOutline16,
  question: IconQuestionOutline14,
  grounding: IconDatabaseOutline16,
  reference: IconLinkOutline14,
  document: IconCodeOutline16,
} as const

/** The last path segment, separators from either platform (display only). */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(segment => segment.length > 0)
  return parts[parts.length - 1] ?? path
}

/** True when a promise rejection or remote failure carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Fallback for a minimal composition without ui-session. */
const useNoSessions = ((selector: (snapshot: { byId: Record<string, never> }) => unknown) =>
  selector({ byId: {} })) as unknown as CanvasDetailProps['useSessions']

/** The card-detail reader. */
export function CanvasDetailView(props: CanvasDetailProps): ReactNode {
  const { t, sessionId, readBoard, patchCard, addComment, openFile, useSelection } = props
  const selection = useSelection(current => current)
  const useSessions = props.useSessions ?? useNoSessions
  const workspaceRoot = useSessions(sessions =>
    sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd)

  const [open, setOpen] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => { setToast(null) }, TOAST_MS)
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  /** Localized copy for one shared error code. */
  const errorText = useCallback((error: CanvasError): string => {
    switch (error) {
      case 'exists': return t('error.exists')
      case 'stale': return t('error.stale')
      case 'missing': return t('error.missing')
      case 'invalid-name': return t('error.invalidName')
      case 'denied': return t('error.denied')
      default: return t('error.io')
    }
  }, [t])

  /** Unwrap the transport envelope, reporting a failure instead of throwing. */
  const run = useCallback(async <T,>(call: () => Promise<RemoteResult<T>>): Promise<T | null> => {
    try {
      const result = await call()
      if (result.ok) return result.value
      setFatal(result.error.message)
      return null
    } catch (error) {
      setFatal(messageOf(error))
      return null
    }
  }, [])

  /* ------------------------------------------------------------ following */

  // Read the selected canvas's board: on a new selection, and again whenever
  // either seat mutates a board (the store's rev is the freshness channel).
  useEffect(() => {
    if (selection.canvasId === null) {
      setOpen(null)
      setLoadError(null)
      return
    }
    const canvasId = selection.canvasId
    let cancelled = false
    void (async () => {
      const value = await run(() => readBoard({ canvasId }))
      if (cancelled || value === null) return
      if (!value.ok) {
        setOpen(null)
        setLoadError(errorText(value.error))
        return
      }
      setLoadError(null)
      setOpen({ board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [selection.canvasId, selection.rev, readBoard, run, errorText])

  // A selection change always returns the body to the reading state.
  useEffect(() => { setEditing(false) }, [selection.canvasId, selection.cardId])

  /** Run one mutation: the service answers the fresh board; apply it in place. */
  const mutate = useCallback(async (
    call: () => Promise<RemoteResult<BoardMutationResult>>,
    toastKey: Parameters<typeof t>[0],
  ): Promise<void> => {
    const value = await run(call)
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    setOpen({ board: value.board, version: value.version })
    showToast(t(toastKey))
  }, [run, showToast, errorText, t])

  /* -------------------------------------------------------------- rendering */

  /** Localized chrome the shared markdown renderer needs (code-block copy, footnotes). */
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const card: BoardCard | null = open?.board.cards.find(candidate => candidate.id === selection.cardId) ?? null

  if (selection.canvasId === null) {
    return <div className={css.root}><div className={css.notice}>{t('detail.empty')}</div></div>
  }
  if (loadError !== null) {
    return <div className={css.root}><div className={css.notice}>{loadError}</div></div>
  }
  if (open === null) {
    return <div className={css.root}><div className={css.notice}>{t('state.loading')}</div></div>
  }
  if (card === null) {
    return <div className={css.root}><div className={css.notice}>{t('detail.cardGone')}</div></div>
  }

  const KindIcon = KIND_ICONS[card.kind]
  const proposed = card.status === 'proposed'
  const archived = card.status === 'archived'
  const heading = card.kind === 'document' ? documentHeadingOf(card.text) : undefined
  const created = Date.parse(card.createdAt)
  const updated = Date.parse(card.updatedAt)

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.kindTag}>
          <KindIcon size={12} />
          {t(`kind.${card.kind}`)}
          {card.createdBy === 'agent' && !proposed ? ` · ${t('card.fromAgent')}` : ''}
        </span>
        {proposed && (
          <span className={css.ghostFlag}>
            <IconSparkle16 size={12} />
            {t('card.proposed')}
          </span>
        )}
        {archived && (
          <span className={css.archivedTag}>
            <IconArchiveOutline20 size={11} />
            {t('detail.archived')}
          </span>
        )}
        {heading !== undefined && <div className={css.title}>{heading.title}</div>}
        <div className={css.meta}>
          {card.kind === 'question' && card.question !== undefined && (
            <span className={css.qState} data-state={card.question.state}>
              <span className={css.qDot} />
              {card.question.state === 'open'
                ? t('q.open')
                : card.question.state === 'exploring'
                  ? t('q.exploring')
                  : t('q.answered')}
            </span>
          )}
          {!Number.isNaN(created) && <span>{t('detail.created', { time: agoOf(created, t) })}</span>}
          {!Number.isNaN(updated) && updated !== created && (
            <span>{t('detail.updated', { time: agoOf(updated, t) })}</span>
          )}
          <span className={css.spacer} />
          {!editing && !proposed && !archived && (
            <button
              type="button"
              className={css.iconButton}
              title={t('card.edit')}
              onClick={() => { setEditing(true) }}
            >
              <IconEditOutline16 size={12} />
              {t('detail.edit')}
            </button>
          )}
          {archived && (
            <button
              type="button"
              className={css.iconButton}
              onClick={() => void mutate(() => patchCard(sessionId, {
                canvasId: open.board.id, cardId: card.id, status: 'kept',
              }), 'toast.cardRestored')}
            >
              <IconRefreshOutline14 size={12} />
              {t('card.restore')}
            </button>
          )}
        </div>
      </div>

      {proposed && (
        <div className={css.ghostActions}>
          <button
            type="button"
            className={css.accept}
            onClick={() => void mutate(() => patchCard(sessionId, {
              canvasId: open.board.id, cardId: card.id, status: 'kept',
            }), 'toast.accepted')}
          >
            <IconCheckOutline16 size={12} />
            {t('card.accept')}
          </button>
          <button
            type="button"
            onClick={() => void mutate(() => patchCard(sessionId, {
              canvasId: open.board.id, cardId: card.id, status: 'archived',
            }), 'toast.rejected')}
          >
            <IconCloseOutline16 size={12} />
            {t('card.reject')}
          </button>
        </div>
      )}

      <div className={css.body}>
        {editing ? (
          <>
            <CardTextarea
              className={css.editor}
              defaultValue={card.text}
              submitOn="mod-enter"
              autoFocus
              onSubmit={text => {
                const trimmed = text.trim()
                setEditing(false)
                if (trimmed.length === 0 || trimmed === card.text) return
                void mutate(() => patchCard(sessionId, {
                  canvasId: open.board.id, cardId: card.id, text: trimmed,
                }), 'toast.cardSaved')
              }}
              onCancel={() => { setEditing(false) }}
            />
            <span className={css.editHint}>{t('card.editHint')}</span>
          </>
        ) : (
          <MarkdownText text={card.text} labels={markdownLabels} />
        )}
      </div>

      {card.source !== undefined && (
        <div className={css.attachment}>
          <span className={css.attachmentLabel}>{t('detail.attachment')}</span>
          {card.source.type === 'url' ? (
            <a
              className={css.attachmentLink}
              href={card.source.ref}
              target="_blank"
              rel="noreferrer"
            >
              <IconLinkOutline14 size={12} />
              {card.source.title ?? card.source.ref}
              <IconRightUpOutline14 size={11} />
            </a>
          ) : card.source.type === 'file' ? (
            <button
              type="button"
              className={css.attachmentButton}
              onClick={() => { openFile(sessionId, workspaceRoot, card.source!.ref) }}
            >
              <IconRightUpOutline14 size={12} />
              {t('detail.openFile', { name: card.source.title ?? basenameOf(card.source.ref) })}
            </button>
          ) : (
            <span className={css.comment}>{card.source.title ?? card.source.ref}</span>
          )}
        </div>
      )}

      <div className={css.thread}>
        <span className={css.threadTitle}>
          {card.comments.length === 0
            ? t('comment.write')
            : card.comments.length === 1
              ? t('comment.one')
              : t('comment.many', { count: String(card.comments.length) })}
        </span>
        {card.comments.map(comment => (
          <span key={comment.id} className={css.comment}>
            <span className={comment.author === 'agent' ? css.commentAuthor : undefined}>
              {comment.author === 'agent' ? t('comment.agent') : t('comment.user')}
            </span>
            {'：'}
            {comment.text}
          </span>
        ))}
        <div className={css.commentForm}>
          <CardTextarea
            className={css.editor}
            // Remounted per comment count, so a sent comment clears the box.
            key={card.comments.length}
            placeholder={t('comment.placeholder')}
            submitOn="enter"
            onSubmit={text => {
              const trimmed = text.trim()
              if (trimmed.length === 0) return
              void mutate(() => addComment(sessionId, {
                canvasId: open.board.id, cardId: card.id, text: trimmed,
              }), 'toast.commented')
            }}
          />
        </div>
      </div>

      {toast !== null && <div className={css.toast}>{toast}</div>}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}

/** A relative instant in the locale's words (the space list's own buckets). */
function agoOf(at: number, t: CanvasDetailProps['t']): string {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, Date.now() - at)
  if (diff < MIN) return t('time.now')
  if (diff < HOUR) return t('time.minutes', { n: String(Math.floor(diff / MIN)) })
  if (diff < DAY) return t('time.hours', { n: String(Math.floor(diff / HOUR)) })
  if (diff < 30 * DAY) return t('time.days', { n: String(Math.floor(diff / DAY)) })
  if (diff < 365 * DAY) return t('time.months', { n: String(Math.floor(diff / (30 * DAY))) })
  return t('time.years', { n: String(Math.floor(diff / (365 * DAY))) })
}
