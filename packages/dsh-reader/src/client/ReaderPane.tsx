/**
 * The inspiration space: the right-Sidebar tab body.
 *
 * It is the only React surface this package ships, and it owns the whole
 * interaction the design settled on:
 *
 * - **the wall** — one card per entry, with a search box, an all/today filter,
 *   an unread-only toggle and a sort menu. All four are local predicates over
 *   entries this process parsed (design decision D14), so none of them costs a
 *   round trip.
 * - **the detail view** — clicking a card opens it. This is the whole point:
 *   the body renders as DOM text, which is what makes passage quoting work
 *   (the QUOTE plugin's own selection menu sees it), and it is why the pane
 *   never hosts a sandboxed iframe.
 * - **the add dialog** — an overlay in the members-tab idiom, because adding is
 *   a momentary act and the wall should stay where it was behind it. The host
 *   decides whether a pasted URL is a feed or an article from what comes back
 *   (D15); this surface reports the verdict, plus the fetch seam's own words
 *   when the fetch failed.
 * - **the subscription page** — every source with its schedule, its pause
 *   switch and its last-fetch status. It exists because "why am I not seeing
 *   anything" and "stop refreshing this one" are questions about SOURCES, and
 *   neither belongs on the wall.
 *
 * The browser has no XML parser on the host side to lean on, so the pane parses
 * payloads itself through `parse-rss` / `extract-article`.
 *
 * @module @khorsheed/dsh-reader/client/ReaderPane
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { absoluteDate, clockOf, formatReaderRef, mergedDraft, provenanceOf, relativeWhen } from './quote.ts'
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
  const view = useStore(s => s.view)
  const filter = useStore(s => s.filter)
  const query = useStore(s => s.query)
  const unreadOnly = useStore(s => s.unreadOnly)
  const sort = useStore(s => s.sort)
  const read = useStore(s => s.read)
  const lastRefreshAt = useStore(s => s.lastRefreshAt)
  const nextRefreshAt = useStore(s => s.nextRefreshAt)
  const refreshing = useStore(s => s.refreshing)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)

  const [addOpen, setAddOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [verdict, setVerdict] = useState<{ kind: Verdict; label?: string; reason?: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [sideChatAvailable, setSideChatAvailable] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState<string>('10:00')

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
      if (!result.ok) return
      setSideChatAvailable(result.value.hasSideChat)
      actions.setSchedule(result.value.lastRefreshAt, result.value.nextRefreshAt)
      if (result.value.nextRefreshAt !== undefined) setTimeOfDay(clockOf(result.value.nextRefreshAt))
    })
  }, [actions, props, rev])

  /**
   * Fetch every enabled source now, then reload the wall.
   *
   * The reload is the point: a refresh that only replaced the host's stored
   * payloads and never re-read them looked like a dead button on the
   * acceptance instance, even though the fetch itself had succeeded.
   */
  const refreshAll = useCallback(async () => {
    actions.setRefreshing(true)
    try {
      const result = await props.refresh()
      actions.noteRefreshed(new Date().toISOString())
      if (!result.ok) actions.setError(result.error.message)
      else actions.refresh()
    } finally {
      actions.setRefreshing(false)
    }
  }, [actions, props])

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
    actions.setView('detail')
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
      // A transport-level failure: the host never answered, so the reason is
      // whatever the wire layer said.
      setVerdict({ kind: 'fetchFailed', reason: result.error.message })
      return
    }
    const value = result.value
    if (typeof value === 'string') {
      setVerdict({ kind: verdictForRefusal(value) })
      return
    }
    if (value.outcome === 'fetch-failed') {
      // The fetch failed with a reason of its own ("connect ECONNREFUSED …",
      // "body over the seam's byte cap"). Showing it is the difference between
      // a retry and a report nobody can act on.
      setVerdict({ kind: 'fetchFailed', reason: value.reason })
      return
    }
    setVerdict({
      kind: value.outcome === 'subscribed' ? 'subscribed' : 'savedLink',
      label: value.label,
    })
    setDraftUrl('')
    // Reload so the new entry is on the wall behind the dialog, not only in
    // the host's state.
    actions.refresh()
  }, [actions, draftUrl, props])

  /** Re-fetch one source from the subscription page. */
  const refreshOne = useCallback(async (id: string) => {
    actions.setRefreshing(true)
    try {
      const result = await props.refresh([id])
      if (!result.ok) actions.setError(result.error.message)
      else actions.refresh()
    } finally {
      actions.setRefreshing(false)
    }
  }, [actions, props])

  /** Pause or resume one source from the subscription page. */
  const toggleSource = useCallback(async (id: string, enabled: boolean) => {
    const result = await props.updateSource({ id, enabled })
    if (result.ok) actions.refresh()
  }, [actions, props])

  /** Drop one source (and everything it brought) from the subscription page. */
  const removeSource = useCallback(async (id: string) => {
    const result = await props.removeSource(id)
    if (result.ok) {
      actions.clearParsed()
      actions.refresh()
    }
  }, [actions, props])

  /** Move the daily refresh time. */
  const setRefreshTime = useCallback(async (value: string) => {
    setTimeOfDay(value)
    // The host reports `invalid-time` for anything it cannot parse, and the
    // input is a native time field, so a bad value only comes from a manual
    // edit; keep the field's value and let the next handshake correct it.
    await props.updateSource({ id: '', timeOfDay: value })
    actions.refresh()
  }, [actions, props])

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

  /**
   * The pane's header.
   *
   * @param back - true on a page that left the wall (detail, subscriptions),
   *   which needs the way back. The wall itself shows none — there is nothing
   *   behind it.
   */
  const header = (back: boolean): ReactNode => (
    <div className={css.head}>
      {back && (
        <button
          type="button"
          className={css.tool}
          title={t('action.back')}
          onClick={() => { actions.setView('list'); actions.closeEntry() }}
        >
          <IconChevronLeftOutline14 size={14} />
        </button>
      )}
      <span className={css.headTitle}>
        <IconGlobeOutline14 size={14} />
        {t('tab.label')}
        <span className={css.count} title={t('filter.unreadOnly')}>
          {countUnread(rows)} {t('foot.unread')}
        </span>
      </span>
      <button
        type="button"
        className={`${css.tool} ${refreshing ? css.toolSpinning : ''}`}
        title={t('action.refresh')}
        disabled={refreshing}
        onClick={() => { void refreshAll() }}
      >
        <IconRefreshOutline16 size={15} />
      </button>
      <button
        type="button"
        className={css.tool}
        title={t('action.manage')}
        onClick={() => { actions.closeEntry(); actions.setView('manage') }}
      >
        {glyph('filter', 15)}
      </button>
      <button
        type="button"
        className={css.tool}
        title={t('action.add')}
        onClick={() => { setAddOpen(true); setVerdict(null) }}
      >
        <IconPlusOutline16 size={15} />
      </button>
    </div>
  )

  /** The add dialog: overlay + centered card, Esc and overlay-click close. */
  const dialog = addOpen && (
    <div
      className={css.overlay}
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget) setAddOpen(false) }}
    >
      <div
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('add.title')}
        onKeyDown={event => { if (event.key === 'Escape') setAddOpen(false) }}
      >
        <h2>{t('add.title')}</h2>
        <p>{t('add.help')}</p>
        <input
          autoFocus
          value={draftUrl}
          placeholder={t('add.placeholder')}
          onChange={event => setDraftUrl(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void submit() }}
        />
        {verdict !== null && (
          <div className={css.verdict}>
            <b>{t(VERDICT_KEY[verdict.kind], verdict.label === undefined ? {} : { label: verdict.label })}</b>
            {/* The seam's own words, when the fetch failed. Without them the
                reader has a verdict and no diagnosis. */}
            {verdict.reason !== undefined && (
              <span className={css.verdictReason}>{verdict.reason}</span>
            )}
          </div>
        )}
        <div className={css.dialogActions}>
          <button type="button" className={css.ghost} onClick={() => setAddOpen(false)}>
            {verdict !== null && (verdict.kind === 'subscribed' || verdict.kind === 'savedLink')
              ? t('action.done')
              : t('action.cancel')}
          </button>
          <button type="button" className={css.submit} onClick={() => { void submit() }}>
            {t('action.submit')}
          </button>
        </div>
      </div>
    </div>
  )

  /* ------------------------------------------------------------- detail view */

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
            onClick={() => { actions.setView('list'); actions.closeEntry() }}
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

        <div className={css.detailBody}>
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

  /* ------------------------------------------------------ subscriptions page */

  if (view === 'manage') {
    return (
      <div className={css.root}>
        <div className={css.bar}>
          <button
            type="button"
            className={css.tool}
            title={t('action.back')}
            onClick={() => actions.setView('list')}
          >
            <IconChevronLeftOutline14 size={14} />
          </button>
          <span className={css.barLabel}>{t('sources.title')}</span>
          <span className={css.spacer} />
          <button type="button" className={css.tool} title={t('action.add')} onClick={() => setAddOpen(true)}>
            <IconPlusOutline16 size={15} />
          </button>
        </div>
        <div className={css.paneBody}>
          <p className={css.help}>{t('sources.help')}</p>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="reader-refresh-time">{t('sources.time')}</label>
            <input
              id="reader-refresh-time"
              className={css.timeInput}
              type="time"
              value={timeOfDay}
              onChange={event => { void setRefreshTime(event.target.value) }}
            />
            <span className={css.help}>{t('sources.timeHelp')}</span>
          </div>
          {sources.length === 0
            ? <div className={css.state}>{t('sources.empty')}</div>
            : (
              <div className={css.sourceList}>
                {sources.map(source => {
                  const group = parsed[source.id]
                  const failed = source.status === 'error'
                  const when = relativeWhen(source.fetchedAt, new Date())
                  return (
                    <div key={source.id} className={css.sourceRow}>
                      <span className={css.tile} style={{ background: hueForSource(source.label) }}>
                        {tileForSource(source.label)}
                      </span>
                      <span className={css.sourceInfo}>
                        <span className={css.sourceName}>{source.label}</span>
                        <span className={css.sourceMeta}>
                          {source.kind === 'rss' ? t('sources.items', { count: group?.entries.length ?? 0 }) : t('tab.subtitle')}
                          {' · '}
                          {source.fetchedAt === undefined
                            ? t('sources.never')
                            : t('foot.refreshedAt', { when: t(when.key, when.count === undefined ? {} : { count: when.count }) })}
                          {' · '}
                          {source.enabled ? t('sources.enabled') : t('sources.disabled')}
                          {failed && <> {' · '}<span className={css.sourceFailed}>{t('sources.failed')}</span></>}
                        </span>
                        {failed && source.error !== undefined && (
                          <span className={css.sourceError}>{source.error}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={css.rowAction}
                        title={t('action.refreshOne')}
                        onClick={() => { void refreshOne(source.id) }}
                      >
                        <IconRefreshOutline16 size={14} />
                      </button>
                      <button
                        type="button"
                        className={css.rowAction}
                        onClick={() => { void toggleSource(source.id, !source.enabled) }}
                      >
                        {source.enabled ? t('sources.disabled') : t('sources.enabled')}
                      </button>
                      <button
                        type="button"
                        className={css.rowActionDanger}
                        onClick={() => { void removeSource(source.id) }}
                      >
                        {t('action.remove')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
        {dialog}
      </div>
    )
  }

  /* ------------------------------------------------------------------- wall */

  return (
    <div className={css.root}>
      {header(false)}

      {/* The tool row doubles as the answer to "why is this list empty?": the
          filter and the unread toggle are the two things that hide entries, so
          both stay visible as labelled controls rather than bare icons. */}
      <div className={css.tools}>
        <div className={css.search}>
          {glyph('search', 12)}
          <input
            value={query}
            placeholder={t('search.placeholder')}
            onChange={event => actions.setQuery(event.target.value)}
          />
        </div>
        <div className={css.segmented}>
          {(['all', 'today'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={filter === option ? css.segmentOn : css.segment}
              onClick={() => actions.setFilter(option)}
            >
              {t(`filter.${option}`)}
            </button>
          ))}
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
          // The empty state is the members tab's trailing dashed card, alone:
          // adding is the one thing to do here, so the card IS the action.
          <div className={css.sourceGrid}>
            <button
              type="button"
              className={css.emptyCard}
              onClick={() => { setAddOpen(true); setVerdict(null) }}
            >
              <span className={css.emptyTitle}>{t('state.emptyTitle')}</span>
              <span className={css.emptyBody}>{t('state.emptyBody')}</span>
            </button>
          </div>
        )}
        {!loading && sources.length > 0 && (
          <div className={css.sourceGrid}>
            {sources.map(source => {
              const group = parsed[source.id]
              const failed = source.status === 'error'
              return (
                <button
                  key={source.id}
                  type="button"
                  className={css.sourceCard}
                  // Clicking a source card searches for it: the cheap way to
                  // answer "what did this source bring me".
                  onClick={() => actions.setQuery(query === source.label ? '' : source.label)}
                >
                  <span className={css.tile} style={{ background: hueForSource(source.label) }}>
                    {tileForSource(source.label)}
                  </span>
                  <span className={css.sourceInfo}>
                    {/* The prefix is not decoration: without it a source card
                        and an entry card from that source share an accessible
                        name ("Hacker News"), which is ambiguous to a screen
                        reader and to every query in the tests. */}
                    <span className={css.sourceName}>{t('sources.cardHint')} · {source.label}</span>
                    <span className={css.sourceMeta}>
                      {source.kind === 'rss'
                        ? t('sources.items', { count: group?.entries.length ?? 0 })
                        : t('tab.subtitle')}
                      {failed && <> {' · '}<span className={css.sourceFailed}>{t('sources.failed')}</span></>}
                    </span>
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              className={css.addCard}
              onClick={() => { setAddOpen(true); setVerdict(null) }}
            >
              <IconPlusOutline16 size={15} />
              <span>{t('action.add')}</span>
            </button>
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

      {/* The snapshot's age. A reader deciding whether to press refresh needs
          to know how stale this copy is, and a refresh really does go back to
          the network — every enabled source is re-fetched. */}
      {sources.length > 0 && (() => {
        const when = relativeWhen(lastRefreshAt ?? undefined, new Date())
        return (
          <div className={css.metaBar}>
            <span>
              {refreshing
                ? t('foot.refreshing')
                : lastRefreshAt === null
                  ? t('foot.never')
                  : t('foot.refreshedAt', { when: t(when.key, when.count === undefined ? {} : { count: when.count }) })}
            </span>
            {nextRefreshAt !== null && (
              <>
                <span className={css.sep}>·</span>
                <span>{t('foot.scheduled', { time: clockOf(nextRefreshAt) })}</span>
              </>
            )}
          </div>
        )
      })()}
      {dialog}
    </div>
  )
}
