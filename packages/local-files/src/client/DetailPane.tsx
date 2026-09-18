/**
 * The detail pane: the selected file's content preview, mirroring
 * ui-file-preview's FilePreviewPane. It reads a kind-union `LocalFilesRead`
 * (`text` / `image` / `binary` / `missing` / `too-large` / `error`) and
 * dispatches exactly like the products pane — a content search row (match
 * highlight + prev/next) for text reads, HTML source ⇄ render ⇄ scripted
 * toggle + fullscreen, and a format banner wrapping structured document views
 * (markdown / JSON / CSV). The header bar shows the resolved path plus the
 * copy-path / open-folder / open-IDE gestures.
 *
 * The content search keeps the rendered body: the hits are painted over it
 * through the CSS Custom Highlight API and the raw matched-lines view is only
 * the fallback for a query the rendered body cannot show (rendered-search.ts).
 *
 * The local-files browser is git-agnostic, so there is no diff view — only the
 * content view. Mirrors the file-preview pane's chrome so both render areas
 * read as one family, preparing for a future merge.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  CodeBlock, IconCheckOutline16, IconCodeOutline16,
  IconCopyOutline16, IconFolderOpenOutline16, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalFilesRead } from '../types.ts'
import { isHtmlPath, isMarkdown, languageFor } from './language.ts'
import { structuredPreview, markdownLabels } from './structured.tsx'
import { buildSrcDoc } from './html-src-doc.ts'
import { attachBridge } from './html-bridge.ts'
import {
  SEARCH_SKIP_ATTRIBUTE, supportsRenderedSearch, useRenderedSearch,
} from './rendered-search.ts'
import css from './DetailPane.module.css'

/**
 * Per-(session,path) content-pane scroll offsets. The workspace view slot
 * renders only the active view (`only: active.id`), so switching tabs unmounts
 * this pane and its `scrollTop` (plain DOM state) is lost with it. Reading the
 * same selection back on a later mount restores the saved offset. A module
 * level Map survives the unmount and — unlike a store field — never
 * re-renders the file tree on every scroll event. Keys are absolute paths
 * namespaced by session, so it stays correct across tab switches and sessions.
 */
const scrollMemory = new Map<string, number>()
const scrollKey = (sessionId: string, path: string): string => `${sessionId}\u0000${path}`

/** Chrome marker for the content scan: the format banner and the truncation
 * notice are not document text, so a query must not count them as hits. */
const searchSkip = { [SEARCH_SKIP_ATTRIBUTE]: '' } as const

/** Content-search state handed to the text preview body. */
interface ContentSearch {
  query: string
  matches: readonly number[]
  active: number
  activeLineRef: RefObject<HTMLSpanElement>
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

/** Plain-text render with per-line match highlighting (search mode). */
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
  t: TranslateNS<'localFiles'>
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
          <IconCheckOutline16 size={12} />
        </button>
      )}
    </div>
  )
}

