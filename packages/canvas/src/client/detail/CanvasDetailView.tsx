/**
 * The card-detail reader: the body of one non-board strip row. It is TOLD which
 * card to show — `canvasId` and `cardId` arrive as props from the active row —
 * and subscribes to the shared store only for its rev, so a board mutation
 * anywhere makes it re-read. Kind + status + source + times in the header, the
 * FULL text through `MarkdownText` (the board shows only the summary), the
 * comment thread (readable and postable), the ghost proposal's ✓/✗, and the
 * attachment area (url → link; file → the official document preview via
 * `ctx.sidebarRight.openResource`).
 *
 * This is the board family's only editor: a card's edit toggle and the
 * new-card draft (the surface holds the draft's text and passes it in
 * `create`) both land on the same pad invariants (CardTextarea: uncontrolled,
 * IME composition as a hard stop, ⌘⏎ saves, and this root stays the one scroll
 * container). The paste arm lives here too — the one place the clipboard is
 * read, so a pasted page, table, image, or markup is decided against the card
 * text it would produce (§11.6 item 3). A pasted image's bytes go to the host's
 * attachment store and only its pointer enters the text (§10.3); the row's
 * `pathImages` and `images` resolve that pointer back for both renderers.
 * The pen field is the third kind of content a card holds (§11.4, demand ③):
 * it shares this page's exit gestures and its strokes commit through the same
 * `patchCard` fence as the text does.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type ReactNode,
} from 'react'
import { MarkdownText, Toast, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconArchiveOutlineMedium, IconCheckOutlineMedium, IconCloseOutlineMedium, IconLinkOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconRightUpOutlineMedium, IconSparkleMedium } from '../icons.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { attachBridge } from '@khorsheed/dsh-inline-html-render/src/client/bridge.ts'
import { buildCardSrcDoc } from '@khorsheed/dsh-inline-html-render/src/client/srcdoc.ts'
import { detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import { COMPOSE_SEND_TEXT } from '../../prompt.ts'
import { imageHtmlOf, imageMarkdownOf } from '../../image-token.ts'
import {
  documentHeadingOf,
  type BoardAskAgentRequest, type BoardCard, type BoardMutationResult, type CanvasBoard,
  type CanvasError, type CanvasImageError,
} from '../../types.ts'
import type { CanvasDetailProps } from '../contract.ts'
import { categoryLabelMap, kindIconOf } from '../category-label.ts'
import { canvasErrorText } from '../error-text.ts'
import { base64Of, imageFilesOf, type CanvasImageFile } from '../images.ts'
import { choosePaste, type PasteArm } from '../paste-table.ts'
import type { CanvasKey } from '../locales.ts'
import { CardTextarea } from '../space/CardTextarea.tsx'
import { agoOf, basenameOf, messageOf } from '../text.ts'
import { FollowUp } from '../follow-up.tsx'
import type { PadTool } from '../draw.ts'
import { CardPad } from './CardPad.tsx'
import css from './CanvasDetailView.module.css'

/** What each paste arm reports about itself (the toast's whole copy). */
const PASTE_VERDICT: Record<Exclude<PasteArm, 'plain'>, CanvasKey> = {
  page: 'paste.page',
  table: 'paste.table',
  formatted: 'paste.formatted',
  words: 'paste.words',
  markup: 'paste.markup',
}

/** What each image failure says (§10.3's four codes; `unreadable` rides the store's news). */
const IMAGE_FAILURE: Record<CanvasImageError, CanvasKey> = {
  unavailable: 'paste.imageUnavailable',
  'not-image': 'paste.imageType',
  'too-large': 'paste.imageSize',
  unreadable: 'paste.imageUnavailable',
}

/** The detail's reading modes (render / source / split) — §11.6 item 1's second row. */
const MODES = ['render', 'source', 'split'] as const

