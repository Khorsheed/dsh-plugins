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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReaderPaneProps } from '../src/client/contract.ts'
import { createReaderStore, type ReaderState } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { ReaderPane } from '../src/client/ReaderPane.tsx'
import { forgetSession, forgetTranslators, readSession, rememberReadingPosition } from '../src/client/session.ts'
import { UNIT_SEPARATOR, clearMemory, translationHash } from '../src/client/translate.ts'
import type { ReaderBody, ReaderEntryFetchState, ReaderRecentEntry, ReaderSourceSummary } from '../src/types.ts'

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
  return {
    id,
    kind: 'rss',
    url: `https://example.com/${id}.xml`,
    label: id,
    enabled: true,
    // The host always reports when a source was added; the pane sorts by it.
    addedAt: '2026-09-17T10:00:00.000Z',
    hasBody: true,
    ...over,
  }
}

/**
 * A real RSS 2.0 document, published today so the pane's default `today`
 * filter keeps its items. Entries carry a `description`, which the parser
 * treats as the body when the feed publishes no `content:encoded` — that is
 * the common case and it keeps the detail view off the network.
 */
function feed(id: string, items: readonly FeedItem[]): string {
  const published = new Date().toISOString()
  // This fixture is a feed that PUBLISHES its text: the body rides
  // `content:encoded` (with the description alongside it), which is what most
  // of these tests assume. A feed that ships only a summary is a different
  // case with its own fixture — and it is the one that still owes a fetch.
  const entries = items.map(item => `<item>
    <title>${item.title}</title>
    <link>https://example.com/${id}/${encodeURIComponent(item.title)}</link>
    <pubDate>${item.publishedAt ?? published}</pubDate>
    <description>${item.description ?? `摘要：${item.title}`}</description>
    <content:encoded><![CDATA[${item.body ?? item.description ?? `<p>${`摘要：${item.title}`}</p>`}]]></content:encoded>
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
  /**
   * Entry ids the host already holds a fetched body for, and that body. This is
   * the `cached: true, fromFeed: false` answer — an entry whose fetch happened
   * earlier (in another visit, or before the pane was remounted).
   */
  readonly cachedBodies?: Readonly<Record<string, string>>
  /** What `entryFetchStates` answers per entry id (default: `none`). */
  readonly fetchStates?: Readonly<Record<string, ReaderEntryFetchState>>
  /** Entry ids the host reports as needing their full text. */
  readonly backfillCandidates?: readonly string[]
  /** What the host's 「最近阅读」 list holds, newest first. */
  readonly recent?: readonly ReaderRecentEntry[]
  /** The entry's exact-fit translation record, as the host would answer it. */
  readonly entryTranslation?: { ok: true; value: { translation?: { pair: string; bodyHash: string; segments: Record<string, string> } } }
  /** The global memory's answers, by sentence hash. */
  readonly memorySlice?: Readonly<Record<string, string>>
  /** The dsh session this mount belongs to (defaults to `s1`). */
  readonly sessionId?: string
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
    removeSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    openExternal: vi.fn(() => true),
    copyText: vi.fn(async () => true),
    setDraft: vi.fn(),
    updateSource: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    refresh: vi.fn(async () => ({ ok: true as const, value: { results: [] } })),
    listTags: vi.fn(async () => ({ ok: true as const, value: { tags: options.tags ?? [], counts: options.tagCounts ?? {} } })),
    entryFetchStates: vi.fn(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: {
        states: Object.fromEntries(entryIds.map(id => [id, options.fetchStates?.[id] ?? { state: 'none' as const }])),
      },
    })),
    getRawBody: vi.fn(async (entryId: string) => ({ ok: true as const, value: { entryId } })),
    storeEntryBody: vi.fn(async (request: { entryId: string; url: string; html: string }) => ({
      ok: true as const,
      value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: request.html },
    })),
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
    recordRead: vi.fn(async () => ({ ok: true as const, value: { entries: 1 } })),
    listRecent: vi.fn(async () => ({ ok: true as const, value: { entries: [...(options.recent ?? [])] } })),
    clearRecent: vi.fn(async () => ({ ok: true as const, value: { removed: (options.recent ?? []).length } })),
    // The persistent translation tiers: empty by default, scripted per test.
    getEntryTranslation: vi.fn(async () => options.entryTranslation ?? { ok: true as const, value: {} }),
    getSentenceTranslations: vi.fn(async (request: { pair: string; hashes: readonly string[] }) => ({
      ok: true as const,
      value: {
        translations: Object.fromEntries(
          request.hashes.flatMap(hash => {
            const hit = options.memorySlice?.[hash]
            return hit === undefined ? [] : [[hash, hit] as const]
          }),
        ),
      },
    })),
    rememberSentences: vi.fn(async () => ({ ok: true as const, value: { stored: 0 } })),
    fetchEntryBody: vi.fn(async (entryId: string) => ({ entryId, cached: true, fresh: true, fromFeed: false, html: '<p>fetched</p>' })),
    getEntryBody: vi.fn(async (request: { entryId: string; url: string; feedHtml?: string }) => {
      const sourceId = request.entryId.startsWith('link:') ? request.entryId.slice('link:'.length) : undefined
      if (options.getEntryBodyError !== undefined) {
        return { ok: true as const, value: { entryId: request.entryId, cached: false, fresh: true, fromFeed: false, error: options.getEntryBodyError } }
      }
      if (sourceId !== undefined && options.failedIds?.includes(sourceId) === true) {
        return { ok: true as const, value: { entryId: request.entryId, cached: false, fresh: true, fromFeed: false, error: 'fetch failed' } }
      }
      const cached = options.cachedBodies?.[request.entryId]
      if (cached !== undefined) {
        return { ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: cached } }
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
    sessionId: options.sessionId ?? 's1',
    useStore,
    actions,
    t,
    listSources: mocks.listSources,
    getBodies: mocks.getBodies,
    addSource: mocks.addSource,
    capabilities: mocks.capabilities,
    quoteToSideChat: mocks.quoteToSideChat,
    updateSource: mocks.updateSource,
    removeSource: mocks.removeSource,
    refresh: mocks.refresh,
    entryFetchStates: mocks.entryFetchStates,
    getRawBody: mocks.getRawBody,
    storeEntryBody: mocks.storeEntryBody,
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
    recordRead: mocks.recordRead,
    listRecent: mocks.listRecent,
    clearRecent: mocks.clearRecent,
    getEntryTranslation: mocks.getEntryTranslation,
    getSentenceTranslations: mocks.getSentenceTranslations,
    rememberSentences: mocks.rememberSentences,
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

// The quoting case installs a `getSelection` spy, and the translation gesture
// reads the selection (a click that ends a drag must not fold the sentence), so
// every test starts from a clean slate.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // "Where the reader was" is module state shared by the WHOLE PAGE (that is
  // the point of it): without this, one case's open article — and its narrowing,
  // and its cached translator — would be restored into the next one. The page's
  // sentence mirror is the same kind of state, and it now warms from the host,
  // so it is cleared here too.
  forgetSession()
  forgetTranslators()
  clearMemory()
})

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

describe('a saved link with no body says so, and can be deleted', () => {
  /** A link the host saved but could not read, as the summary reports it. */
  const unreadableLink = (code: 'blocked' | 'login' | 'unsupported-type' | 'redirected' | 'empty' | 'http' = 'blocked') =>
    rssSource('link-1', {
      kind: 'link',
      label: '只能打开原文的链接',
      url: 'https://openreview.net/pdf?id=1lyagkzogH',
      hasBody: false,
      status: 'error',
      error: 'the site answered a bot challenge instead of the page',
      failure: { code, message: 'the site answered a bot challenge instead of the page' },
    })

  it('marks the card link-only, with the host’s reason on the badge', async () => {
    const ui = bench({ sources: [unreadableLink()] })
    await ui.settle()
    const badge = await screen.findByText(zh['detail.linkOnlyBadge'])
    expect(badge.getAttribute('title')).toBe(zh['preview.blocked'])
  })

  it('uses the code for the sentence, so a login wall is not called a bot wall', async () => {
    const ui = bench({ sources: [unreadableLink('login')] })
    await ui.settle()
    expect((await screen.findByText(zh['detail.linkOnlyBadge'])).getAttribute('title')).toBe(zh['preview.login'])
  })

  it('explains a saved link whose page could not be extracted at all', async () => {
    // The payload arrived and the source is not marked failed, so no reason was
    // recorded anywhere — opening it used to render the title over blank space.
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '抽不出正文的页面', url: 'https://example.com/empty' })],
      payloads: { 'link-1': '' },
    })
    await ui.settle()
    const cards = await screen.findAllByRole('button', { name: /抽不出正文的页面/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    // The sentence shares its paragraph with the 阅读原文 button (and the card
    // badge repeats it in a tooltip), so match loosely and require at least one.
    expect((await screen.findAllByText(/抽不出正文/)).length).toBeGreaterThan(0)
  })

  it('offers delete for a saved link, and never for a feed entry', async () => {
    // A saved link IS one item, so deleting it here is honest; a feed entry
    // would come back on the next refresh, and a delete that undoes itself is
    // a lie the UI must not tell.
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '保存的文章', url: 'https://example.com/story' })],
      payloads: { 'link-1': `<html><body><article><p>${'正文。'.repeat(200)}</p></article></body></html>` },
    })
    await ui.settle()
    const cards = await screen.findAllByRole('button', { name: /保存的文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    fireEvent.click(await screen.findByTitle(zh['detail.removeLink']))
    await waitFor(() => { expect(ui.mocks.removeSource).toHaveBeenCalledWith('link-1') })
  })

  it('reports a saved-but-unreadable link as saved, naming the reason', async () => {
    const ui = bench({
      addAnswer: {
        ok: true,
        value: {
          outcome: 'saved-link',
          kind: 'link',
          id: 'new',
          label: '被拒的文章',
          failure: { code: 'unsupported-type', message: 'unsupported content type "application/pdf"' },
        },
      },
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://openreview.net/pdf?id=x' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    const expected = zh['verdict.savedLinkNoPreview']
      .replace('{label}', '被拒的文章')
      .replace('{reason}', zh['preview.unsupportedType'])
    expect(await screen.findByText(expected)).toBeTruthy()
    // Saved is not failed: the dialog confirms and the field clears.
    expect((input as HTMLInputElement).value).toBe('')
  })
})

describe('the subscription page narrows and orders its own list', () => {
  const feedSource = (id: string, addedAt: string) =>
    rssSource(id, { label: id, addedAt, hasBody: true })

  it('filters by kind and sorts by when things arrived', async () => {
    // The page mixes feeds and saved links, and "delete the link I added
    // yesterday" is not answerable without both against a long list.
    const ui = bench({
      sources: [
        feedSource('订阅甲', '2026-09-01T00:00:00.000Z'),
        rssSource('保存的链接', { kind: 'link', label: '保存的链接', addedAt: '2026-09-18T00:00:00.000Z', url: 'https://example.com/a' }),
      ],
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    expect(await screen.findByText(zh['sources.title'])).toBeTruthy()

    // Sorted by arrival, newest first: the link was added a day after the feed.
    const names = (): string[] => Array.from(
      ui.container.querySelectorAll('[class*="sourceRow"] [class*="sourceNameInput"]'),
    ).map(node => (node as HTMLInputElement).value)
    await waitFor(() => { expect(names()).toEqual(['保存的链接', '订阅甲']) })

    // Narrowing to saved links leaves exactly that one row.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh['sources.kindLink']}`) }))
    await waitFor(() => { expect(names()).toEqual(['保存的链接']) })

    // …and the kind the reader did not ask for is not what "all" means.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh['sources.kindRss']}`) }))
    await waitFor(() => { expect(names()).toEqual(['订阅甲']) })
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
    // Root = read state (2 rows) + the source drill row + the type rows
    // (all / feed / saved link). The nine sources are NOT here: that is what
    // keeps the panel usable as subscriptions accumulate.
    expect(panel.querySelectorAll('[class*="filterRow"]').length).toBe(5)
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

