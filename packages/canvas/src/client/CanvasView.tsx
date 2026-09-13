/**
 * The canvas view: the right-Sidebar tab's body.
 *
 * Three invariants drive the whole file, and each exists because breaking it
 * breaks writing:
 *
 * 1. **The editor is an uncontrolled `<textarea>`.** Nothing ever writes its
 *    `value` back after mount — a controlled value round-tripped through the
 *    host would drop the caret to the start on every save. The element is
 *    keyed by a load token, so switching items remounts it with the new
 *    `defaultValue` and nothing else does.
 * 2. **Composition is a hard stop.** While an IME is composing (every Chinese
 *    keystroke), neither the save nor the preview runs — a re-render mid-
 *    composition tears the candidate window down.
 * 3. **One scroll container per pane.** The wrapper around the textarea does
 *    not scroll; the textarea itself does (two nested scrollers is the bug the
 *    first prototype shipped).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type CompositionEvent, type FormEvent, type ReactNode,
} from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconChevronLeftOutline14, IconChevronRightOutline14,
  IconCopyOutline16, IconPlusOutline16, IconRefreshOutline14, MarkdownText, writeClipboard,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  CANVAS_KINDS, kindOfItemName, titleOfItemName,
  type CanvasError, type CanvasKind, type CanvasListItem, type CanvasListResult,
} from '../types.ts'
import type { CanvasViewProps } from './contract.ts'
import {
  convertPaste, looksLikeTsv, parseDelimited, spaceAlignedToMarkdown, toMarkdownTable,
} from './paste-table.ts'
import css from './CanvasView.module.css'

/** Auto-save debounce: long enough to not fire mid-word, short enough to feel safe. */
const SAVE_DEBOUNCE_MS = 800
/** How long a transient toast stays up. */
const TOAST_MS = 2200

/** The three ways the right pane can present one item. */
type ViewMode = 'edit' | 'preview' | 'split'

/** Which way a save last ended, as the status line reports it. */
type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

/** One loaded item: everything the pane needs, plus the load token that remounts the editor. */
interface OpenItem {
  readonly name: string
  readonly title: string
  readonly kind: CanvasKind
  /** The body the editor mounted with — the diff basis for "is there anything to save". */
  readonly saved: string
  /** The freshness token the next write must present. */
  version: string
  readonly absolutePath: string
  readonly relativePath: string
  readonly token: number
}

