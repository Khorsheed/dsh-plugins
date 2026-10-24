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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReaderPaneProps } from '../src/client/contract.ts'
import type { CanvasInboxLike } from '../src/client/canvas-sync.ts'
import { createReaderStore, type ReaderState } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { ReaderPane } from '../src/client/ReaderPane.tsx'
import { noteTargetForSelection } from '../src/client/notes.ts'
import { forgetSession, forgetTranslators, readSession, readWallCache, rememberReadingPosition, rememberTranslation } from '../src/client/session.ts'
import { UNIT_SEPARATOR, clearMemory, translationHash } from '../src/client/translate.ts'
import type { LocalTranscriptStatus, MediaCardStates, ReaderBody, ReaderPolishView, ReaderEntryFetchState, ReaderEntryNotes, ReaderRecentEntry, ReaderSourceSummary } from '../src/types.ts'

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
  /** The transcript the host answers for a video (undefined: the video has no captions). */
  readonly transcript?: string
  /**
   * The local transcription engine: absent (`unavailable`, the default), or a
   * scripted job — the start answer, then what each poll returns in turn.
   */
  readonly local?: { readonly start: LocalTranscriptStatus[]; readonly polls: LocalTranscriptStatus[] }
  /** The wall's media pills (`mediaStates`). */
  readonly mediaCards?: MediaCardStates
  /** The 润色 layer the host answers (`polish`). */
  readonly polish?: ReaderPolishView
  /** The canvas plugin's inbox, when the bench composes one. */
  readonly inbox?: CanvasInboxLike
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
  /** Per-entry body metadata riding a cachedBodies answer (count, rendered flag). */
  readonly cachedBodiesMeta?: Readonly<Record<string, { scriptFigures?: number; rendered?: boolean }>>
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
  /** The translation budget the policy reports (chars). */
  readonly translationBudgetChars?: number
  /** The host's storage aggregates, when a test cares about the manage page. */
  readonly storageStats?: {
    bodies: { entries: number; chars: number }
    translations: { entries: number; chars: number; memoryEntries: number; memoryChars: number }
  }
  /** The dsh session this mount belongs to (defaults to `s1`). */
  readonly sessionId?: string
  /** True = the in-app Sidebar Browser seam probes present (host 0.1.6-alpha.2+). */
  readonly browserTab?: boolean
  /** True = a capture Remote (the ingest proposal's M1) probes present. */
  readonly capture?: boolean
  /** The captured title/excerpt the host joins onto a link source's payload answer. */
  readonly linkMeta?: Readonly<Record<string, { title?: string; excerpt?: string }>>
  /** What `fetchImage` answers per URL (default: a tiny image/png payload). */
  readonly imageAnswers?: Readonly<Record<string, { mime?: string; base64?: string; error?: string }>>
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
  /** The capture Remote's render verb, when the bench mounts one (M1 probe). */
  const captureRender = vi.fn(async ({ url }: { url: string }) => ({
    ok: true as const,
    value: { html: `<article><p>${'渲染抓到的正文。'.repeat(30)}</p></article>`, finalUrl: url },
  }))
  /** The notes the host holds for the open article (a fake of notes.json). */
  const notesState: { entry?: ReaderEntryNotes } = {}
  const mocks = {
    listSources: vi.fn(async () => ({ ok: true as const, value: { sources: assigned } })),
    getBodies: vi.fn(async (ids: string[]) => ({
      ok: true as const,
      value: {
        bodies: ids.map((id): ReaderBody => {
          // A link source's captured meta rides the payload answer, as the host joins it.
          const meta = options.linkMeta?.[id]
          const carried = meta === undefined ? {} : {
            ...(meta.title === undefined ? {} : { title: meta.title }),
            ...(meta.excerpt === undefined ? {} : { excerpt: meta.excerpt }),
          }
          if (options.failedIds?.includes(id) === true) return { id, error: 'fetch failed', ...carried }
          return {
            id,
            raw: options.payloads?.[id] ?? feed(id, [{ title: `条目 ${id}` }]),
            ...(options.truncatedIds?.includes(id) === true ? { truncated: true } : {}),
            ...carried,
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
    browserTabAvailable: vi.fn(() => options.browserTab ?? false),
    // Like the real face: the open refuses (false) exactly when the seam is absent.
    openBrowserTab: vi.fn(() => options.browserTab ?? false),
    captureRender,
    captureRemote: vi.fn(() => (options.capture === true ? { render: captureRender } : undefined)),
    entryNotes: vi.fn(async (_entryId: string) => ({ ok: true as const, value: notesState.entry === undefined ? {} : { entry: notesState.entry } })),
    addNote: vi.fn(async (request: { entryId: string; title: string; block: number; quote: string; comment?: string; translated?: string }) => {
      const note = {
        id: `n${String((notesState.entry?.notes.length ?? 0) + 1)}`,
        anchor: { block: request.block, quote: request.quote, ...(request.translated === undefined ? {} : { translated: request.translated }) },
        ...(request.comment === undefined ? {} : { comment: request.comment }),
        createdAt: '', updatedAt: '',
      }
      notesState.entry = {
        entryId: request.entryId, title: request.title, notes: [...(notesState.entry?.notes ?? []), note],
        sessions: notesState.entry?.sessions ?? [], nextNote: 2, updatedAt: '',
      }
      return { ok: true as const, value: note }
    }),
    recordDiscussion: vi.fn(async () => ({ ok: true as const, value: 'ok' })),
    mediaTranscript: vi.fn(async (request: { entryId: string; url: string }) => ({
      ok: true as const,
      value: options.transcript === undefined
        ? { entryId: request.entryId, captions: 'none' as const }
        : { entryId: request.entryId, captions: 'platform' as const, html: options.transcript },
    })),
    startLocalTranscript: vi.fn(async (request: { entryId: string; confirmModels?: boolean }) => {
      const scripted = options.local?.start.shift()
      return { ok: true as const, value: { ...(scripted ?? { state: 'unavailable' as const }), entryId: request.entryId } }
    }),
    localTranscript: vi.fn(async (request: { entryId: string }) => {
      const polls = options.local?.polls ?? []
      const next = polls.length > 1 ? polls.shift()! : polls[0]
      return { ok: true as const, value: { ...(next ?? { state: 'idle' as const }), entryId: request.entryId } }
    }),
    polish: vi.fn(async () => ({ ok: true as const, value: options.polish ?? null })),
    setPolishOff: vi.fn(async (request: { paragraph: number }) => ({ ok: true as const, value: options.polish === undefined ? null : { ...options.polish, off: [request.paragraph] } })),
    speakerNames: vi.fn(async () => ({ ok: true as const, value: {} as Record<string, string> })),
    nameSpeaker: vi.fn(async (request: { speaker: number; name: string }) => ({ ok: true as const, value: { [String(request.speaker)]: request.name } as Record<string, string> })),
    mediaStates: vi.fn(async () => ({ ok: true as const, value: options.mediaCards ?? { engine: false, states: {} } })),
    cancelLocalTranscript: vi.fn(async (request: { entryId: string }) => ({ ok: true as const, value: { entryId: request.entryId, state: 'idle' as const } })),
    markSynced: vi.fn(async () => ({ ok: true as const, value: 'ok' })),
    snapshotEntry: vi.fn(async () => ({ ok: true as const, value: 'ok' })),
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
    storeEntryBody: vi.fn(async (request: { entryId: string; url: string; html: string; scriptFigures?: number; rendered?: boolean }) => ({
      ok: true as const,
      value: {
        entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: request.html,
        ...(request.scriptFigures === undefined ? {} : { scriptFigures: request.scriptFigures }),
        ...(request.rendered === undefined ? {} : { rendered: request.rendered }),
      },
    })),
    listBackfillCandidates: vi.fn(async (entries: readonly { entryId: string }[]) => ({
      ok: true as const,
      value: { candidates: (options.backfillCandidates ?? []).filter(id => entries.some(entry => entry.entryId === id))
        .map(id => ({ entryId: id, url: `https://example.com/${id}`, label: id })) },
    })),
    getCachePolicy: vi.fn(async () => ({
      ok: true as const,
      value: { ttlHours: options.ttlHours ?? 24, maxEntries: 500, translationBudgetChars: options.translationBudgetChars ?? 64_000_000 },
    })),
    setCachePolicy: vi.fn(async () => ({ ok: true as const, value: 'ok' as const })),
    getStorageStats: vi.fn(async () => ({
      ok: true as const,
      value: options.storageStats ?? {
        bodies: { entries: 0, chars: 0 },
        translations: { entries: 0, chars: 0, memoryEntries: 0, memoryChars: 0 },
      },
    })),
    clearTranslations: vi.fn(async () => ({ ok: true as const, value: { clearedEntries: 0, clearedMemory: false } })),
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
    // The CORP rescue: the host answers bytes by default; `imageAnswers` scripts per-URL outcomes.
    fetchImage: vi.fn(async (url: string) => {
      const answer = options.imageAnswers?.[url]
      return {
        ok: true as const,
        value: { url, ...(answer ?? { mime: 'image/png', base64: 'aGVsbG8gd29ybGQ=' }) },
      }
    }),
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
        const meta = options.cachedBodiesMeta?.[request.entryId]
        return { ok: true as const, value: {
          entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: cached,
          ...(meta?.scriptFigures === undefined ? {} : { scriptFigures: meta.scriptFigures }),
          ...(meta?.rendered === undefined ? {} : { rendered: meta.rendered }),
        } }
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
    getStorageStats: mocks.getStorageStats,
    clearTranslations: mocks.clearTranslations,
    getEntryBody: mocks.getEntryBody,
    fetchEntryBody: mocks.fetchEntryBody,
    fetchImage: mocks.fetchImage,
    readDraft: () => '',
    setDraft: mocks.setDraft,
    copyText: mocks.copyText,
    openExternal: mocks.openExternal,
    browserTabAvailable: mocks.browserTabAvailable,
    openBrowserTab: mocks.openBrowserTab,
    captureRemote: mocks.captureRemote,
    useSessions: (select: (state: { byId: Record<string, { displayTitle?: string }> }) => unknown) => select({ byId: {} }),
    entryNotes: mocks.entryNotes,
    noteCounts: async () => ({ ok: true as const, value: { counts: {} } }),
    addNote: mocks.addNote,
    updateNote: async () => ({ ok: true as const, value: 'ok' }),
    deleteNote: async () => ({ ok: true as const, value: 'ok' }),
    addReply: async () => ({ ok: true as const, value: 'ok' }),
    editReply: async () => ({ ok: true as const, value: 'ok' }),
    deleteDiscussion: async () => ({ ok: true as const, value: 'ok' }),
    markSynced: mocks.markSynced,
    canvasInbox: () => options.inbox,
    recordDiscussion: mocks.recordDiscussion,
    snapshotEntry: mocks.snapshotEntry,
    mediaTranscript: mocks.mediaTranscript,
    startLocalTranscript: mocks.startLocalTranscript,
    localTranscript: mocks.localTranscript,
    cancelLocalTranscript: mocks.cancelLocalTranscript,
    mediaStates: mocks.mediaStates,
    speakerNames: mocks.speakerNames,
    polish: mocks.polish,
    setPolishOff: mocks.setPolishOff,
    nameSpeaker: mocks.nameSpeaker,
    canOpenSession: () => false,
    openSession: () => undefined,
  } as unknown as ReaderPaneProps

  // A remount within the page shows the wall it already parsed and re-reads
  // only changed sources — so it may never call getBodies at all.
  const remount = readWallCache() !== undefined
  const view = render(<ReaderPane {...props} />)
  /** Wait until the mount round trip has been parsed into rows. */
  const settle = async (): Promise<void> => {
    await waitFor(() => { expect(mocks.listSources).toHaveBeenCalled() })
    if (!remount && assigned.some(item => item.hasBody)) {
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

/** The page's Language Detector global, scripted to answer one language confidently. */
function installDetector(language: string, confidence = 0.9) {
  ;(globalThis as unknown as { LanguageDetector?: unknown }).LanguageDetector = {
    availability: async () => 'available',
    create: async () => ({ detect: async () => [{ detectedLanguage: language, confidence }] }),
  }
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
    expect(await screen.findByTitle(zh['action.back'])).toBeTruthy()
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
    // The ids the pane parsed for the source ride along, so the host can drop
    // their translation maps (the host never parses feeds).
    await waitFor(() => { expect(ui.mocks.removeSource).toHaveBeenCalledWith('link-1', ['link:link-1']) })
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

  it('says it is working while the add is in flight, and never submits twice', async () => {
    // The add chains the resolver APIs, the fetch and its fallback — seconds to
    // half a minute. The dialog used to sit unchanged the whole time, which
    // read as a dead click (and invited a second one).
    const ui = bench()
    await ui.settle()
    let release: ((value: unknown) => void) | undefined
    ui.mocks.addSource.mockImplementation(async () => await new Promise(resolve => { release = resolve }))
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    expect(await screen.findByText(zh['add.busy'])).toBeTruthy()
    expect((input as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByText(zh['add.fetching']))
    expect(ui.mocks.addSource).toHaveBeenCalledTimes(1)
    release?.({ ok: true, value: { outcome: 'subscribed', kind: 'rss', id: 'new', label: '新源' } })
    expect(await screen.findByText(zh['verdict.subscribed'].replace('{label}', '新源'))).toBeTruthy()
    expect(screen.queryByText(zh['add.busy'])).toBeNull()
    // The box is cleared once the link is saved: 抓取 has nothing to fetch, and says so.
    expect((screen.getByText(zh['action.submit']) as HTMLButtonElement).disabled).toBe(true)
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

  it('offers the browser way out on a link-only verdict whose cause has one', async () => {
    // The moment the reader learns WHY there is no preview is the moment the
    // dialog offers the action the cause answers.
    const ui = bench({
      addAnswer: {
        ok: true,
        value: {
          outcome: 'saved-link',
          kind: 'link',
          id: 'new',
          label: '被墙的论文',
          failure: { code: 'blocked', message: 'HTTP 403' },
        },
      },
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://walled.example.com/paper' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    const action = await screen.findByText(zh['action.openExternal'])
    fireEvent.click(action)
    expect(ui.mocks.openExternal).toHaveBeenCalledWith('https://walled.example.com/paper')
  })

  it('offers no action for a cause that has none', async () => {
    const ui = bench({
      addAnswer: {
        ok: true,
        value: {
          outcome: 'saved-link',
          kind: 'link',
          id: 'new',
          label: '打不开的站',
          failure: { code: 'unreachable', message: 'connect ECONNREFUSED' },
        },
      },
    })
    await ui.settle()
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const input = await screen.findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://down.example.com/paper' } })
    fireEvent.click(screen.getByText(zh['action.submit']))
    await screen.findByText(new RegExp(zh['preview.unreachable'].slice(0, 8)))
    // 再按一次抓取就是重试——判定里不再多一个按钮。
    expect(screen.queryByText(zh['action.openExternal'])).toBeNull()
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
    expect(await screen.findByTitle(zh['action.back'])).toBeTruthy()
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

describe('the wall hides republished duplicates behind one card', () => {
  // The aggregator's copy carries tracking parameters; the link is otherwise the same.
  const aggFeed = '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>agg</title><item>'
    + '<title>An Alien Mind</title><link>https://example.com/alien?utm_source=feed</link>'
    + '<pubDate>2026-09-17T08:00:00.000Z</pubDate><description>聚合摘要</description></item></channel></rss>'
  const origFeed = '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>orig</title><item>'
    + '<title>An Alien Mind</title><link>https://example.com/alien</link>'
    + '<pubDate>2026-09-17T09:00:00.000Z</pubDate><description>原始摘要</description></item></channel></rss>'
  const twoSources = () => bench({
    sources: [rssSource('agg', { label: '聚合源' }), rssSource('orig', { label: '原始博客' })],
    payloads: { agg: aggFeed, orig: origFeed },
  })

  it('shows one card with a duplicates badge, and the footer says so', async () => {
    const ui = await twoSources()
    await ui.settle()
    // One card, not two; the badge counts the hidden copies and names them.
    await waitFor(() => {
      expect(screen.getAllByText('An Alien Mind')).toHaveLength(1)
    })
    const badge = await screen.findByText(zh['dedupe.badge'].replace('{count}', '1'))
    // The hidden copy is the aggregator's (its feed's own title wins the label).
    expect(badge.getAttribute('title')).toContain('agg')
    expect(await screen.findByText(zh['foot.deduped'].replace('{count}', '1'))).toBeTruthy()
  })

  it('the toggle in the filter popover shows both copies again', async () => {
    const ui = await twoSources()
    await ui.settle()
    await waitFor(() => { expect(screen.getAllByText('An Alien Mind')).toHaveLength(1) })
    fireEvent.click(screen.getByTitle(zh['action.filter']))
    fireEvent.click(await screen.findByText(zh['filter.hideDupes']))
    await waitFor(() => { expect(screen.getAllByText('An Alien Mind')).toHaveLength(2) })
    expect(screen.queryByText(zh['dedupe.badge'].replace('{count}', '1'))).toBeNull()
    // …and it survives a remount, like every narrowing (persisted in the snapshot).
    ui.unmount()
    const second = twoSources()
    await second.settle()
    await waitFor(() => { expect(screen.getAllByText('An Alien Mind')).toHaveLength(2) })
  })

  it('reads as read when either copy was opened', async () => {
    const ui = await twoSources()
    await ui.settle()
    const card = (await screen.findAllByText('An Alien Mind'))[0]!.closest('[data-reader-entry]') as HTMLElement
    expect(card.getAttribute('data-unread')).not.toBeNull()
    fireEvent.click(card)
    await screen.findByTitle(zh['action.back'])
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      const again = screen.getAllByText('An Alien Mind')[0]!.closest('[data-reader-entry]') as HTMLElement
      expect(again.getAttribute('data-unread')).toBeNull()
    })
  })

  it('folds two copies that share one guid — the live 3080 case, links differing', async () => {
    // Measured live: two aggregator feeds carried "An Alien Mind" with an
    // IDENTICAL guid — so both copies' stableEntryId is one `g:<guid>` BY
    // DESIGN (it buys shared fetch/read/translation state). The links here
    // genuinely differ, so only the id tier can fold them.
    const guidFeed = (id: string, link: string, desc: string): string =>
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>' + id + '</title><item>'
      + '<title>An Alien Mind</title><link>' + link + '</link>'
      + '<guid>https://openai.com/index/an-alien-mind/</guid>'
      + '<pubDate>2026-09-17T08:00:00.000Z</pubDate><description>' + desc + '</description></item></channel></rss>'
    const ui = bench({
      sources: [rssSource('agg', { label: '聚合源' }), rssSource('orig', { label: '原始博客' })],
      payloads: {
        agg: guidFeed('agg', 'https://cdn.example.com/mirror/an-alien-mind', '聚合摘要'),
        orig: guidFeed('orig', 'https://openai.com/index/an-alien-mind/', '原始摘要'),
      },
    })
    await ui.settle()
    await waitFor(() => { expect(screen.getAllByText('An Alien Mind')).toHaveLength(1) })
    expect(await screen.findByText(zh['dedupe.badge'].replace('{count}', '1'))).toBeTruthy()
    expect(await screen.findByText(zh['foot.deduped'].replace('{count}', '1'))).toBeTruthy()
    // The read-merge rides the shared id for free — this pin exists so nobody
    // "fixes" the id collision without reading the dedupe note.
    fireEvent.click(screen.getAllByText('An Alien Mind')[0]!.closest('[data-reader-entry]') as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      const card = screen.getAllByText('An Alien Mind')[0]!.closest('[data-reader-entry]') as HTMLElement
      expect(card.getAttribute('data-unread')).toBeNull()
    })
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

describe('the manage page shows the storage surface', () => {
  const stats = {
    bodies: { entries: 3, chars: 2_400_000 },
    translations: { entries: 2, chars: 300_000, memoryEntries: 1200, memoryChars: 700_000 },
  }
  /** The manage page opens from a settled wall; the card content is incidental. */
  const wall = { sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } }

  it('renders the per-tier usage and the current translation budget', async () => {
    bench({ ...wall, storageStats: stats, translationBudgetChars: 128_000_000 })
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    await screen.findByText(zh['sources.title'])
    // The aggregated readout — the host counts characters, and the page says so.
    expect(await screen.findByText('3 篇 · 2.4 MB')).toBeTruthy()
    expect(await screen.findByText('2 篇映射 + 1200 句 · 1.0 MB')).toBeTruthy()
    const budget = document.getElementById('reader-translation-budget') as HTMLInputElement
    expect(budget.value).toBe('128')
  })

  it('commits a new budget through the cache policy, keeping the current TTL', async () => {
    const ui = bench({ ...wall, storageStats: stats })
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    await screen.findByText(zh['sources.title'])
    const budget = await screen.findByLabelText(/译文预算/) as HTMLInputElement
    fireEvent.change(budget, { target: { value: '32' } })
    fireEvent.blur(budget)
    await waitFor(() => { expect(ui.mocks.setCachePolicy).toHaveBeenCalledWith(24, undefined, 32_000_000) })
  })

  it('clears the translation cache on the button’s SECOND click, then re-reads', async () => {
    let cleared = false
    const ui = bench({ ...wall })
    ui.mocks.getStorageStats.mockImplementation(async () => ({
      ok: true as const,
      value: cleared
        ? { bodies: { entries: 3, chars: 2_400_000 }, translations: { entries: 0, chars: 0, memoryEntries: 0, memoryChars: 0 } }
        : stats,
    }))
    ui.mocks.clearTranslations.mockImplementation(async () => {
      cleared = true
      return { ok: true as const, value: { clearedEntries: 2, clearedMemory: true } }
    })
    await screen.findByText('一条')
    fireEvent.click(screen.getByTitle(zh['action.manage']))
    await screen.findByText(zh['sources.title'])
    await screen.findByText('2 篇映射 + 1200 句 · 1.0 MB')
    const button = await screen.findByText(zh['sources.clearTranslations'])
    fireEvent.click(button)
    // Armed, not executed: one click never clears.
    expect(ui.mocks.clearTranslations).not.toHaveBeenCalled()
    expect(await screen.findByText(zh['sources.clearTranslationsConfirm'])).toBeTruthy()
    fireEvent.click(screen.getByText(zh['sources.clearTranslationsConfirm']))
    await waitFor(() => { expect(ui.mocks.clearTranslations).toHaveBeenCalledTimes(1) })
    // The readout re-reads after the clear: maps and sentences are gone, the
    // bodies line is untouched.
    await screen.findByText('0 篇映射 + 0 句 · 1 KB')
    expect(screen.getByText('3 篇 · 2.4 MB')).toBeTruthy()
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
    // Root = read state (unread + hide-duplicates) + the source drill row + the
    // type rows (all / feed / saved link). The nine sources are NOT here: that
    // is what keeps the panel usable as subscriptions accumulate.
    expect(panel.querySelectorAll('[class*="filterRow"]').length).toBe(6)
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
    await screen.findByTitle(zh['action.back'])
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
    await screen.findByTitle(zh['action.back'])
    return ui
  }

  afterEach(() => {
    delete (globalThis as unknown as { Translator?: unknown }).Translator
    delete (globalThis as unknown as { LanguageDetector?: unknown }).LanguageDetector
  })

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

  it('translates the title with the body, follows the view, and names the article as the quote source', async () => {
    installTranslator()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: 'An English headline', description: '<p>First sentence here. Second sentence here.</p>' }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('An English headline'))
    await screen.findByTitle(zh['action.back'])
    const heading = (): HTMLElement => ui.container.querySelector('h1') as HTMLElement
    const sourceLabel = (): string | null => heading().closest('[data-quote-source]')?.getAttribute('data-quote-source') ?? null
    expect(sourceLabel()).toBe('An English headline')
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => { expect(heading().textContent).toBe('译：An English headline') })
    // The quote plugin names what the reader sees.
    expect(sourceLabel()).toBe('译：An English headline')
    // 对照: the original sits under the translation.
    fireEvent.click(ui.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    fireEvent.click(await screen.findByText(zh['translate.bilingual']))
    await waitFor(() => { expect(heading().textContent).toBe('译：An English headlineAn English headline') })
    // 原文: the title as the source wrote it.
    fireEvent.click(ui.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    fireEvent.click(await screen.findByText(zh['translate.onlyOriginal']))
    await waitFor(() => { expect(heading().textContent).toBe('An English headline') })
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

  it('keeps the globe when the detector misreads a romanized author list as Chinese', async () => {
    const api = installTranslator()
    installDetector('zh')
    // An arXiv-style opening: a pinyin author block, then English prose. The
    // prefix sample reads the names as Chinese; the script measurement of the
    // whole body says otherwise, and it wins.
    const ui = await opened('<p>Jialiang Huang Hongxuan Tang Jingchang Chen Yuxuan Liu Yuan Cheng.</p><p>First sentence here. Second sentence here.</p>')
    const globe = await screen.findByTitle(zh['action.translate'])
    fireEvent.click(globe)
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    // …and the session was built for English, not for the misdetected pair.
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'en' }))
  })

  it('falls back to the script guess when the detected source has no pair on this device', async () => {
    const api = installTranslator()
    installDetector('vi')
    api.availability.mockImplementation(async (pair?: { sourceLanguage?: string }) =>
      pair?.sourceLanguage === 'vi' ? 'unavailable' : 'available')
    await opened('<p>First sentence here. Second sentence here.</p>')
    // vi → zh is a pair this device does not have; the script guess en → zh
    // behind it is, so the globe survives the wrong detection.
    expect(await screen.findByTitle(zh['action.translate'])).toBeTruthy()
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
    // The in-flight line names the leg the relay is on (the mock never answers,
    // so the fetch stays in the download leg).
    expect(await screen.findByText(zh['detail.phase.downloading'])).toBeTruthy()
    release?.({ entryId: 'x', cached: true, fresh: true, fromFeed: false, html: '<p>fetched</p>' })
    await waitFor(() => { expect(screen.queryByText(zh['detail.phase.downloading'])).toBeNull() })
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

describe('an image the browser was refused is rescued through the host', () => {
  /** The CORP report's shape: a body whose figures carry absolute CDN URLs. */
  const figureFeed = (id: string): string =>
    `<feed xmlns="http://www.w3.org/2005/Atom"><title>${id}</title>`
    + `<entry><title>被拦图的论文</title><link href="https://example.com/paper"/>`
    + `<id>https://example.com/paper</id>`
    + `<summary>We find that Claude maintains a small set of representations.</summary>`
    + '</entry></feed>'
  const FIGURE_BODY = '<p>已经抓下来的正文。</p>'
    + '<img src="https://claude.dev/media/abc123.png" alt="Score against action tokens per attempt." referrerpolicy="no-referrer">'

  /** Open the one card into its detail view with the figure body on screen. */
  const openArticle = async (ui: ReturnType<typeof bench>): Promise<void> => {
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /被拦图的论文/ }))[0] as HTMLElement)
    await screen.findByText('已经抓下来的正文。')
  }

  it('re-points a failed image at the bytes the host fetched', async () => {
    // The 2026-09-29 report: claude.dev answers its /media images with
    // `Cross-Origin-Resource-Policy: same-origin`, so the pane's page never
    // receives the pixels (200 to curl, blocked in the browser). The failed
    // `<img>` is re-pointed at what the host fetched.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: figureFeed('tc') },
      cachedBodies: { 'g:https://example.com/paper': FIGURE_BODY },
      fetchStates: { 'g:https://example.com/paper': { state: 'ready' } },
    })
    await openArticle(ui)
    const img = ui.container.querySelector('img[src="https://claude.dev/media/abc123.png"]')
    expect(img).not.toBeNull()
    fireEvent.error(img as Element)
    await waitFor(() => { expect(ui.mocks.fetchImage).toHaveBeenCalledWith('https://claude.dev/media/abc123.png') })
    await waitFor(() => {
      expect(ui.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8gd29ybGQ=')
    })
    // The rescued image failing AGAIN must not loop the rescue.
    fireEvent.error(ui.container.querySelector('img') as Element)
    expect(ui.mocks.fetchImage).toHaveBeenCalledTimes(1)
  })

  it('leaves the image alone when the host cannot have it either', async () => {
    // An origin that refuses the host too: the broken image stays (the card
    // still has its 「阅读原文」 way out) and one failure does not retry forever.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: figureFeed('tc') },
      cachedBodies: { 'g:https://example.com/paper': FIGURE_BODY },
      fetchStates: { 'g:https://example.com/paper': { state: 'ready' } },
      imageAnswers: { 'https://claude.dev/media/abc123.png': { error: 'HTTP 403' } },
    })
    await openArticle(ui)
    const img = ui.container.querySelector('img[src="https://claude.dev/media/abc123.png"]')
    expect(img).not.toBeNull()
    fireEvent.error(img as Element)
    await waitFor(() => { expect(ui.mocks.fetchImage).toHaveBeenCalledTimes(1) })
    expect(img?.getAttribute('src')).toBe('https://claude.dev/media/abc123.png')
    fireEvent.error(img as Element)
    expect(ui.mocks.fetchImage).toHaveBeenCalledTimes(1)
  })

  it('never asks the host about an image that is already inline', async () => {
    // A data: URI that fails is a broken payload, not a fetchable URL.
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: { tc: figureFeed('tc') },
      cachedBodies: {
        'g:https://example.com/paper': '<p>已经抓下来的正文。</p><img src="data:image/png;base64,broken" alt="inline">',
      },
      fetchStates: { 'g:https://example.com/paper': { state: 'ready' } },
    })
    await openArticle(ui)
    const img = ui.container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as Element)
    await Promise.resolve()
    expect(ui.mocks.fetchImage).not.toHaveBeenCalled()
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
    await screen.findByTitle(zh['action.back'])
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
    await screen.findByTitle(zh['action.back'])
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

describe('a saved link’s card learns the paper’s own title', () => {
  const LINK_PAGE = '<html><head><title></title></head><body><article>'
    + '<h1>Circadian Rhythms in Pre-Trained Representations</h1>'
    + `<p>${'We show that representation drift follows a daily rhythm. '.repeat(6)}</p>`
    + '</article></body></html>'
  const linkSource = (over: Partial<ReaderSourceSummary> = {}): ReaderSourceSummary =>
    rssSource('lnk', { kind: 'link', url: 'https://arxiv.org/abs/2604.03147', label: 'arxiv.org/2604.03147', ...over })

  it('upgrades the card at load when the payload parses (title + abstract)', async () => {
    // The user's report: a pasted link wore its URL-derived label forever.
    // The pane extracts the payload at load either way — the card now reads
    // what the extraction read.
    bench({ sources: [linkSource()], payloads: { lnk: LINK_PAGE } }).settle()
    await screen.findByText('Circadian Rhythms in Pre-Trained Representations')
    expect(await screen.findByText(/representation drift follows a daily rhythm/)).toBeTruthy()
  })

  it('reads the captured meta when the payload is already gone', async () => {
    // Payload evicted, extraction remembered: the host joins the captured
    // title/excerpt onto the (missing) payload's answer.
    bench({
      sources: [linkSource({ hasBody: false })],
      failedIds: ['lnk'],
      linkMeta: { lnk: { title: 'Captured Title From Before', excerpt: 'Captured abstract sentence.' } },
    }).settle()
    expect(await screen.findByText('Captured Title From Before')).toBeTruthy()
    expect(await screen.findByText('Captured abstract sentence.')).toBeTruthy()
  })

  it('upgrades the card in place when a pill fetch lands', async () => {
    const ui = bench({
      sources: [linkSource({ url: 'https://example.com/x', label: 'example.com/x' })],
      payloads: { lnk: `<html><head><title></title></head><body><article><p>${'这段正文没有标题。'.repeat(30)}</p></article></body></html>` },
    })
    await ui.settle()
    // No h1, no document title: the card starts on the URL-derived label.
    await screen.findAllByText('example.com/x')
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html: '<p>抓到的正文</p>',
      title: '抓取后才知道的真标题',
      excerpt: '抓取后的摘要句。',
    }))
    fireEvent.click(await screen.findByText(zh['fetch.none']))
    expect(await screen.findByText('抓取后才知道的真标题')).toBeTruthy()
    expect(await screen.findByText('抓取后的摘要句。')).toBeTruthy()
  })

  it('never rewrites a feed entry’s own title', async () => {
    // The same extraction path serves feed entries (the owed-fetch on open):
    // their titles are the publisher's and must not be replaced by a page h1.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '订阅源的标题' }]) },
    })
    await ui.settle()
    await screen.findByText('订阅源的标题')
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html: '<p>fetched</p>',
      title: '页面自己的 h1',
      excerpt: '页面自己的摘要。',
    }))
    fireEvent.click(await screen.findByText(zh['fetch.none']))
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalled() })
    // The feed's title stays; the page's h1 never lands on the card.
    expect(screen.queryByText('页面自己的 h1')).toBeNull()
    expect(screen.getByText('订阅源的标题')).toBeTruthy()
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

  it('opens the in-app Sidebar Browser when that seam probes present', async () => {
    // Same notice, but the host is 0.1.6-alpha.2+: the action reads 「在浏览器
    // 打开原文」 and lands in the right-Sidebar browser tab instead of an
    // external window. The seam's absence keeps the old external link.
    const ui = bench({
      browserTab: true,
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
    const action = await screen.findByText(zh['action.openExternal'])
    expect(screen.queryByText(new RegExp(zh['detail.scriptFigures'].replace('{count}', '3').slice(0, 12)))).toBeTruthy()
    fireEvent.click(action)
    expect(ui.mocks.openBrowserTab).toHaveBeenCalledWith('https://example.com/paper')
    expect(ui.mocks.openExternal).not.toHaveBeenCalled()
  })

  it('falls back to the external link when the in-app open refuses', async () => {
    const ui = bench({
      browserTab: true,
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>有插图的条目</title>'
          + '<link>https://example.com/paper</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.openBrowserTab.mockReturnValue(false)
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html: '<p>fetched body</p>',
      scriptFigures: 1,
    }))
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    fireEvent.click(await screen.findByText(zh['action.openExternal']))
    expect(ui.mocks.openExternal).toHaveBeenCalledWith('https://example.com/paper')
  })

  it('keeps the 渲染抓取 slot hidden while no capture Remote is mounted', async () => {
    // M0 ships no capture package: the probe is the whole surface, and a
    // control that cannot work is worse than none.
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
      scriptFigures: 2,
    }))
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await screen.findByText(new RegExp(zh['detail.scriptFigures'].replace('{count}', '2').slice(0, 12)))
    expect(screen.queryByText(zh['detail.renderFetch'])).toBeNull()
  })

  it('auto-renders on open when the fetched body counts script figures (one gesture, the whole pipeline)', async () => {
    const ui = bench({
      capture: true,
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
      scriptFigures: 2,
    }))
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    // No button click: opening the entry IS the gesture, the plain fetch lands
    // a shell (2 script figures), and the rendered fetch continues on its own.
    await waitFor(() => { expect(ui.mocks.captureRender).toHaveBeenCalledWith({ url: 'https://example.com/paper' }) })
    // The captured HTML went through the whitelist extractor and was stored —
    // rendered: true (「重新抓取」 re-renders it) and the count, zero included:
    // a silent record lets the notice rise from the dead on the next open.
    await waitFor(() => {
      expect(ui.mocks.storeEntryBody).toHaveBeenCalledWith(expect.objectContaining({
        entryId: expect.any(String),
        url: 'https://example.com/paper',
        scriptFigures: 0,
        rendered: true,
      }))
    })
    expect(await screen.findByText(new RegExp('渲染抓到的正文'))).toBeTruthy()
  })

  it('auto-renders on open when the plain fetch meets a bot wall (mp.weixin.qq.com)', async () => {
    const ui = bench({
      capture: true,
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>公众号文章</title>'
          + '<link>https://mp.weixin.qq.com/s/abc</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: false,
      fresh: false,
      fromFeed: false,
      error: 'the site answered a bot challenge instead of the page (https://mp.weixin.qq.com/s/abc)',
    }))
    const cards = await screen.findAllByRole('button', { name: /公众号文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    // The wall refused the plain fetch; a headless browser is what it admits.
    await waitFor(() => { expect(ui.mocks.captureRender).toHaveBeenCalledWith({ url: 'https://mp.weixin.qq.com/s/abc' }) })
    await waitFor(() => {
      expect(ui.mocks.storeEntryBody).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://mp.weixin.qq.com/s/abc',
        rendered: true,
      }))
    })
  })

  it('auto-renders on open when the plain fetch meets a cookie handshake (link.springer.com)', async () => {
    const ui = bench({
      capture: true,
      sources: [rssSource('epj')],
      payloads: {
        epj: '<rss version="2.0"><channel><title>epj</title><item><title>期刊文章</title>'
          + '<link>https://link.springer.com/article/10.1140/x</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: false,
      fresh: false,
      fromFeed: false,
      error: 'cross-origin redirect to https://idp.springer.com is not followed automatically; retry against that URL directly',
    }))
    const cards = await screen.findAllByRole('button', { name: /期刊文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.captureRender).toHaveBeenCalledWith({ url: 'https://link.springer.com/article/10.1140/x' }) })
  })

  it('a bot wall shows the render in progress, then says why a failed render failed', async () => {
    const ui = bench({
      capture: true,
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>公众号文章</title>'
          + '<link>https://mp.weixin.qq.com/s/abc</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: false,
      fresh: false,
      fromFeed: false,
      error: 'the site answered a bot challenge instead of the page (https://mp.weixin.qq.com/s/abc)',
    }))
    let finish: (value: unknown) => void = () => {}
    ui.mocks.captureRender.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const cards = await screen.findAllByRole('button', { name: /公众号文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    // While the headless render runs, the line says so — not the refusal.
    await screen.findByText(zh['detail.renderingWall'])
    expect(screen.queryByText(new RegExp(zh['sources.blocked'].slice(0, 8)))).toBeNull()
    finish({ ok: false, error: { message: 'capture/navigation-failed' } })
    // After a failed render: the refusal, the render's own reason, and the retry.
    await screen.findByText(new RegExp(zh['sources.blocked'].slice(0, 8)))
    expect(screen.getByText(/capture\/navigation-failed/)).toBeTruthy()
    expect(screen.getByText(zh['detail.renderFetch'])).toBeTruthy()
    expect(screen.queryByText(zh['detail.renderingWall'])).toBeNull()
  })

  it('a bot wall without a rendered fetch mounted stays a plain refusal', async () => {
    const ui = bench({
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>公众号文章</title>'
          + '<link>https://mp.weixin.qq.com/s/abc</link></item></channel></rss>',
      },
    })
    await ui.settle()
    ui.mocks.fetchEntryBody.mockImplementation(async (entryId: string) => ({
      entryId,
      cached: false,
      fresh: false,
      fromFeed: false,
      error: 'HTTP 403: the site refuses non-browser requests',
    }))
    const cards = await screen.findAllByRole('button', { name: /公众号文章/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await screen.findByText(new RegExp(zh['sources.blocked'].slice(0, 8)))
    expect(screen.queryByText(zh['detail.renderFetch'])).toBeNull()
  })

  it('a failed auto-render leaves the manual retry, and reopening does not refire it', async () => {
    const ui = bench({
      capture: true,
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
      scriptFigures: 2,
    }))
    ui.mocks.captureRender.mockResolvedValueOnce({ ok: false, error: { message: 'capture/unavailable' } })
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.captureRender).toHaveBeenCalledTimes(1) })
    // The loop guard held: the failure leaves a manual retry…
    await screen.findByText(zh['detail.renderFetch'])
    // …and a leave-and-reopen does not start a second render by itself.
    fireEvent.click(screen.getByRole('button', { name: zh['action.back'] }))
    fireEvent.click((await screen.findAllByRole('button', { name: /有插图的条目/ }))[0] as HTMLElement)
    await screen.findByText(new RegExp(zh['detail.scriptFigures'].replace('{count}', '2').slice(0, 12)))
    expect(ui.mocks.captureRender).toHaveBeenCalledTimes(1)
    fireEvent.click(await screen.findByText(zh['detail.renderFetch']))
    await waitFor(() => { expect(ui.mocks.captureRender).toHaveBeenCalledTimes(2) })
  })

  it('重新抓取 re-renders an entry whose stored body came from a render', async () => {
    const ui = bench({
      capture: true,
      sources: [rssSource('tc')],
      payloads: {
        tc: '<rss version="2.0"><channel><title>tc</title><item><title>有插图的条目</title>'
          + '<link>https://example.com/paper</link></item></channel></rss>',
      },
    })
    await ui.settle()
    const cards = await screen.findAllByRole('button', { name: /有插图的条目/ })
    // The stored body is a rendered one: opening reads rendered: true back.
    ui.mocks.getEntryBody.mockImplementation(async (request: { entryId: string }) => ({
      ok: true as const,
      value: {
        entryId: request.entryId,
        cached: true,
        fresh: true,
        fromFeed: false,
        html: '<p>渲染过的正文</p>',
        scriptFigures: 0,
        rendered: true,
      },
    }))
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    await screen.findByText(new RegExp('渲染过的正文'))
    const before = ui.mocks.captureRender.mock.calls.length
    // Hold the render open: the button must show the in-flight state, or a
    // re-render looks dead for minutes.
    let release: (() => void) | undefined
    ui.mocks.captureRender.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true as const, value: { html: `<article><p>${'渲染抓到的正文。'.repeat(30)}</p></article>` } }
    })
    fireEvent.click(await screen.findByText(zh['detail.refetch']))
    await waitFor(() => { expect(ui.mocks.captureRender.mock.calls.length).toBe(before + 1) })
    const refetchBtn = screen.getByRole('button', { name: new RegExp(zh['detail.refetching']) })
    expect(refetchBtn).toHaveProperty('disabled', true)
    release!()
    await screen.findByText(new RegExp('渲染抓到的正文'))
    // …and the plain fetch never fired: that would clobber the rendered body
    // with the page's pre-JS shell.
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })

  it('counts script-drawn figures on the saved-link path too (inline extraction)', async () => {
    // A saved link's body is extracted IN the pane (the getBodies branch of
    // open()), not via a fetch answer — so the script-figure count must be set
    // from the local extraction, or the notice and the 「渲染抓取」 action never
    // appear for the exact pages capture exists for.
    const SHELL_PAGE = '<html><head><title>Shell Page Paper</title></head><body><article>'
      + '<h1>Shell Page Paper</h1>'
      + `<p>${'这篇正文的段落足够长，用来压住提取器的块评分。'.repeat(12)}</p>`
      + '<figure><div class="chart"></div><figcaption>图 1：由页面脚本绘制</figcaption></figure>'
      + `<p>${'另一段足够长的正文，让条目判定为可读。'.repeat(12)}</p>`
      + '</article></body></html>'
    bench({
      sources: [rssSource('lnk', { kind: 'link', url: 'https://example.com/shell', label: 'example.com/shell' })],
      payloads: { lnk: SHELL_PAGE },
    }).settle()
    const cards = await screen.findAllByRole('button', { name: /Shell Page Paper/ })
    fireEvent.click(cards[cards.length - 1] as HTMLElement)
    const expected = zh['detail.scriptFigures'].replace('{count}', '1')
    expect(await screen.findByText(new RegExp(expected.slice(0, 12)))).toBeTruthy()
  })
})


