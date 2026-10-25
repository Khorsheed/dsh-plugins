/**
 * The shared content pane: one implementation of "show me this file" behind
 * every community file surface.
 *
 * Layout — the panel kit's title bar (back, basename, then priority-ordered
 * icon actions whose overflow folds into one ⋯ menu), a second row with the
 * path and one underline tab row for every face/form switch (change face,
 * rendered/source, HTML tiers), an optional content-search row for text reads,
 * then the body: HTML through the tiered sandbox, markdown / JSON / CSV
 * rendered through the official primitives inside shared block chrome,
 * everything else as a highlighted code block, and images / binary / missing /
 * too-large / error through their designed placeholders.
 *
 * Compact panes (the enclosing panel, or this pane, at or below 560px —
 * panel-responsive-spec P1) spend two rows before the body: the title bar
 * (search, reload inline; path, copy, open-in-app in ⋯) and the tab row. The
 * search row opens from its header icon, and rendered documents drop their
 * format-banner frame so the text takes the full width. Inside a narrow
 * `AdaptiveSplit` with `backInDetail`, the split's back control is drawn in
 * this title bar instead of as a row of its own.
 *
 * Decisions this pane froze (see proposal preview-kernel §能力清单):
 *
 * - The previewable-text control is the UNION of the two surfaces it replaced:
 *   markdown/JSON/CSV get a render⇄source toggle (`worktrees` had it,
 *   `local-files` did not) and HTML keeps its three tiers plus fullscreen
 *   (`local-files` had it, `worktrees` did not).
 * - Markdown spacing comes from the official sheet: this module overrides the
 *   `--dsw-font-markdown-*` scale tokens only, NEVER per-element margins, so a
 *   heading/paragraph/list rhythm cannot drift from the document renderer.
 * - Every rendered form is wrapped in the same block chrome (format banner +
 *   padded body), so JSON/CSV no longer render at chat-sized type.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelHeader, UnderlineTabs, useAdaptiveSplitBack, usePanelCompact, usePanelCompactContext, type PanelAction } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { IconCheckOutlineMedium, IconCodeOutlineMedium, IconCopyOutlineMedium, IconEditOutlineMedium, IconFolderOpenOutlineMedium, IconRefreshOutlineMedium, IconSearchOutlineMedium } from './icons.tsx'
import type { ContentPaneProps, PreviewTranslator, PreviewRead, PreviewView, SaveOutcome } from './contract.ts'
import { draftFor, fromEditorText, isDirty, rememberDraft, toEditorText, type Draft } from './edit.ts'
import { basenameOf, dirnameOf, isHtmlPath, isMarkdown, languageFor } from './language.ts'
import { hasStructuredPreview, structuredPreview } from './structured.tsx'
import { buildSrcDoc } from './html-src-doc.ts'
import { attachBridge } from './html-bridge.ts'
import { SEARCH_SKIP_ATTRIBUTE, supportsRenderedSearch, useRenderedSearch } from './rendered-search.ts'
import css from './ContentPane.module.css'

/**
 * Per-(session,path) content-pane scroll offsets. A surface that unmounts the
 * pane on tab switches loses plain DOM scroll state with it, so the offset is
 * remembered at module level: unlike a store field, scrolling never re-renders
 * the tree, and the key is namespaced by session so tabs and sessions stay
 * independent.
 */
const scrollMemory = new Map<string, number>()
const scrollKey = (sessionId: string, path: string): string => `${sessionId}\u0000${path}`

/** Chrome marker for the content scan: banner and notices are not document text. */
const searchSkip = { [SEARCH_SKIP_ATTRIBUTE]: '' } as const

/** HTML documents above this size arm the stall watchdog in either tier. */
const SLOW_DOCUMENT_CHARS = 256 * 1024
/** Watchdog delay before the pane suggests the source view / a browser handoff. */
const SLOW_DOCUMENT_MS = 20_000

/** Content-search state handed to the text preview body. */
interface ContentSearch {
  readonly query: string
  readonly matches: readonly number[]
  readonly active: number
  readonly activeLineRef: RefObject<HTMLSpanElement>
}