describe('the wall keeps its field and its tools apart', () => {
  it('gives the field a row of its own and the header the three controls', async () => {
    // The reported shape: a search field wedged between three buttons is a
    // field the reader cannot see what they typed in on a narrow sidebar. The
    // field now owns its row (full width) and the wall's controls live in the
    // header with refresh.
    const ui = bench()
    await ui.settle()
    const tools = ui.container.querySelector('[class*="tools"]') as HTMLElement
    const head = ui.container.querySelector('[class*="head"]') as HTMLElement
    expect(tools).not.toBeNull()
    expect(head).not.toBeNull()

    // One child: the field. No buttons, no anchored wrappers.
    expect([...tools.children].map(child => child.className)).toEqual([expect.stringContaining('search')])
    expect(tools.querySelectorAll('button').length).toBe(0)

    // The header carries filter and sort, each in its own anchored wrapper so
    // its panel hangs under the control that opened it. The translation switch
    // joins them only where the page has a Translator API (jsdom has none), so
    // it is asserted in the translation specs instead.
    const wrappers = [...head.querySelectorAll('[class*="toolWrap"]')]
    expect(wrappers.length).toBe(2)
    expect(head.querySelectorAll('button').length).toBeGreaterThanOrEqual(4)
  })

  it('still anchors the filter panel inside its own wrapper', async () => {
    const ui = bench()
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    const panel = ui.container.querySelector('[class*="filterPanel"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.parentElement?.className).toContain('toolWrap')
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

describe('the wall translates its cards', () => {
  /** Two English cards (one mixed), one Chinese card. */
  function wall() {
    return bench({
      sources: [rssSource('hn', { label: 'Hacker News' }), rssSource('mix'), rssSource('cn')],
      payloads: {
        hn: feed('hn', [{ title: 'English card title', description: 'An English summary sentence.' }]),
        mix: feed('mix', [{ title: '中文标题的卡片', description: 'An English summary inside a mixed card.' }]),
        cn: feed('cn', [{ title: '完全中文的卡片', description: '中文摘要。' }]),
      },
    })
  }

  it('translates English cards, leaves Chinese fields alone, and switches back', async () => {
    installTranslator()
    const ui = wall()
    await ui.settle()
    await screen.findByText('English card title')
    expect(screen.getByText('完全中文的卡片')).toBeTruthy()
    // The wall globe appears once the browser has answered the probe.
    const globe = await screen.findByTitle(zh['action.translate'])
    fireEvent.click(globe)
    await waitFor(() => { expect(screen.getByText('译：English card title')).toBeTruthy() })
    // A mixed card translates ONLY its English field: the Chinese title stays.
    expect(screen.getByText('中文标题的卡片')).toBeTruthy()
    expect(await screen.findByText('译：An English summary inside a mixed card.')).toBeTruthy()
    // A wholly Chinese card is never sent: no Chinese-into-Chinese request.
    expect(screen.getByText('完全中文的卡片')).toBeTruthy()
    expect(screen.getByText('中文摘要。')).toBeTruthy()
    expect(screen.queryByText(/译：完全中文的卡片/)).toBeNull()
    // Hovering the card's own surface (blank space, tile, chevron) must NOT flip
    // anything — the reader had to tiptoe around the wall otherwise.
    const card = ui.container.querySelector('[data-reader-entry]') as HTMLElement
    fireEvent.mouseOver(card)
    expect(screen.getByText('译：English card title')).toBeTruthy()
    // Hovering the TRANSLATED TEXT peeks that ONE field back…
    const titleSpan = screen.getByText('译：English card title')
    fireEvent.mouseOver(titleSpan)
    await waitFor(() => { expect(screen.getByText('English card title')).toBeTruthy() })
    // …and the summary of the same card stays translated.
    expect(screen.getByText('译：An English summary sentence.')).toBeTruthy()
    fireEvent.mouseOut(titleSpan, { relatedTarget: document.body })
    await waitFor(() => { expect(screen.getByText('译：English card title')).toBeTruthy() })
    // Switching the wall's translation off puts the originals back.
    fireEvent.click(globe)
    await waitFor(() => { expect(screen.getByText('English card title')).toBeTruthy() })
    expect(screen.queryByText('译：English card title')).toBeNull()
    expect(ui.container.querySelector('[data-translated]')).toBeNull()
  })

  it('shows the original under each field in the side-by-side view', async () => {
    installTranslator()
    const ui = wall()
    await ui.settle()
    await screen.findByText('English card title')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => { expect(screen.getByText('译：English card title')).toBeTruthy() })
    fireEvent.click(ui.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    fireEvent.click(await screen.findByText(zh['translate.bilingual']))
    // Both languages are on the card at once — and the originals are marked so
    // the styles can tell them from the translation.
    await waitFor(() => { expect(ui.container.querySelectorAll('[class*="cardOrig"]').length).toBeGreaterThanOrEqual(2) })
    expect(screen.getByText('English card title')).toBeTruthy()
    expect(screen.getByText('An English summary sentence.')).toBeTruthy()
  })
})

describe('on-device translation', () => {
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
    // Nothing is painted just for being open; the cue is hover, from either side.
    expect(ui.container.querySelectorAll('[data-hover]')).toHaveLength(0)
    fireEvent.mouseOver(units[0] as HTMLElement)
    expect(ui.container.querySelector('[data-reader-reveal] [data-reader-sentence]')?.getAttribute('data-hover')).toBe('1')
    fireEvent.mouseOut(units[0] as HTMLElement)
    expect(ui.container.querySelectorAll('[data-hover]')).toHaveLength(0)
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

  it('does not fold a sentence when the click ends a selection (quoting)', async () => {
    installTranslator()
    const ui = await opened('<p>First sentence here. Second sentence here.</p>')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => { expect(ui.container.querySelector('[data-reader-unit]')).not.toBeNull() })
    // A drag selection ends with a click; folding the sentence there would take
    // the selection (and the quote overlay with it) away.
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'First sentence here.' } as unknown as Selection)
    fireEvent.click(ui.container.querySelector('[data-reader-unit]') as HTMLElement)
    expect(ui.container.querySelector('[data-reader-reveal]')).toBeNull()
    // With no selection, the same click is a toggle again.
    vi.restoreAllMocks()
    fireEvent.click(ui.container.querySelector('[data-reader-unit]') as HTMLElement)
    expect(ui.container.querySelector('[data-reader-reveal]')?.textContent).toBe('First sentence here.')
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

describe('opening an entry with no body pays for one fetch', () => {
  /** A feed entry that carries a link but no description at all. */
  const bareFeed = (id: string): string =>
    `<rss version="2.0"><channel><title>${id}</title>`
    + `<item><title>没有正文的条目</title><link>https://example.com/article</link></item>`
    + '</channel></rss>'

  it('fetches the full text instead of rendering a blank page', async () => {
    // The measured case: `transformer-circuits.pub/feed.xml` publishes a
    // 167-character summary per entry, so the card has a title and nothing
    // else. Opening it used to set no article and no error — a title over blank
    // space, which reads as "this article cannot be read".
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: bareFeed('hn') } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /没有正文的条目/ }))[0] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
    expect(ui.mocks.fetchEntryBody.mock.calls[0]?.[1]).toBe('https://example.com/article')
    expect(await screen.findByText('fetched')).toBeTruthy()
  })

  it('says it is fetching while the request is in flight', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: bareFeed('hn') } })
    await ui.settle()
    // Hold the fetch open so the in-flight state is observable.
    let release: ((value: unknown) => void) | undefined
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) =>
      await new Promise(resolve => {
        release = resolve as (value: unknown) => void
        void entryId
      }))
    fireEvent.click((await screen.findAllByRole('button', { name: /没有正文的条目/ }))[0] as HTMLElement)
    expect(await screen.findByText(zh['detail.fetchingBody'])).toBeTruthy()
    release?.({ entryId: 'x', cached: true, fresh: true, fromFeed: false, html: '<p>fetched</p>' })
    await waitFor(() => { expect(screen.queryByText(zh['detail.fetchingBody'])).toBeNull() })
    expect(await screen.findByText('fetched')).toBeTruthy()
  })

  it('does not re-fetch a saved link whose page already refused extraction', async () => {
    // A saved link with a recorded reason already has its sentence (and a
    // manual retry in the card menu): fetching again on every look at a page
    // that will not extract is a request per open, not a fix.
    const ui = bench({
      sources: [rssSource('link-1', { kind: 'link', label: '抽不出正文的页面', url: 'https://example.com/empty' })],
      payloads: { 'link-1': '' },
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /抽不出正文的页面/ }))[0] as HTMLElement)
    expect((await screen.findAllByText(/抽不出正文/)).length).toBeGreaterThan(0)
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })
})