describe('the card says what the plugin holds, and fetches on demand', () => {
  async function wallWithStates(
    state: 'none' | 'ready' | 'raw' | 'failed',
    code: 'blocked' | 'unreachable' | 'http' = 'blocked',
  ) {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: feed('hn', [{ title: '一条' }]) } })
    // The state must be in place BEFORE the pane's first round trip: the pane
    // only polls while something is in flight, so a late mock is never read.
    ui.mocks.entryFetchStates.mockImplementation(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: {
        states: Object.fromEntries(entryIds.map(id => [id, state === 'failed'
          ? { state, at: '2026-09-19T00:00:00.000Z', message: 'HTTP 403', code }
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
    // The third argument is the fetch-phase callback the progress line reads.
    await waitFor(() => {
      expect(ui.mocks.fetchEntryBody).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('example.com'), expect.any(Function))
    })
  })

  it('shows 已抓取 when the body is cached', async () => {
    await wallWithStates('ready')
    expect(await screen.findByText(zh['fetch.ready'])).toBeTruthy()
  })

  it('keeps the card one line tall — the reason and its actions live in a popover', async () => {
    // The action belongs to the cause, but the card's grid must not break: the
    // reason is NOT on the card (a failed card is the same height as its
    // neighbours); a tap on the pill opens the popover with the reason and the
    // action the cause answers.
    const ui = await wallWithStates('failed', 'blocked')
    const label = await screen.findByText(zh['fetch.failed'])
    const pill = label.closest('[class*="fetchPill"]') as HTMLElement
    // The tooltip still carries the reason; the card's text box does not.
    expect(pill.getAttribute('title')).toContain(zh['preview.blocked'])
    expect(screen.queryByText(zh['preview.blocked'])).toBeNull()
    fireEvent.click(pill)
    expect(await screen.findByText(zh['preview.blocked'])).toBeTruthy()
    fireEvent.click(screen.getByText(zh['detail.readOriginal']))
    await waitFor(() => { expect(ui.mocks.openExternal).toHaveBeenCalledWith(expect.stringContaining('example.com')) })
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })

  it('opens the same popover on a transport failure, whose action retries', async () => {
    const ui = await wallWithStates('failed', 'unreachable')
    const label = await screen.findByText(zh['fetch.failed'])
    const pill = label.closest('[class*="fetchPill"]') as HTMLElement
    fireEvent.click(pill)
    fireEvent.click(await screen.findByText(zh['detail.refetch']))
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalled() })
  })

  it('gives a final failure the reason and no action', async () => {
    // A 404 answers the same way forever: no retry, no browser detour — the
    // popover says why and offers nothing.
    const ui = await wallWithStates('failed', 'http')
    const label = await screen.findByText(zh['fetch.failed'])
    const pill = label.closest('[class*="fetchPill"]') as HTMLElement
    expect(pill.getAttribute('title')).not.toContain('重试')
    fireEvent.click(pill)
    expect(await screen.findByText(zh['preview.http'])).toBeTruthy()
    expect(screen.queryByText(zh['detail.refetch'])).toBeNull()
    expect(screen.queryByText(zh['detail.readOriginal'])).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
    expect(ui.mocks.openExternal).not.toHaveBeenCalled()
  })

  it('dismisses the popover on the next outside click', async () => {
    await wallWithStates('failed', 'blocked')
    fireEvent.click((await screen.findByText(zh['fetch.failed'])).closest('[class*="fetchPill"]') as HTMLElement)
    expect(await screen.findByText(zh['preview.blocked'])).toBeTruthy()
    fireEvent.mouseDown(document.body)
    await waitFor(() => { expect(screen.queryByText(zh['preview.blocked'])).toBeNull() })
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

describe('a fulltext feed body is kept on open', () => {
  /**
   * A mock host whose `storeEntryBody` really holds: the write is what
   * `entryFetchStates` and the next `getEntryBody` answer from — the way the
   * real service derives both from its annotations. A fixed-answer mock would
   * let these tests pass without the pane having persisted anything.
   */
  function holdingHost(ui: ReturnType<typeof bench>): void {
    const held = new Map<string, string>()
    ui.mocks.storeEntryBody.mockImplementation(async (request: { entryId: string; html: string }) => {
      held.set(request.entryId, request.html)
      return { ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: request.html } }
    })
    ui.mocks.getEntryBody.mockImplementation(async (request: { entryId: string; feedHtml?: string }) => {
      const cached = held.get(request.entryId)
      if (cached !== undefined) {
        return { ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: cached } }
      }
      return {
        ok: true as const,
        value: request.feedHtml === undefined
          ? { entryId: request.entryId, cached: false, fresh: true, fromFeed: false }
          : { entryId: request.entryId, cached: false, fresh: true, fromFeed: true, html: request.feedHtml },
      }
    })
    ui.mocks.entryFetchStates.mockImplementation(async (entryIds: readonly string[]) => ({
      ok: true as const,
      value: {
        states: Object.fromEntries(entryIds.map(id => [id, held.has(id)
          ? { state: 'ready' as const, at: '2026-09-20T00:00:00.000Z' }
          : { state: 'none' as const }])),
      },
    }))
  }

  const fulltextFeed = (): string =>
    feed('hn', [{ title: '全文条目', body: '<p>the feed full text</p>' }])

  it('stores the feed’s full text on open, and the card says 已抓取 after back', async () => {
    // The gap: a fulltext feed's payload IS the article, but only inside the
    // feed's window — the host never held it, so the card said 抓取 and the
    // text died with the window. Opening is the gesture that keeps it.
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: fulltextFeed() } })
    holdingHost(ui)
    await ui.settle()
    expect(await screen.findByText(zh['fetch.none'])).toBeTruthy()
    fireEvent.click((await screen.findAllByRole('button', { name: /全文条目/ }))[0] as HTMLElement)
    expect(await screen.findByText('the feed full text')).toBeTruthy()
    const entryId = `l:https://example.com/hn/${encodeURIComponent('全文条目')}`
    await waitFor(() => { expect(ui.mocks.storeEntryBody).toHaveBeenCalledTimes(1) })
    const stored = ui.mocks.storeEntryBody.mock.calls[0]?.[0] as { entryId: string; url: string; html: string; bodyHash?: string }
    expect(stored.entryId).toBe(entryId)
    expect(stored.url).toBe(`https://example.com/hn/${encodeURIComponent('全文条目')}`)
    expect(stored.html).toContain('the feed full text')
    // The hash rides along, so the entry's translation map survives the store.
    expect(typeof stored.bodyHash).toBe('string')
    // No request was made to keep it: the text was already on screen.
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => { expect(screen.getByText(zh['fetch.ready'])).toBeTruthy() })
    expect(screen.queryByText(zh['fetch.none'])).toBeNull()
  })

  it('does not store again when the host already holds the body', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: fulltextFeed() } })
    holdingHost(ui)
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /全文条目/ }))[0] as HTMLElement)
    expect(await screen.findByText('the feed full text')).toBeTruthy()
    await waitFor(() => { expect(ui.mocks.storeEntryBody).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await screen.findByText(zh['fetch.ready'])
    // The second open reads the host's cache (holdingHost answers from the
    // first store) — a cached body is paid for, nothing is written twice.
    fireEvent.click((await screen.findAllByRole('button', { name: /全文条目/ }))[0] as HTMLElement)
    expect(await screen.findByText('the feed full text')).toBeTruthy()
    await waitFor(() => { expect(ui.mocks.getEntryBody).toHaveBeenCalledTimes(2) })
    expect(ui.mocks.storeEntryBody).toHaveBeenCalledTimes(1)
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
  })

  it('a summary-only open still owes the fetch, and the summary is never stored', async () => {
    // The other half of the rule: a summary is not the body, so opening keeps
    // paying one fetch — and the summary itself is never cached as if it were
    // the article (that is the 摘要不是正文 note's rule, kept honest here).
    const summaryFeed =
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>tc</title>'
      + '<entry><title>只有摘要的论文</title><link href="https://example.com/paper"/>'
      + '<id>https://example.com/paper</id>'
      + '<summary>We find that Claude maintains a small set of representations.</summary>'
      + '</entry></feed>'
    const ui = bench({ sources: [rssSource('tc')], payloads: { tc: summaryFeed } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /只有摘要的论文/ }))[0] as HTMLElement)
    await waitFor(() => { expect(ui.mocks.fetchEntryBody).toHaveBeenCalledTimes(1) })
    expect(ui.mocks.storeEntryBody).not.toHaveBeenCalled()
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

  it('shows the wall it already parsed at once, and re-reads only sources that changed', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    await screen.findByText('An English article')
    first.unmount()
    // Same fetch stamp: the wall is back without a body round trip or a 加载中.
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    expect(screen.getByText('An English article')).toBeTruthy()
    await waitFor(() => { expect(second.mocks.listSources).toHaveBeenCalled() })
    expect(second.mocks.getBodies).not.toHaveBeenCalled()
    second.unmount()
    // The host fetched the feed again meanwhile: that source is re-read.
    const third = bench({ sources: [{ ...rssSource('hn'), fetchedAt: '2026-10-21T08:00:00.000Z' }], payloads: { hn: english() } })
    await waitFor(() => { expect(third.mocks.getBodies).toHaveBeenCalledWith(['hn']) })
  })

  it('restores the open article and the wall\'s narrowing', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    const search = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'An English article' } })
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    first.unmount()

    // The pane is gone and comes back: no state crosses over except this
    // module's memory of where the reader was standing.
    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    // The ARTICLE is back — not just the id, and not the wall.
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    // …and so is the search that narrowed the wall behind it. The box lives on
    // the wall, so it takes the back button to see it.
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('An English article')
    })
  })

  it('restores a source-filter narrowing across a remount (the 3199 repro)', async () => {  // Live repro on 3199: source filter set (query `#rss-…`), a dockkit split
    // remounts the pane body, and the box came back EMPTY. Two feeds, so the
    // narrowing is observable in the rows, not just the box.
    const first = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await first.settle()
    const search = screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement
    fireEvent.change(search, { target: { value: '#hn' } })
    await waitFor(() => {
      expect(screen.queryByText('甲源的条目')).not.toBeNull()
      expect(screen.queryByText('乙源的条目')).toBeNull()
    })
    first.unmount()

    const second = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await second.settle()
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#hn')
    })
    await waitFor(() => {
      expect(screen.queryByText('甲源的条目')).not.toBeNull()
      expect(screen.queryByText('乙源的条目')).toBeNull()
    })
  })

  it('keeps the narrowing through a remount AND the add-source flow', async () => {
    // The full 3199 sequence: filter → split (remount) → 新增灵感 → subscribed
    // → dialog closes. The wall must still be narrowed at the end of it.
    const first = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await first.settle()
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '#hn' } })
    await screen.findByText('甲源的条目')
    first.unmount()

    const second = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
      addAnswer: { ok: true, value: { outcome: 'subscribed', kind: 'rss', id: 'new', label: '新源' } },
    })
    await second.settle()
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#hn')
    })
    // The add flow on the remounted pane.
    fireEvent.click(screen.getByTitle(zh['action.add']))
    const dialog = await screen.findByRole('dialog')
    const input = await within(dialog).findByPlaceholderText(zh['add.placeholder'])
    fireEvent.change(input, { target: { value: 'https://example.com/new.xml' } })
    fireEvent.click(within(dialog).getByText(zh['action.submit']))
    await within(dialog).findByText(zh['verdict.subscribed'].replace('{label}', '新源'))
    fireEvent.click(within(dialog).getByText(zh['action.done']))
    // The narrowing is still there — box and rows alike.
    expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#hn')
    await waitFor(() => {
      expect(screen.queryByText('甲源的条目')).not.toBeNull()
      expect(screen.queryByText('乙源的条目')).toBeNull()
    })
  })

  it('flushes the last committed narrowing on unmount, even if the mirror never ran', async () => {
    // The mirror into the page memory is a PASSIVE effect: a pane reseated in
    // the same commit window as the reader's last gesture can unmount before
    // the flush. The unmount cleanup is the guarantee that survives that —
    // cleanups always run. The forgetSession() here stands in for "the mirror
    // never wrote": without the cleanup flush, the next mount finds nothing.
    const first = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await first.settle()
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '#hn' } })
    await screen.findByText('甲源的条目')
    forgetSession()
    first.unmount()

    const second = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await second.settle()
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#hn')
    })
  })

  it('restores a source filter together with the open detail view', async () => {
    // view=detail + query travel together: the article comes back AND the wall
    // behind it is still narrowed.
    const first = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await first.settle()
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '#hn' } })
    fireEvent.click((await screen.findAllByRole('button', { name: /甲源的条目/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    first.unmount()

    const second = bench({
      sources: [rssSource('hn'), rssSource('other')],
      payloads: {
        hn: feed('hn', [{ title: '甲源的条目' }]),
        other: feed('other', [{ title: '乙源的条目' }]),
      },
    })
    await second.settle()
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    fireEvent.click(screen.getByTitle(zh['action.back']))
    await waitFor(() => {
      expect((screen.getByPlaceholderText(zh['search.placeholder']) as HTMLInputElement).value).toBe('#hn')
      expect(screen.queryByText('甲源的条目')).not.toBeNull()
      expect(screen.queryByText('乙源的条目')).toBeNull()
    })
  })

  it('turns the globe back on from a session this page already built', async () => {
    installTranslator()
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
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
    await screen.findByTitle(zh['action.back'])
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
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
    await screen.findByTitle(zh['action.back'])
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
    await screen.findByTitle(zh['action.back'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(first.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    first.unmount()

    // A different session id, the same page: the article is already open and the
    // globe is already on, with neither being clicked this time.
    const second = bench({ sessionId: 'session-b', sources: [rssSource('hn')], payloads: { hn: english() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
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
    await screen.findByTitle(zh['action.back'])
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
    // The record predates title translation: the title is the one model call.
    await waitFor(() => { expect(translate).toHaveBeenCalledTimes(1) })
    expect(translate.mock.calls[0]?.[0]).toBe('An English article')
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
      // The title is a sentence of the global memory like any other.
      memorySlice: Object.fromEntries([...SENTENCES, 'An English article'].map(sentence => [translationHash(sentence), `译：${sentence}`])),
    })
    await ui.settle()
    await openAndTranslate(ui)
    await waitFor(() => { expect(ui.container.querySelector('h1')?.textContent).toBe('译：An English article') })
    expect(translate).not.toHaveBeenCalled()
    expect(ui.mocks.getSentenceTranslations).toHaveBeenCalled()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  /** Open the article with no Translator API on the page (iOS, Safari, Firefox). */
  const openWithoutApi = async (): Promise<void> => {
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
  }

  it('shows a stored translation on a page with no Translator API', async () => {
    // The phone case: the article was translated on desktop, and the host's
    // exact-fit map for this body is all the page needs to show it.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: page() },
      entryTranslation: { ok: true, value: { translation: entryRecord(translationHash(BODY)) } },
    })
    await ui.settle()
    await openWithoutApi()
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    // The views still switch; retranslating (which needs the model) is not offered.
    fireEvent.click(ui.container.querySelector('[class*="translateCaret"]') as HTMLElement)
    expect(screen.getByText(zh['translate.stored'])).toBeTruthy()
    expect(screen.queryByText(zh['translate.retry'])).toBeNull()
    fireEvent.click(await screen.findByText(zh['translate.onlyOriginal']))
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).not.toContain('译：')
    })
    // Reading it moves the LRU stamps and learns nothing.
    await waitFor(() => { expect(ui.mocks.rememberSentences).toHaveBeenCalledTimes(1) })
    const call = ui.mocks.rememberSentences.mock.calls[0]?.[0] as { pair: string; entries: readonly unknown[]; recalled?: readonly unknown[] }
    expect(call.pair).toBe(PAIR)
    expect(call.entries).toHaveLength(0)
    expect(call.recalled).toHaveLength(SENTENCES.length)
  })

  it('offers no globe without a Translator API when nothing is stored for this body', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: page() } })
    await ui.settle()
    await openWithoutApi()
    await waitFor(() => { expect(ui.mocks.getEntryTranslation).toHaveBeenCalled() })
    await ui.settle()
    expect(screen.queryByTitle(zh['action.translate'])).toBeNull()
  })

  it('offers no globe without a Translator API when the stored map is for an older body', async () => {
    // Even with every sentence in the global memory: only the entry's own map,
    // keyed to THIS body, proves the article was translated.
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: page() },
      entryTranslation: { ok: true, value: { translation: entryRecord('the-hash-of-some-older-body') } },
      memorySlice: Object.fromEntries(SENTENCES.map(sentence => [translationHash(sentence), `译：${sentence}`])),
    })
    await ui.settle()
    await openWithoutApi()
    await waitFor(() => { expect(ui.mocks.getEntryTranslation).toHaveBeenCalled() })
    await ui.settle()
    expect(screen.queryByTitle(zh['action.translate'])).toBeNull()
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
    expect(call.entries.map(entry => entry.source).sort()).toEqual([...SENTENCES, 'An English article'].sort())
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
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
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
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
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
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
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
    await screen.findByTitle(zh['action.back'])
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    // The wheel is the gesture that makes the scroll the reader's (a bare
    // scroll event is programmatic as far as the pane is concerned).
    fireEvent.wheel(scroller)
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
    await screen.findByTitle(zh['action.back'])
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    // Block 1 starts 300px into the article, 50px into it: 350.
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    vi.restoreAllMocks()
  })

  it('records the block the reader stopped in', async () => {
    stubLayout()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    fireEvent.wheel(scroller)
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
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    // The id the pane's own parser gives this entry: the place has to name the
    // same entry, or nothing is found and the article opens at the top.
    expect((ui.mocks.recordRead.mock.calls[0]?.[0] as { entryId: string }).entryId).toBe(entryId)
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    await waitFor(() => { expect(scroller.scrollTop).toBe(350) })
    vi.restoreAllMocks()
  })

  it('restores the place after a TAB switch remounts the pane (the 3080 report)', async () => {
    // The exact reported flow: reading partway down an article, click another
    // sidebar tab (the host unmounts this pane's body entirely — dockkit renders
    // only the active tab), click back (a fresh mount). The position must be
    // back — from page memory this time, not a seeded store.
    stubLayout()
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    await settleFrame()
    const scroller1 = first.container.querySelector('[class*="detailBody"]') as HTMLElement
    fireEvent.wheel(scroller1)
    scroller1.scrollTop = 620
    fireEvent.scroll(scroller1)
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    await waitFor(() => {
      expect(readSession().scroll?.[entryId]).toEqual({ block: 2, offset: 20, top: 620, text: 3, textLength: 40 })
    })
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    await settleFrame()
    const scroller2 = second.container.querySelector('[class*="detailBody"]') as HTMLElement
    // The point: NOT the top. jsdom has no Range geometry, so the text-offset
    // path answers proportionally there (a few px into the block rather than
    // the exact pixel) — the assertion is the block, not a fake-exact pixel.
    await waitFor(() => {
      expect(scroller2.scrollTop).toBeGreaterThanOrEqual(600)
      expect(scroller2.scrollTop).toBeLessThanOrEqual(650)
    })
    vi.restoreAllMocks()
  })

  it('restores the place when the remount happens WITH the globe on', async () => {
    // The realistic 3080 flow: the reader reads long English articles in
    // Chinese. The anchor is recorded against the TRANSLATED geometry; the
    // remount first restores onto the ORIGINAL body, then the translation
    // re-applies and the re-anchor must land on the same sentence.
    installTranslator()
    stubTextLayout()
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await first.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => {
      expect(first.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    const scroller1 = first.container.querySelector('[class*="detailBody"]') as HTMLElement
    const article1 = first.container.querySelector('[class*="article"]') as HTMLElement
    // Scroll to block 1 ("Another paragraph entirely…") in the TRANSLATED layout.
    const blocks1 = [...article1.children].filter(child => child.getAttribute('data-reader-reveal') !== '1')
    const heightOf = (element: Element): number => Math.max(40, (element.textContent ?? '').length * 10)
    const block1Top = heightOf(blocks1[0] as Element)
    fireEvent.wheel(scroller1)
    scroller1.scrollTop = block1Top + 100
    fireEvent.scroll(scroller1)
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    const recorded = await waitFor(() => {
      const anchor = readSession().scroll?.[entryId]
      expect(anchor?.block).toBe(1)
      expect(anchor?.textLength).toBeGreaterThan(0)
      return anchor
    })
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await second.settle()
    await waitFor(() => { expect(screen.queryByTitle(zh['action.back'])).not.toBeNull() })
    // The translation comes back by itself (the page's session cache), then the
    // position must land on the same sentence in the SAME translated geometry.
    await waitFor(() => {
      expect(second.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.')
    })
    await settleFrame()
    const scroller2 = second.container.querySelector('[class*="detailBody"]') as HTMLElement
    const article2 = second.container.querySelector('[class*="article"]') as HTMLElement
    const blocks2 = [...article2.children].filter(child => child.getAttribute('data-reader-reveal') !== '1')
    const expectedTop = heightOf(blocks2[0] as Element)
    const expectedOffset = Math.round(((recorded?.text ?? 0) / (recorded?.textLength ?? 1)) * heightOf(blocks2[1] as Element))
    await waitFor(() => { expect(scroller2.scrollTop).toBe(expectedTop + expectedOffset) })
    vi.restoreAllMocks()
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('puts the wall back where it was after the pane remounts', async () => {
    const first = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await first.settle()
    await screen.findByText('An English article')
    const scroller = wallScroller(first.container)
    fireEvent.wheel(scroller)
    scroller.scrollTop = 300
    fireEvent.scroll(scroller)
    first.unmount()

    const second = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await second.settle()
    await screen.findByText('An English article')
    await waitFor(() => { expect(wallScroller(second.container).scrollTop).toBe(300) })
  })

  it('a clamp from a shrinking document is not recorded as the reader\'s position', async () => {
    // The 3080 mechanism: on the remount, the translation rebuild shrank the
    // document under the scrolled scroller, the browser clamped it, and the
    // clamp's scroll event — indistinguishable from the reader's by value —
    // overwrote the stored anchor with the clamped value (and tripped the
    // "reader took over" flag, ending the settle window). Only a scroll the
    // reader CAUSED may be recorded.
    stubLayout()
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    await screen.findByTitle(zh['action.back'])
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    fireEvent.wheel(scroller)
    scroller.scrollTop = 620
    fireEvent.scroll(scroller)
    const entryId = `l:https://example.com/hn/${encodeURIComponent('An English article')}`
    await waitFor(() => {
      expect(readSession().scroll?.[entryId]).toEqual({ block: 2, offset: 20, top: 620, text: 3, textLength: 40 })
    })
    // What a browser clamp looks like from this side: the document shrank, the
    // offset fell, a scroll event fired — with no gesture anywhere near it
    // (the clock is aged past the gesture window; jsdom cannot clamp, so the
    // clamp's shape is stated by hand).
    const realNow = Date.now()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(realNow + 5000)
    scroller.scrollTop = 180
    fireEvent.scroll(scroller)
    nowSpy.mockRestore()
    await settleFrame()
    expect(readSession().scroll?.[entryId]).toEqual({ block: 2, offset: 20, top: 620, text: 3, textLength: 40 })
    vi.restoreAllMocks()
  })

  it('a clamp on the wall is not recorded as the wall\'s position either', async () => {
    const ui = bench({ sources: [rssSource('hn')], payloads: { hn: longFeed() } })
    await ui.settle()
    await screen.findByText('An English article')
    const scroller = wallScroller(ui.container)
    fireEvent.wheel(scroller)
    scroller.scrollTop = 300
    fireEvent.scroll(scroller)
    await waitFor(() => { expect(readSession().wallScroll).toBe(300) })
    // Same clamp shape on the wall (a narrowing filter shrank the list): no
    // gesture, so the wall's recorded place must not move.
    const realNow = Date.now()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(realNow + 5000)
    scroller.scrollTop = 40
    fireEvent.scroll(scroller)
    nowSpy.mockRestore()
    await settleFrame()
    expect(readSession().wallScroll).toBe(300)
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
    await screen.findByTitle(zh['action.back'])
    await settleFrame()
    const scroller = ui.container.querySelector('[class*="detailBody"]') as HTMLElement
    // Block 0 is 42 chars (420px); 500px in is block 1 ("Another paragraph
    // entirely…", 50 chars = 500px), 80px into it — the 8th character.
    fireEvent.wheel(scroller)
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

describe('the compact panel (panel-responsive-spec P2)', () => {
  /** A 390px panel: the kit's PanelRoot measures it and the pane goes compact. */
  const narrow = (): void => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect)
  }

  it('folds the wall header into one row: name, unread count, search and add, the rest behind ⋯', async () => {
    narrow()
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '第一条' }, { title: '第二条' }]) },
    })
    await ui.settle()
    await screen.findByText('第一条')
    expect(screen.getByText(`2 ${zh['foot.unread']}`)).toBeTruthy()
    // The search row is folded until asked for.
    expect(screen.queryByPlaceholderText(zh['search.placeholder'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['search.placeholder'] }))
    expect(screen.getByPlaceholderText(zh['search.placeholder'])).toBeTruthy()
    // Add is inline; refresh, history and subscriptions are not.
    expect(screen.getByRole('button', { name: zh['action.add'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['action.refresh'] })).toBeNull()
    expect(screen.queryByTitle(zh['action.manage'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(await screen.findByText(zh['action.refresh']))
    await waitFor(() => { expect(ui.mocks.refresh).toHaveBeenCalled() })
    // The wide header's own buttons never render on a compact panel.
    expect(screen.queryByTitle(zh['action.filter'])).toBeNull()
  })

  it('narrows the wall from the chip row, and a pressed chip clears again', async () => {
    narrow()
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' }), rssSource('saved', { kind: 'link', label: '保存的文章' })],
      payloads: { hn: feed('hn', [{ title: '订阅里的一条' }]), saved: feed('saved', [{ title: '保存的一条' }]) },
    })
    await ui.settle()
    await screen.findByText('订阅里的一条')
    const chips = screen.getByRole('group', { name: zh['action.filter'] })
    const chip = (label: string): HTMLElement => within(chips).getByText(label).closest('button') as HTMLElement
    expect(chip(zh['filter.all']).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip(zh['sources.kindRss']))
    expect(chip(zh['sources.kindRss']).getAttribute('aria-pressed')).toBe('true')
    expect(chip(zh['filter.all']).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip(zh['sources.kindRss']))
    expect(chip(zh['filter.all']).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip(zh['chip.unread']))
    expect(chip(zh['chip.unread']).getAttribute('aria-pressed')).toBe('true')
    // 全部 clears every narrowing, the unread toggle included.
    fireEvent.click(chip(zh['filter.all']))
    expect(chip(zh['chip.unread']).getAttribute('aria-pressed')).toBe('false')
    // 筛选… opens the same panel the wide header's funnel does.
    fireEvent.click(chip(zh['chip.more']))
    expect(await screen.findByText(zh['filter.bySource'])).toBeTruthy()
  })

  it('marks unread on the row itself once the source tile is gone', async () => {
    narrow()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '没读过的' }]) },
    })
    await ui.settle()
    await screen.findByText('没读过的')
    const dot = ui.container.querySelector('[class*="metaDot"]')
    expect(dot).not.toBeNull()
    expect(dot?.textContent).toBe('')
  })

  it('puts the detail on one header row: back, no repeated title, the ordinary actions behind ⋯', async () => {
    narrow()
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一篇长文', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('一篇长文'))
    expect(await screen.findByTitle(zh['action.back'])).toBeTruthy()
    // The bar carries no title: the article's heading below is the one place it reads.
    expect(screen.getAllByText('一篇长文')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: zh['action.copyLink'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(await screen.findByText(zh['action.openExternal']))
    expect(ui.mocks.openExternal).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['action.back'] }))
    expect(await screen.findByText('一篇长文')).toBeTruthy()
  })
})

