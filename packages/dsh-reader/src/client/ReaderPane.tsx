/**
 * The reader pane: the right-Sidebar tab body.
 *
 * It is the only React surface this package ships, and it owns the whole
 * interaction the design settled on:
 *
 * - **the list** — one card per entry, with a search box, an unread-only
 *   toggle and a sort menu. All three are local predicates over entries this
 *   process parsed (design decision D14), so none of them costs a round trip.
 * - **the detail view** — clicking a card opens it. This is the reader's whole
 *   point: the body renders as DOM text, which is what makes passage quoting
 *   work (the QUOTE plugin's own selection menu sees it), and it is why the
 *   pane never hosts a sandboxed iframe.
 * - **the add form** — the host decides whether a pasted URL is a feed or an
 *   article from what comes back (D15); this surface only reports the verdict.
 *
 * The browser has no XML parser on the host side to lean on, so the pane parses
 * payloads itself through `parse-rss` / `extract-article`.
 *
 * @module @khorsheed/dsh-reader/client/ReaderPane
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronLeftOutline14,
  IconCopyOutline16,
  IconGlobeOutline14,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReaderPaneProps } from './contract.ts'
import { extractArticle } from './extract-article.ts'
import { parseFeed } from './parse-rss.ts'
import { absoluteDate, formatReaderRef, mergedDraft, provenanceOf, relativeWhen } from './quote.ts'
import {
  countUnread,
  flattenEntries,
  hueForSource,
  selectRows,
  tileForSource,
  type ReaderRow,
  type SourcePresentation,
} from './selectors.ts'
import css from './ReaderPane.module.css'

/** The view the pane is showing. */
type View = 'list' | 'add' | 'detail'

/** One in-flight fetch's kind, for the verdict message. */
type Verdict = 'subscribed' | 'savedLink' | 'duplicate' | 'invalidUrl' | 'unsupportedContent' | 'fetchFailed'

/** A tiny stroke glyph set for the chrome the host has no icon for. */
const STROKE: Readonly<Record<string, string>> = {
  search: 'M7 2.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm3.4 8.2 3 3',
  filter: 'M2.6 3.4h10.8L9.2 8.3v4.1l-2.4-1.3V8.3z',
  sort: 'M4.6 3v10M2.4 10.8 4.6 13l2.2-2.2M11.4 13V3M9.2 5.2 11.4 3l2.2 2.2',
  chevron: 'M6.2 3.4 10.7 8l-4.5 4.6',
}

/** Render one of the small stroke glyphs. */
function glyph(name: keyof typeof STROKE & string, size = 15): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STROKE[name]} />
    </svg>
  )
}

/**
 * Whether the body's dominant script is CJK. The article typography differs by
 * script (line height, letter spacing and measure — see the design's D5), and
 * the script is a property of the TEXT, not of the source it came from.
 *
 * @param html - the normalized article markup.
 * @returns true when the body reads mostly as Han/Kana/Hangul.
 */
function isCjk(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, '')
  if (text.length === 0) return false
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
  return (cjk?.length ?? 0) / text.length > 0.2
}

/** The dictionary key each verdict message lives under. */
const VERDICT_KEY: Readonly<Record<Verdict, 'verdict.subscribed' | 'verdict.savedLink' | 'verdict.duplicate' | 'verdict.invalidUrl' | 'verdict.unsupportedContent' | 'verdict.fetchFailed'>> = {
  subscribed: 'verdict.subscribed',
  savedLink: 'verdict.savedLink',
  duplicate: 'verdict.duplicate',
  invalidUrl: 'verdict.invalidUrl',
  unsupportedContent: 'verdict.unsupportedContent',
  fetchFailed: 'verdict.fetchFailed',
}

/** Map an `addSource` refusal onto its verdict message. */
function verdictForRefusal(refusal: string): Verdict {
  switch (refusal) {
    case 'duplicate': return 'duplicate'
    case 'invalid-url': return 'invalidUrl'
    case 'unsupported-content': return 'unsupportedContent'
    default: return 'fetchFailed'
  }
}