/** Render one kind-union read (mirrors the products pane's PreviewBody). */
function PreviewBody(props: {
  read: LocalFilesRead
  t: TranslateNS<'localFiles'>
  search: ContentSearch
  /** Show the raw matched-lines view instead of the rendered body (the
   * content search's fallback — see rendered-search.ts). */
  rawSearch: boolean
  htmlMode: 'source' | 'render' | 'script'
  scripted: boolean
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  onScroll: () => void
  fullscreen: boolean
}) {
  const { read, t, search, rawSearch, htmlMode, scripted, onLoaded, iframeRef, frameRef, scrollRef, onScroll, fullscreen } = props
  switch (read.kind) {
    case 'text': {
      const content = read.content ?? ''
      if (isHtmlPath(read.path)) {
        return (
          <div className={css.previewScroll} ref={scrollRef} onScroll={onScroll}>
            {read.truncated === true && <div className={css.notice} {...searchSkip}>{t('local.tooLarge')}</div>}
            {rawSearch
              ? <MarkedContent content={content} search={search} />
              : htmlMode === 'source'
                ? <CodeBlock code={content} lang="html" copyLabel={t('action.copy')} copiedLabel={t('action.copied')} />
                : <HtmlRenderView content={content} mode={htmlMode} scripted={scripted} t={t} onLoaded={onLoaded} iframeRef={iframeRef} frameRef={frameRef} fullscreen={fullscreen} />}
          </div>
        )
      }
      const documentBody = rawSearch
        ? null
        : structuredPreview(read.path, content, t)
          ?? (isMarkdown(read.path) ? <MarkdownText text={content} labels={markdownLabels(t)} /> : null)
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
              : <CodeBlock code={content} lang={languageFor(read.path)} copyLabel={t('action.copy')} copiedLabel={t('action.copied')} />}
        </div>
      )
    }
    case 'image':
      return (
        <div className={css.imageScroll} ref={scrollRef} onScroll={onScroll}>
          <img className={css.image} src={read.url} alt={read.path} />
          {read.size !== undefined && <div className={css.notice}>{read.size} B</div>}
        </div>
      )
    case 'binary':
      return <div className={css.notice}>{t('local.binary')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'missing':
      return <div className={css.notice}>{t('local.noSelection')}</div>
    case 'too-large':
      return <div className={css.notice}>{t('local.tooLarge')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'error':
      return <div className={css.notice}>{read.message ?? t('state.error', { message: '' })}</div>
  }
}

/** The detail pane's view: diff or content. The local-files browser is
 * git-agnostic and renders no diff, so only 'content' is rendered here. */
export type DetailView = 'diff' | 'content'

/** Props of the detail pane. */
export interface DetailPaneProps {
  /** The selected file's path ('' when none). */
  path: string
  /** The session serving this view — namespaces the scroll-memory cache. */
  sessionId?: string | undefined
  /** The active detail view (retained for the parent's view-state contract). */
  detailView?: DetailView
  /** The kind-union preview read (null until loaded / no selection). */
  read: LocalFilesRead | null
  /** Whether a fetch is in flight. */
  loading: boolean
  /** Human-readable fetch failure, or null. */
  error: string | null
  /** The host-resolved absolute path shown in the preview header. */
  displayPath?: string | undefined
  /** Copy the selected file's path; resolves true only on acceptance. */
  onCopyPath?: ((path: string) => Promise<boolean>) | undefined
  /** Whether any host-open gesture is available (the open-in-app probe resolved an app). */
  canOpenHost?: boolean
  /** Open the selected file's parent folder in the host file manager. */
  onOpenFolder?: ((path: string) => void) | undefined
  /** Open the selected file's parent folder in the host editor/IDE. */
  onOpenIDE?: ((path: string) => void) | undefined
  /** Called when the view changes (retained for the parent's contract). */
  onViewChange?: (view: DetailView) => void
  /** When given and a file is selected, renders a back button. */
  onBack?: (() => void) | undefined
  /** When true, the pane is nested inside an already-padded container. */
  embedded?: boolean
  /** Locale-bound translator. */
  t: TranslateNS<'localFiles'>
}