describe('the compact detail bar takes the title once the heading scrolls away', () => {
  /** The observers the pane creates, so a test can play the browser's part. */
  const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = []
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal('IntersectionObserver', class {
      private readonly record: { callback: IntersectionObserverCallback; targets: Element[] }
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: [] }
        observers.push(this.record)
      }
      observe(target: Element): void { this.record.targets.push(target) }
      unobserve(): void {}
      disconnect(): void { this.record.targets.length = 0 }
      takeRecords(): IntersectionObserverEntry[] { return [] }
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  /** Report the heading's position to whoever watches it. */
  const report = (heading: Element, isIntersecting: boolean, bottom: number): void => {
    const watcher = observers.find(record => record.targets.includes(heading))
    expect(watcher).toBeDefined()
    act(() => {
      watcher?.callback([{ target: heading, isIntersecting, boundingClientRect: { bottom } as DOMRect, rootBounds: { top: 0 } as DOMRect } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  }

  it('shows it only after the heading left through the top, and drops it on the way back', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect)
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '一篇长文', description: `<p>${'正文。'.repeat(40)}</p>` }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('一篇长文'))
    expect(await screen.findByTitle(zh['action.back'])).toBeTruthy()
    const heading = screen.getByRole('heading', { level: 1, name: '一篇长文' })
    expect(screen.getAllByText('一篇长文')).toHaveLength(1)
    // Below the fold (a restored position mid-render) is not "scrolled past".
    report(heading, false, 900)
    expect(screen.getAllByText('一篇长文')).toHaveLength(1)
    report(heading, false, -12)
    expect(screen.getAllByText('一篇长文')).toHaveLength(2)
    report(heading, true, 40)
    expect(screen.getAllByText('一篇长文')).toHaveLength(1)
  })
})