/** The reader tab body. */
export function ReaderPane(props: ReaderPaneProps): ReactNode {
  const { sessionId, useStore, actions, t } = props
  const sources = useStore(s => s.sources)
  const parsed = useStore(s => s.parsed)
  const articleHtml = useStore(s => s.articleHtml)
  const articleTruncated = useStore(s => s.articleTruncated)
  const articleError = useStore(s => s.articleError)
  const openEntryId = useStore(s => s.openEntryId)
  const filter = useStore(s => s.filter)
  const query = useStore(s => s.query)
  const unreadOnly = useStore(s => s.unreadOnly)
  const sort = useStore(s => s.sort)
  const read = useStore(s => s.read)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)

  const [view, setView] = useState<View>('list')
  const [sortOpen, setSortOpen] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [verdict, setVerdict] = useState<{ kind: Verdict; label?: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [sideChatAvailable, setSideChatAvailable] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /** Load the source list and parse whatever payloads the host is holding. */
  const load = useCallback(async () => {
    actions.setLoading(true)
    try {
      const listed = await props.listSources()
      if (!listed.ok) {
        actions.setError(listed.error.message)
        return
      }
      const known = listed.value.sources
      actions.setSources(known)
      const withBody = known.filter(source => source.hasBody)
      if (withBody.length === 0) return
      const bodies = await props.getBodies(withBody.map(source => source.id))
      if (!bodies.ok) {
        actions.setError(bodies.error.message)
        return
      }
      for (const body of bodies.value.bodies) {
        const source = known.find(item => item.id === body.id)
        if (source === undefined) continue
        // `truncated` is a property of the FETCH, not of the payload: the host
        // seam caps a body at its size limit and says so on the envelope. It
        // has to be carried onto the parsed entry here, because that flag is
        // what the detail view's "content shown in part" note reads — and a
        // source whose payload never arrived still needs the entry, or the
        // detail view would show a blank page instead of the reason.
        const cut = body.truncated === true
        if (body.raw === undefined) {
          if (source.kind === 'rss') {
            actions.setParsed({ id: source.id, entries: [], error: body.error ?? t('detail.extractFailed') })
          } else {
            actions.setParsed({
              id: source.id,
              entries: [{
                id: `link:${source.id}`,
                sourceId: source.id,
                title: source.label,
                link: source.url,
                // No payload at all: whatever the detail view can show is
                // partial by definition, so it says so instead of pretending.
                truncated: true,
              }],
              error: body.error ?? t('detail.extractFailed'),
            })
          }
          continue
        }
        // A feed is parsed as a feed; a saved link is its own single entry,
        // extracted here so opening it is instant (D7).
        if (source.kind === 'rss') {
          const result = parseFeed(body.raw, source.id)
          actions.setParsed(result.ok
            ? { id: source.id, entries: result.feed.entries.map(entry => cut ? { ...entry, truncated: true } : entry) }
            : { id: source.id, entries: [], error: result.error })
        } else {
          const extracted = extractArticle(body.raw, source.url)
          actions.setParsed({
            id: source.id,
            entries: [{
              id: `link:${source.id}`,
              sourceId: source.id,
              title: source.label,
              link: source.url,
              ...(extracted.ok ? { contentHtml: extracted.html } : {}),
              // Incompleteness comes from the FETCH, not from extraction: the
              // seam truncated the page, so whatever we extracted is partial.
              ...(cut ? { truncated: true } : {}),
            }],
          })
        }
      }
    } finally {
      actions.setLoading(false)
    }
  }, [actions, props, t])

  useEffect(() => { void load() }, [load, rev])

  useEffect(() => {
    void props.capabilities().then(result => {
      if (result.ok) setSideChatAvailable(result.value.hasSideChat)
    })
  }, [props])

  const presentation = useMemo(() => {
    const map = new Map<string, SourcePresentation>()
    for (const source of sources) {
      map.set(source.id, {
        id: source.id,
        label: source.label,
        tile: tileForSource(source.label),
        hue: hueForSource(source.label),
      })
    }
    return map
  }, [sources])

  const allEntries = useMemo(() => flattenEntries(parsed), [parsed])
  const rows = useMemo(() => selectRows(allEntries, presentation, {
    filter, query, unreadOnly, sort, read, now: new Date(),
  }), [allEntries, presentation, filter, query, unreadOnly, sort, read])

  const openEntry = openEntryId === null ? undefined : allEntries.find(entry => entry.id === openEntryId)

  /** Open one entry: mark it read and make sure a body is available. */
  const open = useCallback(async (row: ReaderRow) => {
    actions.openEntry(row.entry.id, row.sourceId)
    setView('detail')
    if (row.entry.contentHtml !== undefined) {
      actions.setArticle(row.entry.contentHtml, row.entry.truncated === true, null)
      return
    }
    const bodies = await props.getBodies([row.sourceId])
    if (!bodies.ok) {
      actions.setArticle('', false, bodies.error.message)
      return
    }
    const body = bodies.value.bodies[0]
    if (body?.raw === undefined) {
      actions.setArticle('', false, body?.error ?? t('detail.extractFailed'))
      return
    }
    const truncated = body.truncated === true
    const extracted = extractArticle(body.raw, row.entry.link ?? '')
    if (extracted.ok) actions.setArticle(extracted.html, truncated, null)
    else actions.setArticle('', truncated, extracted.error)
  }, [actions, props, t])

  /** Submit the add form and report the host's verdict. */
  const submit = useCallback(async () => {
    const url = draftUrl.trim()
    if (url.length === 0) return
    setVerdict(null)
    const result = await props.addSource(url)
    if (!result.ok) {
      setVerdict({ kind: 'fetchFailed' })
      return
    }
    const value = result.value
    if (typeof value === 'string') {
      setVerdict({ kind: verdictForRefusal(value) })
      return
    }
    setVerdict({
      kind: value.outcome === 'subscribed' ? 'subscribed' : 'savedLink',
      label: value.label,
    })
    setDraftUrl('')
    actions.refresh()
  }, [actions, draftUrl, props])

  /** Quote the open entry (or a selection) into the conversation draft. */
  const quote = useCallback((explicit?: string) => {
    if (openEntry === undefined) return
    const selection = explicit ?? window.getSelection()?.toString() ?? ''
    const source = presentation.get(openEntry.sourceId)
    const block = formatReaderRef(selection, provenanceOf(openEntry, {
      label: source?.label ?? openEntry.title,
    }))
    const next = mergedDraft(props.readDraft(), block)
    props.setDraft(next)
    setDraft(next)
  }, [openEntry, presentation, props])

  const copyLink = useCallback(async () => {
    if (openEntry?.link === undefined) return
    await props.copyText(openEntry.link)
  }, [openEntry, props])

  /* ------------------------------------------------------------------ render */

  const header = (
    <div className={css.head}>
      <span className={css.headTitle}>
        <IconGlobeOutline14 size={14} />
        {t('tab.label')}
        <span className={css.count}>{countUnread(rows)} {t('filter.unreadOnly')}</span>
      </span>
      <button type="button" className={css.tool} title={t('action.refresh')} onClick={() => actions.refresh()}>
        <IconRefreshOutline16 size={15} />
      </button>
      <button
        type="button"
        className={css.tool}
        title={t('action.add')}
        onClick={() => { setView('add'); setVerdict(null) }}
      >
        <IconPlusOutline16 size={15} />
      </button>
    </div>
  )

  if (view === 'detail' && openEntry !== undefined) {
    const source = presentation.get(openEntry.sourceId)
    const when = relativeWhen(openEntry.publishedAt, new Date())
    const date = absoluteDate(openEntry.publishedAt)
    const alsoFrom = allEntries
      .filter(entry => entry.sourceId === openEntry.sourceId && entry.id !== openEntry.id)
      .slice(0, 3)
    return (
      <div className={css.root}>
        <div className={css.bar}>
          <button
            type="button"
            className={css.tool}
            title={t('action.back')}
            onClick={() => { setView('list'); actions.closeEntry() }}
          >
            <IconChevronLeftOutline14 size={14} />
          </button>
          <span className={css.barLabel}>{openEntry.title}</span>
          <span className={css.spacer} />
          <button type="button" className={css.tool} title={t('action.copyLink')} onClick={() => { void copyLink() }}>
            <IconCopyOutline16 size={15} />
          </button>
          <button
            type="button"
            className={css.tool}
            title={t('action.openExternal')}
            onClick={() => { if (openEntry.link !== undefined) props.openExternal(openEntry.link) }}
          >
            <IconRightUpOutline16 size={15} />
          </button>
        </div>

        <div className={css.detailBody} ref={bodyRef}>
          <div className={css.kicker}>
            <span className={css.tile} style={{ background: source?.hue }}>{source?.tile}</span>
            <span>{source?.label}</span>
            <span className={css.sep}>·</span>
            <span>{date ?? t(when.key, when.count === undefined ? {} : { count: when.count })}</span>
            {openEntry.author !== undefined && (<><span className={css.sep}>·</span><span>{openEntry.author}</span></>)}
          </div>
          <h1 className={css.detailTitle}>{openEntry.title}</h1>
          {(openEntry.tags ?? []).length > 0 && (
            <div className={css.tagRow}>
              {(openEntry.tags ?? []).map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
            </div>
          )}
          <div className={css.rule} />
          {articleError !== null && (
            <p className={css.incomplete}>{t('detail.extractFailed')}</p>
          )}
          {articleHtml !== null && articleHtml.length > 0 && (
            <div
              // The markup is the output of this package's own whitelist
              // normalizer (`extract-article`): scripts, styles, forms, iframes
              // and event attributes are already gone, and every URL that
              // survives has been scheme-checked. Re-sanitizing here would mean
              // a second implementation of the same policy.
              className={`${css.article} ${isCjk(articleHtml) ? css.articleZh : css.articleEn}`}
              dangerouslySetInnerHTML={{ __html: articleHtml }}
            />
          )}
          {/* One line, at the end, only when the body is known to be partial. */}
          {(articleTruncated || openEntry.truncated === true) && (
            <p className={css.incomplete}>
              {t('detail.incomplete')} —{' '}
              <button
                type="button"
                className={css.incompleteLink}
                onClick={() => { if (openEntry.link !== undefined) props.openExternal(openEntry.link) }}
              >
                {t('detail.readOriginal')}
              </button>
            </p>
          )}
          {alsoFrom.length > 0 && (
            <div className={css.alsoFrom}>
              <div className={css.alsoFromLabel}>{t('detail.alsoFrom')}</div>
              {alsoFrom.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  className={css.alsoFromRow}
                  onClick={() => {
                    void open({
                      entry,
                      sourceId: entry.sourceId,
                      sourceLabel: source?.label ?? '',
                      sourceTile: source?.tile ?? '·',
                      sourceHue: source?.hue ?? '',
                      unread: read[entry.id] !== true,
                    })
                  }}
                >
                  <span className={css.alsoFromTitle}>{entry.title}</span>
                  <span className={css.when}>
                    {t(relativeWhen(entry.publishedAt, new Date()).key)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={css.composer}>
          <div className={css.composerLabel}>{t('detail.composerLabel')}</div>
          <div className={`${css.composerText} ${draft.length === 0 ? css.composerEmpty : ''}`}>
            {draft.length === 0 ? t('detail.composerEmpty') : draft}
          </div>
        </div>
        <div className={css.foot}>
          <button type="button" className={css.incompleteLink} onClick={() => quote()}>
            {t('action.quote')}
          </button>
          {sideChatAvailable && openEntry.link !== undefined && (
            <button
              type="button"
              className={css.incompleteLink}
              onClick={() => {
                void props.quoteToSideChat({
                  contextKey: sessionId,
                  label: openEntry.title,
                  text: formatReaderRef('', provenanceOf(openEntry, { label: source?.label ?? '' })),
                })
              }}
            >
              {t('quote.toSideChat')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (view === 'add') {
    return (
      <div className={css.root}>
        {header}
        <div className={css.add}>
          <h2>{t('add.title')}</h2>
          <p>{t('add.help')}</p>
          <input
            value={draftUrl}
            placeholder={t('add.placeholder')}
            onChange={event => setDraftUrl(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void submit() }}
          />
          <button type="button" className={css.submit} onClick={() => { void submit() }}>
            {t('action.submit')}
          </button>
          {verdict !== null && (
            <div className={css.verdict}>
              <b>{t(VERDICT_KEY[verdict.kind], verdict.label === undefined ? {} : { label: verdict.label })}</b>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      {header}
      <div className={css.tools}>
        <div className={css.search}>
          {glyph('search', 12)}
          <input
            value={query}
            placeholder={t('search.placeholder')}
            onChange={event => actions.setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`${css.tool} ${unreadOnly ? css.toolOn : ''}`}
          title={t('filter.unreadOnly')}
          onClick={() => actions.toggleUnreadOnly()}
        >
          {glyph('filter', 15)}
        </button>
        <button
          type="button"
          className={`${css.tool} ${sort === 'newest' ? '' : css.toolOn}`}
          title={t('sort.title')}
          onClick={() => setSortOpen(open => !open)}
        >
          {glyph('sort', 15)}
        </button>
      </div>
      {sortOpen && (
        <div className={css.menu}>
          {(['newest', 'oldest', 'source'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => { actions.setSort(option); setSortOpen(false) }}
            >
              <span>{t(`sort.${option}`)}</span>
              {sort === option && <span className={css.check}>✓</span>}
            </button>
          ))}
        </div>
      )}

      <div className={css.scroll}>
        {loading && <div className={css.state}>{t('state.loading')}</div>}
        {!loading && error !== null && <div className={css.state}><b>{t('state.error')}</b>{error}</div>}
        {!loading && error === null && sources.length === 0 && (
          <div className={css.state}>
            <b>{t('state.emptyTitle')}</b>
            {t('state.emptyBody')}
          </div>
        )}
        {!loading && sources.length > 0 && rows.length === 0 && (
          <div className={css.state}>{t('state.noMatch', { query })}</div>
        )}
        {!loading && rows.length > 0 && (
          <div className={css.list}>
            {rows.map(row => (
              <button key={row.entry.id} type="button" className={css.card} onClick={() => { void open(row) }}>
                <span className={css.tileWrap}>
                  <span className={css.tile} style={{ background: row.sourceHue }}>{row.sourceTile}</span>
                  {row.unread && <span className={css.unread} />}
                </span>
                <span className={css.meta}>
                  <span className={css.source}>{row.sourceLabel}</span>
                  <span className={css.sep}>·</span>
                  <span className={css.when}>
                    {t(relativeWhen(row.entry.publishedAt, new Date()).key)}
                  </span>
                </span>
                <span className={css.title}>{row.entry.title}</span>
                {row.entry.summary !== undefined && <span className={css.summary}>{row.entry.summary}</span>}
                <span className={css.tags}>
                  {(row.entry.tags ?? []).slice(0, 2).map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
                  {row.entry.author !== undefined && <span className={css.author}>{row.entry.author}</span>}
                </span>
                <span className={css.chevron}>{glyph('chevron', 13)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
