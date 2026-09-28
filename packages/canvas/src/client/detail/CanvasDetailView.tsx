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
 * A markdown card reads and edits as a flow of blocks (step 6 of the
 * 2026-09-27 redesign): 阅读 renders words, drawings and images in the order
 * the card holds them, 编辑 is the BlockEditor over the same flow, and 源码 is
 * the raw markdown with its `draw://` lines. An HTML card is one page, so it
 * keeps render / source / split and its single pen field underneath.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type ReactNode,
} from 'react'
import { MarkdownText, Toast, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconArchiveOutlineMedium, IconCheckOutlineMedium, IconCloseOutlineMedium, IconLinkOutlineMedium, IconListPenOutlineMedium, IconRefreshOutlineMedium, IconRightUpOutlineMedium, IconSparkleMedium, IconTrashOutlineMedium } from '../icons.tsx'
import { MoreMenu } from '../more-menu.tsx'
import { ConfirmDelete } from '../confirm-delete.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { attachBridge } from '@khorsheed/dsh-inline-html-render/src/client/bridge.ts'
import { buildCardSrcDoc } from '@khorsheed/dsh-inline-html-render/src/client/srcdoc.ts'
import { cardNameOf, cardTitleOf, detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import { cardBlocksOf, withoutDrawLines } from '../../blocks.ts'
import { imageHtmlOf, imageMarkdownOf } from '../../image-token.ts'
import {
  documentHeadingOf, hasDrawings, LEGACY_DRAWING_ID,
  type BoardCard, type BoardManuscript, type BoardMutationResult, type CanvasBoard,
  type CanvasError, type CanvasImageError,
} from '../../types.ts'
import type { CanvasDetailProps } from '../contract.ts'
import { categoryLabelMap } from '../category-label.ts'
import { DetailCrumbs, KindTag } from './DetailCrumbs.tsx'
import { canvasErrorText } from '../error-text.ts'
import { base64Of, imageFilesOf, type CanvasImageFile } from '../images.ts'
import { choosePaste, type PasteArm } from '../paste-table.ts'
import type { CanvasKey } from '../locales.ts'
import { CardTextarea } from '../space/CardTextarea.tsx'
import { agoOf, basenameOf, messageOf } from '../text.ts'
import { FollowUp } from '../follow-up.tsx'
import { cardQuoteOf, commentQuoteOf } from '../quote.ts'
import type { PadTool } from '../draw.ts'
import { CardPad } from './CardPad.tsx'
import { useImageLightbox } from './image-lightbox.tsx'
import { BlockEditor, type CardDrawings } from './BlockEditor.tsx'
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

/** Every way the detail shows a card's body. */
type Mode = 'read' | 'edit' | 'source' | 'render' | 'split'

/** A markdown card is a flow of blocks: read it, edit it, or open its markdown. */
const FLOW_MODES: readonly Mode[] = ['read', 'edit', 'source']

/** An HTML card is one page: render it, read its source, or both side by side (§11.6 item 1). */
const PAGE_MODES: readonly Mode[] = ['render', 'source', 'split']

/** Each mode's button words. */
const MODE_LABEL: Record<Mode, CanvasKey> = {
  read: 'detail.read',
  edit: 'detail.edit',
  source: 'detail.source',
  render: 'detail.render',
  split: 'detail.split',
}

/** A mode as the card's format has it: the two families never mix. */
function modeFor(mode: Mode, html: boolean): Mode {
  if (html) return mode === 'read' || mode === 'edit' ? 'render' : mode
  return mode === 'render' || mode === 'split' ? 'read' : mode
}

/** The mode switch: one segmented control, whichever family the card reads in. */
function ModeSeg({ modes, mode, onMode, t }: {
  readonly modes: readonly Mode[]
  readonly mode: Mode
  readonly onMode: (mode: Mode) => void
  readonly t: CanvasDetailProps['t']
}): ReactNode {
  return (
    <span className={css.seg} role="group" aria-label={t('detail.viewMode')}>
      {modes.map(candidate => (
        <button
          key={candidate}
          type="button"
          aria-pressed={mode === candidate}
          onClick={() => { onMode(candidate) }}
        >
          {t(MODE_LABEL[candidate])}
        </button>
      ))}
    </span>
  )
}

/**
 * A markdown card read as its flow: each run of words through the shared
 * renderer (images inline, as markdown draws them), each drawing where the
 * text places it — or after the words, when the text does not. A picture
 * opens large on a click.
 */
function CardFlow({ t, text, drawings, labels, pathImages }: {
  readonly t: CanvasDetailProps['t']
  readonly text: string
  readonly drawings: CardDrawings | undefined
  readonly labels: MarkdownLabels
  readonly pathImages: CanvasDetailProps['pathImages']
}): ReactNode {
  const { onClick, lightbox } = useImageLightbox(t)
  const blocks = cardBlocksOf(text, drawings)
  if (blocks.length === 0) return <div className={css.notice}>{t('detail.nothingToRender')}</div>
  return (
    <div className={css.flow} onClick={onClick}>
      {lightbox}
      {blocks.map((block, index) => block.kind === 'draw' ? (
        <CardPad
          key={`d:${block.id}`}
          t={t}
          strokes={drawings?.[block.id] ?? []}
          tool="text"
          onTool={() => undefined}
          onStrokes={() => undefined}
          notify={() => undefined}
          editing={false}
        />
      ) : (
        <MarkdownText
          key={`t:${index}`}
          text={block.kind === 'text' ? block.text : block.line}
          labels={labels}
          pathImages={pathImages}
        />
      ))}
    </div>
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
    t, sessionId, canvasId, cardId, create, crumbs, readBoard, patchCard, addComment, deleteCard, openFile, useSelection,
    talkAvailable, quoteToConversation, attachImage, images, pathImages, writeManuscript, openManuscript,
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
  /** How the body shows; `modeFor` maps it onto the card's format. */
  const [mode, setMode] = useState<Mode>('read')
  /** An HTML card's pen field tool (§11.4): the pad takes the editor's place while this says so. */
  const [tool, setTool] = useState<PadTool>('text')
  const [toast, setToast] = useState<{ text: string; seq: number; undo?: () => void } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  /** The chat seam's probe: null while probing, so entries never flash. */
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
      // The tab's poll bumps the rev with nothing new most of the time: an
      // unchanged version keeps the board object, so nothing re-renders.
      setOpen(current => current !== null && current.board.id === value.board.id && current.version === value.version
        ? current
        : { board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [canvasId, boardRev, readBoard, run, errorText])

  // Turning to another card always returns the body to the reading state — and
  // puts the pen down: leaving the card is one of its three exits (§11.2 row 8).
  useEffect(() => {
    setMode('read')
    setTool('text')
  }, [canvasId, cardId])

  // A draft opens where the work is: an empty reading pane is not a writing
  // surface, and the ＋新卡 gesture's whole point is the keyboard.
  const drafting = create !== undefined
  useEffect(() => { if (drafting) setMode('edit') }, [drafting])

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

  // 与 Agent 对谈 / 开始写作 / 追问 quote into the session's own input; they
  // hide where the composition has none (and a session-less pane has none).
  const canTalk = !noSession && talkAvailable(sessionId)

  const quote = useCallback((block: string) => {
    if (sessionId === undefined) return
    showToast(quoteToConversation(sessionId, block) ? t('talk.quoted') : t('talk.unavailable'))
  }, [sessionId, quoteToConversation, showToast, t])

  /**
   * The image arm of a paste (§10.3): the clipboard's files go to the host's
   * attachment store and the card keeps the pointer, spelled for whichever
   * renderer the card it would produce uses — an `<img>` inside a page,
   * markdown everywhere else. Pixels never enter card text.
   */
  const uploadImages = useCallback(async (
    files: readonly CanvasImageFile[], page: boolean,
  ): Promise<string[]> => {
    const lines: string[] = []
    let failure: CanvasImageError | undefined
    for (const { file, mediaType } of files) {
      const data = await base64Of(file)
      const outcome = await run(() => attachImage({ data, mediaType, name: file.name }))
      if (outcome === null) return []
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
    return lines
  }, [attachImage, run, showToast, t])

  /** The block editor's uploads: always markdown, it only edits markdown cards. */
  const uploadFlowImages = useCallback(
    (files: readonly CanvasImageFile[]) => uploadImages(files, false), [uploadImages])

  /** The image arm inside one raw textarea: upload, then insert where the paste was. */
  const pasteImages = useCallback(async (
    files: readonly CanvasImageFile[], element: HTMLTextAreaElement, from: number, to: number,
  ): Promise<void> => {
    // The form is decided against the card WITHOUT the pasted run, exactly as
    // `choosePaste` decides markup: clearing the selection first is what makes
    // "replace the whole page with one image" a markdown card, correctly.
    const page = detectCardFormat(`${element.value.slice(0, from)}${element.value.slice(to)}`) === 'html'
    const lines = await uploadImages(files, page)
    if (lines.length === 0) return
    // The caret may have moved while the bytes were in flight: the insertion
    // goes where the paste was, which is what the user aimed at.
    element.setRangeText(lines.join('\n'), from, to, 'end')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, [uploadImages])

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

  // The host's Toast owns its timer; every face of the page shows the same one.
  const toastNode = toast !== null && (
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
  )

  if (create !== undefined) {
    const draftMode = modeFor(mode, false)
    return (
      <div className={css.root}>
        <div className={css.header}>
          {crumbs !== undefined && (
            <DetailCrumbs t={t} crumbs={crumbs} here={t('crumb.newCard')} cardId={null} />
          )}
          <div className={css.meta}>
            <KindTag
              t={t}
              kind={create.kind}
              categories={open?.board.categories ?? []}
              labels={categoryLabels}
              // Re-filing a draft is the ＋新卡 menu's own verb: one draft per
              // canvas, re-categorized in place.
              onPick={create.onKind}
            />
            <span className={`${css.ghostFlag} ${css.rowFlag}`}>{t('detail.unsaved')}</span>
            <span className={css.spacer} />
            <ModeSeg modes={FLOW_MODES} mode={draftMode} onMode={setMode} t={t} />
          </div>
        </div>
        <div className={css.body} data-mode={draftMode === 'edit' ? 'edit' : undefined}>
          {draftMode === 'edit' ? (
            <BlockEditor
              t={t}
              text={create.text}
              drawings={create.drawings}
              submitOn="auto-enter"
              placeholder={t('board.newCardPlaceholder')}
              autoFocus
              // The chord the box just agreed to: one line says ⏎, two say ⌘⏎.
              hint={t(withoutDrawLines(create.text).includes('\n') ? 'detail.createHintMulti' : 'detail.createHint')}
              saveLabel={t('block.save')}
              markdownLabels={markdownLabels}
              pathImages={pathImages}
              notify={showToast}
              uploadImages={uploadFlowImages}
              onPaste={onPaste}
              onChange={(text, drawings) => {
                create.onTextChange(text)
                create.onDrawingsChange(drawings)
              }}
              onSave={(text, drawings) => { void create.onSave(create.kind, text, drawings) }}
              onCancel={create.onLeave}
            />
          ) : draftMode === 'source' ? (
            <div className={css.sourcePane}>
              <CardTextarea
                className={css.editor}
                defaultValue={create.text}
                placeholder={t('board.newCardPlaceholder')}
                submitOn="auto-enter"
                blurSubmits={false}
                autoFocus
                onPaste={onPaste}
                onTextChange={create.onTextChange}
                onSubmit={text => { void create.onSave(create.kind, text, create.drawings) }}
                onCancel={create.onLeave}
              />
              <span className={css.editHint}>
                {t(create.text.includes('\n') ? 'detail.createHintMulti' : 'detail.createHint')}
              </span>
            </div>
          ) : (
            <div className={css.renderPane}>
              {detectCardFormat(create.text) === 'html' ? (
                <HtmlFrame html={images.cardHtml(create.text)} />
              ) : (
                <CardFlow t={t} text={create.text} drawings={create.drawings} labels={markdownLabels} pathImages={pathImages} />
              )}
            </div>
          )}
        </div>
        {toastNode}
        {fatal !== null && (
          <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
        )}
      </div>
    )
  }

  // Every stand-in page keeps the crumb row, so the way back never depends on
  // the card having loaded.
  const notice = (text: string): ReactNode => (
    <div className={css.root}>
      {crumbs !== undefined && (
        <div className={css.header}>
          <DetailCrumbs t={t} crumbs={crumbs} here={crumbs.heading} cardId={cardId} />
        </div>
      )}
      <div className={css.notice}>{text}</div>
    </div>
  )
  if (canvasId === null) return notice(t('detail.empty'))
  if (loadError !== null) return notice(loadError)
  if (open === null) return notice(t('state.loading'))
  if (card === null) return notice(t('detail.cardGone'))

  const proposed = card.status === 'proposed'
  const archived = card.status === 'archived'
  const format = detectCardFormat(card.text)
  // An html document's heading is its <title>, never the doctype opener.
  const heading = card.kind === 'document'
    ? (format === 'html' ? (htmlTitleOf(card.text) !== undefined ? { title: htmlTitleOf(card.text)!, body: '' } : undefined) : documentHeadingOf(card.text))
    : undefined
  const created = Date.parse(card.createdAt)
  // An HTML card is a page: it renders whole, keeps its source view, and its
  // one drawing sits under it. Markdown is a flow of words, drawings, images.
  const html = detectCardFormat(card.text) === 'html'
  const view = modeFor(mode, html)
  /** Whether an HTML card's pad has the editor's place right now (a read-only seat never does). */
  const drawing = html && !readonly && tool !== 'text'
  const pageDrawing = card.drawings?.[LEGACY_DRAWING_ID] ?? []
  const updated = Date.parse(card.updatedAt)
  // The page you read a card on is where you decide it is done, so its fate
  // lives here too: archive (undoable) for a kept card, and a true delete
  // behind a confirmation for any settled one. It ends the crumb row.
  // Turning the same card twice would only fork the piece: once it has a
  // manuscript, the entry opens the newest one instead.
  const turned = open.board.manuscripts
    .filter(row => row.fromCardId === card.id)
    .reduce<BoardManuscript | undefined>((newest, row) => newest === undefined || row.updatedAt > newest.updatedAt ? row : newest, undefined)
  const turnIntoManuscript = async (): Promise<void> => {
    if (turned !== undefined) {
      openManuscript(open.board.id, turned.id, turned.title)
      return
    }
    if (sessionId === undefined) return
    // A document's heading is its name; the markdown `#` is not part of it.
    const title = heading?.title || cardTitleOf(card.text) || card.id
    const value = await run(() => writeManuscript(sessionId, {
      canvasId: open.board.id, title, body: withoutDrawLines(card.text), fromCardId: card.id, sources: { used: [card.id] },
    }))
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    showToast(t('ms.turned'))
    openManuscript(open.board.id, value.manuscript.id, value.manuscript.title)
  }
  const moreMenu = !proposed && !readonly ? (
    <MoreMenu
      label={t('action.more')}
      className={css.tool}
      items={[
        // Quoting a passage is the quote plugin's selection menu; the whole
        // card goes from here, so the header keeps only the view switch
        // (2026-09-28 review).
        ...(canTalk && !archived ? [{
          id: 'quote',
          label: t('card.quoteWhole'),
          icon: <IconRightUpOutlineMedium size={14} />,
        }] : []),
        // A document card that became the piece is turned into a manuscript
        // by hand (the 2026-09-27 decision): the card stays as material, the
        // manuscript starts from its text and names it as its first source.
        // An HTML page is not markdown, so it cannot be turned.
        ...(card.kind === 'document' ? [{
          id: 'manuscript',
          label: t(turned !== undefined ? 'ms.openTurned' : format === 'html' ? 'ms.toManuscriptHtml' : 'ms.toManuscript'),
          icon: <IconListPenOutlineMedium size={14} />,
          disabled: turned === undefined && format === 'html',
        }] : []),
        ...(archived ? [] : [{ id: 'archive', label: t('card.archive'), icon: <IconArchiveOutlineMedium size={14} /> }]),
        { id: 'delete', label: t('action.delete'), icon: <IconTrashOutlineMedium size={14} />, danger: true },
      ]}
      onSelect={id => {
        if (id === 'delete') { setAskDelete(true); return }
        if (id === 'quote') {
          quote(cardQuoteOf(t, card, {
            canvasTitle: open.board.title, kindLabel: categoryLabels.get(card.kind) ?? card.kind,
          }))
          return
        }
        if (id === 'manuscript') { void turnIntoManuscript(); return }
        void mutate(sid => patchCard(sid, {
          canvasId: open.board.id, cardId: card.id, status: 'archived',
        }), 'toast.cardArchived', () => void mutate(sid => patchCard(sid, {
          canvasId: open.board.id, cardId: card.id, status: 'kept',
        }), 'toast.cardRestored'))
      }}
    />
  ) : null

  return (
    <div className={css.root}>
      <div className={css.header}>
        {crumbs !== undefined && (
          <DetailCrumbs
            t={t}
            crumbs={crumbs}
            here={cardNameOf(card) || crumbs.heading}
            cardId={card.id}
            trailing={moreMenu}
          />
        )}
        {heading !== undefined && <div className={css.title}>{heading.title}</div>}
        <div className={css.meta}>
          <KindTag
            t={t}
            kind={card.kind}
            categories={open.board.categories}
            labels={categoryLabels}
            suffix={card.createdBy === 'agent' && !proposed ? t('card.fromAgent') : undefined}
            onPick={readonly || archived ? undefined : kind => void mutate(sid => patchCard(sid, {
              canvasId: open.board.id, cardId: card.id, kind,
            }), 'toast.cardSaved')}
          />
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
          {html && (
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
            <ModeSeg modes={html ? PAGE_MODES : FLOW_MODES} mode={view} onMode={setMode} t={t} />
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
          {/* A composition without the crumb row keeps the ⋯ where it was. */}
          {crumbs === undefined && moreMenu}
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

      {html ? (
        <>
          {!drawing && (
            <div className={css.body} data-mode={view}>
              {view === 'source' || view === 'split' ? (
                <div className={css.sourcePane}>
                  <CardTextarea
                    className={css.editor}
                    defaultValue={card.text}
                    submitOn="mod-enter"
                    autoFocus={view === 'source'}
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
              {view === 'render' || view === 'split' ? (
                <div className={css.renderPane}>
                  <HtmlFrame key={card.id} html={images.cardHtml(card.text)} />
                </div>
              ) : null}
            </div>
          )}
          <CardPad
            key={card.id}
            t={t}
            strokes={pageDrawing}
            tool={tool}
            onTool={chooseTool}
            onStrokes={next => {
              const { [LEGACY_DRAWING_ID]: _gone, ...others } = card.drawings ?? {}
              void mutate(sid => patchCard(sid, {
                canvasId: open.board.id, cardId: card.id,
                drawings: next.length > 0 ? { ...others, [LEGACY_DRAWING_ID]: next } : others,
              }))
            }}
            notify={showToast}
            editing={!readonly && !proposed && !archived}
          />
        </>
      ) : view === 'edit' && !readonly && !proposed && !archived ? (
        <BlockEditor
          key={card.id}
          t={t}
          text={card.text}
          drawings={card.drawings ?? {}}
          submitOn="mod-enter"
          placeholder={t('block.placeholder')}
          autoFocus
          hint={t('block.hint')}
          saveLabel={t('block.save')}
          markdownLabels={markdownLabels}
          pathImages={pathImages}
          notify={showToast}
          uploadImages={uploadFlowImages}
          onPaste={onPaste}
          onSave={(text, drawings) => {
            setMode('read')
            const trimmed = text.trim()
            if (trimmed.length === 0 && !hasDrawings(drawings)) return
            if (trimmed === card.text && JSON.stringify(drawings) === JSON.stringify(card.drawings ?? {})) return
            void mutate(sid => patchCard(sid, {
              canvasId: open.board.id, cardId: card.id, text: trimmed, drawings,
            }), 'toast.cardSaved')
          }}
          onCancel={() => { setMode('read') }}
        />
      ) : view === 'source' && !readonly && !proposed && !archived ? (
        <div className={css.body} data-mode="source">
          <div className={css.sourcePane}>
            <CardTextarea
              className={css.editor}
              defaultValue={card.text}
              submitOn="mod-enter"
              autoFocus
              onPaste={onPaste}
              onSubmit={text => {
                const trimmed = text.trim()
                setMode('read')
                if (trimmed.length === 0 || trimmed === card.text) return
                void mutate(sid => patchCard(sid, {
                  canvasId: open.board.id, cardId: card.id, text: trimmed,
                }), 'toast.cardSaved')
              }}
              onCancel={() => { setMode('read') }}
            />
            <span className={css.editHint}>{t('card.editHint')}</span>
          </div>
        </div>
      ) : (
        <div className={css.body} data-mode="read">
          <div className={css.renderPane}>
            <CardFlow t={t} text={card.text} drawings={card.drawings} labels={markdownLabels} pathImages={pathImages} />
          </div>
        </div>
      )}

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
            {comment.author === 'agent' && canTalk && (
              <>
                {' '}
                <FollowUp
                  t={t}
                  className={css.followUp}
                  onFollowUp={() => { quote(commentQuoteOf(t, comment.text, card, open.board.title)) }}
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

      <ConfirmDelete
        t={t}
        ask={askDelete ? { kind: 'card', canvasId: open.board.id, cardId: card.id } : null}
        onCancel={() => { setAskDelete(false) }}
        onConfirm={() => {
          setAskDelete(false)
          // A success takes this card's row off the strip (the face's
          // `forget`), so the page unmounts onto the board it came from.
          void mutate(sid => deleteCard(sid, { canvasId: open.board.id, cardId: card.id }), 'toast.cardDeleted')
        }}
      />
      {toastNode}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