/** Split one line into text and <mark> segments by a case-insensitive query. */
function markLine(line: string, lowerQuery: string): ReactNode {
  const lowerLine = line.toLowerCase()
  const parts: ReactNode[] = []
  let at = 0
  let key = 0
  for (;;) {
    const hit = lowerLine.indexOf(lowerQuery, at)
    if (hit === -1) {
      parts.push(line.slice(at))
      break
    }
    if (hit > at) parts.push(line.slice(at, hit))
    parts.push(
      <mark key={key++} className={css.contentMatch}>{line.slice(hit, hit + lowerQuery.length)}</mark>,
    )
    at = hit + lowerQuery.length
  }
  return parts
}

/** Plain-text render with per-line match highlighting (the search fallback). */
function MarkedContent({ content, search }: { content: string; search: ContentSearch }) {
  const hits = new Set(search.matches)
  const activeLine = search.matches[search.active]
  return (
    <pre className={css.markedPre}><code>
      {content.split('\n').map((line, index) => (
        <span
          key={index}
          className={hits.has(index) ? css.markedLineHit : css.markedLine}
          ref={index === activeLine ? search.activeLineRef : undefined}
        >
          {markLine(line, search.query.toLowerCase())}
        </span>
      ))}
    </code></pre>
  )
}

/** The sandboxed render iframe (Tier0 static / Tier1 scripted). */
function HtmlRenderView(props: {
  content: string
  mode: 'render' | 'script'
  scripted: boolean
  t: PreviewTranslator
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  fullscreen: boolean
}) {
  const { content, mode, scripted, t, onLoaded, iframeRef, frameRef, fullscreen } = props
  const tier = mode === 'script' ? 1 : 0
  const hint = mode === 'render' && scripted ? t('preview.staticHint') : undefined
  const srcDoc = useMemo(
    () => buildSrcDoc(content, hint === undefined ? { tier } : { tier, hint }),
    [content, tier, hint],
  )
  useEffect(() => {
    if (mode !== 'script') return
    const frame = iframeRef.current
    if (frame === null) return
    return attachBridge(frame)
  }, [mode, srcDoc, iframeRef])
  return (
    <div ref={frameRef} className={css.htmlFrameWrap}>
      <iframe
        ref={iframeRef}
        className={css.htmlRender}
        sandbox={mode === 'script' ? 'allow-scripts' : ''}
        srcDoc={srcDoc}
        title={mode === 'script' ? t('preview.htmlScript') : t('preview.htmlRender')}
        onLoad={onLoaded}
      />
      {fullscreen && (
        <button
          type="button"
          className={css.htmlFrameExit}
          aria-label={t('preview.exitFullscreen')}
          title={t('preview.exitFullscreen')}
          onClick={() => { void document.exitFullscreen?.() }}
        >
          <IconCheckOutlineMedium size={12} />
        </button>
      )}
    </div>
  )
}

