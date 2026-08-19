/** Shared preview pane: the file's current content by default, with a
 * change-history tab that steps through every recorded write/edit diff. Used
 * by both the file view tab and the link-click drawer. */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { FilePreviewEntry, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import { CodeBlock, DiffBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { languageFor } from './path-utils.ts'
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

/** Render one classified read; text carries a syntax-highlighted CodeBlock,
 * except markdown files, which render through the official MarkdownText
 * pipeline (the same renderer the chat uses — headings, tables, emphasis,
 * links, images, footnotes, math) so the preview reads like the document, not
 * its source. A content search switches any text read to the raw marked-lines
 * view so matches stay visible regardless of rendering. */
function PreviewBody(props: { read: FilePreviewRead; t: TranslateNS<'filePreview'>; search?: ContentSearch }) {
  const { read, t, search } = props
  switch (read.kind) {
    case 'text': {
      const content = read.content ?? ''
      const markdown = languageFor(read.path) === 'markdown'
      return (
        <div className={css.previewScroll}>
          {read.truncated === true && <div className={css.notice}>{t('drawer.truncated')}</div>}
          {search !== undefined && search.query !== '' && search.matches.length > 0
            ? <MarkedContent content={content} search={search} />
            : markdown
              ? <MarkdownText text={content} />
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
  const activeLineRef = useRef<HTMLSpanElement | null>(null)
  const diffs = entry?.diffs ?? []
  const showTabs = diffs.length > 0
  const showingDiff = showTabs && view === 'diff'
  const current = diffs[diffs.length - 1 - diffIndex]
  // The diff branch renders only when diffs is non-empty (which requires the
  // entry), so the fallback is unreachable; it keeps the type honest.
  /* v8 ignore next -- entry defined whenever its diffs are non-empty */
  const diffPath = entry?.path ?? ''

  const content = read.kind === 'text' ? (read.content ?? '') : null
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
        </div>
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
        : <PreviewBody read={read} t={t} search={search} />}
    </div>
  )
}