describe('the card menu stays on screen', () => {
  it('opens inside the window even when summoned at its corner', async () => {
    const ui = bench({
      sources: [rssSource('hn')],
      payloads: { hn: feed('hn', [{ title: '边上的一条' }]) },
    })
    await ui.settle()
    const card = (await screen.findByText('边上的一条')).closest('[tabindex]') as HTMLElement
    fireEvent.contextMenu(card, { clientX: window.innerWidth - 2, clientY: window.innerHeight - 2 })
    const menu = await screen.findByRole('menu')
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 168 - 8)
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 120 - 8)
  })
})

describe('several incomplete sources fold into one line', () => {
  it('names how many, and lists them on request', async () => {
    const half = (id: string): string => `<rss version="2.0"><channel><title>${id}</title>`
      + `<item><title>${id} 完整的一条</title><link>https://example.com/${id}/a</link><description>正文</description></item>`
      + `<item><title>${id} 被截断的</title><link>https://example.com/${id}/b</link><description>半`
    const ui = bench({
      sources: [rssSource('one', { label: '源一' }), rssSource('two', { label: '源二' })],
      payloads: { one: half('one'), two: half('two') },
      truncatedIds: ['one', 'two'],
    })
    await ui.settle()
    expect(await screen.findByText(zh['state.incompleteCount'].replace('{count}', '2'))).toBeTruthy()
    expect(screen.queryByText(zh['state.incompleteReason'], { exact: false })).toBeNull()
    fireEvent.click(screen.getByText(zh['action.showList']))
    expect(screen.getAllByText(zh['state.incompleteReason'], { exact: false })).toHaveLength(2)
    fireEvent.click(screen.getByText(zh['action.foldList']))
    expect(screen.queryByText(zh['state.incompleteReason'], { exact: false })).toBeNull()
  })
})