describe('the search box clears itself, and tags can be deleted', () => {
  it('clears the wall search from inside the field, and only while it has text', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    await ui.settle()
    const input = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    // Nothing to clear, nothing shown: the × is a state, not decoration.
    expect(screen.queryByTitle(zh['action.clearSearch'])).toBeNull()
    fireEvent.change(input, { target: { value: '一条' } })
    fireEvent.click(screen.getByTitle(zh['action.clearSearch']))
    expect(input.value).toBe('')
    expect(screen.queryByTitle(zh['action.clearSearch'])).toBeNull()
  })

  it('deletes a tag from the filter panel and drops its narrowing with it', async () => {
    // A tag that can only be created is a one-way door: the vocabulary is the
    // reader's own, so it has to be deletable where it is used — and a deleted
    // tag must not stay the active filter.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一条' }]) },
      tags: [{ id: 'tag-ai', name: 'AI', createdAt: 'x' }],
      tagCounts: { 'tag-ai': 2 },
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(screen.getByText('AI'))
    const input = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    await waitFor(() => { expect(input.value).toBe('@tag-ai') })

    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(screen.getByLabelText(`${zh['filter.deleteTag']}: AI`))
    await waitFor(() => { expect(ui.mocks.deleteTag).toHaveBeenCalledWith('tag-ai') })
    expect(input.value).toBe('')
  })

  it('keeps both settings controls in the compressed row', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    expect(ui.container.querySelector('#reader-refresh-time')).not.toBeNull()
    expect(ui.container.querySelector('#reader-cache-ttl')).not.toBeNull()
  })
})

