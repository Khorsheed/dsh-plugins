// @vitest-environment jsdom
/**
 * The reader pane, rendered.
 *
 * This file exists for one specific accident: the package this one replaces
 * shipped a pane whose component returned `null` on every path, so the tab
 * type registered, the seat opened, and the user saw an empty column. Every
 * assertion here therefore starts from "something is on screen" — an empty
 * state, a card, a detail body — rather than from a returned value, because a
 * component that returns nothing passes a unit test of its own helpers and
 * fails a user.
 *
 * The host face is scripted at the payload level, not at the parsed level: the
 * pane really parses what the host sends, so a change in the wire contract or
 * in the parsers shows up here as a missing card rather than as a green test.
 * The two surfaces the design makes load-bearing get their own blocks:
 * pointing (option B: a card click opens the detail, and only the detail's own
 * buttons reach the browser) and the incomplete-body note (the fetch cap
 * truncates silently, so the reader must be told the text stops early).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReaderPaneProps } from '../src/client/contract.ts'
import { createReaderStore, type ReaderState } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { ReaderPane } from '../src/client/ReaderPane.tsx'
import { UNIT_SEPARATOR } from '../src/client/translate.ts'
import type { ReaderBody, ReaderSourceSummary } from '../src/types.ts'

/** A translate over the zh dictionary: its key set is the source of truth. */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as ReaderPaneProps['t']

/** The verdicts the host's `addSource` can answer with. */
type AddAnswer = { ok: true; value: unknown } | { ok: false; error: { message: string } }

/** One item for the feed fixture. */
interface FeedItem {
  readonly title: string
  /** The feed's short summary (its `<description>`). */
  readonly description?: string
  /** The feed's full text (its `<content:encoded>`), when it publishes one. */
  readonly body?: string
  readonly publishedAt?: string
}

/** A source as the host reports it, with every field the pane reads. */
function rssSource(id: string, over: Partial<ReaderSourceSummary> = {}): ReaderSourceSummary {
  return { id, kind: 'rss', url: `https://example.com/${id}.xml`, label: id, enabled: true, hasBody: true, ...over }
}

/**
 * A real RSS 2.0 document, published today so the pane's default `today`
 * filter keeps its items. Entries carry a `description`, which the parser
 * treats as the body when the feed publishes no `content:encoded` — that is
 * the common case and it keeps the detail view off the network.
 */
function feed(id: string, items: readonly FeedItem[]): string {
  const published = new Date().toISOString()
  const entries = items.map(item => `<item>
    <title>${item.title}</title>
    <link>https://example.com/${id}/${encodeURIComponent(item.title)}</link>
    <pubDate>${item.publishedAt ?? published}</pubDate>
    <description>${item.description ?? `摘要：${item.title}`}</description>
    ${item.body === undefined ? '' : `<content:encoded><![CDATA[${item.body}]]></content:encoded>`}
  </item>`).join('')
  // The namespace declaration is not decoration: `<content:encoded>` with no
  // `xmlns:content` is FATAL XML, which would make every one of these tests pass
  // for the wrong reason.
  return `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${id}</title>${entries}</channel></rss>`
}

interface BenchOptions {
  readonly sources?: readonly ReaderSourceSummary[]
  /** The payload each source id answers with. Sources with no entry answer with their own feed. */
  readonly payloads?: Readonly<Record<string, string>>
  /** Source ids whose payload arrives truncated — how the fetch cap arrives. */
  readonly truncatedIds?: readonly string[]
  readonly failedIds?: readonly string[]
  readonly hasSideChat?: boolean
  readonly addAnswer?: AddAnswer
  /** The handshake's freshness facts; omitted = "never refreshed yet". */
  readonly lastRefreshAt?: string
  readonly nextRefreshAt?: string
  /** The tag vocabulary the host reports. */
  readonly tags?: readonly { id: string; name: string; createdAt: string }[]
  readonly tagCounts?: Record<string, number>
  readonly ttlHours?: number
  /** Forces `getEntryBody` to answer with this error (the refusal paths). */
  readonly getEntryBodyError?: string
  /** Entry ids the host reports as needing their full text. */
  readonly backfillCandidates?: readonly string[]
}

