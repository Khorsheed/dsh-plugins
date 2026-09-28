/**
 * The manuscript page (成稿, the 2026-09-27 decision) and the board's 成稿
 * face that lists them.
 *
 * A manuscript is not a card: it is the piece the cards were for. The page
 * reads it in one column at a reading measure, says where it stands (writing
 * or final, which version, who wrote it last, where it was saved), and ends
 * with its source ledger — the cards it used, and the cards it left out, which
 * are the next draft's starting place. Writing happens in the main
 * conversation: 「让 Agent 改」 quotes the manuscript's handle and version into
 * the input, and the Agent writes back through `canvas_write_manuscript`.
 *
 * The user's own edit is the card editor's pad (CardTextarea, uncontrolled,
 * ⌘⏎ saves) beside a live preview, and every save presents the version the
 * edit started from. When someone wrote in between, the store refuses and the
 * page says so, offering both ways out — take theirs, or put mine over it —
 * rather than choosing for the user. Saving into a workspace follows the same
 * rule: a file changed since the last save, or a stranger's file where a first
 * save would land, is asked about, never overwritten silently.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type ReactNode,
} from 'react'
import { Button, Modal, Tag, Toast, type MarkdownLabels, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cardNameOf } from '../../card-format.ts'
import { imageMarkdownOf } from '../../image-token.ts'
import { CardMarkdown } from '../detail/CardMarkdown.tsx'
import { documentHeadingOf } from '../../types.ts'
import type {
  BoardManuscript, BoardMutationResult, CanvasBoard, CanvasError, ManuscriptExportError,
} from '../../types.ts'
import type { CanvasManuscriptViewProps } from '../contract.ts'
import { canvasErrorText } from '../error-text.ts'
import { base64Of, imageFilesOf } from '../images.ts'
import { ConfirmDelete } from '../confirm-delete.tsx'
import { DetailCrumbs } from '../detail/DetailCrumbs.tsx'
import { MoreMenu } from '../more-menu.tsx'
import { CardTextarea } from '../space/CardTextarea.tsx'
import { agoOf, basenameOf, messageOf } from '../text.ts'
import {
  IconCheckOutlineMedium, IconCodeOutlineMedium, IconEditOutlineMedium, IconFolderOpenOutlineMedium,
  IconRightUpOutlineMedium, IconTrashOutlineMedium,
} from '../icons.tsx'
import type {} from '../locales.ts'
import detailCss from '../detail/CanvasDetailView.module.css'
import css from './ManuscriptView.module.css'

/** The user's edit in flight: the version it started from, and its words so far. */
interface Editing {
  readonly base: number
  readonly text: string
}

/** A workspace save that stopped to ask. */
interface ExportAsk {
  readonly workspace: string
  readonly error: Extract<ManuscriptExportError, 'changed' | 'exists'>
  readonly path: string
}

/**
 * A saved file's path as the dialog names it: from the workspace's own name
 * down, since the absolute prefix is the same every time and only pushes the
 * part that matters off the line.
 */
function shownPathOf(workspace: string, path: string): string {
  const root = workspace.replace(/[\\/]+$/, '')
  return path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
    ? `${basenameOf(root)}/${path.slice(root.length + 1)}`
    : path
}

/** The status as a host `Tag`: writing is information, final is done. */
export function ManuscriptStatusTag({ t, manuscript }: {
  readonly t: TranslateNS<'canvas'>
  readonly manuscript: BoardManuscript
}): ReactNode {
  return manuscript.status === 'final'
    ? <Tag tone="success">{t('ms.final')}</Tag>
    : <Tag tone="info">{t('ms.writing')}</Tag>
}