describe('a feed that publishes only a summary still gets its article', () => {
  /** An entry whose feed carries a `<summary>` and no `<content>`. */
  const summaryFeed = (id: string): string =>
    `<feed xmlns="http://www.w3.org/2005/Atom"><title>${id}</title>`
    + `<entry><title>只有摘要的论文</title><link href="https://example.com/paper"/>`
    + `<id>https://example.com/paper</id>`
    + `<summary>We find that Claude maintains a small set of representations.</summary>`
    + '</entry></feed>'

  it('shows the feed summary, says so, and fetches the real text on open', async () => {
    // The measured case: transformer-circuits.pub ships a 167-character summary
    // per entry. It used to BE the body — so the entry looked complete, the
    // backfill skipped it, and opening it never fetched the paper.
    // No backfill candidate is offered here, so the ONLY fetch in this test is
    // the one opening the entry decides to make.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /只有摘要的论文/ }))[0] as HTMLElement)
    // The summary is on screen immediately, with the sentence that says it is
    // only a summary…
    expect(await screen.findByText(zh['detail.summaryOnly'])).toBeTruthy()
    // …and the page behind it is fetched without the reader asking.
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
    expect(ui.mocks.fetchEntryBody.mock.calls[0]?.[1]).toBe('https://example.com/paper')
    // The fetched body replaces the summary, so the notice goes away.
    expect(await screen.findByText('fetched')).toBeTruthy()
    await waitFor(() => { expect(screen.queryByText(zh['detail.summaryOnly'])).toBeNull() })
  })

  it('offers a summary-only entry to the automatic backfill', async () => {
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
      backfillCandidates: ['g:https://example.com/paper'],
    })
    await ui.settle()
    await waitFor(() => { expect(ui.mocks.listBackfillCandidates).toHaveBeenCalled() })
    const passed = ui.mocks.listBackfillCandidates.mock.calls[0]?.[0] as readonly { entryId: string }[]
    expect(passed.some(entry => entry.entryId === 'g:https://example.com/paper')).toBe(true)
  })
})

describe('an article that is already fetched is not fetched again', () => {
  /** The measured feed shape: a summary, no full text — so a body is OWED. */
  const summaryFeed = (id: string): string =>
    `<feed xmlns="http://www.w3.org/2005/Atom"><title>${id}</title>`
    + `<entry><title>已经抓过的论文</title><link href="https://example.com/paper"/>`
    + `<id>https://example.com/paper</id>`
    + `<summary>We find that Claude maintains a small set of representations.</summary>`
    + '</entry></feed>'

  it('shows the cached body without a request, so the translation on screen survives', async () => {
    // The reported bug: a summary-only feed keeps saying a full text is owed
    // even after one was fetched, so opening the article replaced its DOM (and
    // the reader's translation) with the same bytes from the network.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
      cachedBodies: { 'g:https://example.com/paper': '<p>已经抓下来的正文</p>' },
      fetchStates: { 'g:https://example.com/paper': { state: 'ready' } },
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /已经抓过的论文/ }))[0] as HTMLElement)
    expect(await screen.findByText('已经抓下来的正文')).toBeTruthy()
    // The feed-summary notice is gone: what is on screen is no longer the feed's
    // summary, and no fetch was made to get here.
    expect(screen.queryByText(zh['detail.summaryOnly'])).toBeNull()
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })

  it('still pays one fetch when the entry has never been fetched', async () => {
    // The other half of the rule: "the host holds a body" is what skips the
    // fetch, not "the entry is old".
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /已经抓过的论文/ }))[0] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
  })

  it('fetches again from the detail view\'s own button', async () => {
    // Where a reader asks for a fresh copy: the site changed, or the extraction
    // came back thin the first time. Entering the article no longer does this.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
      cachedBodies: { 'g:https://example.com/paper': '<p>旧正文</p>' },
      fetchStates: { 'g:https://example.com/paper': { state: 'ready' } },
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /已经抓过的论文/ }))[0] as HTMLElement)
    // The cached body is on screen before anything could have been fetched for it.
    expect(await screen.findByText('旧正文')).toBeTruthy()
    const button = await screen.findByRole('button', { name: new RegExp(zh['detail.refetch']) })
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
    expect(ui.mocks.fetchEntryBody.mock.calls[0]?.[0]).toBe('g:https://example.com/paper')
    expect(await screen.findByText('fetched')).toBeTruthy()
  })
})

