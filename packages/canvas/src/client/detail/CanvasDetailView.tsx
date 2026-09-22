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
 * This is the board family's only editor: a card's edit toggle and the
 * new-card draft (the tab holds the draft's text and passes it in `create`)
 * both land on the same pad invariants (CardTextarea: uncontrolled, IME
 * composition as a hard stop, ⌘⏎ saves, and this root stays the one scroll
 * container). The paste arm lives here too — the one place the clipboard is
 * read, so a pasted page, table, or markup is decided against the card text it
 * would produce (§11.6 item 3).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type ReactNode,
} from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconCloseOutline16, IconCodeOutline16,
  IconDatabaseOutline16, IconLinkOutline14, IconListPenOutline16, IconPlusOutline16,
  IconQuestionOutline14, IconRefreshOutline14, IconRightUpOutline14, IconSparkle16,
  MarkdownText, Toast, type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { attachBridge } from '@khorsheed/dsh-inline-html-render/src/client/bridge.ts'
import { buildCardSrcDoc } from '@khorsheed/dsh-inline-html-render/src/client/srcdoc.ts'
import { detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import {
  documentHeadingOf,
  type BoardAskAgentRequest, type BoardCard, type BoardMutationResult, type CanvasBoard, type CanvasError,
} from '../../types.ts'
import type { CanvasDetailProps } from '../contract.ts'
import { choosePaste, type PasteArm } from '../paste-table.ts'
import type { CanvasKey } from '../locales.ts'
import { CardTextarea } from '../space/CardTextarea.tsx'
import css from './CanvasDetailView.module.css'

/** What each paste arm reports about itself (the toast's whole copy). */
const PASTE_VERDICT: Record<Exclude<PasteArm, 'plain'>, CanvasKey> = {
  page: 'paste.page',
  table: 'paste.table',
  words: 'paste.words',
  markup: 'paste.markup',
}

/** The kind icon set (the board's own vocabulary). */
const KIND_ICONS = {
  fragment: IconListPenOutline16,
  question: IconQuestionOutline14,
  grounding: IconDatabaseOutline16,
  reference: IconLinkOutline14,
  document: IconCodeOutline16,
} as const

/** The detail's reading modes (render / source / split) — §11.6 item 1's second row. */
const MODES = ['render', 'source', 'split'] as const

/** The mode switch: the same three buttons in the reader and in create mode. */
function ModeSeg({ mode, onMode, t }: {
  readonly mode: 'render' | 'source' | 'split'
  readonly onMode: (mode: 'render' | 'source' | 'split') => void
  readonly t: CanvasDetailProps['t']
}): ReactNode {
  return (
    <span className={css.seg} role="group" aria-label={t('card.edit')}>
      {MODES.map(candidate => (
        <button
          key={candidate}
          type="button"
          aria-pressed={mode === candidate}
          onClick={() => { onMode(candidate) }}
        >
          {candidate === 'render' ? t('detail.render') : candidate === 'source' ? t('detail.source') : t('detail.split')}
        </button>
      ))}
    </span>
  )
}

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

/**
 * The sandboxed HTML frame (the strict card CSP, no network, the capability
 * bridge for link/copy/height). Both helpers come from inline-html-render's
 * SOURCE plane — bundled into this client, zero runtime coupling.
 */
function HtmlFrame({ html }: { html: string }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    return attachBridge(frame)
  }, [])
  return (
    <iframe
      ref={frameRef}
      className={css.htmlFrame}
      sandbox="allow-scripts"
      srcDoc={buildCardSrcDoc(html)}
      title="HTML"
    />
  )
}