/** The manuscript page. */
export function ManuscriptView(props: CanvasManuscriptViewProps): ReactNode {
  const {
    t, sessionId, canvasId, manuscriptId, crumbs, pathImages, useSelection,
    readBoard, readManuscript, writeManuscript, patchManuscript, deleteManuscript, exportManuscript,
    openCardDetail, openFile, talkAvailable, quoteToConversation, attachImage,
  } = props
  const boardRev = useSelection(current => current.rev)
  const [open, setOpen] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [body, setBody] = useState<{ readonly version: number; readonly text: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  /** A save lost the version race: the version it lost to. */
  const [conflict, setConflict] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [exportAsk, setExportAsk] = useState<ExportAsk | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  /** Bumped to force a re-read (「载入最新」 must not wait for the poll). */
  const [reload, setReload] = useState(0)
  const toastSeqRef = useRef(0)

  const readonly = sessionId === undefined || (open !== null && open.board.archivedAt !== null)
  const manuscript = open?.board.manuscripts.find(row => row.id === manuscriptId) ?? null

  const showToast = useCallback((text: string) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current })
  }, [])

  const errorText = useCallback((error: CanvasError): string => canvasErrorText(t, error), [t])

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

  // The metadata rides the board, so the board read is the freshness channel:
  // any seat's write (the Agent's included, through the tab's poll) moves it.
  useEffect(() => {
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
      setOpen(current => current !== null && current.version === value.version
        ? current
        : { board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [canvasId, boardRev, reload, readBoard, run, errorText])

  // The body is read only when the version the board names moved: a long text
  // never rides the poll.
  const wantVersion = manuscript?.version
  useEffect(() => {
    if (wantVersion === undefined || body?.version === wantVersion) return
    let cancelled = false
    void (async () => {
      const value = await run(() => readManuscript({ canvasId, manuscriptId }))
      if (cancelled || value === null) return
      if (!value.ok) {
        setLoadError(errorText(value.error))
        return
      }
      setBody({ version: value.manuscript.version, text: value.body })
    })()
    return () => { cancelled = true }
  }, [canvasId, manuscriptId, wantVersion, body?.version, readManuscript, run, errorText])

  /** Apply one board mutation's answer in place; false when it was refused. */
  const landed = useCallback((value: BoardMutationResult | null, toastKey?: Parameters<typeof t>[0]): boolean => {
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    setOpen({ board: value.board, version: value.version })
    if (toastKey !== undefined) showToast(t(toastKey))
    return true
  }, [showToast, errorText, t])

  /* --------------------------------------------------------------- writing */

  /** Save the edit from `base`: a lost race opens the conflict banner and keeps the words. */
  const save = useCallback(async (text: string, base: number): Promise<void> => {
    if (sessionId === undefined) return
    const value = await run(() => writeManuscript(sessionId, { canvasId, manuscriptId, body: text, baseVersion: base }))
    if (value === null) return
    if (!value.ok) {
      if (value.error === 'stale' && value.currentVersion !== undefined) {
        setEditing({ base, text })
        setConflict(value.currentVersion)
        return
      }
      showToast(errorText(value.error))
      return
    }
    setOpen({ board: value.board, version: value.version })
    setBody({ version: value.manuscript.version, text })
    setEditing(null)
    setConflict(null)
    showToast(t('ms.written', { version: String(value.manuscript.version) }))
  }, [sessionId, canvasId, manuscriptId, writeManuscript, run, showToast, errorText, t])

  /**
   * Images paste straight into the manuscript: the bytes go to the attachment
   * store and the text keeps the pointer, exactly as a card does (§10.3), so
   * 「保存到工作区」 can later write them beside the markdown.
   */
  const onPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesOf(event.clipboardData?.files)
    if (files.length === 0) return
    event.preventDefault()
    const element = event.currentTarget
    const from = element.selectionStart ?? element.value.length
    const to = element.selectionEnd ?? from
    void (async () => {
      const lines: string[] = []
      for (const { file, mediaType } of files) {
        const outcome = await run(async () => attachImage({ data: await base64Of(file), mediaType, name: file.name }))
        if (outcome === null) return
        if (outcome.ok) lines.push(imageMarkdownOf(outcome.ref, file.name))
      }
      showToast(t(lines.length === files.length ? 'paste.image' : 'paste.imageUnavailable'))
      if (lines.length === 0) return
      element.setRangeText(lines.join('\n'), from, to, 'end')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  }, [attachImage, run, showToast, t])

  /* -------------------------------------------------------------- the menu */

  const exportTo = useCallback(async (workspace: string, overwrite: boolean): Promise<void> => {
    if (sessionId === undefined) return
    const value = await run(() => exportManuscript(sessionId, {
      canvasId, manuscriptId, workspace, ...(overwrite ? { overwrite: true } : {}),
    }))
    if (value === null) return
    if (!value.ok) {
      if ((value.error === 'changed' || value.error === 'exists') && value.path !== undefined) {
        setExportAsk({ workspace, error: value.error, path: value.path })
        return
      }
      showToast(value.error === 'changed' ? t('error.stale') : errorText(value.error))
      return
    }
    setOpen({ board: value.board, version: value.version })
    showToast(value.missingImages > 0
      ? t('ms.savedMissing', { path: value.path, count: String(value.missingImages) })
      : t('ms.saved', { path: value.path }))
  }, [sessionId, canvasId, manuscriptId, exportManuscript, run, showToast, errorText, t])

  const copyMarkdown = useCallback((): void => {
    if (body === null) return
    try {
      void navigator.clipboard.writeText(body.text).then(
        () => { showToast(t('ms.copied')) },
        () => { showToast(t('ms.copyFailed')) },
      )
    } catch {
      showToast(t('ms.copyFailed'))
    }
  }, [body, showToast, t])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  /* -------------------------------------------------------------- rendering */

  const notice = (text: string): ReactNode => (
    <div className={detailCss.root}>
      <div className={detailCss.header}>
        <DetailCrumbs t={t} crumbs={crumbs} here={crumbs.heading} cardId={null} />
      </div>
      <div className={detailCss.notice}>{text}</div>
    </div>
  )
  if (loadError !== null) return notice(loadError)
  if (open === null) return notice(t('state.loading'))
  if (manuscript === null) return notice(t('ms.gone'))

  const board = open.board
  const workspaces = board.attachedWorkspaces
  const exported = manuscript.exported
  const updated = Date.parse(manuscript.updatedAt)
  const canTalk = sessionId !== undefined && talkAvailable(sessionId)
  const cardName = (cardId: string): string | undefined => {
    const card = board.cards.find(row => row.id === cardId)
    return card === undefined ? undefined : (cardNameOf(card) || card.id)
  }
  // The header already names the manuscript; a body opening on that same
  // heading would say it twice, so the reading view drops it (the file keeps it).
  const reading = (text: string): string => {
    const heading = documentHeadingOf(text)
    return heading !== undefined && heading.body !== text && heading.title === manuscript.title
      ? heading.body.replace(/^\s*\n/, '')
      : text
  }

  const items: MenuEntry[] = [
    { id: 'copy', label: t('ms.copy'), icon: <IconCodeOutlineMedium size={14} />, disabled: body === null },
  ]
  if (!readonly) {
    if (workspaces.length === 0) {
      items.push({ id: 'export:none', label: t('ms.noWorkspace'), icon: <IconFolderOpenOutlineMedium size={14} /> })
    }
    workspaces.forEach((workspace, index) => {
      const again = exported?.workspace === workspace
      items.push({
        id: `export:${index}`,
        label: t(again ? 'ms.saveToAgain' : 'ms.saveTo', { name: basenameOf(workspace) }),
        icon: <IconFolderOpenOutlineMedium size={14} />,
      })
    })
    items.push(
      { id: 'rename', label: t('ms.rename'), icon: <IconEditOutlineMedium size={14} /> },
      manuscript.status === 'final'
        ? { id: 'reopen', label: t('ms.reopen'), icon: <IconEditOutlineMedium size={14} /> }
        : { id: 'final', label: t('ms.markFinal'), icon: <IconCheckOutlineMedium size={14} /> },
      { id: 'delete', label: t('ms.delete'), icon: <IconTrashOutlineMedium size={14} />, danger: true },
    )
  }
  const moreMenu = (
    <MoreMenu
      label={t('action.more')}
      className={detailCss.tool}
      items={items}
      onSelect={id => {
        if (id === 'copy') { copyMarkdown(); return }
        if (id === 'export:none') { showToast(t('ms.noWorkspaceHint')); return }
        if (id.startsWith('export:')) {
          const workspace = workspaces[Number(id.slice('export:'.length))]
          if (workspace !== undefined) void exportTo(workspace, false)
          return
        }
        if (id === 'rename') { setRenaming(true); return }
        if (id === 'delete') { setAskDelete(true); return }
        if (sessionId === undefined) return
        const status = id === 'final' ? 'final' : 'writing'
        void run(() => patchManuscript(sessionId, { canvasId, manuscriptId, status }))
          .then(value => landed(value, status === 'final' ? 'ms.markedFinal' : 'ms.reopened'))
      }}
    />
  )

  const rename = (title: string): void => {
    setRenaming(false)
    const next = title.trim()
    if (sessionId === undefined || next.length === 0 || next === manuscript.title) return
    void run(() => patchManuscript(sessionId, { canvasId, manuscriptId, title: next }))
      .then(value => landed(value, 'ms.renamed'))
  }

  const ledger = (label: string, ids: readonly string[], unused: boolean): ReactNode => (
    <div className={css.ledgerRow}>
      <span className={css.ledgerLabel}>{label}</span>
      <span className={css.chips}>
        {ids.length === 0 && <span className={css.none}>—</span>}
        {ids.map(cardId => {
          const name = cardName(cardId)
          return (
            <button
              key={cardId}
              type="button"
              className={css.chip}
              data-unused={unused || undefined}
              disabled={name === undefined}
              title={name ?? t('ms.cardGone')}
              onClick={() => { if (name !== undefined) openCardDetail(canvasId, cardId, name) }}
            >
              {name ?? `${cardId} ${t('ms.cardGone')}`}
            </button>
          )
        })}
      </span>
    </div>
  )

  const newer = editing !== null && conflict === null && manuscript.version > editing.base

  return (
    <div className={detailCss.root}>
      <div className={detailCss.header}>
        <DetailCrumbs t={t} crumbs={crumbs} here={manuscript.title} cardId={null} trailing={moreMenu} />
        {renaming ? (
          <input
            className={`${detailCss.title} ${css.titleInput}`}
            defaultValue={manuscript.title}
            autoFocus
            aria-label={t('ms.rename')}
            onBlur={event => { rename(event.currentTarget.value) }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') rename(event.currentTarget.value)
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <div className={detailCss.title}>{manuscript.title}</div>
        )}
        <div className={detailCss.meta}>
          <ManuscriptStatusTag t={t} manuscript={manuscript} />
          <span className={css.version}>{t('ms.version', { version: String(manuscript.version) })}</span>
          <span>{manuscript.lastWrittenBy === 'agent' ? t('ms.byAgent') : t('ms.byUser')}</span>
          {!Number.isNaN(updated) && <span>{t('detail.updated', { time: agoOf(updated, t) })}</span>}
          {exported !== undefined && (
            <button
              type="button"
              className={css.savedPath}
              title={exported.path}
              onClick={() => { if (sessionId !== undefined) openFile(sessionId, exported.workspace, exported.path) }}
            >
              <IconRightUpOutlineMedium size={11} />
              <span>{t('ms.savedAt', { path: basenameOf(exported.path) })}</span>
            </button>
          )}
          <span className={detailCss.spacer} />
          {editing === null && !readonly && (
            <button
              type="button"
              className={detailCss.iconButton}
              disabled={body === null}
              onClick={() => { if (body !== null) setEditing({ base: body.version, text: body.text }) }}
            >
              <IconEditOutlineMedium size={12} />
              {t('ms.edit')}
            </button>
          )}
          {editing === null && canTalk && (
            <button
              type="button"
              className={`${detailCss.iconButton} ${css.primary}`}
              onClick={() => {
                const block = t('ms.quote', {
                  canvas: board.title, title: manuscript.title, id: manuscript.id, version: String(manuscript.version),
                })
                showToast(quoteToConversation(sessionId, block) ? t('talk.quoted') : t('talk.unavailable'))
              }}
            >
              {t('ms.askAgent')}
            </button>
          )}
        </div>
      </div>

      {newer && (
        <div className={css.banner} role="status">
          <span className={css.bannerText}>
            {t('ms.newer', { version: String(manuscript.version), base: String(editing.base) })}
          </span>
        </div>
      )}
      {conflict !== null && editing !== null && (
        <div className={css.banner} data-tone="warning" role="alert">
          <span className={css.bannerText}>{t('ms.conflict', { version: String(conflict) })}</span>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setConflict(null)
              setReload(value => value + 1)
            }}
          >
            {t('ms.loadLatest')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => { void save(editing.text, conflict) }}>
            {t('ms.overwrite')}
          </Button>
        </div>
      )}

      {editing !== null ? (
        <div className={detailCss.body} data-mode="split">
          <div className={detailCss.sourcePane}>
            <CardTextarea
              className={detailCss.editor}
              defaultValue={editing.text}
              submitOn="mod-enter"
              blurSubmits={false}
              autoFocus
              onPaste={onPaste}
              onTextChange={text => { setEditing(current => current === null ? current : { ...current, text }) }}
              onSubmit={text => { void save(text, editing.base) }}
              // Esc leaves only an untouched edit: words are never dropped by a key.
              onCancel={() => { if (editing.text === body?.text) setEditing(null) }}
            />
            <div className={css.editActions}>
              <span className={detailCss.editHint}>{t('ms.editHint')}</span>
              <span className={detailCss.spacer} />
              <Button size="sm" onClick={() => { setEditing(null); setConflict(null) }}>{t('ms.cancel')}</Button>
              <Button size="sm" variant="primary" onClick={() => { void save(editing.text, editing.base) }}>
                {t('ms.save')}
              </Button>
            </div>
          </div>
          <div className={`${detailCss.renderPane} ${css.prose}`}>
            <CardMarkdown text={editing.text} labels={markdownLabels} pathImages={pathImages} />
          </div>
        </div>
      ) : (
        <div className={`${detailCss.body} ${css.prose}`}>
          {body === null
            ? <div className={detailCss.notice}>{t('state.loading')}</div>
            : <CardMarkdown text={reading(body.text)} labels={markdownLabels} pathImages={pathImages} />}
        </div>
      )}

      <div className={css.ledger}>
        {ledger(t('ms.used'), manuscript.sources.used, false)}
        {ledger(t('ms.unused'), manuscript.sources.unused, true)}
      </div>

      <Modal
        open={exportAsk !== null}
        onClose={() => { setExportAsk(null) }}
        title={exportAsk?.error === 'changed' ? t('ms.exportChangedTitle') : t('ms.exportExistsTitle')}
        closeLabel={t('confirm.close')}
        description={exportAsk === null ? '' : t(
          exportAsk.error === 'changed' ? 'ms.exportChangedBody' : 'ms.exportExistsBody',
          { path: shownPathOf(exportAsk.workspace, exportAsk.path) },
        )}
        footer={(
          <>
            <Button size="sm" onClick={() => { setExportAsk(null) }}>{t('confirm.cancel')}</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const ask = exportAsk
                setExportAsk(null)
                if (ask !== null) void exportTo(ask.workspace, true)
              }}
            >
              {t('ms.exportOverwrite')}
            </Button>
          </>
        )}
      />
      <ConfirmDelete
        t={t}
        ask={askDelete ? { kind: 'manuscript', canvasId, manuscriptId, title: manuscript.title } : null}
        onCancel={() => { setAskDelete(false) }}
        onConfirm={() => {
          setAskDelete(false)
          if (sessionId === undefined) return
          // A success sends this row back to the board (the face's `forget`),
          // so the page unmounts; the toast would die with it.
          void run(() => deleteManuscript(sessionId, { canvasId, manuscriptId })).then(value => landed(value))
        }}
      />
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
      {fatal !== null && (
        <div className={detailCss.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}

/**
 * The board's 成稿 face: every manuscript of the canvas, newest first. A row
 * says what a manuscript IS at a glance — its title, where it stands, which
 * version, when it last moved, how much of the board it drew on — and opens it.
 */
export function ManuscriptList({ t, board, onOpen }: {
  readonly t: TranslateNS<'canvas'>
  readonly board: CanvasBoard
  readonly onOpen: (manuscript: BoardManuscript) => void
}): ReactNode {
  const rows = [...board.manuscripts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (rows.length === 0) {
    return <div className={css.list}><div className={css.empty}>{t('ms.empty')}</div></div>
  }
  return (
    <div className={css.list} data-canvas-scroll="manuscripts">
      {rows.map(manuscript => {
        const updated = Date.parse(manuscript.updatedAt)
        return (
          <button key={manuscript.id} type="button" className={css.row} onClick={() => { onOpen(manuscript) }}>
            <span className={css.rowTitle}>{manuscript.title}</span>
            <ManuscriptStatusTag t={t} manuscript={manuscript} />
            <span className={css.rowMeta}>
              <span className={css.version}>{t('ms.version', { version: String(manuscript.version) })}</span>
              <span>{manuscript.lastWrittenBy === 'agent' ? t('ms.byAgent') : t('ms.byUser')}</span>
              {!Number.isNaN(updated) && <span>{t('detail.updated', { time: agoOf(updated, t) })}</span>}
              <span>{t('ms.sourcesCount', {
                used: String(manuscript.sources.used.length), unused: String(manuscript.sources.unused.length),
              })}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Keep `SessionId` referenced for the props' optional session (type-only import guard). */
export type ManuscriptSession = SessionId | undefined