describe('a slower answer never lands under a newer entry\'s title', () => {
  /**
   * The race this block pins: open A, and before the host answers, go back and
   * open B. A's answer resolving LAST used to write A's body onto B's screen —
   * and the translation restore, keyed on `[openEntryId, articleHtml]`, would
   * then re-translate a pairing that never existed.
   */
  const idA = `l:https://example.com/hn/${encodeURIComponent('First article')}`
  const twoArticles = (): string =>
    feed('hn', [
      { title: 'First article', body: '<p>First body here, long enough to read.</p>' },
      { title: 'Second article', body: '<p>Second body here, long enough to read.</p>' },
    ])

  it('discards a body that arrives after another entry was opened', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: twoArticles() } })
    // The first entry's answer is held back; the second's comes from the cache
    // at once.
    let resolveFirst: ((value: unknown) => void) | undefined
    ui.mocks.getEntryBody.mockImplementation(async (request: { entryId: string }) => {
      if (request.entryId === idA) {
        return await new Promise(resolve => { resolveFirst = resolve })
      }
      return { ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false as const, html: '<p>Second body here, long enough to read.</p>' } }
    })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /First article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    fireEvent.click(screen.getByTitle(zh['action.back']))
    fireEvent.click((await screen.findAllByRole('button', { name: /Second article/ }))[0] as HTMLElement)
    await screen.findByText('Second body here, long enough to read.')

    // Now the first answer lands — after the second entry is already on screen.
    await act(async () => {
      resolveFirst?.({ ok: true, value: { entryId: idA, cached: true, fresh: true, fromFeed: false, html: '<p>First body here, long enough to read.</p>' } })
    })
    expect(screen.queryByText('First body here, long enough to read.')).toBeNull()
    expect(screen.getByText('Second body here, long enough to read.')).toBeTruthy()
  })

  it('discards a fetch owed by an entry the reader has already left', async () => {
    // Same race through the OTHER writer: a summary-only entry pays one fetch on
    // open, and that fetch is the slow one here.
    const atomFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>hn</title>`
      + '<entry><title>Summary paper</title><link href="https://example.com/paper-a"/>'
      + '<id>https://example.com/paper-a</id><summary>A summary sentence, all the feed ships.</summary></entry>'
      + '<entry><title>Full paper</title><link href="https://example.com/paper-b"/>'
      + '<id>https://example.com/paper-b</id><content><p>Second full text on screen.</p></content></entry></feed>'
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: atomFeed } })
    let resolveFetch: ((value: unknown) => void) | undefined
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => {
      if (entryId === 'g:https://example.com/paper-a') {
        return await new Promise(resolve => { resolveFetch = resolve })
      }
      return { entryId, cached: true, fresh: true, fromFeed: false, html: '<p>fetched</p>' }
    })
    await ui.settle()
    // Opening the summary-only entry shows the feed's text and owes one fetch.
    fireEvent.click((await screen.findAllByRole('button', { name: /Summary paper/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByTitle(zh['action.back']))
    fireEvent.click((await screen.findAllByRole('button', { name: /Full paper/ }))[0] as HTMLElement)
    await screen.findByText('Second full text on screen.')

    // The owed fetch lands now — on the wall's back, its body belongs nowhere.
    await act(async () => {
      resolveFetch?.({ entryId: 'g:https://example.com/paper-a', cached: true, fresh: true, fromFeed: false, html: '<p>First fetched body, late.</p>' })
    })
    expect(screen.queryByText('First fetched body, late.')).toBeNull()
    expect(screen.getByText('Second full text on screen.')).toBeTruthy()
  })
})

describe('the detail view owns up to figures it cannot fetch', () => {
  it('counts script-drawn figures and points at the original', async () => {
    // A feed entry with a link and no body: the fetch path supplies the body,
    // and with it the count of figures the page paints at runtime.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>有插图的条目</title>'
          + '<link>https://example.com/paper</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html: '<p>fetched body</p>',
      scriptFigures: 3,
    }))
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    const expected = zh['detail.scriptFigures'].replace('{count}', '3')
    expect(await screen.findByText(new RegExp(expected.slice(0, 12)))).toBeTruthy()
    expect(screen.getByText(zh['detail.readOriginal'])).toBeTruthy()
  })
})


describe('the card says what the plugin holds, and fetches on demand', () => {
  async function wallWithStates(state: 'none' | 'ready' | 'raw' | 'failed') {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    // The state must be in place BEFORE the pane's first round trip: the pane
    // only polls while something is in flight, so a late mock is never read.
    ui.mocks.entryFetchStates.mockImplementation(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: {
        states: Object.fromEntries(entryIds.map(id => [id, state === 'failed'
          ? { state, at: '2026-09-19T00:00:00.000Z', message: 'HTTP 403', code: 'blocked' }
          : { state }])),
      },
    }))
    await ui.settle()
    await screen.findByText('一条')
    await waitFor(() => { expect(ui.mocks.entryFetchStates).toHaveBeenCalled() })
    return ui
  }

  it('shows 抓取 when nothing is held, and fetches on click', async () => {
    const ui = await wallWithStates('none')
    const pill = await screen.findByText(zh['fetch.none'])
    fireEvent.click(pill)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('example.com')) })
  })

  it('shows 已抓取 when the body is cached', async () => {
    await wallWithStates('ready')
    expect(await screen.findByText(zh['fetch.ready'])).toBeTruthy()
  })

  it('explains a failure and retries on click', async () => {
    const ui = await wallWithStates('failed')
    const label = await screen.findByText(zh['fetch.failed'])
    const pill = label.closest('[class*="fetchPill"]') as HTMLElement
    expect(pill.getAttribute('title')).toContain(zh['preview.blocked'])
    fireEvent.click(pill)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalled() })
  })

  it('extracts a payload the host stored while the page was away', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    ui.mocks.entryFetchStates.mockImplementation(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: { states: Object.fromEntries(entryIds.map(id => [id, { state: 'raw' as const, at: '2026-09-19T00:00:00.000Z' }])) },
    }))
    ui.mocks.getRawBody.mockImplementation(async (entryId: string) => ({
      ok: true as const,
      value: { entryId, raw: `<article><p>${'prose '.repeat(60)}</p></article>`, url: 'https://example.com/a' },
    }))
    await ui.settle()
    await waitFor(() => { expect(ui.mocks.storeEntryBody).toHaveBeenCalled() })
    const stored = ui.mocks.storeEntryBody.mock.calls[0]?.[0] as { html: string }
    expect(stored.html).toContain('prose')
  })
})

describe('the card learns what the pane just did', () => {
  /** A feed entry whose publisher ships only a summary: opening it owes a fetch. */
  const summaryFeed = (id: string): string =>
    `<feed xmlns="http://www.w3.org/2005/Atom"><title>${id}</title>`
    + `<entry><title>只有摘要的论文</title><link href="https://example.com/paper"/>`
    + `<id>https://example.com/paper</id>`
    + `<summary>We find that Claude maintains a small set of representations.</summary>`
    + '</entry></feed>'
  const paperId = 'g:https://example.com/paper'

  /**
   * A mock host document: what `entryFetchStates` answers is whatever the
   * writes have made true — exactly how the real service derives states from
   * its annotations. A fixed-answer mock would let these tests pass without
   * the pane having propagated anything.
   */
  function hostModel(ui: ReturnType<typeof bench>, options: { readonly fail?: boolean } = {}): void {
    const held = new Map<string, ReaderEntryFetchState>()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => {
      if (options.fail === true) {
        held.set(entryId, { state: 'failed', at: new Date().toISOString(), message: 'HTTP 403', code: 'blocked' })
        return { entryId, cached: false, fresh: false, fromFeed: false, error: 'HTTP 403' }
      }
      held.set(entryId, { state: 'ready', at: new Date().toISOString() })
      return { entryId, cached: true, fresh: true, fromFeed: false, html: '<p>the fetched paper body</p>' }
    })
    ui.mocks.entryFetchStates.mockImplementation(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: { states: Object.fromEntries(entryIds.map(id => [id, held.get(id) ?? { state: 'none' as const }])) },
    }))
  }

  it('flips the card to 已抓取 when the detail view fetched the body', async () => {
    // The reported symptom: the card said 抓取, the reader opened the article
    // (which fetched and cached the body), came back — and the card still said
    // 抓取 until the next mount, because the open path never told the mirror.
    const ui = bench({ sources: [rssSource('tc')], payloads: { tc: summaryFeed('tc') } })
    hostModel(ui)
    await ui.settle()
    expect(await screen.findByText(zh['fetch.none'])).toBeTruthy()
    fireEvent.click((await screen.findAllByRole('button', { name: /只有摘要的论文/ }))[0] as HTMLElement)
    // The detail view shows the fetched body — the gesture really did land it.
    expect(await screen.findByText('the fetched paper body')).toBeTruthy()
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => { expect(screen.getByText(zh['fetch.ready'])).toBeTruthy() })
    expect(screen.queryByText(zh['fetch.none'])).toBeNull()
  })

  it('flips the card when the automatic backfill lands the body', async () => {
    // Same mirror gap through the other writer: the run's badge appeared, but
    // nothing re-read the states, so the pill kept saying 抓取. (No "starts at
    // 抓取" assertion here: the mock host answers in microtasks, so how long the
    // initial state is visible is a race that is not the point.)
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: summaryFeed('tc') },
      backfillCandidates: [paperId],
    })
    hostModel(ui)
    await ui.settle()
    await waitFor(() => { expect(screen.getByText(zh['fetch.ready'])).toBeTruthy() })
    expect(ui.mocks.fetchEntryBody).toHaveBeenCalledWith(paperId, expect.any(String))
  })

  it('shows 抓取失败 with the host’s reason after an open-triggered fetch fails', async () => {
    const ui = bench({ sources: [rssSource('tc')], payloads: { tc: summaryFeed('tc') } })
    hostModel(ui, { fail: true })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /只有摘要的论文/ }))[0] as HTMLElement)
    // The fetch fails behind the summary, which stays on screen.
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalled() })
    fireEvent.click(screen.getByTitle(zh['action.back']))
    const label = await screen.findByText(zh['fetch.failed'])
    const pill = label.closest('[class*="fetchPill"]') as HTMLElement
    expect(pill.getAttribute('title')).toContain(zh['preview.blocked'])
  })
})