/** Render the pane over a real store handle and a scripted host face. */
function bench(options: BenchOptions = {}) {
  // The real engine instance, not a stand-in: the pane's `useStore` is a
  // selector hook, which is exactly what the slot renderer binds from this.
  const instance = createReaderStore().create('reader-test')
  const useStore = (<T,>(selector: (snapshot: ReaderState) => T): T =>
    useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()))) as ReaderPaneProps['useStore']
  const actions = instance.actions

  const assigned: ReaderSourceSummary[] = [...(options.sources ?? [])]
  const mocks = {
    listSources: vi.fn(async () => ({ ok: true as const, value: { sources: assigned } })),
    getBodies: vi.fn(async (ids: string[]) => ({
      ok: true as const,
      value: {
        bodies: ids.map((id): ReaderBody => {
          if (options.failedIds?.includes(id) === true) return { id, error: 'fetch failed' }
          return {
            id,
            raw: options.payloads?.[id] ?? feed(id, [{ title: `条目 ${id}` }]),
            ...(options.truncatedIds?.includes(id) === true ? { truncated: true } : {}),
          }
        }),
      },
    })),
    addSource: vi.fn(async () => options.addAnswer ?? { ok: true as const, value: { outcome: 'subscribed' as const, kind: 'rss' as const, id: 'new', label: '新源' } }),
    capabilities: vi.fn(async () => ({
      ok: true as const,
      value: {
        protocolVersion: 1 as const,
        hasFs: true,
        hasSideChat: options.hasSideChat ?? false,
        ...(options.lastRefreshAt === undefined ? {} : { lastRefreshAt: options.lastRefreshAt }),
        ...(options.nextRefreshAt === undefined ? {} : { nextRefreshAt: options.nextRefreshAt }),
      },
    })),
    quoteToSideChat: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    refresh: vi.fn(async () => ({ ok: true as const, value: { results: [] } })),
    openExternal: vi.fn(() => true),
    copyText: vi.fn(async () => true),
    setDraft: vi.fn(),
    updateSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    refresh: vi.fn(async () => ({ ok: true as const, value: { results: [] } })),
    listTags: vi.fn(async () => ({ ok: true as const, value: { tags: options.tags ?? [], counts: options.tagCounts ?? {} } })),
    listBackfillCandidates: vi.fn(async (entries: readonly { entryId: string }[]) => ({
      ok: true as const,
      value: { candidates: (options.backfillCandidates ?? []).filter(id => entries.some(entry => entry.entryId === id))
        .map(id => ({ entryId: id, url: `https://example.com/${id}`, label: id })) },
    })),
    getCachePolicy: vi.fn(async () => ({ ok: true as const, value: { ttlHours: options.ttlHours ?? 24, maxEntries: 500 } })),
    setCachePolicy: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    entryTags: vi.fn(async () => ({ ok: true as const, value: { tags: [] } })),
    createTag: vi.fn(async (name: string) => ({ ok: true as const, value: { id: `tag-${name}`, name, createdAt: 'now' } })),
    tagEntry: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    renameTag: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    deleteTag: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    pruneTags: vi.fn(async () => ({ ok: true as const, value: { removed: 0 } })),
    fetchEntryBody: vi.fn(async (entryId: string) => ({ entryId, cached: true, fresh: true, fromFeed: false, html: '<p>fetched</p>' })),
    getEntryBody: vi.fn(async (request: { entryId: string; url: string; feedHtml?: string }) => {
      const sourceId = request.entryId.startsWith('link:') ? request.entryId.slice('link:'.length) : undefined
      if (options.getEntryBodyError !== undefined) {
        return { ok: true as const, value: { entryId: request.entryId, cached: false, fresh: true, fromFeed: false, error: options.getEntryBodyError } }
      }
      if (sourceId !== undefined && options.failedIds?.includes(sourceId) === true) {
        return { ok: true as const, value: { entryId: request.entryId, cached: false, fresh: true, fromFeed: false, error: 'fetch failed' } }
      }
      return {
        ok: true as const,
        value: request.feedHtml === undefined
          ? { entryId: request.entryId, cached: false, fresh: true, fromFeed: false }
          : { entryId: request.entryId, cached: false, fresh: true, fromFeed: true, html: request.feedHtml },
      }
    }),
  }

  const props = {
    sessionId: 's1',
    useStore,
    actions,
    t,
    listSources: mocks.listSources,
    getBodies: mocks.getBodies,
    addSource: mocks.addSource,
    capabilities: mocks.capabilities,
    quoteToSideChat: mocks.quoteToSideChat,
    updateSource: mocks.updateSource,
    removeSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    refresh: mocks.refresh,
    listBackfillCandidates: mocks.listBackfillCandidates,
    listTags: mocks.listTags,
    getCachePolicy: mocks.getCachePolicy,
    setCachePolicy: mocks.setCachePolicy,
    entryTags: mocks.entryTags,
    createTag: mocks.createTag,
    tagEntry: mocks.tagEntry,
    renameTag: mocks.renameTag,
    deleteTag: mocks.deleteTag,
    pruneTags: mocks.pruneTags,
    getEntryBody: mocks.getEntryBody,
    fetchEntryBody: mocks.fetchEntryBody,
    readDraft: () => '',
    setDraft: mocks.setDraft,
    copyText: mocks.copyText,
    openExternal: mocks.openExternal,
  } as unknown as ReaderPaneProps

  const view = render(<ReaderPane {...props} />)
  /** Wait until the mount round trip has been parsed into rows. */
  const settle = async (): Promise<void> => {
    await waitFor(() => { expect(mocks.listSources).toHaveBeenCalled() })
    if (assigned.some(item => item.hasBody)) {
      await waitFor(() => { expect(mocks.getBodies).toHaveBeenCalled() })
    }
  }
  return { ...view, mocks, actions, settle }
}

afterEach(cleanup)

