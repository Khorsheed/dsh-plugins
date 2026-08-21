/** Shared preview pane: the file's current content by default, with a
 * change-history tab that steps through every recorded write/edit diff. Used
 * by both the file view tab and the link-click drawer. */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { FilePreviewEntry, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import { CodeBlock, DiffBlock, MarkdownText, IconFullscreenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isHtmlPath, languageFor } from './path-utils.ts'
import { buildSrcDoc } from './html-src-doc.ts'
import { attachBridge } from './html-bridge.ts'
import { structuredPreview } from './structured.tsx'
import css from './FilePreviewPane.module.css'

/** Content-search state handed to the text preview body. */
interface ContentSearch {
  /** Trimmed query ('' renders the plain CodeBlock). */
  query: string
  /** Matching line indexes (content order). */
  matches: readonly number[]
  /** Index into matches of the jump target. */
  active: number
  /** Ref parked on the active line, scrolled into view on jumps. */
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

/** The sandboxed render iframe. `mode: 'render'` runs with an empty `sandbox`
 * — CSS/SVG render, scripts never run. `mode: 'script'` (the Tier1 gate)
 * runs with `sandbox="allow-scripts"` — never `allow-same-origin`, so the
 * frame keeps an opaque origin and its scripts cannot touch the host — and
 * the Tier1 srcDoc wrapper (meta CSP + content-visibility + the `dshBridge`
 * capability client). The bridge's host side validates every call; the
 * watchdog lives in the pane (armed only for large documents and the
 * scripted tier — see FilePreviewPane). The iframe is wrapped in a
 * fullscreen-able container owned by the pane, so fullscreen keeps a visible
 * exit control (the toolbar lives outside the iframe and would vanish).
 * Relative assets do not resolve against a file base in either mode. */
function HtmlRenderView(props: {
  content: string
  mode: 'render' | 'script'
  scripted: boolean
  t: TranslateNS<'filePreview'>
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  fullscreen: boolean
}) {
  const { content, mode, scripted, t, onLoaded, iframeRef, frameRef, fullscreen } = props
  const tier = mode === 'script' ? 1 : 0
  // At the static tier a scripted page's own "loading…" can never finish;
  // explain it instead of letting it read as a hang.
  const hint = mode === 'render' && scripted ? t('preview.staticHint') : undefined
  const srcDoc = useMemo(
    () => buildSrcDoc(content, hint === undefined ? { tier } : { tier, hint }),
    [content, tier, hint],
  )
  // Tier1: attach the capability bridge to this iframe's window. The frame is
  // mounted in the same commit that flips the mode, so the ref is set here.
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
          onClick={() => { void document.exitFullscreen?.() }}
        >
          <IconFullscreenOutline16 size={14} />
          {t('preview.exitFullscreen')}
        </button>
      )}
    </div>
  )
}

/** Render one classified read; text carries a syntax-highlighted CodeBlock,
 * except markdown files, which render through the official MarkdownText
 * pipeline (the same renderer the chat uses — headings, tables, emphasis,
 * links, images, footnotes, math) so the preview reads like the document, not
 * its source, and JSON/CSV files, which render through their structured forms
 * (JsonTree inspector / markdown table) when parseable. HTML files get a
 * source ⇄ render toggle: the render view is a sandboxed iframe (empty
 * `sandbox` — no scripts, forms, or popups; CSS/images render, relative
 * assets do not resolve against a file base), because the official pipeline
 * keeps raw HTML literal by design. Every document view (markdown included)
 * sits in the same block chrome the code and diff views use — a rounded
 * surface with a small format banner — so the previews read as one family.
 * A content search switches any text read to the raw marked-lines view so
 * matches stay visible regardless of rendering. */