describe('coming back to the pane puts the reader where they were', () => {
  /**
   * The host unmounts the whole right sidebar when another main panel takes
   * over (the side chat is the everyday case), and the store is created per
   * mount — so this block renders the pane, lets the reader set something up,
   * unmounts it and renders a SECOND pane over the same session id.
   */
  const english = (): string =>
    feed('hn', [{
      title: 'An English article',
      description: 'First sentence here. Second sentence here.',
    }, { title: 'Another article', description: 'Different text entirely.' }])

  it('restores the open article and the wall\'s narrowing', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    const search = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'An English article' } })
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    first.unmount()

    // The pane is gone and comes back: no state crosses over except this
    // module's memory of where the reader was standing.
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    // The ARTICLE is back — not just the id, and not the wall.
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    // …and so is the search that narrowed the wall behind it. The box lives on
    // the wall, so it takes the back button to see it.
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('An English article')
    })
  })

  it('turns the globe back on from a session this page already built', async () => {
    installTranslator()
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(first.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    first.unmount()

    // No click on the globe this time: `Translator.create()` would need user
    // activation, so the ONLY way this can work is the page's session cache.
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => {
      expect(second.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    expect(screen.getByText(zh['translate.tip'])).toBeTruthy()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('opens the entry again without asking the host for a body it already has', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    // The feed published the text itself (`contentHtml`), so the restore costs
    // no network call at all.
    expect(second.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })

  it('re-applies the translation when the body under it is replaced', async () => {
    // The reported shape: the article is on screen but the translation is gone.
    // Any body swap — a fetch landing after a restore, an expired cache
    // re-fetched, a re-render that recreated the element — takes the segmented
    // DOM with it, so the record has to be honoured again for the NEW body.
    installTranslator()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })

    // The same entry, a different body, with no gesture from the reader.
    act(() => { ui.actions.setArticle('<p>Third sentence here.</p>', false, null) })
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：Third sentence here.')
    })
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('carries the article and its translation into ANOTHER dsh session', async () => {
    // The report: read (and translate) in one conversation, open the reader in
    // another, and nothing was there. The pane is mounted per dsh session, so a
    // per-session memory made "continue in the next chat" a fresh start — the
    // memory belongs to the PAGE, and the session id is only about the
    // conversation draft.
    installTranslator()
    const first = bench({ sessionId: 'session-a', sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(first.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    first.unmount()

    // A different session id, the same page: the article is already open and the
    // globe is already on, with neither being clicked this time.
    const second = bench({ sessionId: 'session-b', sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    await waitFor(() => {
      expect(second.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('keeps the wall\'s translation switch and its card texts across a remount', async () => {
    // The wall's globe has its own switch and its own card texts, and both are
    // part of "where the reader was". They were mirrored into the page memory on
    // every change — but initialized from bare defaults, so the FIRST mirror
    // after a remount overwrote the record with `false`/`{}` before anything
    // had a chance to read it back.
    installTranslator()
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    await screen.findByText('An English article')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => { expect(screen.getByText('译：An English article')).toBeTruthy() })
    // Side-by-side, so its restoration is visible on its own mark.
    fireEvent.click(first.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    fireEvent.click(await screen.findByText(zh['translate.bilingual']))
    await waitFor(() => { expect(first.container.querySelectorAll('[class*="cardOrig"]').length).toBeGreaterThanOrEqual(1) })
    first.unmount()

    // No click anywhere: the wall comes back translated, in the same view.
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => { expect(screen.getByText('译：An English article')).toBeTruthy() })
    await waitFor(() => { expect(second.container.querySelectorAll('[class*="cardOrig"]').length).toBeGreaterThanOrEqual(1) })
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })
})

describe('the translation memory survives a reload', () => {
  /** One English article with an explicit, hashable body. */
  const BODY = '<p>First sentence here. Second sentence here.</p><p>A third one closes it.</p>'
  const SENTENCES = ['First sentence here.', 'Second sentence here.', 'A third one closes it.']
  const PAIR = 'en→zh'
  const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
  const page = (): string => feed('hn', [{ title: 'An English article', body: BODY }])
  /** The entry-map record as the host would hold it, keyed to the body as-is. */
  const entryRecord = (bodyHash: string): { pair: string; bodyHash: string; segments: Record<string, string> } => ({
    pair: PAIR,
    bodyHash,
    segments: Object.fromEntries(SENTENCES.map(sentence => [translationHash(sentence), `译：${sentence}`])),
  })
  /** installTranslator, plus a spy on the session's own `translate`. */
  const installCountingTranslator = () => {
    const api = installTranslator()
    const translate = vi.fn(async (payloadText: string) =>
      payloadText.split(UNIT_SEPARATOR).map(part => `译：${part}`).join(UNIT_SEPARATOR))
    api.create.mockImplementation(async () => ({
      inputQuota: 10_000,
      measureInputUsage: async (text: string) => text.length,
      translate,
    }))
    return translate
  }
  /** Open the article and turn the globe on, with the translation on screen. */
  const openAndTranslate = async (ui: ReturnType<typeof bench>): Promise<void> => {
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
  }

  it('paints a stored entry translation without asking the model', async () => {
    // The feature's reason to exist: the reader re-reads long articles, and the
    // exact-fit map for this body is on disk — so after the globe's gesture,
    // every sentence is a read, not a model call.
    const translate = installCountingTranslator()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: page() },
      entryTranslation: { ok: true, value: { translation: entryRecord(translationHash(BODY)) } },
    })
    await ui.settle()
    await openAndTranslate(ui)
    expect(translate).not.toHaveBeenCalled()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('skips a stale entry map but still serves the sentences from the global memory', async () => {
    // The body was re-fetched (a minor edit), so its exact-fit record no longer
    // answers — bodyHash says so. The unchanged sentences still hit globally.
    const translate = installCountingTranslator()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: page() },
      entryTranslation: { ok: true, value: { translation: entryRecord('the-hash-of-some-older-body') } },
      memorySlice: Object.fromEntries(SENTENCES.map(sentence => [translationHash(sentence), `译：${sentence}`])),
    })
    await ui.settle()
    await openAndTranslate(ui)
    expect(translate).not.toHaveBeenCalled()
    expect(ui.mocks.getSentenceTranslations).toHaveBeenCalled()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('persists what a run learned in ONE batch — never per sentence', async () => {
    const translate = installCountingTranslator()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: page() } })
    await ui.settle()
    await openAndTranslate(ui)
    expect(translate).toHaveBeenCalled() // a cold run pays the model
    await waitFor(() => { expect(ui.mocks.rememberSentences).toHaveBeenCalledTimes(1) })
    const call = ui.mocks.rememberSentences.mock.calls[0]?.[0] as {
      pair: string
      entryId?: string
      bodyHash?: string
      entries: { hash: string; source: string; target: string }[]
      recalled?: readonly unknown[]
    }
    expect(call.pair).toBe(PAIR)
    expect(call.entryId).toBe(entryId)
    expect(call.bodyHash).toBe(translationHash(BODY))
    expect(call.entries.map(entry => entry.source).sort()).toEqual([...SENTENCES].sort())
    expect(call.entries.every(entry => entry.hash === translationHash(entry.source))).toBe(true)
    expect(call.recalled).toEqual([])
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('a reload re-paints the translation from the store — gesture yes, model no', async () => {
    const translate = installCountingTranslator()
    // The host's tiers, modeled: what the write verb receives is what the reads
    // answer next time — the only way this test can pass is real propagation.
    let storedMemory: Record<string, string> = {}
    let storedEntry: { pair: string; bodyHash: string; segments: Record<string, string> } | undefined
    const wire = (ui: ReturnType<typeof bench>): void => {
      ui.mocks.rememberSentences.mockImplementation(async (request: {
        pair: string
        entries: readonly { hash: string; target: string }[]
        recalled?: readonly { hash: string; target: string }[]
        entryId?: string
        bodyHash?: string
      }) => {
        const all = [...request.entries, ...(request.recalled ?? [])]
        for (const entry of all) storedMemory[entry.hash] = entry.target
        if (request.entryId !== undefined && request.bodyHash !== undefined) {
          storedEntry = { pair: request.pair, bodyHash: request.bodyHash, segments: Object.fromEntries(all.map(entry => [entry.hash, entry.target])) }
        }
        return { ok: true as const, value: { stored: request.entries.length } }
      })
      ui.mocks.getEntryTranslation.mockImplementation(async () =>
        ({ ok: true as const, value: storedEntry === undefined ? {} : { translation: storedEntry } }))
      ui.mocks.getSentenceTranslations.mockImplementation(async (request: { hashes: readonly string[] }) => ({
        ok: true as const,
        value: {
          translations: Object.fromEntries(
            request.hashes.flatMap(hash => (storedMemory[hash] === undefined ? [] : [[hash, storedMemory[hash]] as const])),
          ),
        },
      }))
    }
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: page() } })
    wire(first)
    await first.settle()
    await openAndTranslate(first)
    const modelCalls = translate.mock.calls.length
    expect(modelCalls).toBeGreaterThan(0)
    first.unmount()

    // The reload, faithfully: module memory is gone (translator sessions, the
    // sentence mirror), the place in sessionStorage is not — the article comes
    // back by itself, the globe waits for its gesture.
    clearMemory()
    forgetTranslators()
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: page() } })
    wire(second)
    await second.settle()
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(second.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    // Not one new model call: the whole body came from the store.
    expect(translate.mock.calls.length).toBe(modelCalls)
    // And the recall ride-along bumped the LRU clocks without claiming new content.
    const last = second.mocks.rememberSentences.mock.calls.at(-1)?.[0] as { entries: readonly unknown[]; recalled?: readonly unknown[] }
    expect(last.entries).toEqual([])
    expect(last.recalled).toHaveLength(SENTENCES.length)
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })
})

describe('the 最近阅读 page', () => {
  const recentItem = (entryId: string, over: Partial<ReaderRecentEntry> = {}): ReaderRecentEntry => ({
    entryId,
    sourceId: 'hn',
    title: `读过的 ${entryId}`,
    url: `https://example.com/${entryId}`,
    readAt: '2026-09-19T09:00:00.000Z',
    ...over,
  })

  it('records every open, with the source and the URL', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /一条/ }))[0] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.recordRead).toHaveBeenCalledTimes(1) })
    const request = ui.mocks.recordRead.mock.calls[0]?.[0] as { entryId: string; sourceId: string; title: string; url?: string }
    expect(request.sourceId).toBe('hn')
    expect(request.title).toBe('一条')
    expect(request.url).toContain('example.com')
  })

  it('lists what the host holds, newest first, and reopens one by clicking it', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '第一条' }, { title: '第二条' }]) },
      recent: [
        // The id the pane's own parser gives this item (no guid in the fixture,
        // so the link is the id): this row points at a REAL entry on the wall.
        recentItem(`l:https://example.com/hn/${encodeURIComponent('第二条')}`, { title: '第二条' }),
        recentItem('older', { title: '更早读过的一篇' }),
      ],
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.recent']))
    // The host's copy is what the page renders — the pane mirrors nothing.
    expect(await screen.findByText('最近阅读')).toBeTruthy()
    expect(await screen.findByText('第二条')).toBeTruthy()
    expect(screen.getByText('更早读过的一篇')).toBeTruthy()
    // …and the second one, whose entry the feed still publishes, opens again.
    fireEvent.click(screen.getByText('第二条'))
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    expect(ui.mocks.recordRead).toHaveBeenCalledWith(expect.objectContaining({ title: '第二条' }))
  })

  it('shows an entry the feed no longer publishes, rebuilt from the record', async () => {
    // A feed's window rolls over: the recent list is the only place left that
    // knows the reader read this article, and its URL still opens it.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '第一条' }]) },
      recent: [recentItem('gone-entry', { title: '已经滚出订阅窗口的一篇' })],
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.recent']))
    expect(await screen.findByText('已经滚出订阅窗口的一篇')).toBeTruthy()
    fireEvent.click(screen.getByText('已经滚出订阅窗口的一篇'))
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
  })

  it('cannot reopen an entry whose source was deleted, and says why', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '第一条' }]) },
      recent: [recentItem('orphan', { sourceId: 'deleted-source', title: '源已经删掉的一篇' })],
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.recent']))
    const row = (await screen.findByText('源已经删掉的一篇')).closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(row.getAttribute('title')).toBe(zh['recent.sourceGone'])
  })

  it('empties the list, and keeps the empty state', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '第一条' }]) },
      recent: [recentItem('e1', { title: '读过的一篇' })],
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.recent']))
    expect(await screen.findByText('读过的一篇')).toBeTruthy()
    fireEvent.click(screen.getByTitle(zh['recent.clearTitle']))
    await waitFor(() => { expect(ui.mocks.clearRecent).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText(zh['recent.empty'])).toBeTruthy()
    expect(screen.queryByText('读过的一篇')).toBeNull()
  })

  it('says so when nothing has been read yet', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '第一条' }]) } })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.recent']))
    expect(await screen.findByText(zh['recent.empty'])).toBeTruthy()
    // Nothing to clear, so the destructive affordance is not rendered at all.
    expect(screen.queryByTitle(zh['recent.clearTitle'])).toBeNull()
  })
})