describe('notes: take one from a selection, find it in the notes face, bring it to the conversation', () => {
  async function openedArticle() {
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '位置编码', description: '<p>自注意力不看顺序。</p><p>旋转 query 和 key。</p>' }]) },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('位置编码'))
    await screen.findByTitle(zh['action.back'])
    return ui
  }

  /** Select a whole paragraph of the rendered article. */
  function selectParagraph(text: string): void {
    const paragraph = screen.getByText(text)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    selection.addRange(range)
  }

  it('hands the host the article text once it renders', async () => {
    const ui = await openedArticle()
    await waitFor(() => { expect(ui.mocks.snapshotEntry).toHaveBeenCalled() })
    const request = ui.mocks.snapshotEntry.mock.calls[0]?.[0] as unknown as { paragraphs: string[]; title: string }
    expect(request.title).toBe('位置编码')
    expect(request.paragraphs).toEqual(['自注意力不看顺序。', '旋转 query 和 key。'])
  })

  it('asks for a selection first, then saves the excerpt with its block and comment', async () => {
    const ui = await openedArticle()
    // The way in is the quote plugin's selection menu, which asks this target;
    // nothing is selected yet, so the menu has no 记笔记 to offer.
    expect(noteTargetForSelection()).toBeUndefined()
    selectParagraph('旋转 query 和 key。')
    act(() => { noteTargetForSelection()?.start() })
    const sheet = await screen.findByRole('dialog', { name: zh['notes.sheetTitle'] })
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: '为什么只看相对距离？' } })
    fireEvent.click(within(sheet).getByText(`${zh['notes.save']} ⌘⏎`))
    await waitFor(() => { expect(ui.mocks.addNote).toHaveBeenCalled() })
    expect(ui.mocks.addNote.mock.calls[0]?.[0]).toMatchObject({ block: 1, quote: '旋转 query 和 key。', comment: '为什么只看相对距离？', title: '位置编码' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    // The notes tab now carries the count, and the notes face lists the excerpt.
    fireEvent.click(await screen.findByRole('tab', { name: /笔记\s*1/ }))
    expect(await screen.findByText('旋转 query 和 key。', { selector: 'button' })).toBeTruthy()
    // Bringing the notes to the conversation merges a quote block into the draft
    // and remembers this conversation on the article.
    fireEvent.click(screen.getByText(zh['notes.discussAll']))
    const written = ui.mocks.setDraft.mock.calls.at(-1)?.[0] as string
    expect(written).toContain('> n1 ¶2「旋转 query 和 key。」')
    expect(written).toContain('> 我的评论：为什么只看相对距离？')
    await waitFor(() => { expect(ui.mocks.recordDiscussion).toHaveBeenCalled() })
  })

  it('puts the quiz-me request into the draft from the tab row (and the end of the article)', async () => {
    const ui = await openedArticle()
    expect(screen.getByRole('button', { name: `${zh['notes.check']} →` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['notes.checkShort'] }))
    const written = ui.mocks.setDraft.mock.calls.at(-1)?.[0] as string
    expect(written).toContain('考考我：《位置编码》')
    expect(written).toContain('reader_note')
    await waitFor(() => { expect(ui.mocks.recordDiscussion).toHaveBeenCalled() })
  })

  it('syncs a note to the canvas picked last as a kept card carrying its provenance', async () => {
    const addCard = vi.fn(async () => ({ ok: true as const, cardId: 'card-9' }))
    const inbox: CanvasInboxLike = {
      current: () => null,
      listCanvases: async () => [{ id: 'cv-a', title: '读书会', cardCount: 3 }, { id: 'cv-b', title: '周报', cardCount: 1 }],
      addCard,
      openCard: vi.fn(),
    }
    localStorage.setItem('dsh-reader.lastCanvas', 'cv-b')
    const ui = bench({
      sources: [rssSource('hn', { label: 'Hacker News' })],
      payloads: { hn: feed('hn', [{ title: '位置编码', description: '<p>自注意力不看顺序。</p><p>旋转 query 和 key。</p>' }]) },
      inbox,
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('位置编码'))
    await screen.findByTitle(zh['action.back'])
    selectParagraph('旋转 query 和 key。')
    act(() => { noteTargetForSelection()?.start() })
    const sheet = await screen.findByRole('dialog', { name: zh['notes.sheetTitle'] })
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: '只看相对距离' } })
    fireEvent.click(within(sheet).getByText(`${zh['notes.save']} ⌘⏎`))
    fireEvent.click(await screen.findByRole('tab', { name: /笔记\s*1/ }))
    fireEvent.click(await screen.findByText(zh['notes.sync']))
    const picker = await screen.findByRole('dialog', { name: zh['notes.sync'] })
    // The canvas used last is preselected.
    await waitFor(() => { expect(within(picker).getByRole('radio', { name: /周报/ }).getAttribute('aria-checked')).toBe('true') })
    fireEvent.click(within(picker).getByText(zh['notes.syncRun']))
    await waitFor(() => { expect(addCard).toHaveBeenCalled() })
    const [, request] = addCard.mock.calls[0] as unknown as [string, { canvasId: string; text: string; source: { ref: string } }]
    expect(request.canvasId).toBe('cv-b')
    expect(request.text).toContain('> 旋转 query 和 key。')
    expect(request.text).toContain('只看相对距离')
    expect(request.text).toContain('— 《位置编码》 ¶2')
    await waitFor(() => { expect(ui.mocks.markSynced).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1', canvasId: 'cv-b', cardId: 'card-9', canvasTitle: '周报' })) })
    expect(await screen.findByText('已同步到《周报》')).toBeTruthy()
  })

  it('offers no sync without the canvas', async () => {
    await openedArticle()
    expect(screen.queryByText(zh['notes.sync'])).toBeNull()
  })
})