/** The detail pane. */
export function DetailPane({
  path, sessionId, read, loading, error, displayPath, onCopyPath, canOpenHost,
  onOpenFolder, onOpenIDE, t,
}: DetailPaneProps): ReactNode {
  // HTML source ⇄ render ⇄ scripted toggle; the sandboxed iframe is default.
  const [htmlMode, setHtmlMode] = useState<'source' | 'render' | 'script'>('render')
  // Post-copy "copied" confirmations.
  const [copiedPath, setCopiedPath] = useState(false)
  // Content search: query + active match index.
  const [contentQuery, setContentQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const activeLineRef = useRef<HTMLSpanElement | null>(null)
  // The Tier1 confirm dialog (scripted files only; scripts never run without a
  // gesture).
  const [scriptConfirm, setScriptConfirm] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const htmlIframeRef = useRef<HTMLIFrameElement>(null)
  const htmlFrameRef = useRef<HTMLDivElement>(null)
  // The scrollable preview body (text/image pans); offsets survive the
  // tab-switch unmount through the module-level scrollMemory cache.
  const scrollRef = useRef<HTMLDivElement>(null)
  // Watchdog for large/scripted renders.
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef<number | null>(null)

  // Scroll-memory keys: this selection's cache slot and its writer (a plain
  // Map write — no React state, so scrolling never re-renders the tree).
  const memKey = scrollKey(sessionId ?? '', path)
  const captureScroll = (): void => {
    const el = scrollRef.current
    if (el !== null) scrollMemory.set(memKey, el.scrollTop)
  }

  // All hooks run unconditionally before the empty-path early return, so the
  // hook order is stable across `path` flipping '' → file (React #310 guard).
  const html = path !== '' && isHtmlPath(path)
  const htmlScripted = read?.htmlScripted === true && html

  const matches = useMemo(() => {
    const query = contentQuery.trim().toLowerCase()
    const content = read?.kind === 'text' ? (read.content ?? '') : ''
    if (content === '' || query === '') return []
    const hits: number[] = []
    content.split('\n').forEach((line, index) => {
      if (line.toLowerCase().includes(query)) hits.push(index)
    })
    return hits
  }, [read, contentQuery])
  // The text read's content (null for every other kind), needed above the
  // empty-path early return by the search state below.
  const content = read?.kind === 'text' ? (read.content ?? '') : null
  const searchQuery = contentQuery.trim()
  // `matches` is the source-line hit set: it names the hits for the raw view
  // and its counter, and it is also the cheap "is there anything at all" gate.
  const searching = content !== null && searchQuery !== '' && matches.length > 0
  // The rendered body keeps its form and the hits are painted over it (see
  // rendered-search.ts). The html preview is excluded: its body is an
  // opaque-origin iframe whose text is not in this DOM, so it keeps the raw
  // matched-lines view.
  const canPaint = searching && !html && supportsRenderedSearch()
  const paintedSearch = useRenderedSearch({
    rootRef: scrollRef,
    query: searchQuery,
    active: activeMatch,
    enabled: canPaint,
  })
  const painted = canPaint && !paintedSearch.fallback
  // The counter and the jump cursor size themselves against what is on screen:
  // painted occurrences in the rendered body, matched lines in the raw view.
  // An unmeasured query (the commit before its scan) reads the raw count, which
  // is always ≥ the painted one — the hook clamps the index. The rendered body
  // MUST stay mounted until the scan says otherwise: falling back on the
  // unmeasured frame would scan the raw view (where the source syntax it could
  // not find is visible) and latch a hit count for a body that is gone.
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
  useEffect(() => {
    const content = read?.kind === 'text' ? (read.content ?? '') : null
    if (!html || htmlMode === 'source' || content === null) return
    const large = content.length > 256 * 1024
    if (!large && htmlMode !== 'script') return
    setSlow(false)
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => setSlow(true), 20_000)
    return () => {
      if (slowTimer.current !== null) { window.clearTimeout(slowTimer.current); slowTimer.current = null }
    }
  }, [html, htmlMode, read])

  // Restore this selection's saved scroll offset once its content is pinned.
  // Re-runs when `read` lands, so an async re-select (which nulls `read` first)
  // also re-applies the offset — not only a same-selection remount. A fresh
  // path has no cache entry and stays at the top.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const saved = scrollMemory.get(memKey)
    if (saved !== undefined) el.scrollTop = saved
  }, [memKey, read])

  const onHtmlLoaded = (): void => {
    setSlow(false)
    if (slowTimer.current !== null) { window.clearTimeout(slowTimer.current); slowTimer.current = null }
  }

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
    void onCopyPath(path).then(ok => {
      if (ok) {
        setCopiedPath(true)
        window.setTimeout(() => { setCopiedPath(false) }, 1200)
      }
    })
  }

  return (
    <div className={css.root}>
      {displayPath !== undefined && (onCopyPath !== undefined || canOpenHost === true) && (
        <div className={css.previewHeader}>
          <div className={css.previewPath} title={displayPath}>{displayPath}</div>
          <div className={css.previewActions}>
            {onCopyPath !== undefined && (
              <button
                type="button"
                className={css.action}
                title={copiedPath ? t('action.copied') : t('action.copyPath')}
                aria-label={copiedPath ? t('action.copied') : t('action.copyPath')}
                onClick={doCopyPath}
              >
                {copiedPath ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
                {copiedPath ? t('action.copied') : t('action.copyPath')}
              </button>
            )}
            {canOpenHost === true && onOpenFolder !== undefined && (
              <button type="button" className={css.action} title={t('action.openFolder')} onClick={() => { onOpenFolder(path) }}>
                <IconFolderOpenOutline16 size={14} />
                {t('action.openFolder')}
              </button>
            )}
            {canOpenHost === true && onOpenIDE !== undefined && (
              <button type="button" className={css.action} title={t('action.openIDE')} onClick={() => { onOpenIDE(path) }}>
                <IconCodeOutline16 size={14} />
                {t('action.openIDE')}
              </button>
            )}
          </div>
        </div>
      )}
      {content !== null && (
        <div className={css.contentSearch}>
          <input
            type="search"
            className={css.contentSearchInput}
            placeholder={t('search.placeholder')}
            value={contentQuery}
            onChange={(event) => {
              setContentQuery(event.target.value)
              setActiveMatch(0)
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
          {html && (
            <div className={css.htmlToggle} role="group" aria-label={t('preview.htmlToggle')}>
              <button
                type="button"
                className={htmlMode === 'source' ? `${css.htmlToggleBtn} ${css.htmlToggleActive}` : css.htmlToggleBtn}
                onClick={() => { setHtmlMode('source') }}
              >
                {t('preview.htmlSource')}
              </button>
              <button
                type="button"
                className={htmlMode === 'render' ? `${css.htmlToggleBtn} ${css.htmlToggleActive}` : css.htmlToggleBtn}
                onClick={() => { setHtmlMode('render'); setScriptConfirm(false) }}
              >
                {t('preview.htmlRender')}
              </button>
              {htmlScripted && (
                <button
                  type="button"
                  className={htmlMode === 'script' ? `${css.htmlToggleBtn} ${css.htmlToggleActive}` : css.htmlToggleBtn}
                  onClick={() => {
                    if (htmlMode === 'script') { setHtmlMode('render'); setScriptConfirm(false) }
                    else setScriptConfirm(true)
                  }}
                >
                  {t(htmlMode === 'script' ? 'preview.htmlScriptStop' : 'preview.htmlScript')}
                </button>
              )}
              {(htmlMode === 'render' || htmlMode === 'script') && (
                <button
                  type="button"
                  className={css.htmlToggleBtn}
                  aria-label={fullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')}
                  onClick={() => {
                    const frame = htmlFrameRef.current
                    if (frame === null) return
                    if (document.fullscreenElement != null) { void document.exitFullscreen?.() }
                    else if (typeof frame.requestFullscreen === 'function') { void frame.requestFullscreen() }
                  }}
                >
                  <IconCodeOutline16 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
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
      <div className={css.body}>
        {loading
          ? <div className={css.placeholder}>{t('state.loading')}</div>
          : error !== null
            ? <div className={css.placeholder}>{t('state.error', { message: error })}</div>
            : read === null
              ? <div className={css.placeholder}>{t('detail.noSelection')}</div>
              : <PreviewBody read={read} t={t} search={search} rawSearch={rawSearch} htmlMode={htmlMode} scripted={htmlScripted} onLoaded={onHtmlLoaded} iframeRef={htmlIframeRef} frameRef={htmlFrameRef} scrollRef={scrollRef} onScroll={captureScroll} fullscreen={fullscreen} />}
      </div>
    </div>
  )
}