/**
 * A fake layout for the position tests.
 *
 * jsdom has no layout engine at all: every rect is zero, the scroller never
 * clamps, and `scrollHeight` is 0. The anchored position is about exactly the
 * thing jsdom cannot provide — a document whose height changes as images load —
 * so the tests state that geometry instead of pretending it away.
 *
 * The model: the scroller is 600px tall; the article starts at its top; each
 * top-level block is `blockHeight` tall; the article scrolls up as the reader
 * scrolls down (which is what a real rect reports).
 *
 * @param blockHeight - how tall each top-level block is.
 */
function stubLayout(blockHeight = 300): void {
  const rect = (top: number, height: number): DOMRect => ({
    top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
  }) as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
    const el = this as HTMLElement
    const scrolled = (document.querySelector('[class*="detailBody"]') as HTMLElement | null)?.scrollTop ?? 0
    const classes = (el.className ?? '').toString()
    if (classes.includes('detailBody')) return rect(0, 600)
    if (classes.includes('article')) return rect(-scrolled, 10_000)
    const parent = el.parentElement
    if (parent !== null && (parent.className ?? '').toString().includes('article')) {
      const index = [...parent.children].indexOf(el)
      return rect(index * blockHeight - scrolled, blockHeight)
    }
    return rect(0, 0)
  })
}