describe('the pane renders content, never an empty column', () => {
  it('paints its empty state and its toolbar on the first frame', async () => {
    const ui = bench()
    await ui.settle()
    expect(await screen.findByText(zh['state.emptyTitle'])).toBeTruthy()
    expect(screen.getByText(zh['state.emptyBody'])).toBeTruthy()
    expect(screen.getByPlaceholderText(zh['search.placeholder'])).toBeTruthy()
    // The empty state IS the add card: clicking it opens the dialog.
    fireEvent.click(screen.getByText(zh['state.emptyTitle']))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows a card per entry, with the unread marker and no body markup in the list', async () => {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '第一条' }]) },
    })
    await ui.settle()
    expect(await screen.findByText('第一条')).toBeTruthy()
    // The source's name appears on its filter chip and in the card's meta
    // line: the chip is what proves the strip is populated.
    // The source list lives in the filter popover now (the sidebar is too
    // narrow for a row of chips): open it and the drill row names the page.
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    expect(await screen.findByText(zh['filter.bySource'])).toBeTruthy()
    expect(ui.container.querySelectorAll('[class*="filterRow"]').length).toBeGreaterThanOrEqual(2)
    // The unread marker is a dot: an element with no glyph and no text.
    const dot = ui.container.querySelector('[class*="unread"]')
    expect(dot).not.toBeNull()
    expect(dot?.textContent).toBe('')
    // The list is a list: the body only appears once a card is opened.
    expect(ui.container.querySelector('[class*="article"]')).toBeNull()
  })

  it('answers the search box locally, and says so when nothing matches', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '命中我' }, { title: '另一个' }]) },
    })
    await ui.settle()
    await screen.findByText('命中我')
    const search = screen.getByPlaceholderText(zh['search.placeholder'])
    fireEvent.change(search, { target: { value: '命中' } })
    expect(screen.queryByText('另一个')).toBeNull()
    expect(screen.getByText('命中我')).toBeTruthy()
    fireEvent.change(search, { target: { value: '不存在' } })
    expect(await screen.findByText(zh['state.noMatch'].replace('{query}', '不存在'))).toBeTruthy()
  })
})

describe('pointing (option B): the card opens the detail, the detail owns the browser', () => {
  it('opens the body in place and does NOT reach the browser', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一篇长文', description: `<p>${'正文段落。'.repeat(30)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('一篇长文'))
    expect(await screen.findByText(zh['detail.composerLabel'])).toBeTruthy()
    await waitFor(() => { expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('正文段落') })
    // The click must not have opened a tab: the browser is a detail action.
    expect(ui.mocks.openExternal).not.toHaveBeenCalled()
  })

  it('leaves a saved link as one card with no subscription chrome', async () => {
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '保存的文章', url: 'https://example.com/story', hasBody: true })],
      payloads: { 'link-1': `<article><p>${'网页正文。'.repeat(40)}</p></article>` },
    })
    await ui.settle()
    // The label is on the strip's chip AND on the entry card: point at the card.
    const cards = await screen.findAllByRole('button', { name: /保存的文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await waitFor(() => { expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('网页正文') })
  })
})

describe('a truncated body says so, and offers the way out', () => {
  it('renders the one-line note with a working 阅读原文', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '被截断的长文', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
      truncatedIds: ['hn'],
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('被截断的长文'))
    expect(await screen.findByText(new RegExp(zh['detail.incomplete']))).toBeTruthy()
    fireEvent.click(screen.getByText(zh['detail.readOriginal']))
    expect(ui.mocks.openExternal).toHaveBeenCalled()
  })

  it('keeps a saved link whose fetch failed, and says why when it is opened', async () => {
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '抓取失败的文章', url: 'https://example.com/story' })],
      failedIds: ['link-1'],
    })
    await ui.settle()
    // The entry survives the failure: dropping it would leave the reader with
    // a source they added and can never open.
    const failedCards = await screen.findAllByRole('button', { name: /抓取失败的文章/ })
    fireEvent.click(failedCards[failedCards.length - 1] as HTMLElement)
    // "fetch failed" is a transport failure, so it is said in those terms —
    // not as an extraction problem, which is what it used to claim.
    expect(await screen.findByText(zh['sources.unreachable'])).toBeTruthy()
  })
})

