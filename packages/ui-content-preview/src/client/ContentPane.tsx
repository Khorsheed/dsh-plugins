/**
 * The shared content pane: one implementation of "show me this file" behind
 * every community file surface.
 *
 * Layout — a two-line title bar (back control, basename with a language chip,
 * then the view/preview/source controls and the host-open gestures, with the
 * relative path on its own line), an optional content-search row for text reads
 * (query, hit counter, stepper, the source/render control, and the HTML tier
 * control), then the body: HTML through the tiered sandbox, markdown / JSON /
 * CSV rendered through the official primitives inside shared block chrome,
 * everything else as a highlighted code block, and images / binary / missing /
 * too-large / error through their designed placeholders.
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
 * - `headless` (explicit per call site) drops the pane's own chrome — the
 *   title bar and the view controls — for embeddings whose host frame already
 *   carries them (ui-file-preview's official-document-tab renderer). The
 *   content-search row STAYS: the rc.1 official document tab has no content
 *   search of its own, so the row is no duplication — dropping it would be a
 *   net loss, not a de-overlap (repo-owner call, 2026-09-24). The floating
 *   copy-path button likewise stays (the one gesture the host frame's actions
 *   have no equivalent for). Surfaces without a host frame keep the full
 *   chrome.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  CodeBlock, IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronLeftOutlineMedium,
  IconCodeOutlineMedium, IconCopyOutlineMedium, IconFolderOpenOutlineMedium, MarkdownText, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentPaneProps, PreviewTranslator, PreviewRead, PreviewView } from './contract.ts'
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
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  onScroll: () => void
  fullscreen: boolean
}) {
  const {
    read, t, labels, search, rawSearch, htmlMode, scripted, sourceMode, imageView,
    onLoaded, iframeRef, frameRef, scrollRef, onScroll, fullscreen,
  } = props
  switch (read.kind) {
    case 'text': {
      const content = read.content
      if (isHtmlPath(read.path)) {
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
    onCopyPath, onBack, diffView, view, onViewChange, imageView, notice, embedded = false,
    headless = false,
  } = props

  // HTML source ⇄ render ⇄ scripted; the sandboxed static render is default.
  const [htmlMode, setHtmlMode] = useState<'source' | 'render' | 'script'>('render')
  // Markdown / JSON / CSV source ⇄ rendered; rendered is the default.
  const [sourceMode, setSourceMode] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)
  // The IDE split control's menu (only rendered when more than one IDE resolved).
  const [ideOpen, setIdeOpen] = useState(false)
  const [contentQuery, setContentQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const activeLineRef = useRef<HTMLSpanElement | null>(null)
  // Tier1 never runs without a gesture: the confirm bar gates it per file.
  const [scriptConfirm, setScriptConfirm] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null)
  const htmlFrameRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef<number | null>(null)

  const memKey = scrollKey(sessionId ?? '', path)
  const captureScroll = (): void => {
    const el = scrollRef.current
    if (el !== null) scrollMemory.set(memKey, el.scrollTop)
  }

  // All hooks run unconditionally before the empty-path early return so the
  // hook order stays stable across `path` flipping '' → file (React #310).
  const html = path !== '' && isHtmlPath(path)
  const htmlScripted = read?.kind === 'text' && read.htmlScripted === true && html
  const content = read?.kind === 'text' ? read.content : null

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
  // Headless suppresses the chrome the toggle lives in, so the body pins the
  // content view regardless of the caller's view state.
  const diffActive = !headless && showDiffToggle && view === 'diff'

  return (
    <div className={headless ? `${css.root} ${css.rootHeadless}` : css.root}>
      {headless && onCopyPath !== undefined && (
        // The one gesture the host frame has no equivalent for (its document
        // actions carry native opens only): a minimal floating entry over the
        // content's top-right corner.
        <button
          type="button"
          className={css.copyFloat}
          title={copiedPath ? t('action.copied') : t('action.copyPath')}
          aria-label={copiedPath ? t('action.copied') : t('action.copyPath')}
          onClick={doCopyPath}
        >
          {copiedPath ? <IconCheckOutlineMedium size={14} /> : <IconCopyOutlineMedium size={14} />}
        </button>
      )}
      {!headless && (
      <div className={`${css.titleBar} ${embedded ? css.headerEmbedded : ''}`}>
        <div className={css.titleRow}>
          {onBack !== undefined && (
            <button
              type="button"
              className={css.back}
              title={t('detail.back')}
              aria-label={t('detail.back')}
              onClick={onBack}
            >
              <IconChevronLeftOutlineMedium />
            </button>
          )}
          <span className={css.title} title={basename}>
            {basename}
            {lang !== undefined && <span className={css.langTag}>{isMarkdown(path) ? 'MD' : lang}</span>}
          </span>
          <span className={css.titleActions}>
            {onCopyPath !== undefined && (
              <button
                type="button"
                className={css.action}
                title={copiedPath ? t('action.copied') : t('action.copyPath')}
                aria-label={copiedPath ? t('action.copied') : t('action.copyPath')}
                onClick={doCopyPath}
              >
                {copiedPath ? <IconCheckOutlineMedium size={14} /> : <IconCopyOutlineMedium size={14} />}
              </button>
            )}
            {chrome?.openFolder !== undefined && (
              <button
                type="button"
                className={css.action}
                title={t('action.openFolder')}
                aria-label={t('action.openFolder')}
                onClick={chrome.openFolder}
              >
                <IconFolderOpenOutlineMedium size={14} />
              </button>
            )}
            {splitIde
              ? (
                <span className={css.split}>
                  <button
                    type="button"
                    className={css.action}
                    title={t('action.openIDE')}
                    aria-label={t('action.openIDE')}
                    onClick={chrome.openIDE}
                  >
                    <IconCodeOutlineMedium size={14} />
                  </button>
                  <Menu
                    open={ideOpen}
                    align="end"
                    anchor={(
                      <button
                        type="button"
                        className={css.action}
                        title={t('action.chooseIDE')}
                        aria-label={t('action.chooseIDE')}
                        aria-expanded={ideOpen}
                        onClick={() => { setIdeOpen(value => !value) }}
                      >
                        <IconChevronDownOutlineMedium />
                      </button>
                    )}
                    items={ideChoices.map(choice => ({ id: choice.id, label: choice.label }))}
                    onSelect={(id) => { setIdeOpen(false); chrome.onIdeChoice?.(id) }}
                    onClose={() => { setIdeOpen(false) }}
                  />
                </span>
              )
              : chrome?.openIDE !== undefined && (
                <button
                  type="button"
                  className={css.action}
                  title={t('action.openIDE')}
                  aria-label={t('action.openIDE')}
                  onClick={chrome.openIDE}
                >
                  <IconCodeOutlineMedium size={14} />
                </button>
              )}
          </span>
        </div>
        <div className={css.pathRow}>
          <div className={css.pathLine} title={displayPath ?? path}>{displayPath ?? dirname}</div>
          <span className={css.viewControls}>
            {showDiffToggle && (
              <span className={css.toggle}>
                <button
                  type="button"
                  className={`${css.viewButton} ${diffActive ? css.viewActive : ''}`}
                  onClick={() => { onViewChange('diff') }}
                >
                  {t('detail.diff')}
                </button>
                <button
                  type="button"
                  className={`${css.viewButton} ${!diffActive ? css.viewActive : ''}`}
                  onClick={() => { onViewChange('content') }}
                >
                  {t('detail.content')}
                </button>
              </span>
            )}
            {!diffActive && content !== null && !html && (isMarkdown(path) || hasStructuredPreview(path)) && (
              <span className={css.seg}>
                <button
                  type="button"
                  className={`${css.segButton} ${!sourceMode ? css.segActive : ''}`}
                  onClick={() => { setSourceMode(false) }}
                >
                  {t('detail.preview')}
                </button>
                <button
                  type="button"
                  className={`${css.segButton} ${sourceMode ? css.segActive : ''}`}
                  onClick={() => { setSourceMode(true) }}
                >
                  {t('detail.source')}
                </button>
              </span>
            )}
            {!diffActive && html && content !== null && (
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
                    <IconCodeOutlineMedium size={14} />
                  </button>
                )}
              </div>
            )}
          </span>
        </div>
      </div>
      )}
      {/* The content-search row rides both modes: headless drops the chrome
          the host frame already carries (title bar, view controls); the
          official document tab has no content search, so this row is kept —
          no duplication, and dropping it would be a net loss. */}
      {!diffActive && content !== null && (
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
        </div>
      )}
      {notice !== undefined && <div className={css.notice}>{notice}</div>}
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
        {diffActive
          ? diffView
          : loading
            ? <div className={css.placeholder}>{t('state.loading')}</div>
            : error !== null
              ? <div className={css.placeholder}>{t('state.error', { message: error })}</div>
              : read === null
                ? <div className={css.placeholder}>{t('detail.noSelection')}</div>
                : (
                  <PreviewBody
                    read={read}
                    t={t}
                    labels={labels}
                    search={search}
                    rawSearch={rawSearch}
                    htmlMode={htmlMode}
                    scripted={htmlScripted}
                    sourceMode={sourceMode}
                    imageView={imageView}
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