/** Render one normalized read. */
function PreviewBody(props: {
  read: PreviewRead
  t: PreviewTranslator
  labels: ContentPaneProps['labels']
  search: ContentSearch
  /** Show the raw matched-lines view instead of the rendered body. */
  rawSearch: boolean
  htmlMode: 'source' | 'render' | 'script'
  scripted: boolean
  /** Whether markdown/JSON/CSV show their source form instead of the preview. */
  sourceMode: boolean
  imageView: ReactNode
  /** The edit-mode textarea; replaces the source face while editing. */
  editor: ReactNode
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  onScroll: () => void
  fullscreen: boolean
}) {
  const {
    read, t, labels, search, rawSearch, htmlMode, scripted, sourceMode, imageView, editor,
    onLoaded, iframeRef, frameRef, scrollRef, onScroll, fullscreen,
  } = props
  switch (read.kind) {
    case 'text': {
      const content = read.content
      if (isHtmlPath(read.path)) {
        if (editor !== null && htmlMode === 'source') return editor
        return (
          <div className={css.previewScroll} ref={scrollRef} onScroll={onScroll}>
            {read.truncated === true && <div className={css.notice} {...searchSkip}>{t('local.tooLarge')}</div>}
            {rawSearch
              ? <MarkedContent content={content} search={search} />
              : htmlMode === 'source'
                ? <CodeBlock code={content} lang="html" copyLabel={labels.markdown.code.copyLabel} copiedLabel={labels.markdown.code.copiedLabel} />
                : <HtmlRenderView content={content} mode={htmlMode} scripted={scripted} t={t} onLoaded={onLoaded} iframeRef={iframeRef} frameRef={frameRef} fullscreen={fullscreen} />}
          </div>
        )
      }
      const documentBody = rawSearch || sourceMode
        ? null
        : structuredPreview(read.path, content, labels)
          ?? (isMarkdown(read.path) ? <MarkdownText text={content} labels={labels.markdown} /> : null)
      // While editing, the source face — and a plain code file's only face — is the editor.
      if (editor !== null && documentBody === null) return editor
      const dot = read.path.lastIndexOf('.')
      const documentLabel = languageFor(read.path) ?? (dot < 0 ? read.path : read.path.slice(dot + 1).toLowerCase())
      return (
        <div className={css.previewScroll} ref={scrollRef} onScroll={onScroll}>
          {read.truncated === true && <div className={css.notice} {...searchSkip}>{t('local.tooLarge')}</div>}
          {rawSearch
            ? <MarkedContent content={content} search={search} />
            : documentBody !== null
              ? (
                <div className={css.structured}>
                  <div className={css.structuredBanner} {...searchSkip}>
                    <span className={css.structuredInfo}>{documentLabel}</span>
                  </div>
                  <div className={css.structuredBody}>{documentBody}</div>
                </div>
              )
              : <CodeBlock code={content} lang={languageFor(read.path)} copyLabel={labels.markdown.code.copyLabel} copiedLabel={labels.markdown.code.copiedLabel} />}
        </div>
      )
    }
    case 'image':
      return imageView !== undefined
        ? <div className={css.previewScroll} ref={scrollRef} onScroll={onScroll}>{imageView}</div>
        : (
          <div className={css.imageScroll} ref={scrollRef} onScroll={onScroll}>
            <img className={css.image} src={read.url} alt={read.path} />
            {read.size !== undefined && <div className={css.notice}>{read.size} B</div>}
          </div>
        )
    case 'binary':
      return <div className={css.placeholder}>{t('local.binary')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'missing':
      return (
        <div className={css.placeholder}>
          {read.reason === 'deleted'
            ? t('detail.deleted')
            : read.reason === 'unreadable' ? t('local.unreadable') : t('local.noSelection')}
        </div>
      )
    case 'too-large':
      return <div className={css.placeholder}>{t('local.tooLarge')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'error':
      return <div className={css.placeholder}>{read.message ?? t('state.error', { message: '' })}</div>
  }
}

/**
 * The shared content pane.
 * @param props - the normalized read, its chrome, and the consumer's locale adapter.
 * @returns the pane, or the empty placeholder when no file is selected.
 */
export function ContentPane(props: ContentPaneProps): ReactNode {
  const {
    path, read, loading, error, sessionId, displayPath, chrome, labels, t,
    onCopyPath, onReload, onSave, onBack, diffView, view, onViewChange, imageView, notice, embedded = false,
  } = props

  // HTML source ⇄ render ⇄ scripted; the sandboxed static render is default.
  const [htmlMode, setHtmlMode] = useState<'source' | 'render' | 'script'>('render')
  // Markdown / JSON / CSV source ⇄ rendered; rendered is the default.
  const [sourceMode, setSourceMode] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)
  // In-flight state of the caller's reload gesture (the button owns it: the
  // caller's promise settling is the only "done" signal that exists).
  const [reloading, setReloading] = useState(false)
  // Compact panes fold the content-search row behind a header icon.
  const [searchOpen, setSearchOpen] = useState(false)
  const [contentQuery, setContentQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const activeLineRef = useRef<HTMLSpanElement | null>(null)
  // Tier1 never runs without a gesture: the confirm bar gates it per file.
  const [scriptConfirm, setScriptConfirm] = useState(false)
  // The in-progress edit of THIS selection (see edit.ts): the state mirrors
  // the module-level draft memory so a file switch neither drops nor leaks it.
  const [draftState, setDraftState] = useState<{ key: string; draft: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  // Why the last save did not land, or the discard confirm; keyed like the
  // draft so another file's bar never shows it.
  type EditIssue = { kind: 'conflict' | 'unsupported' | 'missing' | 'failed' | 'discard'; message?: string | undefined }
  const [issueState, setIssueState] = useState<{ key: string; issue: EditIssue } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null)
  const htmlFrameRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // The change-history face is a SECOND scrollport in the same pane, so it
  // keeps an offset of its own: toggling 改动 ⇄ 内容 must not trade one face's
  // position for the other's.
  const diffScrollRef = useRef<HTMLDivElement | null>(null)
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef<number | null>(null)
  // Layout density follows the enclosing panel when there is one (a split's
  // detail column can be narrow inside a wide panel without being a phone),
  // else this pane's own width.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const ownCompact = usePanelCompact(rootRef)
  const compact = usePanelCompactContext() ?? ownCompact
  const splitBack = useAdaptiveSplitBack()

  const memKey = scrollKey(sessionId ?? '', path)
  const diffMemKey = `${memKey}\u0000diff`
  const captureScroll = (): void => {
    const el = scrollRef.current
    if (el !== null) scrollMemory.set(memKey, el.scrollTop)
  }
  const captureDiffScroll = (): void => {
    const el = diffScrollRef.current
    if (el !== null) scrollMemory.set(diffMemKey, el.scrollTop)
  }

  // All hooks run unconditionally before the empty-path early return so the
  // hook order stays stable across `path` flipping '' → file (React #310).
  const html = path !== '' && isHtmlPath(path)
  // Whether the change-history face is the one on screen — props only, so the
  // scroll-restore hook below can key on it before the early return.
  const diffFace = view === 'diff' && diffView !== undefined
  const htmlScripted = read?.kind === 'text' && read.htmlScripted === true && html
  const content = read?.kind === 'text' ? read.content : null
  // A complete text read is editable when the caller can save; a truncated
  // window would save half a file.
  const editable = onSave !== undefined && read?.kind === 'text' && read.truncated !== true
  const draft = !editable ? null
    : draftState?.key === memKey ? draftState.draft : (draftFor(memKey) ?? null)
  const editing = draft !== null
  const dirty = draft !== null && isDirty(draft)
  const issue = issueState?.key === memKey ? issueState.issue : null

  const matches = useMemo(() => {
    const query = contentQuery.trim().toLowerCase()
    if (content === null || content === '' || query === '') return []
    const hits: number[] = []
    content.split('\n').forEach((line, index) => {
      if (line.toLowerCase().includes(query)) hits.push(index)
    })
    return hits
  }, [content, contentQuery])
  const searchQuery = contentQuery.trim()
  // `matches` is the source-line hit set: it names the hits for the raw view and
  // its counter, and it is the cheap "is there anything at all" gate.
  const searching = content !== null && searchQuery !== '' && matches.length > 0
  // The rendered body keeps its form and the hits are painted over it. The HTML
  // preview is excluded: its body is an opaque-origin iframe whose text is not
  // in this DOM, so it keeps the raw matched-lines view.
  const canPaint = searching && !html && supportsRenderedSearch()
  const paintedSearch = useRenderedSearch({
    rootRef: scrollRef,
    query: searchQuery,
    active: activeMatch,
    enabled: canPaint,
  })
  const painted = canPaint && !paintedSearch.fallback
  // The rendered body MUST stay mounted until the scan says otherwise: falling
  // back on the unmeasured frame would scan the raw view and latch a hit count
  // for a body that is gone.
  const total = painted ? (paintedSearch.count ?? matches.length) : matches.length
  const rawSearch = searching && !painted
  const active = total === 0 ? 0 : Math.min(activeMatch, total - 1)

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center' })
  }, [active, contentQuery])
  // Track the html iframe's fullscreen state.
  useEffect(() => {
    const onFullscreen = (): void => {
      setFullscreen(document.fullscreenElement === htmlFrameRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])
  // An unsaved edit holds the tab open (the browser's own leave prompt).
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
  // Watchdog for large or scripted renders (cancelled by the iframe's load).
  useEffect(() => {
    if (!html || htmlMode === 'source' || content === null) return undefined
    const large = content.length > SLOW_DOCUMENT_CHARS
    if (!large && htmlMode !== 'script') return undefined
    setSlow(false)
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => { setSlow(true) }, SLOW_DOCUMENT_MS)
    return () => {
      if (slowTimer.current !== null) {
        window.clearTimeout(slowTimer.current)
        slowTimer.current = null
      }
    }
  }, [html, htmlMode, content])
  // Restore this selection's saved offset once its content is pinned. Re-runs
  // when `read` lands, so an async re-select re-applies the offset too.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const saved = scrollMemory.get(memKey)
    if (saved !== undefined) el.scrollTop = saved
  }, [memKey, read])
  // The same restore for the change-history scroller, keyed separately (it
  // re-runs when the face comes back or a fresh read/step lands).
  useEffect(() => {
    const el = diffScrollRef.current
    if (el === null) return
    const saved = scrollMemory.get(diffMemKey)
    if (saved !== undefined) el.scrollTop = saved
  }, [diffMemKey, diffFace, read])

  if (path === '') {
    return <div className={css.placeholder}>{t('detail.noSelection')}</div>
  }

  const search: ContentSearch = { query: searchQuery, matches, active, activeLineRef }
  const stepMatch = (delta: number): void => {
    if (total === 0) return
    setActiveMatch(index => (index + delta + total) % total)
  }
  const doCopyPath = (): void => {
    if (onCopyPath === undefined) return
    void onCopyPath().then(ok => {
      if (ok) {
        setCopiedPath(true)
        window.setTimeout(() => { setCopiedPath(false) }, 1200)
      }
    })
  }
  const doReload = (): void => {
    if (onReload === undefined || reloading) return
    setReloading(true)
    // The caller reports failures through its own error channel, so a rejected
    // promise here means the caller forgot to; either way the button re-arms.
    void Promise.resolve(onReload()).then(
      () => { setReloading(false) },
      () => { setReloading(false) },
    )
  }
  const setDraft = (next: Draft | null): void => {
    rememberDraft(memKey, next)
    setDraftState(next === null ? null : { key: memKey, draft: next })
  }
  const setIssue = (next: EditIssue | null): void => {
    setIssueState(next === null ? null : { key: memKey, issue: next })
  }
  const startEdit = (): void => {
    if (content === null) return
    setDraft({ text: toEditorText(content), base: content })
    setIssue(null)
    // The editor IS the source face: land on it, and stop any search paint.
    setSourceMode(true)
    if (html) { setHtmlMode('source'); setScriptConfirm(false) }
    setContentQuery('')
    setSearchOpen(false)
  }
  const leaveEdit = (): void => {
    setDraft(null)
    setIssue(null)
  }
  const doSave = (force: boolean): void => {
    if (onSave === undefined || draft === null || saving) return
    setSaving(true)
    setIssue(null)
    const settle = (outcome: SaveOutcome): void => {
      setSaving(false)
      if (outcome.ok) { leaveEdit(); return }
      setIssue({ kind: outcome.reason === 'error' ? 'failed' : outcome.reason, message: outcome.message })
    }
    void Promise.resolve(onSave({ content: fromEditorText(draft.text, draft.base), base: force ? null : draft.base })).then(
      settle,
      (cause: unknown) => { settle({ ok: false, reason: 'error', message: cause instanceof Error ? cause.message : String(cause) }) },
    )
  }
  const takeTheirs = (): void => {
    leaveEdit()
    if (onReload !== undefined) doReload()
  }
  const onHtmlLoaded = (): void => {
    setSlow(false)
    if (slowTimer.current !== null) {
      window.clearTimeout(slowTimer.current)
      slowTimer.current = null
    }
  }

  const basename = basenameOf(path)
  const dirname = dirnameOf(path)
  const lang = languageFor(path)
  const showDiffToggle = diffView !== undefined && view !== undefined && onViewChange !== undefined
  // The IDE control is a split button only when the caller resolved more than
  // one IDE; otherwise it is the plain single button every surface had.
  const ideChoices = chrome?.ideChoices ?? []
  const splitIde = chrome?.openIDE !== undefined && ideChoices.length > 1 && chrome.onIdeChoice !== undefined
  const diffActive = diffFace && onViewChange !== undefined

  const searchable = !diffActive && content !== null && !editing
  // Compact panes fold the search row behind a header icon; a live query keeps
  // it open so a hit counter never disappears under the user.
  const searchVisible = searchable && (!compact || searchOpen || contentQuery !== '')
  const back = onBack ?? splitBack?.onBack
  const backLabel = onBack === undefined && splitBack !== undefined ? splitBack.backLabel : t('detail.back')
  const location = displayPath ?? path

  // Header actions in priority order: the search toggle (compact only — wide
  // panes keep the row open), edit, reload, copy path, then the host-open gestures
  // (absent off-host: the open-in-app probe publishes no apps there). The
  // full path is no menu row: the title names the file, the list's trail
  // names where it is, and copy path hands over the rest.
  const headerActions: PanelAction[] = []
  if (compact && searchable) {
    headerActions.push({
      id: 'search', label: t('search.placeholder'), icon: <IconSearchOutlineMedium size={16} />, pinned: true, pressed: searchVisible,
      onSelect: () => {
        if (searchVisible) { setSearchOpen(false); setContentQuery(''); setActiveMatch(0) } else setSearchOpen(true)
      },
    })
  }
  if (editable && !editing && !diffActive) {
    headerActions.push({ id: 'edit', label: t('action.edit'), icon: <IconEditOutlineMedium size={16} />, pinned: true, onSelect: startEdit })
  }
  if (onReload !== undefined) {
    headerActions.push({
      id: 'reload', label: t('action.reload'), disabled: reloading, onSelect: doReload,
      icon: <IconRefreshOutlineMedium size={16} className={reloading ? css.actionSpinning : undefined} />,
    })
  }
  if (onCopyPath !== undefined) {
    headerActions.push({
      // An editable read spends the inline slot on edit; copy path is the
      // gesture that folds (keyed on `editable`, not `editing`, so the row
      // does not jump when edit mode starts).
      id: 'copy', label: copiedPath ? t('action.copied') : t('action.copyPath'), onSelect: doCopyPath, menuOnly: editable,
      icon: copiedPath ? <IconCheckOutlineMedium size={16} /> : <IconCopyOutlineMedium size={16} />,
    })
  }
  if (chrome?.openFolder !== undefined) {
    headerActions.push({ id: 'folder', label: t('action.showInFolder'), icon: <IconFolderOpenOutlineMedium size={16} />, onSelect: chrome.openFolder })
  }
  if (chrome?.openIDE !== undefined) {
    headerActions.push({ id: 'ide', label: t('action.openIDE'), icon: <IconCodeOutlineMedium size={16} />, onSelect: chrome.openIDE })
    // Each resolved IDE is its own menu row (the wide pane's old split caret).
    if (splitIde) {
      for (const choice of ideChoices) {
        headerActions.push({
          id: `ide:${choice.id}`, label: `${t('action.openIDE')} · ${choice.label}`, icon: <IconCodeOutlineMedium size={16} />,
          menuOnly: true, onSelect: () => { chrome.onIdeChoice?.(choice.id) },
        })
      }
    }
  }
  if (!diffActive && html && content !== null && htmlMode !== 'source') {
    headerActions.push({
      id: 'fullscreen', label: fullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen'), icon: <IconCodeOutlineMedium size={16} />,
      menuOnly: compact,
      onSelect: () => {
        const frame = htmlFrameRef.current
        if (frame === null) return
        if (document.fullscreenElement != null) { void document.exitFullscreen?.() }
        else if (typeof frame.requestFullscreen === 'function') { void frame.requestFullscreen() }
      },
    })
  }

  // One tab row for every face/form switch the read offers: the change face,
  // then the content forms (rendered/source for markdown-like reads, the HTML
  // tiers, or a plain "content" face beside the diff).
  type ViewTab = 'diff' | 'content' | 'preview' | 'source' | 'html:source' | 'html:render' | 'html:script'
  const viewTabs: { id: ViewTab; label: string }[] = []
  if (showDiffToggle) viewTabs.push({ id: 'diff', label: t('detail.diff') })
  if (content !== null && !html && (isMarkdown(path) || hasStructuredPreview(path))) {
    viewTabs.push({ id: 'preview', label: t('detail.preview') }, { id: 'source', label: t('detail.source') })
  } else if (content !== null && html) {
    viewTabs.push({ id: 'html:source', label: t('preview.htmlSource') }, { id: 'html:render', label: t('preview.htmlRender') })
    if (htmlScripted) viewTabs.push({ id: 'html:script', label: t('preview.htmlScript') })
  } else if (showDiffToggle) {
    viewTabs.push({ id: 'content', label: t('detail.content') })
  }
  const viewValue: ViewTab = diffActive ? 'diff'
    : viewTabs.some(tab => tab.id === 'preview') ? (sourceMode ? 'source' : 'preview')
      : html ? `html:${htmlMode}` as ViewTab
        : 'content'
  const selectView = (id: ViewTab): void => {
    if (id === 'diff') { onViewChange?.('diff'); return }
    if (diffActive) onViewChange?.('content')
    if (id === 'preview' || id === 'source') setSourceMode(id === 'source')
    else if (id === 'html:source') { setHtmlMode('source'); setScriptConfirm(false) }
    else if (id === 'html:render') { setHtmlMode('render'); setScriptConfirm(false) }
    // Tier1 never runs without a gesture: the tab arms the confirm bar.
    else if (id === 'html:script' && htmlMode !== 'script') setScriptConfirm(true)
  }
  const editor = editing && draft !== null
    ? (
      <div className={css.editorWrap}>
        <textarea
          className={css.editor}
          value={draft.text}
          aria-label={t('edit.label')}
          spellCheck={false}
          autoFocus
          wrap={isMarkdown(path) ? 'soft' : 'off'}
          disabled={saving}
          onChange={(event) => { setDraft({ text: event.target.value, base: draft.base }) }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              if (dirty) doSave(false)
            }
          }}
        />
      </div>
    )
    : null
  const editBar = editing
    ? (
      <div className={issue !== null && issue.kind !== 'discard' ? css.editBarIssue : css.editBar} role="status">
        <span className={css.editBarText}>
          {saving ? t('edit.saving')
            : issue?.kind === 'conflict' ? t('edit.conflict')
              : issue?.kind === 'unsupported' ? t('edit.unsupported')
                : issue?.kind === 'missing' ? t('edit.missing')
                  : issue?.kind === 'failed' ? t('edit.failed', { message: issue.message ?? '' })
                    : issue?.kind === 'discard' ? t('edit.discardConfirm')
                      : dirty ? t('edit.dirty') : t('edit.editing')}
        </span>
        <span className={css.editBarActions}>
        {issue?.kind === 'conflict'
          ? (
            <>
              <button type="button" className={css.editBarButton} disabled={saving} onClick={takeTheirs}>{t('edit.takeTheirs')}</button>
              <button type="button" className={css.editBarPrimary} disabled={saving} onClick={() => { doSave(true) }}>{t('edit.overwrite')}</button>
            </>
          )
          : issue?.kind === 'discard'
            ? (
              <>
                <button type="button" className={css.editBarButton} onClick={() => { setIssue(null) }}>{t('edit.keepEditing')}</button>
                <button type="button" className={css.editBarDanger} onClick={leaveEdit}>{t('edit.discard')}</button>
              </>
            )
            : (
              <>
                <button type="button" className={css.editBarButton} disabled={saving} onClick={() => { if (dirty) setIssue({ kind: 'discard' }); else leaveEdit() }}>
                  {t('edit.discard')}
                </button>
                <button type="button" className={css.editBarPrimary} disabled={saving || !dirty} onClick={() => { doSave(false) }}>{t('edit.save')}</button>
              </>
            )}
        </span>
      </div>
    )
    : null
  const tabs = viewTabs.length > 1
    ? <UnderlineTabs tabs={viewTabs} value={viewValue} onChange={selectView} label={t('detail.views')} className={css.viewTabs} />
    : null

  return (
    // data-quote-source / data-quote-ref: a passage quoted from here names the
    // file and hands the model its absolute path (plain DOM data — read by the
    // quote plugin when installed, inert otherwise).
    <div ref={rootRef} className={css.root} data-compact={compact ? 'true' : 'false'} data-quote-source={basename} data-quote-ref={location}>
      <div className={`${css.titleBar} ${embedded ? css.headerEmbedded : ''}`}>
        <PanelHeader
          className={css.paneHeader}
          compact={compact}
          title={<>{basename}{!compact && lang !== undefined && <span className={css.langTag}>{isMarkdown(path) ? 'MD' : lang}</span>}</>}
          onBack={back}
          backLabel={backLabel}
          backRef={onBack === undefined ? splitBack?.backRef : undefined}
          actions={headerActions}
          moreLabel={t('action.more')}
        />
        {compact
          ? tabs
          : (
            <div className={css.pathRow}>
              <div className={css.pathLine} title={location}>{displayPath ?? dirname}</div>
              {tabs}
            </div>
          )}
      </div>
      {searchVisible && (
        <div className={css.contentSearch}>
          <input
            type="search"
            className={css.contentSearchInput}
            placeholder={t('search.placeholder')}
            value={contentQuery}
            autoFocus={compact}
            onChange={(event) => {
              setContentQuery(event.target.value)
              setActiveMatch(0)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !compact) return
              if (contentQuery === '') setSearchOpen(false)
              else { setContentQuery(''); setActiveMatch(0) }
            }}
            aria-label={t('search.placeholder')}
          />
          {contentQuery.trim() !== '' && matches.length === 0 && (
            <span className={css.searchCount}>{t('search.noMatch')}</span>
          )}
          {matches.length > 0 && (
            <>
              <span className={css.searchCount}>{t('search.hit', { current: active + 1, total })}</span>
              <button type="button" className={css.stepButton} onClick={() => { stepMatch(-1) }} aria-label={t('search.prev')}>‹</button>
              <button type="button" className={css.stepButton} onClick={() => { stepMatch(1) }} aria-label={t('search.next')}>›</button>
            </>
          )}
        </div>
      )}
      {notice !== undefined && <div className={css.notice}>{notice}</div>}
      {!diffActive && editBar}
      {html && scriptConfirm && content !== null && (
        <div className={css.scriptConfirm} role="alertdialog">
          <span>{t('preview.scriptConfirm')}</span>
          <button type="button" className={css.scriptConfirmRun} onClick={() => { setScriptConfirm(false); setHtmlMode('script') }}>
            {t('preview.scriptRun')}
          </button>
          <button type="button" className={css.scriptConfirmCancel} onClick={() => setScriptConfirm(false)}>
            {t('preview.scriptCancel')}
          </button>
        </div>
      )}
      {html && slow && htmlMode !== 'source' && content !== null && (
        <div className={css.notice}>{t('preview.slowHint')}</div>
      )}
      <div className={`${css.body} ${embedded ? css.bodyEmbedded : ''}`}>
        {diffActive
          ? (
            <div className={css.diffScroll} ref={diffScrollRef} onScroll={captureDiffScroll}>
              {diffView}
            </div>
          )
          : loading
            ? <div className={css.placeholder}>{t('state.loading')}</div>
            : error !== null
              ? <div className={css.placeholder}>{t('state.error', { message: error })}</div>
              : read === null
                ? <div className={css.placeholder}>{t('detail.noSelection')}</div>
                : (
                  <PreviewBody
                    read={editing && read.kind === 'text' && draft !== null ? { ...read, content: draft.text } : read}
                    t={t}
                    labels={labels}
                    search={search}
                    rawSearch={rawSearch}
                    htmlMode={htmlMode}
                    scripted={htmlScripted}
                    sourceMode={sourceMode}
                    imageView={imageView}
                    editor={editor}
                    onLoaded={onHtmlLoaded}
                    iframeRef={htmlIframeRef}
                    frameRef={htmlFrameRef}
                    scrollRef={scrollRef}
                    onScroll={captureScroll}
                    fullscreen={fullscreen}
                  />
                )}
      </div>
    </div>
  )
}

/** Whether a read is a text document (the search row's gate). */
export function isTextRead(read: PreviewRead | null): boolean {
  return read?.kind === 'text'
}

/** Re-exported so consumers can type their own view state without the kernel's barrel. */
export type { PreviewView }