describe('the add form reports the host verdict', () => {
  it('confirms a subscription and clears the field', async () => {
    const ui = bench()
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    expect(await screen.findByText(zh['verdict.subscribed'].replace('{label}', '新源'))).toBeTruthy()
    expect(ui.mocks.addSource).toHaveBeenCalledWith('https://example.com/feed.xml')
  })

  it('maps each refusal onto its own sentence', async () => {
    const ui = bench({ addAnswer: { ok: true, value: 'invalid-url' } })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'not a url' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    expect(await screen.findByText(zh['verdict.invalidUrl'])).toBeTruthy()
  })

  it('shows the fetch seam’s own reason, not just the verdict', async () => {
    // A bare "failed" is not a diagnosis: this is the line that lets a reader
    // tell a dead feed from a machine with no egress.
    const ui = bench({
      addAnswer: { ok: true, value: { outcome: 'fetch-failed', reason: 'connect ECONNREFUSED 127.0.0.1:9' } },
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    expect(await screen.findByText(zh['verdict.fetchFailed'])).toBeTruthy()
    expect(screen.getByText('connect ECONNREFUSED 127.0.0.1:9')).toBeTruthy()
  })
})

describe('every page that leaves the wall carries the way back', () => {
  it('closes the add dialog without leaving the wall', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    expect(await screen.findByText('一条')).toBeTruthy()
    // Two add affordances exist by design (the header button and the strip's
    // dashed chip); either one opens the same dialog.
    fireEvent.click(screen.getAllByTitle(zh['action.add'])[0] as HTMLElement)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // Esc closes it; the wall was never replaced, so nothing has to be rebuilt.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(screen.getByText('一条')).toBeTruthy()
  })

  it('returns from the detail view to the wall', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一篇长文', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('一篇长文'))
    expect(await screen.findByText(zh['detail.composerLabel'])).toBeTruthy()
    fireEvent.click(screen.getByTitle(zh['action.back']))
    // The placeholder is an attribute, not text: point at the input itself.
    expect(await screen.findByPlaceholderText(zh['search.placeholder'])).toBeTruthy()
    expect(await screen.findByText('一篇长文')).toBeTruthy()
  })

  it('opens the subscription page, and comes back from it', async () => {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    expect(await screen.findByText(zh['sources.title'])).toBeTruthy()
    // The schedule is configurable from this page, which is the whole reason
    // it exists. Queried by id: `type="time"` is a widget jsdom does not
    // implement, so the label association is not how a test should reach it.
    expect(ui.container.querySelector('#reader-refresh-time')).not.toBeNull()
    fireEvent.click(screen.getByTitle(zh['action.back']))
    expect(await screen.findByText('一条')).toBeTruthy()
  })
})

describe('a subscription whose entries are not from today', () => {
  it('shows them on the wall without the reader having to change the filter', async () => {
    // The measured case: the acceptance instance's feed's newest item was 8
    // days old, and the old default `today` filter rendered that as "the
    // subscribe did not work".
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '八天前的文章', publishedAt: eightDaysAgo }]) },
    })
    await ui.settle()
    expect(await screen.findByRole('button', { name: /八天前的文章/ })).toBeTruthy()
    // …and the default is visible as a control STATE, not implicit: the filter
    // button is off (no source selected, not unread-only), which is what "all"
    // means now that the filter lives in a popover.
    expect(screen.getByTitle(zh['action.filter']).className).not.toContain('toolOn')
  })
})

describe('quoting needs a body, and the side-chat gesture needs a composition', () => {
  /** The bench every quote test shares: one readable entry, opened. */
  async function openedArticle(hasSideChat: boolean) {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '可引用', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
      hasSideChat,
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('可引用'))
    await screen.findByText(zh['action.quote'])
    return ui
  }

  it('writes the source-tagged block into the conversation draft', async () => {
    const ui = await openedArticle(false)
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '选中的一段' } as unknown as Selection)
    fireEvent.click(screen.getByText(zh['action.quote']))
    const written = ui.mocks.setDraft.mock.calls[0]?.[0] as string | undefined
    expect(written).toContain('选中的一段')
    // The provenance names the FEED (the fixture's channel title is `hn`), not
    // the host's URL-derived label: a feed declares its own name.
    expect(written).toContain('hn')
  })

  it('hides the side-chat action when no side chat is composed', async () => {
    await openedArticle(false)
    expect(screen.queryByText(zh['quote.toSideChat'])).toBeNull()
  })

  it('offers it, and uses it, once the handshake says a side chat exists', async () => {
    const ui = await openedArticle(true)
    fireEvent.click(await screen.findByText(zh['quote.toSideChat']))
    expect(ui.mocks.quoteToSideChat).toHaveBeenCalledWith(expect.objectContaining({ contextKey: 's1' }))
  })
})

describe('the filter popover narrows the wall', () => {
  it('picks one source, and clears again', async () => {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' }), rssSource('ruanyf', { label: '阮一峰周刊' })],
      payloads: {
        hn: feed('hn', [{ title: '来自 HN 的一条' }]),
        ruanyf: feed('ruanyf', [{ title: '来自周刊的一条' }]),
      },
    })
    await ui.settle()
    await screen.findByText('来自 HN 的一条')
    expect(screen.getByText('来自周刊的一条')).toBeTruthy()
    const before = ui.mocks.listSources.mock.calls.length
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    // The root page holds the read-state row and the source drill row only; the
    // sources themselves are one level down (the cascading picker).
    fireEvent.click(await screen.findByText(zh['filter.bySource']))
    const rows = ui.container.querySelectorAll('[class*="filterRow"]')
    // rows: [all, source hn, source ruanyf]
    fireEvent.click(rows[1] as HTMLElement)
    await waitFor(() => { expect(screen.queryByText('来自周刊的一条')).toBeNull() })
    expect(screen.getByText('来自 HN 的一条')).toBeTruthy()
    // The filter is the same local predicate as typing: no round trip.
    expect(ui.mocks.listSources.mock.calls.length).toBe(before)
    // …and its value is visible in the search box, which is how it is cleared.
    const search = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    expect(search.value).toMatch(/^#/)
    fireEvent.change(search, { target: { value: '' } })
    expect(await screen.findByText('来自周刊的一条')).toBeTruthy()
  })

  it('offers the read-state filter in the same popover', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(await screen.findByText(zh['filter.unreadOnly']))
    expect(screen.getByText('一条')).toBeTruthy()
  })
})