/** The card-detail reader. */
export function CanvasDetailView(props: CanvasDetailProps): ReactNode {
  const {
    t, sessionId, create, readBoard, patchCard, addComment, openFile, useSelection,
    askAgent, chatStatus, openSideChat,
  } = props
  const selection = useSelection(current => current)
  const useSessions = props.useSessions ?? useNoSessions
  const workspaceRoot = useSessions(sessions =>
    sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd)
  /** The pane (root scope) can sit above no session: the reader then reads only. */
  const readonly = sessionId === undefined

  const [open, setOpen] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** The detail's three reading modes (render / source / split). */
  const [mode, setMode] = useState<'render' | 'source' | 'split'>('render')
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  /** The chat seam's probe: null while probing, so entries never flash. */
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null)
  const toastSeqRef = useRef(0)

  // The host's Toast owns its timer and reports back (v2.2: the hand-rolled
  // banner div and its timeout constant are gone — same job, host's tokens).
  const showToast = useCallback((text: string) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current })
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
  useEffect(() => { setMode('render') }, [selection.canvasId, selection.cardId])

  // A draft opens where the work is: an empty render pane is not a writing
  // surface, and the ＋新卡 gesture's whole point is the keyboard.
  const drafting = create !== undefined
  useEffect(() => { if (drafting) setMode('source') }, [drafting])

  /** Run one mutation: the service answers the fresh board; apply it in place. */
  const mutate = useCallback(async (
    call: (sessionId: SessionId) => Promise<RemoteResult<BoardMutationResult>>,
    toastKey: Parameters<typeof t>[0],
  ): Promise<void> => {
    if (sessionId === undefined) return
    const value = await run(() => call(sessionId))
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    setOpen({ board: value.board, version: value.version })
    showToast(t(toastKey))
  }, [sessionId, run, showToast, errorText, t])

  // Probe the chat seam once per mount: 问 Agent / 追问 hide when absent
  // (and a session-less pane never asks at all).
  useEffect(() => {
    if (readonly) return
    let cancelled = false
    void (async () => {
      const value = await run(() => chatStatus())
      if (cancelled || value === null) return
      setChatAvailable(value.available)
    })()
    return () => { cancelled = true }
  }, [readonly, chatStatus, run])

  /** Ask through the seam and activate the side-chat tab (the ask flow's tail). */
  const ask = useCallback(async (request: Omit<BoardAskAgentRequest, 'canvasId'>) => {
    const canvasId = selection.canvasId
    if (sessionId === undefined || canvasId === null) return
    const value = await run(() => askAgent(sessionId, { canvasId, ...request }))
    if (value === null) return
    if (!value.ok) {
      if (value.error === 'unavailable') {
        setChatAvailable(false)
        showToast(t('chat.unavailable'))
        return
      }
      showToast(t('chat.askFailed', { message: errorText(value.error) }))
      return
    }
    openSideChat(value.contextKey)
  }, [sessionId, selection.canvasId, askAgent, openSideChat, run, showToast, errorText, t])

  /**
   * The paste arm (§11.6 item 3, §11.2 row 12): markup may only land when the
   * card it would produce still reads as one page, because THAT is what the
   * renderer sniffs. The decision is `choosePaste`'s — this is the one place
   * the clipboard is read, and the one place a pasted table turns markdown.
   */
  const onPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData
    if (clipboard === null) return
    const markup = clipboard.getData('text/html')
    if (markup.trim().length === 0) return
    const words = clipboard.getData('text/plain')
    const element = event.currentTarget
    const from = element.selectionStart ?? element.value.length
    const to = element.selectionEnd ?? from
    const choice = choosePaste(markup, words, candidate =>
      `${element.value.slice(0, from)}${candidate}${element.value.slice(to)}`)
    if (choice.arm !== 'plain') showToast(t(PASTE_VERDICT[choice.arm]))
    // When the clipboard's text flavor is what lands, the browser does the
    // inserting: its own undo entry, nothing to take over.
    if (choice.arm === 'plain' || choice.arm === 'words') return
    event.preventDefault()
    element.setRangeText(choice.text, from, to, 'end')
    // The textarea is uncontrolled, so only an input event moves the owner's
    // copy of its text (the draft's dirty flag rides that report).
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, [showToast, t])

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

  /* ------------------------------------------------------------ create mode */

  // The detail page is the ONLY card editor (v2.2 ②), so ＋新卡 opens THIS
  // page with the owner's draft instead of the board's in-place textarea: no
  // card to read, nothing on disk until the first save, and the tab owns the
  // one exit gesture (its back bar asks once before dropping a draft — §11.6
  // item 5). The blur commit is off here: a click elsewhere must never
  // create a card.
  if (create !== undefined) {
    return (
      <div className={css.root}>
        <div className={css.header}>
          <div className={css.meta}>
            <span className={css.kindTag}>
              <IconPlusOutline16 size={12} />
              {t(`kind.${create.kind}`)}
            </span>
            <span className={css.ghostFlag}>{t('detail.unsaved')}</span>
            <span className={css.spacer} />
            <ModeSeg mode={mode} onMode={setMode} t={t} />
          </div>
        </div>
        <div className={css.body} data-mode={mode}>
          {mode === 'source' || mode === 'split' ? (
            <div className={css.sourcePane}>
              <CardTextarea
                className={css.editor}
                defaultValue={create.text}
                placeholder={t('board.newCardPlaceholder')}
                submitOn="mod-enter"
                blurSubmits={false}
                autoFocus={mode === 'source'}
                onPaste={onPaste}
                onTextChange={create.onTextChange}
                onSubmit={text => { void create.onSave(create.kind, text) }}
                onCancel={create.onLeave}
              />
              <span className={css.editHint}>{t('detail.createHint')}</span>
            </div>
          ) : null}
          {mode === 'render' || mode === 'split' ? (
            <div className={css.renderPane}>
              {create.text.trim().length === 0 ? (
                <div className={css.notice}>{t('detail.nothingToRender')}</div>
              ) : detectCardFormat(create.text) === 'html' ? (
                <HtmlFrame html={create.text} />
              ) : (
                <MarkdownText text={create.text} labels={markdownLabels} />
              )}
            </div>
          ) : null}
        </div>
        {fatal !== null && (
          <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
        )}
      </div>
    )
  }

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
  const format = detectCardFormat(card.text)
  // An html document's heading is its <title>, never the doctype opener.
  const heading = card.kind === 'document'
    ? (format === 'html' ? (htmlTitleOf(card.text) !== undefined ? { title: htmlTitleOf(card.text)!, body: '' } : undefined) : documentHeadingOf(card.text))
    : undefined
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
          {detectCardFormat(card.text) === 'html' && (
            <span className={css.formatTag}>{t('detail.formatHtml')}</span>
          )}
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
          {!proposed && !archived && !readonly && (
            <ModeSeg mode={mode} onMode={setMode} t={t} />
          )}
          {archived && !readonly && (
            <button
              type="button"
              className={css.iconButton}
              onClick={() => void mutate(sid => patchCard(sid, {
                canvasId: open.board.id, cardId: card.id, status: 'kept',
              }), 'toast.cardRestored')}
            >
              <IconRefreshOutline14 size={12} />
              {t('card.restore')}
            </button>
          )}
        </div>
      </div>

      {proposed && !readonly && (
        <div className={css.ghostActions}>
          <button
            type="button"
            className={css.accept}
            onClick={() => void mutate(sid => patchCard(sid, {
              canvasId: open.board.id, cardId: card.id, status: 'kept',
            }), 'toast.accepted')}
          >
            <IconCheckOutline16 size={12} />
            {t('card.accept')}
          </button>
          <button
            type="button"
            onClick={() => void mutate(sid => patchCard(sid, {
              canvasId: open.board.id, cardId: card.id, status: 'archived',
            }), 'toast.rejected')}
          >
            <IconCloseOutline16 size={12} />
            {t('card.reject')}
          </button>
        </div>
      )}

      <div className={css.body} data-mode={mode}>
        {mode === 'source' || mode === 'split' ? (
          <div className={css.sourcePane}>
            <CardTextarea
              className={css.editor}
              defaultValue={card.text}
              submitOn="mod-enter"
              autoFocus={mode === 'source'}
              onPaste={onPaste}
              onSubmit={text => {
                const trimmed = text.trim()
                setMode('render')
                if (trimmed.length === 0 || trimmed === card.text) return
                void mutate(sid => patchCard(sid, {
                  canvasId: open.board.id, cardId: card.id, text: trimmed,
                }), 'toast.cardSaved')
              }}
              onCancel={() => { setMode('render') }}
            />
            <span className={css.editHint}>{t('card.editHint')}</span>
          </div>
        ) : null}
        {mode === 'render' || mode === 'split' ? (
          <div className={css.renderPane}>
            {detectCardFormat(card.text) === 'html' ? (
              <HtmlFrame key={card.id} html={card.text} />
            ) : (
              <MarkdownText text={card.text} labels={markdownLabels} />
            )}
          </div>
        ) : null}
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
              onClick={() => { if (sessionId !== undefined) openFile(sessionId, workspaceRoot, card.source!.ref) }}
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
            {comment.author === 'agent' && chatAvailable === true && (
              <>
                {' '}
                <button
                  type="button"
                  className={css.followUp}
                  onClick={() => {
                    void ask({
                      lens: 'ask',
                      cardIds: [card.id],
                      text: t('chat.followupText', { text: comment.text }),
                    })
                  }}
                >
                  {t('chat.followup')} →
                </button>
              </>
            )}
          </span>
        ))}
        {!readonly && (
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
              void mutate(sid => addComment(sid, {
                canvasId: open.board.id, cardId: card.id, text: trimmed,
              }), 'toast.commented')
            }}
          />
        </div>
        )}
      </div>

      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
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
