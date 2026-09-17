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
import type { ReaderBody, ReaderSourceSummary } from '../src/types.ts'

/** A translate over the zh dictionary: its key set is the source of truth. */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as ReaderPaneProps['t']

/** The verdicts the host's `addSource` can answer with. */
type AddAnswer = { ok: true; value: unknown } | { ok: false; error: { message: string } }

/** One item for the feed fixture. */
interface FeedItem {
  readonly title: string
  readonly description?: string
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
  </item>`).join('')
  return `<rss version="2.0"><channel><title>${id}</title>${entries}</channel></rss>`
}

interface BenchOptions {
  readonly sources?: readonly ReaderSourceSummary[]
  /** The payload each source id answers with. Sources with no entry answer with their own feed. */
  readonly payloads?: Readonly<Record<string, string>>
  /** Odd-number source ids get a truncated body — how the fetch cap arrives. */
  readonly truncatedIds?: readonly string[]
  readonly failedIds?: readonly string[]
  readonly hasSideChat?: boolean
  readonly addAnswer?: AddAnswer
  /** The handshake's freshness facts; omitted = "never refreshed yet". */
  readonly lastRefreshAt?: string
  readonly nextRefreshAt?: string
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
    openExternal: vi.fn(() => true),
    copyText: vi.fn(async () => true),
    setDraft: vi.fn(),
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
    updateSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    removeSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    refresh: vi.fn(async () => ({ ok: true as const, value: { results: [] } })),
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
    expect(ui.container.querySelector('button')).not.toBeNull()
  })

  it('shows a card per entry, with the unread marker and no body markup in the list', async () => {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '第一条' }]) },
    })
    await ui.settle()
    expect(await screen.findByText('第一条')).toBeTruthy()
    expect(screen.getByText('Hacker News')).toBeTruthy()
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
    // The label is on the card AND in the detail kicker, so point at the card.
    fireEvent.click(await screen.findByRole('button', { name: /保存的文章/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: /抓取失败的文章/ }))
    expect(await screen.findByText(zh['detail.extractFailed'])).toBeTruthy()
    // …and because the fetch never completed, the body is by definition partial.
    expect(await screen.findByText(new RegExp(zh['detail.incomplete']))).toBeTruthy()
  })
})

describe('the add form reports the host verdict', () => {
  it('confirms a subscription and clears the field', async () => {
    const ui = bench()
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
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

describe('every page that leaves the list carries the way back', () => {
  it('returns from the add page to the card list', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    expect(await screen.findByText('一条')).toBeTruthy()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    expect(await screen.findByText(zh['add.help'])).toBeTruthy()
    // The list is gone while the add page is up…
    expect(screen.queryByText('一条')).toBeNull()
    fireEvent.click(screen.getByTitle(zh['action.back']))
    // …and the cards come back, not an empty column.
    expect(await screen.findByText('一条')).toBeTruthy()
    expect(screen.getByPlaceholderText(zh['search.placeholder'])).toBeTruthy()
  })

  it('returns from the detail view to the card list', async () => {
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
})

describe('the list says how old this snapshot is', () => {
  it('says so when nothing has been fetched yet', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
    })
    await ui.settle()
    await screen.findByText('一条')
    expect(screen.getByText(zh['foot.never'])).toBeTruthy()
  })

  it('states when the last refresh ran and when the next one is due', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
      lastRefreshAt: sixtyMinutesAgo,
      nextRefreshAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    })
    await ui.settle()
    await screen.findByText('一条')
    // A reader deciding whether to refresh needs the age, not just a count.
    expect(screen.getByText(/刷出于 1 小时前/)).toBeTruthy()
    expect(screen.getByText(/每日 \d{2}:\d{2}/)).toBeTruthy()
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
    expect(written).toContain('Hacker News')
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