describe('an unreadable payload says so on the wall', () => {
  it('marks the source and explains the cap', async () => {
    const truncatedFeed = '<rss version="2.0"><channel><title>probe</title>'
      + '<item><title>完整的一条</title><link>https://example.com/a</link><description>正文</description></item>'
      + '<item><title>被截断的一条</title><link>https://example.com/b</link><description>半'
    const ui = bench({
      sources: [rssSource('hn', { label: '超长 Feed' })],
      payloads: { hn: truncatedFeed },
      truncatedIds: ['hn'],
    })
    await ui.settle()
    // The complete item is on the wall…
    expect(await screen.findByText('完整的一条')).toBeTruthy()
    // …the filter's source page marks the source as incomplete…
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(await screen.findByText(zh['filter.bySource']))
    expect(ui.container.querySelector('[class*="chipBroken"]')).not.toBeNull()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    // …and the notice names the cause with the way out.
    expect(await screen.findByText(zh['state.incompleteReason'], { exact: false })).toBeTruthy()
    fireEvent.click(screen.getAllByText(zh['detail.readOriginal'])[0] as HTMLElement)
    expect(ui.mocks.openExternal).toHaveBeenCalled()
  })
})

describe('a source is editable from the subscription page', () => {
  it('saves an edited address and refetches it', async () => {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News', url: 'https://example.com/hn.xml' })],
      // The feed's own channel title IS the source's display name, which is
      // what makes the assertion below meaningful (see the load path).
      payloads: { hn: feed('Hacker News', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    await screen.findByText(zh['sources.title'])
    // The name and the address are editable in place, and the row's button
    // says what pressing it DOES rather than what the state is.
    const name = screen.getByLabelText(zh['sources.name']) as HTMLInputElement
    const url = screen.getByLabelText(zh['sources.url']) as HTMLInputElement
    expect(name.value).toBe('Hacker News')
    expect(url.value).toBe('https://example.com/hn.xml')
    expect(screen.getByText(zh['action.pause'])).toBeTruthy()
    fireEvent.change(url, { target: { value: 'https://example.com/other.xml' } })
    fireEvent.blur(url)
    await waitFor(() => {
      expect(ui.mocks.updateSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'hn', url: 'https://example.com/other.xml' }))
    })
    // A changed address re-fetches: the next payload is a different document.
    await waitFor(() => { expect(ui.mocks.refresh).toHaveBeenCalledWith(['hn']) })
  })
})

describe('the refresh button really refreshes', () => {
  it('asks the host and re-reads the wall', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    const before = ui.mocks.getBodies.mock.calls.length
    fireEvent.click(screen.getByTitle(zh['action.refresh']))
    await waitFor(() => { expect(ui.mocks.refresh).toHaveBeenCalled() })
    // The re-read is the point: the acceptance instance's fetch succeeded and
    // the list never noticed, so the button looked dead.
    await waitFor(() => { expect(ui.mocks.getBodies.mock.calls.length).toBeGreaterThan(before) })
  })
})

describe('the wall states how old its snapshot is', () => {
  it('reports the last refresh and the next one', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
      lastRefreshAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      nextRefreshAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await ui.settle()
    await screen.findByText('一条')
    expect(screen.getByText(/刷出于 3 小时前/)).toBeTruthy()
    expect(screen.getByText(/每日 \d{2}:\d{2}/)).toBeTruthy()
  })

  it('says so when nothing has been fetched yet', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    expect(screen.getByText(zh['foot.never'])).toBeTruthy()
  })
})