/** True when a promise rejection or remote failure carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The canvas view. */
export function CanvasView({
  sessionId, useSessions, t, list, read, create, write, setArchived,
}: CanvasViewProps): ReactNode {
  // The workspace root, reactively — the same read the official sidebar file
  // tree makes. undefined until the session row loads, or without a workspace.
  const workspaceRoot = useSessions(sessions =>
    sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd)

  const [listing, setListing] = useState<CanvasListResult | null>(null)
  const [open, setOpen] = useState<OpenItem | null>(null)
  const [mode, setMode] = useState<ViewMode>('edit')
  const [listOpen, setListOpen] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [preview, setPreview] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [newKind, setNewKind] = useState<CanvasKind | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [rev, setRev] = useState(0)

  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const openRef = useRef<OpenItem | null>(null)
  const composingRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const tokenRef = useRef(0)

  /** Mirror the open item into a ref: the save timer must read it, not a stale closure. */
  const rememberOpen = useCallback((item: OpenItem | null) => {
    openRef.current = item
    setOpen(item)
  }, [])

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => { setToast(null) }, TOAST_MS)
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

  /** Localized chrome the shared markdown renderer needs (code-block copy, footnotes). */
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

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

  /* ---------------------------------------------------------------- loading */

  useEffect(() => {
    if (workspaceRoot === undefined) return
    let cancelled = false
    void (async () => {
      const value = await run(() => list({ dir: workspaceRoot }))
      if (cancelled || value === null) return
      setFatal(null)
      setListing(value)
    })()
    return () => { cancelled = true }
  }, [workspaceRoot, rev, list, run])

  const loadItem = useCallback(async (name: string) => {
    if (workspaceRoot === undefined) return
    const value = await run(() => read({ dir: workspaceRoot, name }))
    if (value === null) return
    if (!value.ok) {
      // The file went away under us (deleted or renamed outside the pad): drop
      // the editor and re-list rather than keep editing a ghost.
      rememberOpen(null)
      setRev(current => current + 1)
      if (value.error !== 'missing') showToast(errorText(value.error))
      return
    }
    rememberOpen({
      name,
      title: titleOfItemName(name),
      kind: kindOfItemName(name) ?? 'article',
      saved: value.content,
      version: value.version,
      absolutePath: value.absolutePath,
      relativePath: value.relativePath,
      token: tokenRef.current++,
    })
    setPreview(value.content)
    setSaveState('saved')
  }, [workspaceRoot, read, run, rememberOpen, showToast, errorText])

  // Open the first item once the pad is known and nothing is open yet.
  useEffect(() => {
    if (listing === null || openRef.current !== null) return
    const first = listing.items[0]
    if (first !== undefined) void loadItem(first.name)
  }, [listing, loadItem])

  /* ----------------------------------------------------------------- saving */

  const flushSave = useCallback(async () => {
    const editor = editorRef.current
    const current = openRef.current
    if (editor === null || current === null || workspaceRoot === undefined || sessionId === undefined) return
    // An IME is mid-word: defer, never write half a candidate.
    if (composingRef.current) return
    const content = editor.value
    if (content === current.saved) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    const value = await run(() => write(sessionId, {
      dir: workspaceRoot, name: current.name, content, version: current.version,
    }))
    if (value === null) {
      setSaveState('error')
      return
    }
    if (!value.ok) {
      setSaveState(value.error === 'stale' ? 'conflict' : 'error')
      if (value.error !== 'stale') showToast(t('error.write', { message: errorText(value.error) }))
      return
    }
    const next: OpenItem = { ...current, saved: content, version: value.version }
    rememberOpen(next)
    setSaveState('saved')
  }, [workspaceRoot, sessionId, write, run, rememberOpen, showToast, t, errorText])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void flushSave() }, SAVE_DEBOUNCE_MS)
  }, [flushSave])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  /* ------------------------------------------------------- editor callbacks */

  const onInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    // Composition is a hard stop for BOTH the preview and the save.
    if (composingRef.current) return
    setPreview(event.currentTarget.value)
    scheduleSave()
  }, [scheduleSave])

  const onCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const onCompositionEnd = useCallback((event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    setPreview(event.currentTarget.value)
    scheduleSave()
  }, [scheduleSave])

  const convertSelection = useCallback(() => {
    const editor = editorRef.current
    if (editor === null) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    if (start === end) {
      showToast(t('toast.convertNeedSelection'))
      return
    }
    const selection = editor.value.slice(start, end)
    const markdown = looksLikeTsv(selection)
      ? toMarkdownTable(parseDelimited(selection.replace(/\r\n?/g, '\n'), '\t'))
      : spaceAlignedToMarkdown(selection)
    if (markdown === null) {
      showToast(t('toast.convertNeedRows'))
      return
    }
    editor.focus()
    /* oxlint-disable-next-line typescript/no-deprecated -- insertText is the only
       insertion that preserves the textarea's native undo stack; assigning
       `value` would clear it. */
    if (!document.execCommand('insertText', false, markdown)) {
      editor.value = editor.value.slice(0, start) + markdown + editor.value.slice(end)
    }
    setPreview(editor.value)
    scheduleSave()
    showToast(t('toast.converted'))
  }, [scheduleSave, showToast, t])

  const onPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData
    let html = ''
    let text = ''
    try { html = data.getData('text/html') ?? '' } catch { /* clipboard refused the flavour */ }
    try { text = data.getData('text/plain') ?? '' } catch { /* clipboard refused the flavour */ }
    const conversion = convertPaste(html, text)
    // Not a table: let the browser paste it. Mangling ordinary prose would be
    // a far worse failure than declining to convert.
    if (conversion === null) return
    event.preventDefault()
    const editor = event.currentTarget
    editor.focus()
    /* oxlint-disable-next-line typescript/no-deprecated -- see convertSelection. */
    if (!document.execCommand('insertText', false, conversion.markdown)) {
      const start = editor.selectionStart
      const end = editor.selectionEnd
      editor.value = editor.value.slice(0, start) + conversion.markdown + editor.value.slice(end)
      editor.selectionStart = editor.selectionEnd = start + conversion.markdown.length
    }
    setPreview(editor.value)
    scheduleSave()
    showToast(conversion.source === 'html-table' ? t('toast.tableHtml') : t('toast.tableTsv'))
  }, [scheduleSave, showToast, t])

  /* --------------------------------------------------------------- gestures */

  const chooseMode = useCallback((next: ViewMode) => {
    if (next === 'split' && listOpen) {
      // Split needs the width; collapse once, and never again against the
      // operator's own choice to reopen it.
      setListOpen(false)
      showToast(t('toast.splitFolded'))
    }
    setMode(next)
  }, [listOpen, showToast, t])

  const copyPath = useCallback(() => {
    const current = openRef.current
    if (current === null) return
    void writeClipboard(current.absolutePath).then(ok => {
      showToast(ok ? t('toast.copied') : t('toast.copyFailed'))
    })
  }, [showToast, t])

  const setArchivedState = useCallback(async (item: CanvasListItem, archived: boolean) => {
    if (workspaceRoot === undefined || sessionId === undefined) return
    const value = await run(() => setArchived(sessionId, { dir: workspaceRoot, name: item.name, archived }))
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    showToast(archived ? t('toast.archived', { title: item.title }) : t('toast.restored', { title: item.title }))
    if (archived && openRef.current?.name === item.name) {
      rememberOpen(null)
      setPreview('')
    }
    setRev(current => current + 1)
  }, [workspaceRoot, sessionId, setArchived, run, showToast, t, errorText, rememberOpen])

  const submitNew = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (workspaceRoot === undefined || sessionId === undefined || newKind === null) return
    const title = newTitle.trim()
    if (title.length === 0) {
      showToast(t('toast.needTitle'))
      return
    }
    const value = await run(() => create(sessionId, { dir: workspaceRoot, kind: newKind, title, content: '' }))
    if (value === null) return
    if (!value.ok) {
      showToast(errorText(value.error))
      return
    }
    setNewKind(null)
    setNewTitle('')
    showToast(t('toast.created', { name: value.relativePath }))
    rememberOpen(null)
    await loadItem(value.name)
    setRev(current => current + 1)
    window.setTimeout(() => { editorRef.current?.focus() }, 0)
  }, [workspaceRoot, sessionId, newKind, newTitle, create, run, showToast, t, errorText, rememberOpen, loadItem])

  /* --------------------------------------------------------------- rendering */

  if (workspaceRoot === undefined) {
    return <div className={css.notice}>{t('workspace.none')}</div>
  }

  const items = listing?.items ?? []
  const archived = listing?.archived ?? []

  return (
    <div className={css.root} data-list={listOpen ? 'open' : 'closed'} data-mode={mode}>
      {listOpen && (
        <aside className={css.list}>
          <div className={css.newbar}>
            <button
              type="button"
              className={css.newButton}
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(open => !open) }}
            >
              <IconPlusOutline16 size={14} />
              {t('new.label')}
            </button>
            <button
              type="button"
              className={css.iconButton}
              title={t('list.fold')}
              aria-label={t('list.fold')}
              onClick={() => { setListOpen(false) }}
            >
              <IconChevronLeftOutline14 size={14} />
            </button>
            {menuOpen && (
              <div className={css.menu}>
                {CANVAS_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={css.menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      setNewKind(kind)
                      setNewTitle('')
                    }}
                  >
                    {kind === 'article' ? t('new.article') : t('new.card')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {newKind !== null && (
            <form className={css.newForm} onSubmit={event => { void submitNew(event) }}>
              <input
                className={css.newInput}
                autoFocus
                value={newTitle}
                placeholder={newKind === 'article' ? t('new.articlePlaceholder') : t('new.cardPlaceholder')}
                onChange={event => { setNewTitle(event.target.value) }}
                onKeyDown={event => { if (event.key === 'Escape') { setNewKind(null) } }}
              />
              <button type="submit" className={css.primaryButton}>{t('new.confirm')}</button>
              <button type="button" className={css.button} onClick={() => { setNewKind(null) }}>
                {t('new.cancel')}
              </button>
            </form>
          )}

          <div className={css.items}>
            {items.map(item => (
              <div
                key={item.name}
                className={css.item}
                data-active={item.name === open?.name}
                onClick={() => { void loadItem(item.name) }}
              >
                <span className={css.itemTitle}>{item.title}</span>
                <button
                  type="button"
                  className={css.itemAction}
                  title={t('action.archive')}
                  aria-label={t('action.archive')}
                  onClick={event => { event.stopPropagation(); void setArchivedState(item, true) }}
                >
                  <IconArchiveOutline20 size={14} />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className={css.empty}>
                {t('list.empty')}
                <br />
                {t('list.emptyHint')}
              </div>
            )}
          </div>

          {archived.length > 0 && (
            <div className={css.archiveWell}>
              <button
                type="button"
                className={css.archiveHeader}
                aria-expanded={showArchived}
                onClick={() => { setShowArchived(value => !value) }}
              >
                {showArchived ? <IconChevronRightOutline14 size={14} /> : <IconChevronLeftOutline14 size={14} />}
                {t('list.archived', { count: String(archived.length) })}
              </button>
              {showArchived && archived.map(item => (
                <div key={item.name} className={css.item} data-archived="true">
                  <span className={css.itemTitle}>{item.title}</span>
                  <button
                    type="button"
                    className={css.itemAction}
                    title={t('action.restore')}
                    aria-label={t('action.restore')}
                    onClick={event => { event.stopPropagation(); void setArchivedState(item, false) }}
                  >
                    <IconRefreshOutline14 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      <section className={css.main}>
        <header className={css.header}>
          {!listOpen && (
            <button
              type="button"
              className={css.iconButton}
              title={t('list.unfold')}
              aria-label={t('list.unfold')}
              onClick={() => { setListOpen(true) }}
            >
              <IconChevronRightOutline14 size={14} />
            </button>
          )}
          <span className={css.title}>{open?.title ?? ''}</span>
          {open !== null && (
            <span className={css.meta}>
              {open.kind === 'card' ? t('meta.card') : t('meta.article')}
            </span>
          )}
          <span className={css.spacer} />
          <span className={css.seg} role="group">
            {(['edit', 'preview', 'split'] as const).map(candidate => (
              <button
                key={candidate}
                type="button"
                aria-pressed={mode === candidate}
                onClick={() => { chooseMode(candidate) }}
              >
                {candidate === 'edit' ? t('mode.edit') : candidate === 'preview' ? t('mode.preview') : t('mode.split')}
              </button>
            ))}
          </span>
          <button type="button" className={css.button} onClick={convertSelection}>
            {t('action.convert')}
          </button>
          <button type="button" className={css.primaryButton} onClick={copyPath}>
            <IconCopyOutline16 size={14} />
            {t('action.copyPath')}
          </button>
        </header>

        <div className={css.body}>
          <div className={css.editorPane}>
            <textarea
              ref={editorRef}
              className={css.editor}
              key={open?.token ?? -1}
              defaultValue={open?.saved ?? ''}
              spellCheck={false}
              disabled={open === null}
              placeholder=""
              onInput={onInput}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onPaste={onPaste}
            />
          </div>
          <div className={css.previewPane}>
            <div className={css.markdown}>
              <MarkdownText text={preview} labels={markdownLabels} />
            </div>
          </div>
        </div>

        <footer className={css.status}>
          <span className={css.statusIcon} data-state={saveState}>
            {saveState === 'saved' && <IconCheckOutline16 size={12} />}
          </span>
          <span>
            {saveState === 'saving'
              ? t('state.saveSaving')
              : saveState === 'conflict'
                ? t('state.saveConflict')
                : saveState === 'error'
                  ? t('error.io')
                  : t('state.saveSaved')}
          </span>
          <span className={css.spacer} />
          <span className={css.path}>{open?.relativePath ?? ''}</span>
        </footer>
      </section>

      {toast !== null && <div className={css.toast}>{toast}</div>}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