/** The mode switch: the same three buttons in the reader and in create mode. */
function ModeSeg({ mode, onMode, t }: {
  readonly mode: 'render' | 'source' | 'split'
  readonly onMode: (mode: 'render' | 'source' | 'split') => void
  readonly t: CanvasDetailProps['t']
}): ReactNode {
  return (
    <span className={css.seg} role="group" aria-label={t('detail.viewMode')}>
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
    t, sessionId, canvasId, cardId, create, readBoard, patchCard, addComment, openFile, useSelection,
    askAgent, chatStatus, openSideChat, attachImage, images, pathImages,
  } = props
  // Only the rev is read from the shared store: which card this page shows came
  // in as a prop the moment the detail became its own tab (stage ⑧).
  const boardRev = useSelection(current => current.rev)
  const useSessions = props.useSessions ?? useNoSessions
  const workspaceRoot = useSessions(sessions =>
    sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd)
  /** The pane (root scope) can sit above no session: the reader then reads only. */
  const noSession = sessionId === undefined

  const [open, setOpen] = useState<{ board: CanvasBoard; version: string } | null>(null)
  /** An archived canvas reads only, like a session-less seat (its board says so too). */
  const readonly = noSession || (open !== null && open.board.archivedAt !== null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** The detail's three reading modes (render / source / split). */
  const [mode, setMode] = useState<'render' | 'source' | 'split'>('render')
  /** The pen field's tool (§11.4): the pad takes the editor's place while this says so. */
  const [tool, setTool] = useState<PadTool>('text')
  const [toast, setToast] = useState<{ text: string; seq: number; undo?: () => void } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  /** The chat seam's probe: null while probing, so entries never flash. */
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null)
  const toastSeqRef = useRef(0)

  // The host's Toast owns its timer and reports back (v2.2: the hand-rolled
  // banner div and its timeout constant are gone — same job, host's tokens).
  const showToast = useCallback((text: string, undo?: () => void) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current, ...(undo === undefined ? {} : { undo }) })
  }, [])

  /** Put the pen up or down, and say which happened (the pad's only channel). */
  const chooseTool = useCallback((next: PadTool) => {
    setTool(next)
    if (next === 'pen') showToast(t('draw.penOn'))
    if (next === 'erase') showToast(t('draw.eraseOn'))
    if (next === 'text') showToast(t('draw.off'))
  }, [showToast, t])

  /** Localized copy for one shared error code. */
  const errorText = useCallback((error: CanvasError): string => canvasErrorText(t, error), [t])

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

  // Read this tab's canvas: on a new one, and again whenever any tab mutates a
  // board (the store's rev is the freshness channel).
  useEffect(() => {
    if (canvasId === null) {
      setOpen(null)
      setLoadError(null)
      return
    }
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
  }, [canvasId, boardRev, readBoard, run, errorText])

  // Turning to another card always returns the body to the reading state — and
  // puts the pen down: leaving the card is one of its three exits (§11.2 row 8).
  useEffect(() => {
    setMode('render')
    setTool('text')
  }, [canvasId, cardId])

  // A draft opens where the work is: an empty render pane is not a writing
  // surface, and the ＋新卡 gesture's whole point is the keyboard.
  const drafting = create !== undefined
  useEffect(() => { if (drafting) setMode('source') }, [drafting])

  /** Run one mutation: the service answers the fresh board; apply it in place. */
  const mutate = useCallback(async (
    call: (sessionId: SessionId) => Promise<RemoteResult<BoardMutationResult>>,
    toastKey?: Parameters<typeof t>[0],
    undo?: () => void,
  ): Promise<void> => {
    if (sessionId === undefined) return
    const value = await run(() => call(sessionId))
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    setOpen({ board: value.board, version: value.version })
    // Some writes announce themselves by being visible — a stroke lands on the
    // pad the moment it saves, so a toast per stroke would only be noise.
    if (toastKey !== undefined) showToast(t(toastKey), undo)
  }, [sessionId, run, showToast, errorText, t])

  // Probe the chat seam once per mount: 问 Agent / 追问 hide when absent
  // (and a session-less pane never asks at all).
  useEffect(() => {
    if (noSession) return
    let cancelled = false
    void (async () => {
      const value = await run(() => chatStatus())
      if (cancelled || value === null) return
      setChatAvailable(value.available)
    })()
    return () => { cancelled = true }
  }, [noSession, chatStatus, run])

  /** Ask through the seam and activate the side-chat tab (the ask flow's tail). */
  const ask = useCallback(async (request: Omit<BoardAskAgentRequest, 'canvasId'>) => {
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
  }, [sessionId, canvasId, askAgent, openSideChat, run, showToast, errorText, t])

  /**
   * The image arm of a paste (§10.3): the clipboard's files go to the host's
   * attachment store and the card keeps the pointer, spelled for whichever
   * renderer the card it would produce uses — an `<img>` inside a page,
   * markdown everywhere else. Pixels never enter card text.
   */
  const pasteImages = useCallback(async (
    files: readonly CanvasImageFile[], element: HTMLTextAreaElement, from: number, to: number,
  ): Promise<void> => {
    // The form is decided against the card WITHOUT the pasted run, exactly as
    // `choosePaste` decides markup: clearing the selection first is what makes
    // "replace the whole page with one image" a markdown card, correctly.
    const page = detectCardFormat(`${element.value.slice(0, from)}${element.value.slice(to)}`) === 'html'
    const lines: string[] = []
    let failure: CanvasImageError | undefined
    for (const { file, mediaType } of files) {
      const data = await base64Of(file)
      const outcome = await run(() => attachImage({ data, mediaType, name: file.name }))
      if (outcome === null) return
      if (!outcome.ok) {
        failure = outcome.error
        continue
      }
      lines.push(page ? imageHtmlOf(outcome.ref, file.name) : imageMarkdownOf(outcome.ref, file.name))
    }
    // A refused file is the news that matters; a partial success still says
    // what landed. With nothing inserted there is nothing to report.
    if (failure !== undefined) showToast(t(IMAGE_FAILURE[failure]))
    else if (lines.length > 0) showToast(t('paste.image'))
    if (lines.length === 0) return
    // The caret may have moved while the bytes were in flight: the insertion
    // goes where the paste was, which is what the user aimed at.
    element.setRangeText(lines.join('\n'), from, to, 'end')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, [attachImage, run, showToast, t])

  /**
   * The paste arm (§11.6 item 3, §11.2 row 12): markup may only land when the
   * card it would produce still reads as one page, because THAT is what the
   * renderer sniffs. The decision is `choosePaste`'s — this is the one place
   * the clipboard is read, and the one place a pasted table turns markdown.
   */
  const onPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData
    if (clipboard === null) return
    const element = event.currentTarget
    const from = element.selectionStart ?? element.value.length
    const to = element.selectionEnd ?? from
    const files = imageFilesOf(clipboard.files)
    if (files.length > 0) {
      // Taken over BEFORE the first await: after one, the browser has already
      // run its own (empty) text insertion.
      event.preventDefault()
      void pasteImages(files, element, from, to)
      return
    }
    const markup = clipboard.getData('text/html')
    if (markup.trim().length === 0) return
    const words = clipboard.getData('text/plain')
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
  }, [pasteImages, showToast, t])

  /* -------------------------------------------------------------- rendering */

  /** Localized chrome the shared markdown renderer needs (code-block copy, footnotes). */
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const card: BoardCard | null = open?.board.cards.find(candidate => candidate.id === cardId) ?? null

  // The category words come from the board's own catalog (stage ⑤): the map
  // carries the built-ins' dictionary names and whatever the user renamed.
  const categoryLabels = useMemo(
    () => categoryLabelMap(open?.board.categories ?? [], t),
    [open?.board.categories, t],
  )

  /* ------------------------------------------------------------ create mode */

  // The detail page is the ONLY card editor (v2.2 ②), so ＋新卡 opens THIS
  // page with the owner's draft instead of the board's in-place textarea: no
  // card to read, nothing on disk until the first save, and the tab owns the
  // one exit gesture (its back bar asks once before dropping a draft — §11.6
  // item 5). The blur commit is off here: a click elsewhere must never
  // create a card.
  /** Whether the pad has the editor's place right now (a read-only seat never does). */
  const drawing = !readonly && tool !== 'text'

  if (create !== undefined) {
    return (
      <div className={css.root}>
        <div className={css.header}>
          <div className={css.meta}>
            <span className={css.kindTag}>
              <IconPlusOutlineMedium size={12} />
              {categoryLabels.get(create.kind) ?? create.kind}
            </span>
            <span className={css.ghostFlag}>{t('detail.unsaved')}</span>
            <span className={css.spacer} />
            <ModeSeg mode={mode} onMode={setMode} t={t} />
          </div>
        </div>
        {!drawing && (
          <div className={css.body} data-mode={mode}>
            {mode === 'source' || mode === 'split' ? (
              <div className={css.sourcePane}>
                <CardTextarea
                  className={css.editor}
                  defaultValue={create.text}
                  placeholder={t('board.newCardPlaceholder')}
                  submitOn="auto-enter"
                  blurSubmits={false}
                  autoFocus={mode === 'source'}
                  onPaste={onPaste}
                  onTextChange={create.onTextChange}
                  onSubmit={text => { void create.onSave(create.kind, text, create.draw) }}
                  onCancel={create.onLeave}
                />
                {/* The chord the box just agreed to: one line says ⏎, two say ⌘⏎. */}
                <span className={css.editHint}>
                  {t(create.text.includes('\n') ? 'detail.createHintMulti' : 'detail.createHint')}
                </span>
              </div>
            ) : null}
            {mode === 'render' || mode === 'split' ? (
              <div className={css.renderPane}>
                {create.text.trim().length === 0 && create.draw.length === 0 ? (
                  <div className={css.notice}>{t('detail.nothingToRender')}</div>
                ) : detectCardFormat(create.text) === 'html' ? (
                  <HtmlFrame html={images.cardHtml(create.text)} />
                ) : (
                  <MarkdownText text={create.text} labels={markdownLabels} pathImages={pathImages} />
                )}
              </div>
            ) : null}
          </div>
        )}
        <CardPad
          t={t}
          strokes={create.draw}
          tool={tool}
          onTool={chooseTool}
          onStrokes={create.onDrawChange}
          notify={showToast}
          editing={!readonly}
          onSave={() => { void create.onSave(create.kind, create.text, create.draw) }}
        />
        {fatal !== null && (
          <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
        )}
      </div>
    )
  }

  if (canvasId === null) {
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

  const KindIcon = kindIconOf(card.kind)
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
          {KindIcon !== undefined && <KindIcon size={12} />}
          {categoryLabels.get(card.kind) ?? card.kind}
          {card.createdBy === 'agent' && !proposed ? ` · ${t('card.fromAgent')}` : ''}
        </span>
        {proposed && (
          <span className={css.ghostFlag}>
            <IconSparkleMedium size={12} />
            {t('card.proposed')}
          </span>
        )}
        {archived && (
          <span className={css.archivedTag}>
            <IconArchiveOutlineMedium size={11} />
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
          {chatAvailable === true && !archived && (
            // The detail page IS one card, so the compose gesture sends just it.
            <button
              type="button"
              className={css.iconButton}
              onClick={() => { void ask({ lens: 'ask', cardIds: [card.id], text: COMPOSE_SEND_TEXT }) }}
            >
              {t('detail.compose')}
            </button>
          )}
          {!proposed && !archived && !readonly && (
            // A kept card is archived from here too (round-4 fix): the board's
            // hover button was the only way, and the page you read a card on
            // is where you decide it is done.
            <button
              type="button"
              className={css.iconButton}
              onClick={() => void mutate(sid => patchCard(sid, {
                canvasId: open.board.id, cardId: card.id, status: 'archived',
              }), 'toast.cardArchived', () => void mutate(sid => patchCard(sid, {
                canvasId: open.board.id, cardId: card.id, status: 'kept',
              }), 'toast.cardRestored'))}
            >
              <IconArchiveOutlineMedium size={12} />
              {t('card.archive')}
            </button>
          )}
          {archived && !readonly && (
            <button
              type="button"
              className={css.iconButton}
              onClick={() => void mutate(sid => patchCard(sid, {
                canvasId: open.board.id, cardId: card.id, status: 'kept',
              }), 'toast.cardRestored')}
            >
              <IconRefreshOutlineMedium size={12} />
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
            <IconCheckOutlineMedium size={12} />
            {t('card.accept')}
          </button>
          <button
            type="button"
            onClick={() => void mutate(sid => patchCard(sid, {
              canvasId: open.board.id, cardId: card.id, status: 'archived',
            }), 'toast.rejected')}
          >
            <IconCloseOutlineMedium size={12} />
            {t('card.reject')}
          </button>
        </div>
      )}

      {!drawing && (
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
                <HtmlFrame key={card.id} html={images.cardHtml(card.text)} />
              ) : (
                <MarkdownText text={card.text} labels={markdownLabels} pathImages={pathImages} />
              )}
            </div>
          ) : null}
        </div>
      )}

      <CardPad
        key={card.id}
        t={t}
        strokes={card.draw ?? []}
        tool={tool}
        onTool={chooseTool}
        onStrokes={next => {
          void mutate(sid => patchCard(sid, {
            canvasId: open.board.id, cardId: card.id, draw: next,
          }))
        }}
        notify={showToast}
        editing={!readonly && !proposed && !archived}
      />

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
              <IconLinkOutlineMedium size={12} />
              {card.source.title ?? card.source.ref}
              <IconRightUpOutlineMedium size={11} />
            </a>
          ) : card.source.type === 'file' ? (
            <button
              type="button"
              className={css.attachmentButton}
              onClick={() => { if (sessionId !== undefined) openFile(sessionId, workspaceRoot, card.source!.ref) }}
            >
              <IconRightUpOutlineMedium size={12} />
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
                <FollowUp
                  t={t}
                  className={css.followUp}
                  onFollowUp={() => {
                    void ask({
                      lens: 'ask',
                      cardIds: [card.id],
                      text: t('chat.followupText', { text: comment.text }),
                    })
                  }}
                />
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
        <Toast
          key={toast.seq}
          text={toast.text}
          {...(toast.undo === undefined ? {} : {
            holdMs: 6000,
            actions: [{
              label: t('toast.undo'),
              onClick: () => { const undo = toast.undo; setToast(null); undo?.() },
            }],
          })}
          onDone={() => { setToast(null) }}
        />
      )}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