describe('a feed that publishes only a summary for some entries', () => {
  it('says so instead of blaming the fetch cap', async () => {
    // Measured on the OpenAI alignment feed: entry bodies run from ~150
    // characters (a summary) to 62,044 (full text). Nothing was truncated
    // there, so the cap note would be a lie.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '只有摘要的一条', description: '这是一段很短的摘要。' }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('只有摘要的一条'))
    // The feed's own summary is shown as the body, and the view does NOT claim
    // the payload was cut off — because it was not.
    await waitFor(() => { expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('这是一段很短的摘要') })
    expect(screen.queryByText(new RegExp(zh['detail.incomplete']))).toBeNull()
  })

  it('does not say it for a full body', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '长文', description: '摘要一句', body: `<p>${'正文。'.repeat(60)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('长文'))
    await waitFor(() => { expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('正文') })
    expect(screen.queryByText(zh['detail.summaryOnly'], { exact: false })).toBeNull()
  })
})

describe('tags', () => {
  it('creates a tag on the open entry and offers it as a filter', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '可打标签', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('可打标签'))
    await screen.findByText(zh['tag.title'])
    // The + opens the input; Enter creates the tag (or reuses it) and applies it.
    fireEvent.click(ui.container.querySelector('[class*="tagAdd"]') as HTMLElement)
    const input = ui.container.querySelector('[class*="tagInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '灵感' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.mocks.createTag).toHaveBeenCalledWith('灵感') })
    await waitFor(() => { expect(ui.mocks.tagEntry).toHaveBeenCalledWith(expect.any(String), 'tag-灵感', true) })
  })

  it('filters the wall by tag through the same query mechanism', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
      tags: [{ id: 'tag-ai', name: 'AI', createdAt: 'x' }],
      tagCounts: { 'tag-ai': 2 },
    })
    await ui.settle()
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(await screen.findByText('AI'))
    // Picking a tag writes the tag query, exactly like picking a source does.
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('@tag-ai')
    })
  })
})

describe('a publisher that refuses automatic fetches', () => {
  it('says the page blocked us instead of blaming extraction', async () => {
    // Measured: openai.com answers 403 to every non-browser request (proxy or
    // not), so our fetch never sees the article. The reader must be told THAT,
    // because "could not extract" invites a retry that cannot work.
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '被拒的文章', url: 'https://openai.com/index/x/' })],
      failedIds: ['link-1'],
      getEntryBodyError: 'HTTP 403: the site refuses non-browser requests',
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /被拒的文章/ })).at(-1) as HTMLElement)
    expect(await screen.findByText(zh['sources.blocked'])).toBeTruthy()
  })
})

describe('full text is filled in automatically', () => {
  it('asks the host for the work list and fetches without any button', async () => {
    // The agreed shape: no click, no "fetch the text" button — the package
    // completes what the feeds only summarised, in the background.
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '摘要文章', url: 'https://example.com/story' })],
      failedIds: ['link-1'],
      backfillCandidates: ['link:link-1'],
    })
    await ui.settle()
    await waitFor(() => {
      expect(ui.mocks.listBackfillCandidates).toHaveBeenCalled()
      expect(ui.mocks.fetchEntryBody).toHaveBeenCalledWith('link:link-1', 'https://example.com/link:link-1')
    })
    // The reader never had to press anything.
    expect(screen.queryByText(zh['action.fetchBody'])).toBeNull()
  })
})

describe('the filter panel cascades into the source list', () => {
  /** A wall with `count` subscriptions, named after their ids. */
  function manySources(count: number) {
    const ids = Array.from({ length: count }, (_, index) => `src${index}`)
    return bench({
      sources: ids.map(id => rssSource(id, { label: id })),
      payloads: Object.fromEntries(ids.map(id => [id, feed(id, [{ title: `${id} 的一条` }])])),
    })
  }

  it('keeps its root short, then searches and picks inside the source page', async () => {
    const ui = manySources(9)
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    const panel = ui.container.querySelector('[class*="filterPanel"]') as HTMLElement
    // Root = the read-state row + the drill row. The nine sources are NOT here:
    // that is what keeps the panel usable as subscriptions accumulate.
    expect(panel.querySelectorAll('[class*="filterRow"]').length).toBe(2)
    // …and the drill row carries the current value, so nothing is hidden.
    expect(panel.querySelector('[class*="filterValue"]')?.textContent).toBe(zh['filter.all'])
    fireEvent.click(screen.getByText(zh['filter.bySource']))
    // The source page has its own search box (the list is unbounded)…
    const search = await screen.findByPlaceholderText(zh['filter.searchSource'])
    expect(panel.querySelectorAll('[class*="filterRow"]').length).toBe(10)
    fireEvent.change(search, { target: { value: 'src7' } })
    const rows = panel.querySelectorAll('[class*="filterRow"]')
    // …all + the one match.
    expect(rows.length).toBe(2)
    fireEvent.click(rows[1] as HTMLElement)
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#src7')
    })
  })

  it('hides the search box while the list is short enough to read', async () => {
    const ui = manySources(3)
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(screen.getByText(zh['filter.bySource']))
    expect(screen.queryByPlaceholderText(zh['filter.searchSource'])).toBeNull()
    expect(ui.container.querySelectorAll('[class*="filterList"] [class*="filterRow"]').length).toBe(4)
  })

  it('says a search matched nothing instead of showing an empty list', async () => {
    const ui = manySources(7)
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(screen.getByText(zh['filter.bySource']))
    fireEvent.change(await screen.findByPlaceholderText(zh['filter.searchSource']), { target: { value: 'zzz' } })
    const panel = ui.container.querySelector('[class*="filterPanel"]') as HTMLElement
    expect(panel.querySelector('[class*="filterEmpty"]')?.textContent).toBe(zh['filter.noSourceMatch'])
  })

  it('returns to the root page without closing the panel', async () => {
    const ui = manySources(7)
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(screen.getByText(zh['filter.bySource']))
    fireEvent.click(screen.getByTitle(zh['action.back']))
    // Still open, back at the root: the read-state row is there and the source
    // page's search box is gone.
    expect(screen.getByText(zh['filter.unreadOnly'])).toBeTruthy()
    expect(screen.queryByPlaceholderText(zh['filter.searchSource'])).toBeNull()
  })
})

describe('the toolbar keeps room for both of its tools', () => {
  it('puts the field first, then the two icon tools in their own anchored wrappers', async () => {
    const ui = bench()
    await ui.settle()
    const tools = ui.container.querySelector('[class*="tools"]') as HTMLElement
    expect(tools).not.toBeNull()
    // DOM order IS visual order (no `order` games): field, filter, sort. The
    // field is the row's only flexible item, so a narrow sidebar gives width
    // back from the input — never from a tool.
    const children = [...tools.children]
    expect(children[0]?.className).toContain('search')
    expect(children[1]?.className).toContain('toolWrap')
    expect(children[2]?.className).toContain('toolWrap')
    expect(tools.querySelectorAll('button').length).toBe(2)
    // Opening one anchors its panel inside that tool's own wrapper. The old
    // pane-anchored `top: 62px` was shorter than the toolbar itself, so the
    // filter panel sat on top of the sort button.
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    const panel = ui.container.querySelector('[class*="filterPanel"]') as HTMLElement
    expect(panel.parentElement).toBe(children[1])
    // …and the other tool is still in the row, outside the panel.
    expect(children[2]?.querySelector('button')).not.toBeNull()
  })
})

describe('the card tag panel', () => {
  /** One card on the wall, with the vocabulary the host reports. */
  async function wallWithVocabulary(tags: readonly { id: string; name: string; createdAt: string }[]) {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条', description: '<p>正文</p>' }]) },
      tags,
    })
    await ui.settle()
    await screen.findByText('一条')
    fireEvent.click(ui.container.querySelector('[class*="tagOnCard"]') as HTMLElement)
    return ui
  }

  it('lists the vocabulary, toggles it, and creates the name you typed', async () => {
    const ui = await wallWithVocabulary([{ id: 'tag-ai', name: 'AI', createdAt: 'x' }])
    const panel = ui.container.querySelector('[class*="cardTagPanel"]') as HTMLElement
    expect(panel).not.toBeNull()
    // The vocabulary is a checklist IN the panel: clicking a row applies it.
    fireEvent.click(await screen.findByText('AI'))
    await waitFor(() => { expect(ui.mocks.tagEntry).toHaveBeenCalledWith(expect.any(String), 'tag-ai', true) })
    // Typing a name the vocabulary does not hold offers to create it, in place
    // (this is what replaced the native datalist's unstyleable popup).
    const input = panel.querySelector('[class*="tagInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '新标签' } })
    fireEvent.click(await screen.findByText(t('tag.create', { name: '新标签' })))
    await waitFor(() => { expect(ui.mocks.createTag).toHaveBeenCalledWith('新标签') })
  })

  it('offers to create the typed name instead of leaving an empty list', async () => {
    const ui = await wallWithVocabulary([])
    expect(await screen.findByText(zh['tag.empty'])).toBeTruthy()
    const input = ui.container.querySelector('[class*="cardTagPanel"] [class*="tagInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '第一个' } })
    fireEvent.click(await screen.findByText(t('tag.create', { name: '第一个' })))
    await waitFor(() => { expect(ui.mocks.createTag).toHaveBeenCalledWith('第一个') })
  })

  it('closes on Escape and forgets the half-typed name', async () => {
    const ui = await wallWithVocabulary([])
    const input = ui.container.querySelector('[class*="cardTagPanel"] [class*="tagInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '半截' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => { expect(ui.container.querySelector('[class*="cardTagPanel"]')).toBeNull() })
    // Reopening starts clean rather than resurrecting the abandoned draft.
    fireEvent.click(ui.container.querySelector('[class*="tagOnCard"]') as HTMLElement)
    const again = ui.container.querySelector('[class*="cardTagPanel"] [class*="tagInput"]') as HTMLInputElement
    expect(again.value).toBe('')
  })
})

describe('read state is visible without hiding anything', () => {
  it('marks an unread card, and drops the mark once the entry is opened', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条', description: '<p>正文</p>' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    // The attribute is what the styles read for the title hierarchy; the dot is
    // the at-a-glance marker.
    const card = ui.container.querySelector('[data-reader-entry]') as HTMLElement
    expect(card.hasAttribute('data-unread')).toBe(true)
    expect(card.querySelector('[class*="unread"]')).not.toBeNull()
    fireEvent.click(screen.getByText('一条'))
    await screen.findByText(zh['detail.composerLabel'])
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      const back = ui.container.querySelector('[data-reader-entry]') as HTMLElement
      expect(back.hasAttribute('data-unread')).toBe(false)
      expect(back.querySelector('[class*="unread"]')).toBeNull()
    })
  })
})

describe('on-device translation', () => {
  /** The page global the pane probes, scripted per test. */
  function installTranslator(over: { availability?: string; createThrows?: string; unsupported?: boolean; mangled?: boolean } = {}) {
    const api = {
      availability: vi.fn(async () => over.availability ?? 'available'),
      create: vi.fn(async () => {
        if (over.unsupported === true) {
          throw new DOMException('Unable to create translator for the given source and target language.', 'NotSupportedError')
        }
        if (over.createThrows !== undefined) throw new Error(over.createThrows)
        return {
          inputQuota: 10_000,
          measureInputUsage: async (text: string) => text.length,
          translate: async (payload: string) =>
            payload
              .split(UNIT_SEPARATOR)
              .map(part => `译：${part}`)
              .join(over.mangled === true ? ' ' : UNIT_SEPARATOR),
        }
      }),
    }
    ;(globalThis as unknown as { Translator?: unknown }).Translator = api
    return api
  }

  /** One English article, opened, its body on screen. */
  async function opened(body: string) {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一篇长文', description: body }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('一篇长文'))
    await screen.findByText(zh['action.quote'])
    return ui
  }

  afterEach(() => { delete (globalThis as unknown as { Translator?: unknown }).Translator })

  it('translates in place, reveals one sentence at a time, and switches views', async () => {
    const api = installTranslator()
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    const globe = await screen.findByTitle(zh['action.translate'])
    // The tip only exists once there is a translation to explain.
    expect(screen.queryByText(zh['translate.tip'])).toBeNull()
    fireEvent.click(globe)
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    const units = ui.container.querySelectorAll('[data-reader-unit]')
    expect(units.length).toBe(2)
    expect(screen.getByText(zh['translate.tip'])).toBeTruthy()
    // Clicking a sentence opens exactly its own original under the block…
    fireEvent.click(units[0] as HTMLElement)
    expect(ui.container.querySelector('[data-reader-reveal]')?.textContent).toBe('First sentence here.')
    expect(units[0]?.getAttribute('data-open')).toBe('1')
    // …and the pairing is marked on BOTH sides: the original line is lit too,
    // which is what the reader looks for when they click a sentence.
    expect(ui.container.querySelector('[data-reader-reveal] [data-reader-sentence]')?.getAttribute('data-open')).toBe('1')
    // …and clicking it again takes it away.
    fireEvent.click(units[0] as HTMLElement)
    expect(ui.container.querySelector('[data-reader-reveal]')).toBeNull()
    // The caret menu switches the view; original-only keeps the segmentation
    // but shows the source text again.
    fireEvent.click(ui.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    fireEvent.click(await screen.findByText(zh['translate.onlyOriginal']))
    await waitFor(() => {
      const article = ui.container.querySelector('[class*="article"]')
      expect(article?.textContent).toContain('First sentence here.')
      expect(article?.textContent).not.toContain('译：')
    })
    // …and the globe flips it back without translating anything again.
    fireEvent.click(screen.getByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
  })

  it('hides the globe when the browser has no translator', async () => {
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    // Nothing to click: an offer that cannot work is worse than no offer.
    expect(screen.queryByTitle(zh['action.translate'])).toBeNull()
    expect(ui.container.querySelector('[data-reader-unit]')).toBeNull()
  })

  it('hides it when the browser says the pair is unavailable', async () => {
    installTranslator({ availability: 'unavailable' })
    await opened('<p>First sentence here. Second sentence here.</p>')
    await waitFor(() => { expect(screen.queryByTitle(zh['action.translate'])).toBeNull() })
  })

  it('hides it for a body that is already Chinese', async () => {
    installTranslator()
    await opened('<p>这是一段中文正文。这是第二句。</p>')
    await waitFor(() => { expect(screen.queryByTitle(zh['action.translate'])).toBeNull() })
  })

  it('says why the pack or the model failed, and leaves the body alone', async () => {
    installTranslator({ createThrows: 'no language pack available' })
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    // The pair is named: the browser's own message names neither language, so a
    // reader reporting the failure needs the plugin to say which pair was asked.
    expect(await screen.findByText(/en → zh/, { exact: false })).toBeTruthy()
    expect(screen.getByText(/no language pack available/, { exact: false })).toBeTruthy()
    // The article is exactly as the host sent it: no spans, no half-translation.
    expect(ui.container.querySelector('[data-reader-unit]')).toBeNull()
    expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('First sentence here.')
  })

  it('gives up honestly when the browser cannot build that pair at all', async () => {
    installTranslator({ unsupported: true })
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    // The reason names every spelling that was tried…
    expect(await screen.findByText(zh['translate.unsupported'].replace('{pair}', 'en → zh / en → zh-Hans'))).toBeTruthy()
    // …and the globe stops offering an action this browser cannot perform.
    await waitFor(() => { expect(screen.queryByTitle(zh['action.translate'])).toBeNull() })
    expect(ui.container.querySelector('[data-reader-unit]')).toBeNull()
  })

  it('keeps the text aligned when the batch separator does not survive', async () => {
    installTranslator({ mangled: true })
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      const article = ui.container.querySelector('[class*="article"]')?.textContent ?? ''
      // The fallback re-sends unit by unit, so both sentences still get their
      // OWN translation rather than a merged one.
      expect(article).toContain('译：First sentence here.')
      expect(article).toContain('译：Second sentence here.')
    })
  })
})