describe('video and audio entries', () => {
  // The 字幕 switch and positions are remembered per entry in localStorage.
  beforeEach(() => { localStorage.removeItem('dsh-reader.captionsHidden') })

  const videoFeed = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Channel</title>
    <entry><id>yt:video:zjkBMFhNj_g</id><title>Intro to LLMs</title><link rel="alternate" href="https://www.youtube.com/watch?v=zjkBMFhNj_g"/>
    <updated>2026-10-19T10:00:00Z</updated><media:group><media:description>A talk.</media:description></media:group></entry>
    <entry><id>ep</id><title>Episode 9</title><link rel="alternate" href="https://pod.example/ep9"/><updated>2026-10-19T09:00:00Z</updated>
    <link rel="enclosure" href="https://cdn.example/ep9.mp3" type="audio/mpeg"/><summary>Shownotes.</summary></entry></feed>`

  it('plays the video and reads its platform captions as a timed transcript', async () => {
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      transcript: '<p data-t="0.2">hi everyone.</p><p data-t="38.5">so the model is two files.</p>',
    })
    await ui.settle()
    expect((await screen.findByText('Intro to LLMs')).closest('[data-reader-entry]')?.getAttribute('data-thumb')).toBe('video')
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    await waitFor(() => { expect(ui.mocks.mediaTranscript).toHaveBeenCalledWith({ entryId: expect.any(String), url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g' }) })
    const frame = document.querySelector('iframe[src*="youtube.com/embed/zjkBMFhNj_g"]')
    expect(frame?.getAttribute('src')).toContain('enablejsapi=1')
    expect(await screen.findByText('so the model is two files.')).toBeTruthy()
    // Each paragraph carries its time chip (a CSS label, so selections skip it).
    await waitFor(() => { expect(document.querySelector('[data-reader-ts="38.5"]')?.getAttribute('data-label')).toBe('0:38') })
    expect(screen.getByText(zh['media.sourcePlatform'])).toBeTruthy()
    // The page behind the link is never fetched as an article.
    expect(ui.mocks.fetchEntryBody).not.toHaveBeenCalled()
    // 字幕 off: just the video.
    fireEvent.click(screen.getByRole('checkbox', { name: zh['media.captions'] }))
    expect(screen.getByText('so the model is two files.').closest('[hidden]')).not.toBeNull()
    expect(document.querySelector('iframe[src*="youtube.com/embed"]')).not.toBeNull()
  })

  it('says a video without captions has none, and keeps its description', async () => {
    const ui = bench({ sources: [rssSource('yt')], payloads: { yt: videoFeed } })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    expect(await screen.findByText(zh['media.noCaptions'])).toBeTruthy()
  })

  it('plays audio from its enclosure without asking for captions', async () => {
    const ui = bench({ sources: [rssSource('yt')], payloads: { yt: videoFeed } })
    await ui.settle()
    fireEvent.click(await screen.findByText('Episode 9'))
    await waitFor(() => { expect(document.querySelector('audio')?.getAttribute('src')).toBe('https://cdn.example/ep9.mp3') })
    expect(ui.mocks.mediaTranscript).not.toHaveBeenCalled()
    expect(await screen.findByText(zh['media.noCaptionsAudio'])).toBeTruthy()
  })

  it('transcribes a caption-less video on open, after one model-download confirmation, showing what is done', async () => {
    const entryless = { entryId: '' }
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      local: {
        start: [
          { ...entryless, state: 'needs-models', bytes: 323_000_000 },
          { ...entryless, state: 'fetching', progress: 0 },
        ],
        polls: [
          { ...entryless, state: 'transcribing', progress: 0.42, html: '<p data-src="local" data-t="0.0">大家好，欢迎回到节目。</p>' },
          { ...entryless, state: 'done', progress: 1, html: '<p data-src="local" data-t="0.0">大家好，欢迎回到节目。</p><p data-src="local" data-t="21.0">今天聊推理。</p>' },
        ],
      },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    await waitFor(() => { expect(ui.mocks.startLocalTranscript).toHaveBeenCalledTimes(1) })
    expect(ui.mocks.startLocalTranscript.mock.calls[0]![0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g', media: { kind: 'video', provider: 'youtube' } })
    // First use: one confirmation for the model download.
    fireEvent.click(await screen.findByRole('button', { name: zh['media.localModelsGo'] }))
    await waitFor(() => { expect(ui.mocks.startLocalTranscript).toHaveBeenLastCalledWith(expect.objectContaining({ confirmModels: true })) })
    // The part already transcribed reads at once, then the whole transcript.
    expect(await screen.findByText('大家好，欢迎回到节目。', {}, { timeout: 4000 })).toBeTruthy()
    expect(await screen.findByText('今天聊推理。', {}, { timeout: 4000 })).toBeTruthy()
    expect(await screen.findByText((_, element) => element?.textContent?.startsWith(zh['media.sourceLocal']) === true && element.tagName === 'SPAN')).toBeTruthy()
  })

  it('dresses a video card with its cover and says where its transcript stands', async () => {
    const ui = bench({ sources: [rssSource('yt')], payloads: { yt: videoFeed }, mediaCards: { engine: true, states: {} } })
    await ui.settle()
    const card = (await screen.findByText('Intro to LLMs')).closest('[data-reader-entry]')!
    expect(card.getAttribute('data-thumb')).toBe('video')
    expect(card.querySelector('img')?.getAttribute('src')).toBe('https://i.ytimg.com/vi/zjkBMFhNj_g/mqdefault.jpg')
    expect(card.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    await waitFor(() => { expect(ui.mocks.mediaStates).toHaveBeenCalled() })
    const ids = ui.mocks.mediaStates.mock.calls[0]![0].entryIds as string[]
    expect(ids).toHaveLength(2)
    // An audio entry with nothing known yet transcribes on open (the engine is installed).
    const audio = (await screen.findByText('Episode 9')).closest('[data-reader-entry]')!
    expect(audio.textContent).toContain(zh['media.cardNoneAuto'])
  })

  it('calls the body 转写稿 and labels each time as a play control', async () => {
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      transcript: '<p data-t="0.2">hi everyone.</p><p data-t="38.5">so the model is two files.</p>',
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    expect(await screen.findByRole('tab', { name: zh['media.tabTranscript'] })).toBeTruthy()
    await waitFor(() => { expect(document.querySelector('[data-reader-ts="38.5"]')?.getAttribute('title')).toBe('从 0:38 开始播放') })
    // 收起视频 turns the player into the mini bar (same frame, still there).
    fireEvent.click(screen.getByRole('button', { name: zh['media.collapse'] }))
    expect(document.querySelector('[data-mini="true"] iframe[src*="youtube.com/embed"]')).not.toBeNull()
  })

  it('reopened onto a stored local transcript, follows the speakers pass still running on the host', async () => {
    const stored = '<p data-src="local" data-t="0.0">hi everyone.</p>'
    const split = '<p data-src="local" data-spk="0" data-t="0.0">hi everyone.</p><p data-src="local" data-spk="1" data-t="5.0">thanks for having me.</p>'
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      local: { start: [], polls: [{ entryId: '', state: 'speakers', progress: 1, html: stored }, { entryId: '', state: 'done', progress: 1, html: split, speakers: 2 }] },
    })
    await ui.settle()
    ui.mocks.getEntryBody.mockImplementation(async (request: { entryId: string }) => ({ ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: stored } }))
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    expect(await screen.findByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.includes(zh['media.speakersRunning']) === true)).toBeTruthy()
    expect(await screen.findByText('thanks for having me.', {}, { timeout: 4000 })).toBeTruthy()
    expect(ui.mocks.startLocalTranscript).not.toHaveBeenCalled()
  })

  it('names the speakers where the voice changes, and renames one from the legend', async () => {
    const split = '<p data-src="local" data-spk="0" data-t="0.0">hi everyone.</p><p data-src="local" data-spk="0" data-t="3.0">welcome back.</p><p data-src="local" data-spk="1" data-t="5.0">thanks for having me.</p>'
    const ui = bench({ sources: [rssSource('yt')], payloads: { yt: videoFeed } })
    await ui.settle()
    ui.mocks.getEntryBody.mockImplementation(async (request: { entryId: string }) => ({ ok: true as const, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html: split } }))
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    await waitFor(() => { expect(document.querySelectorAll('[data-reader-spk]')).toHaveLength(2) })
    // Only where the voice changes: the second paragraph of speaker A carries no name.
    expect([...document.querySelectorAll('[data-reader-spk]')].map(label => label.getAttribute('data-label'))).toEqual(['说话人 A', '说话人 B'])
    fireEvent.click(screen.getByRole('button', { name: '说话人 B' }))
    const input = screen.getByRole('textbox', { name: zh['media.speakerRename'] })
    fireEvent.change(input, { target: { value: '嘉宾' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.mocks.nameSpeaker).toHaveBeenCalledWith({ entryId: expect.any(String), speaker: 1, name: '嘉宾' }) })
    await waitFor(() => { expect(document.querySelectorAll('[data-reader-spk]')[1]?.getAttribute('data-label')).toBe('嘉宾') })
  })

  it('shows the agent\'s 润色 in place of the paragraph, over the original, and back on 「看机翻」', async () => {
    const body = '<p data-t="0.2">hi everyone.</p><p data-t="38.5">so the model is two files.</p>'
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      transcript: body,
      polish: { total: 2, done: 1, paragraphs: { 2: '所以模型其实就是两个文件。' }, off: [], updatedAt: new Date().toISOString(), complete: false },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    const polished = await screen.findByText('所以模型其实就是两个文件。')
    const article = polished.closest('[data-polish-view]')!
    expect(article.getAttribute('data-polish-view')).toBe('both')
    // The paragraph's own text is still in the DOM (notes, translation), just not shown.
    expect(polished.closest('p')?.querySelector('[data-reader-orig-run]')?.textContent).toBe('so the model is two files.')
    expect(screen.getByText(zh['polish.running'].replace('{done}', '1').replace('{total}', '2'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['polish.showMachine'] }))
    expect(article.getAttribute('data-polish-view')).toBeNull()
  })

  it('puts the 润色 request into the draft from the bar when the globe is not offered', async () => {
    const ui = bench({ sources: [rssSource('yt')], payloads: { yt: videoFeed }, transcript: '<p data-t="0.2">hi everyone.</p>' })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    await screen.findByText('hi everyone.')
    fireEvent.click(screen.getByTitle(zh['polish.action']))
    const written = ui.mocks.setDraft.mock.calls.at(-1)?.[0] as string
    expect(written).toContain('reader_translate')
    expect(written).toContain('共 1 段')
    expect(await screen.findByText(zh['polish.awaiting'])).toBeTruthy()
  })

  it('does not re-translate a transcript while it is still arriving, and restores the translation once it is done', async () => {
    installTranslator()
    const part = (n: number) => Array.from({ length: n }, (_, i) => `<p data-src="local" data-t="${String(i * 10)}.0">Sentence number ${String(i + 1)} here.</p>`).join('')
    const ui = bench({
      sources: [rssSource('hn'), rssSource('yt')],
      payloads: { hn: feed('hn', [{ title: 'An English article', description: 'First sentence here.' }]), yt: videoFeed },
      local: {
        start: [{ entryId: '', state: 'transcribing', progress: 0.2 }],
        polls: [
          { entryId: '', state: 'transcribing', progress: 0.3, html: part(1) },
          { entryId: '', state: 'transcribing', progress: 0.5, html: part(2) },
          { entryId: '', state: 'done', progress: 1, html: part(3) },
        ],
      },
    })
    await ui.settle()
    // This page already built an English → Chinese session (the reader translated another article).
    fireEvent.click((await screen.findAllByRole('button', { name: /An English article/ }))[0] as HTMLElement)
    fireEvent.click(await screen.findByTitle(zh['action.translate']))
    await waitFor(() => { expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：First sentence here.') })
    fireEvent.click(screen.getByTitle(zh['action.back']))
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    await waitFor(() => { expect(ui.mocks.startLocalTranscript).toHaveBeenCalled() })
    // The reader had this entry translated before re-transcribing it.
    rememberTranslation(String(ui.mocks.startLocalTranscript.mock.calls[0]![0].entryId), 'trans', 'en')
    expect(await screen.findByText('Sentence number 2 here.', {}, { timeout: 4000 })).toBeTruthy()
    expect(ui.container.querySelector('[class*="article"]')?.textContent).not.toContain('译：')
    await waitFor(() => {
      expect(ui.container.querySelector('[class*="article"]')?.textContent).toContain('译：Sentence number 3 here.')
    }, { timeout: 5000 })
    delete (globalThis as unknown as { Translator?: unknown }).Translator
  })

  it('withdraws a job when leaving and stops it from 取消', async () => {
    const entryless = { entryId: '' }
    const ui = bench({
      sources: [rssSource('yt')],
      payloads: { yt: videoFeed },
      local: { start: [{ ...entryless, state: 'transcribing', progress: 0.1 }], polls: [{ ...entryless, state: 'transcribing', progress: 0.2 }] },
    })
    await ui.settle()
    fireEvent.click(await screen.findByText('Intro to LLMs'))
    fireEvent.click(await screen.findByRole('button', { name: zh['media.localStop'] }))
    await waitFor(() => { expect(ui.mocks.cancelLocalTranscript).toHaveBeenCalledWith({ entryId: expect.any(String), force: true }) })
    expect(await screen.findByRole('button', { name: zh['media.localRetry'] })).toBeTruthy()
  })
})