function PreviewBody(props: {
  read: FilePreviewRead
  t: TranslateNS<'filePreview'>
  search?: ContentSearch
  htmlMode: 'source' | 'render' | 'script'
  scripted: boolean
  onLoaded: () => void
  iframeRef: RefObject<HTMLIFrameElement>
  frameRef: RefObject<HTMLDivElement>
  fullscreen: boolean
}) {
  const { read, t, search, htmlMode, scripted, onLoaded, iframeRef, frameRef, fullscreen } = props
  switch (read.kind) {
    case 'text': {
      const content = read.content ?? ''
      const searching = search !== undefined && search.query !== '' && search.matches.length > 0
      // HTML: the render view is a sandboxed iframe (the source view is
      // the CodeBlock below); a content search still shows the raw lines.
      if (isHtmlPath(read.path)) {
        return (
          <div className={css.previewScroll}>
            {read.truncated === true && <div className={css.notice}>{t('drawer.truncated')}</div>}
            {searching
              ? <MarkedContent content={content} search={search} />
              : htmlMode === 'source'
                ? <CodeBlock code={content} lang="html" />
                : <HtmlRenderView content={content} mode={htmlMode} scripted={scripted} t={t} onLoaded={onLoaded} iframeRef={iframeRef} frameRef={frameRef} fullscreen={fullscreen} />}
          </div>
        )
      }
      // The document-form body (structured JSON/CSV, or rendered markdown),
      // or null when the file has none — the code view then renders.
      const documentBody = searching
        ? null
        : structuredPreview(read.path, content, t)
          ?? (languageFor(read.path) === 'markdown' ? <MarkdownText text={content} /> : null)
      // The frame's format label mirrors CodeBlock's infostring: the prism
      // language when the map knows it ('markdown', 'json'), else the bare
      // extension ('csv', 'tsv').
      const dot = read.path.lastIndexOf('.')
      const documentLabel = languageFor(read.path) ?? (dot < 0 ? read.path : read.path.slice(dot + 1).toLowerCase())
      return (
        <div className={css.previewScroll}>
          {read.truncated === true && <div className={css.notice}>{t('drawer.truncated')}</div>}
          {searching
            ? <MarkedContent content={content} search={search} />
            : documentBody !== null
              ? (
                <div className={css.structured}>
                  <div className={css.structuredBanner}>
                    <span className={css.structuredInfo}>{documentLabel}</span>
                  </div>
                  <div className={css.structuredBody}>{documentBody}</div>
                </div>
              )
              : <CodeBlock code={content} lang={languageFor(read.path)} />}
        </div>
      )
    }
    case 'image':
      return (
        <div className={css.imageScroll}>
          {/* The url is populated exactly when kind is 'image' (the type allows
              undefined for the other kinds); a missing url renders no src. */}
          <img className={css.image} src={read.url} alt={read.path} />
          {read.size !== undefined && <div className={css.notice}>{read.size} B</div>}
        </div>
      )
    case 'binary':
      return <div className={css.notice}>{t('drawer.kind.binary')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'missing':
      return (
        <div className={css.notice}>
          <div>{t('drawer.kind.missing')}</div>
          <div className={css.missingPath}>{t('drawer.missingPath', { path: read.path })}</div>
        </div>
      )
    case 'too-large':
      return <div className={css.notice}>{t('drawer.kind.tooLarge')}{read.size !== undefined ? ` · ${read.size} B` : ''}</div>
    case 'error':
      return <div className={css.notice}>{read.message ?? t('drawer.kind.error')}</div>
  }
}

/**
 * One selected file's preview: the current content by default, with a change
 * history tab that steps through every recorded diff when the entry carries
 * any. The step index counts from the LATEST change (0 = most recent, the
 * default position), matching "修改记录 2/2 · 最新" reading where ◀ walks
 * older and ▶ walks newer. Keyed by the selection at the render site, so the
 * view choice resets per file.
 */
export function FilePreviewPane(props: {
  entry: FilePreviewEntry | undefined
  read: FilePreviewRead
  t: TranslateNS<'filePreview'>
}) {
  const { entry, read, t } = props
  const [view, setView] = useState<'diff' | 'content'>('content')
  // Index over `entry.diffs` (event order); 0 = the latest change, the default.
  const [diffIndex, setDiffIndex] = useState(0)
  const [contentQuery, setContentQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  // HTML files toggle between the source, the sandboxed static render, and —
  // for scripted documents, behind a one-time confirm per file — the Tier1
  // scripted sandbox; the pane is keyed by the selection at the render site,
  // so the choice resets per file. Render is the default — the document form,
  // like every other structured preview.
  const [htmlMode, setHtmlMode] = useState<'source' | 'render' | 'script'>('render')
  // The Tier1 confirm dialog is open (scripted files only; scripts never run
  // without an explicit user gesture).
  const [scriptConfirm, setScriptConfirm] = useState(false)
  // Fullscreen state of the html iframe (exit via Esc / the browser UI).
  const [fullscreen, setFullscreen] = useState(false)
  const htmlIframeRef = useRef<HTMLIFrameElement>(null)
  const htmlFrameRef = useRef<HTMLDivElement>(null)
  // Watchdog: a render that stalls suggests the source view / a browser open.
  // Armed only when it can actually stall — a large document (>256 KiB, where
  // parsing/scripting takes real time) or the scripted tier (network via CDN).
  // Small static documents render synchronously, and a blocked-script static
  // frame never fires `load` (Chrome keeps it pending), so a fixed timer there
  // would be pure noise.
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef<number | null>(null)
  const html = isHtmlPath(entry?.path ?? read.path)
  const scripted = html && read.htmlScripted === true
  const content = read.kind === 'text' ? (read.content ?? '') : null
  useEffect(() => {
    if (!html || htmlMode === 'source' || content === null) return
    const large = content.length > 256 * 1024
    if (!large && htmlMode !== 'script') return
    setSlow(false)
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => setSlow(true), 20_000)
    return () => {
      if (slowTimer.current !== null) { window.clearTimeout(slowTimer.current); slowTimer.current = null }
    }
  }, [html, htmlMode, content])
  // A successful load cancels the stall timer — the scene is fine, the timer
  // must not keep counting (a fixed 20s notice fired even after a healthy
  // load because only the state was cleared, never the timeout).
  const onHtmlLoaded = (): void => {
    setSlow(false)
    if (slowTimer.current !== null) { window.clearTimeout(slowTimer.current); slowTimer.current = null }
  }
  // Track the html iframe's fullscreen state (Esc / browser UI exits too).
  useEffect(() => {
    const onFullscreen = (): void => {
      setFullscreen(document.fullscreenElement === htmlFrameRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])
  const activeLineRef = useRef<HTMLSpanElement | null>(null)
  const diffs = entry?.diffs ?? []
  const showTabs = diffs.length > 0
  const showingDiff = showTabs && view === 'diff'
  const current = diffs[diffs.length - 1 - diffIndex]
  // The diff branch renders only when diffs is non-empty (which requires the
  // entry), so the fallback is unreachable; it keeps the type honest.
  /* v8 ignore next -- entry defined whenever its diffs are non-empty */
  const diffPath = entry?.path ?? ''

  const matches = useMemo(() => {
    const query = contentQuery.trim().toLowerCase()
    if (content === null || query === '') return []
    const hits: number[] = []
    content.split('\n').forEach((line, index) => {
      if (line.toLowerCase().includes(query)) hits.push(index)
    })
    return hits
  }, [content, contentQuery])
  const active = matches.length === 0 ? 0 : Math.min(activeMatch, matches.length - 1)
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center' })
  }, [active, contentQuery])
  const stepDiff = (delta: number): void => {
    setDiffIndex((index) => {
      const next = index + delta
      // The stepper buttons are disabled at both bounds, so a delta can never
      // leave the range; the clamps keep the index honest for direct callers.
      /* v8 ignore next -- bounds are disabled at the UI; direct callers stay in range */
      if (next < 0) return 0
      /* v8 ignore next -- bounds are disabled at the UI; direct callers stay in range */
      if (next >= diffs.length) return diffs.length - 1
      return next
    })
  }
  const stepMatch = (delta: number): void => {
    // Wrap-around: a content search cycles through its hits without ends.
    setActiveMatch(index => (index + delta + matches.length) % matches.length)
  }
  const search: ContentSearch = {
    query: contentQuery.trim(),
    matches,
    active,
    activeLineRef,
  }
  return (
    <div className={css.previewColumn}>
      {showTabs && (
        <div className={css.tabs}>
          <button
            type="button"
            className={showingDiff ? css.tab : `${css.tab} ${css.tabActive}`}
            onClick={() => { setView('content') }}
          >
            {t('drawer.tab.content')}
          </button>
          <button
            type="button"
            className={showingDiff ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => { setView('diff') }}
          >
            {t('drawer.tab.diff')}
          </button>
        </div>
      )}
      {!showingDiff && read.kind === 'text' && (
        <div className={css.contentSearch}>
          <input
            type="search"
            className={css.contentSearchInput}
            placeholder={t('preview.search.placeholder')}
            value={contentQuery}
            onChange={(event) => {
              setContentQuery(event.target.value)
              setActiveMatch(0)
            }}
            aria-label={t('preview.search.placeholder')}
          />
          {search.query !== '' && matches.length === 0 && (
            <span className={css.searchCount}>{t('preview.search.noMatch')}</span>
          )}
          {matches.length > 0 && (
            <>
              <span className={css.searchCount}>{active + 1}/{matches.length}</span>
              <button
                type="button"
                className={css.stepButton}
                onClick={() => { stepMatch(-1) }}
                aria-label={t('preview.search.prev')}
              >
                ‹
              </button>
              <button
                type="button"
                className={css.stepButton}
                onClick={() => { stepMatch(1) }}
                aria-label={t('preview.search.next')}
              >
                ›
              </button>
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
              {scripted && (
                <button
                  type="button"
                  className={htmlMode === 'script' ? `${css.htmlToggleBtn} ${css.htmlToggleActive}` : css.htmlToggleBtn}
                  onClick={() => {
                    // First click on scripted content asks for confirmation;
                    // a click while already scripted stops it (the iframe
                    // unmounts, so the artifact's loops stop with it).
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
                    // Loose null check: environments without the Fullscreen
                    // API leave fullscreenElement undefined.
                    if (document.fullscreenElement != null) { void document.exitFullscreen?.() }
                    else if (typeof frame.requestFullscreen === 'function') { void frame.requestFullscreen() }
                  }}
                >
                  <IconFullscreenOutline16 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {html && scriptConfirm && read.kind === 'text' && (
        <div className={css.scriptConfirm} role="alertdialog">
          <span>{t('preview.scriptConfirm')}</span>
          <button
            type="button"
            className={css.scriptConfirmRun}
            onClick={() => { setScriptConfirm(false); setHtmlMode('script') }}
          >
            {t('preview.scriptRun')}
          </button>
          <button
            type="button"
            className={css.scriptConfirmCancel}
            onClick={() => setScriptConfirm(false)}
          >
            {t('preview.scriptCancel')}
          </button>
        </div>
      )}
      {html && slow && htmlMode !== 'source' && read.kind === 'text' && (
        <div className={css.notice}>{t('preview.slowHint')}</div>
      )}
      {showingDiff && current !== undefined
        ? (
          <div className={css.previewScroll}>
            <div className={css.stepper}>
              <button
                type="button"
                className={css.stepButton}
                onClick={() => { stepDiff(1) }}
                disabled={diffIndex >= diffs.length - 1}
                aria-label={t('drawer.step.older')}
              >
                ◀
              </button>
              <span className={css.stepLabel}>
                {t('drawer.step.count', { current: diffs.length - diffIndex, total: diffs.length })}
                {diffIndex === 0 ? ` · ${t('drawer.step.latest')}` : ''}
                {' · '}{t('drawer.step', { turn: current.turn, step: current.step })}
              </span>
              <button
                type="button"
                className={css.stepButton}
                onClick={() => { stepDiff(-1) }}
                disabled={diffIndex <= 0}
                aria-label={t('drawer.step.newer')}
              >
                ▶
              </button>
            </div>
            <DiffBlock className={css.diffWrap} diffs={[{ path: diffPath, oldText: current.oldText, newText: current.newText }]} />
          </div>
        )
        : <PreviewBody read={read} t={t} search={search} htmlMode={htmlMode} scripted={scripted} onLoaded={onHtmlLoaded} iframeRef={htmlIframeRef} frameRef={htmlFrameRef} fullscreen={fullscreen} />}
    </div>
  )
}