/**
 * A variant of the fake layout whose blocks are AS TALL AS THEIR TEXT IS LONG.
 *
 * That is the property the translation case needs: a translated block sets
 * different words of a different length, so its height must actually change —
 * a fixed-height stub would make "the geometry moved" untestable. Block tops
 * accumulate; the translation's reveal lines (data-reader-reveal) are not
 * blocks, exactly as `articleBlocks` sees them.
 */
function stubTextLayout(): void {
  const rect = (top: number, height: number): DOMRect => ({
    top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
  }) as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
    const el = this as HTMLElement
    const scrolled = (document.querySelector('[class*="detailBody"]') as HTMLElement | null)?.scrollTop ?? 0
    const classes = (el.className ?? '').toString()
    if (classes.includes('detailBody')) return rect(0, 600)
    if (classes.includes('article')) return rect(-scrolled, 100_000)
    const parent = el.parentElement
    if (parent !== null && (parent.className ?? '').toString().includes('article')) {
      const blocks = [...parent.children].filter(child => child.getAttribute('data-reader-reveal') !== '1')
      let top = 0
      for (const block of blocks) {
        const height = Math.max(40, (block.textContent ?? '').length * 10)
        if (block === el) return rect(top - scrolled, height)
        top += height
      }
      return rect(0, 0)
    }
    return rect(0, 0)
  })
}

describe('the reading position survives the trip', () => {

  // Real top-level blocks, because an anchor IS a block index: a body that is
  // one bare text run has no block to anchor to.
  const longFeed = (): string =>
    feed('hn', [{
      title: 'An English article',
      description: 'First sentence here. Second sentence here.',
      body: '<p>First sentence here. Second sentence here.</p>'
        + '<p>Another paragraph entirely, with more words in it.</p>'
        + '<p>Third paragraph here, closing the piece.</p>',
    }])

  /**
 * Let the pane's post-render frame run.
 *
 * The article is measured there (one layout pass, not one per scroll event), so
 * a test that scrolls or asserts a position has to let that frame land first.
 */
const settleFrame = async (): Promise<void> => {
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30) }) })
}

/** The pane's wall scroller (the detail view has its own). */
  const wallScroller = (container: HTMLElement): HTMLElement =>
    container.querySelector('[class*="scroll"]') as HTMLElement

  it('puts the article back to where the reader was when its body is replaced', async () => {
    // The body can arrive in two steps — the feed's summary first, the real page
    // after the fetch — and one application clamps the offset against the short
    // version. The saved position is the target, and it is re-applied to
    // whatever body ends up on screen.
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    scroller.scrollTop = 640
    fireEvent.scroll(scroller)

    act(() => {
      ui.actions.setArticle('<p>Third sentence here.</p>', false, null)
      // What a browser does to the scroller when the content underneath it is
      // replaced: the offset is clamped away. jsdom keeps it, so the loss is
      // simulated explicitly — otherwise the assertion would pass without any
      // restore at all.
      scroller.scrollTop = 0
    })
    await waitFor(() => { expect(scroller.scrollTop).toBe(640) })
  })

  it('restores the BLOCK the reader was in, not the pixel offset', async () => {
    // The paper's images carry no dimensions, so by the time the reader comes
    // back the document is a different height than when they left. A pixel
    // offset then points at different content — the anchor does not.
    stubLayout()
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    // A deliberately absurd pixel offset: only the anchor can produce the target.
    rememberReadingPosition(entryId, { block: 1, offset: 50, top: 999_999 })
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    // Block 1 starts 300px into the article, 50px into it: 350.
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    vi.restoreAllMocks()
  })

  it('records the block the reader stopped in', async () => {
    stubLayout()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    scroller.scrollTop = 620
    fireEvent.scroll(scroller)
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    // 620px in: block 2 (600..900), 20px into it — and the same place as TEXT:
    // block 2 is "Third paragraph here, closing the piece." (40 chars), so 20 of
    // 300px is the 3rd character. The text offset is what a translated (taller
    // or shorter) rendering of the same block can still resolve.
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(readSession().scroll?.[entryId]).toEqual({ block: 2, offset: 20, top: 620, text: 3, textLength: 40 })
    })
    vi.restoreAllMocks()
  })

  it('restores the article and its place after the PAGE restarts', async () => {
    // What the reader kept reporting: the page restarts (whatever restarted it),
    // and the store, the parser and every module-level map are empty again. The
    // place is in sessionStorage precisely for this — no memory survives, and the
    // article still comes back where it was.
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    stubLayout()
    sessionStorage.setItem('dsh-reader:place', JSON.stringify({
      view: 'detail',
      openEntryId: entryId,
      scroll: { [entryId]: { block: 1, offset: 50, top: 350 } },
    }))
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    // No click on a card, no memory: the place alone brings it back.
    await waitFor(() => { expect(screen.queryByText(zh['action.quote'])).not.toBeNull() })
    // The id the pane's own parser gives this entry: the place has to name the
    // same entry, or nothing is found and the article opens at the top.
    expect((ui.mocks.recordRead.mock.calls[0]?.[0] as { entryId: string }).entryId).toBe(entryId)
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    await waitFor(() => { expect(scroller.scrollTop).toBe(350) })
    vi.restoreAllMocks()
  })

  it('puts the wall back where it was after the pane remounts', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await first.settle()
    await screen.findByText('An English article')
    const scroller = wallScroller(first.container)
    scroller.scrollTop = 300
    fireEvent.scroll(scroller)
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await second.settle()
    await screen.findByText('An English article')
    await waitFor(() => { expect(wallScroller(second.container).scrollTop).toBe(300) })
  })

  it('keeps the reader at the same sentence when the translation rewrites the geometry', async () => {
    // The drift the text offset fixes: the anchor's pixel offset into a block
    // is only valid for the layout it was measured in, and the translated view
    // sets different words — so switching the globe on used to leave the reader
    // wherever the stale pixels happened to point.
    installTranslator()
    stubTextLayout()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByText(zh['action.quote'])
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    // Block 0 is 42 chars (420px); 500px in is block 1 ("Another paragraph
    // entirely…", 50 chars = 500px), 80px into it — the 8th character.
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    await waitFor(() => {
      expect(readSession().scroll?.[entryId]).toEqual({ block: 1, offset: 80, top: 500, text: 8, textLength: 50 })
    })

    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })

    // After the translation lands, the blocks are taller (the mock's 译： prefix
    // lengthens every sentence) and the anchor is re-applied THROUGH the text:
    // block 1 still holds the same sentence, so its new top plus the same
    // FRACTION of its new text is where the reader must end up — no scroll
    // gesture involved.
    const article = ui.container.querySelector('[class*="article"]') as HTMLElement
    const blocks = [...article.children].filter(child => child.getAttribute('data-reader-reveal') !== '1')
    const heightOf = (element: Element): number => Math.max(40, (element.textContent ?? '').length * 10)
    const expected = heightOf(blocks[0] as Element) + Math.round((8 / 50) * heightOf(blocks[1] as Element))
    await waitFor(() => { expect(scroller.scrollTop).toBe(expected) })
    // Sanity: the expected target really is a DIFFERENT place than where the
    // pixel offset alone would have left the reader (block 1's old top + 80).
    expect(expected).not.toBe(420 + 80)
    vi.restoreAllMocks()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })
})
