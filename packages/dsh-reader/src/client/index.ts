/**
 * The reader's browser half: mount the Remote, register the dictionaries and
 * the right-Sidebar tab, and hand the pane the four gestures it cannot perform
 * for itself (the conversation draft, the clipboard, the browser, and the
 * side-chat hop).
 *
 * Failure policy is the repo's "degrade, don't explode": genuinely required
 * wiring (`slots`, `remote`, `locale`, `sidebarRightTabs`) is declared in
 * `inject` and logged when it fails, while every OPTIONAL capability is probed
 * per gesture — no `sideChat` hides the side-chat action, no conversation
 * surface makes the draft gestures no-ops, and an unavailable clipboard reports
 * failure instead of pretending to have copied.
 *
 * @module @khorsheed/dsh-reader/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-reader/remote'
// Type-only: pulls the ctx.sidebarRightTabs merge and the pane seat.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import readerRemote from '@khorsheed/dsh-reader/remote'
import type { ReaderEntryBodyView } from '../types.ts'
import type { ReaderCaptureRemote, ReaderPaneInjected } from './contract.ts'
import { extractArticle } from './extract-article.ts'
import { translationHash } from './translate.ts'
import { READER_TAB_ID, readerDefinition } from './definition.tsx'
import { ReaderPane } from './ReaderPane.tsx'
import { createReaderStore } from './store.ts'
import { en, NS, zh } from './locales.ts'

export { ReaderPane }
export { READER_KIND, READER_TAB_ID } from './definition.tsx'

/**
 * Required services: the pane seat, the wire channel, the locale,
 * the tab-type registry, and sessions (the conversation draft lives behind a
 * session scope, and the session id alone is not enough to reach it).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: mount the Remote, register the dictionaries and the
 * sidebar tab, and return the disposer.
 *
 * @param ctx - client root context.
 * @returns the teardown for everything this body registered.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(readerRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud; the rest of
    // the plugin still registers, so the tab shows its empty state rather than
    // disappearing.
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'reader: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote.reader')

  /** Copy text through the clipboard API, reporting whether it worked. */
  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  /**
   * Open a URL in the user's browser.
   *
   * The host exposes no plugin-facing "open this URL" service today (the
   * open-in-app routes launch local files into an app), so this rides the
   * browser's own user-invoked navigation: a click handler calling
   * `window.open` with `noopener` is a user gesture, not a popup. The design
   * records this as the one unverified seam, to be re-checked on the
   * acceptance instance.
   */
  const openExternal = (url: string): boolean => {
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (opened !== null) return true
    } catch {
      // fall through to the anchor path
    }
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.click()
      return true
    } catch {
      return false
    }
  }

  /**
   * The in-app Sidebar Browser, probed live (the canvas/quote pattern).
   *
   * Two services, both optional: the tab-type registry answers whether the
   * `browser` kind is registered (host 0.1.6-alpha.2 mounts it; older hosts do
   * not), and the navigation face performs the open. `openTab` throws for a
   * kind nothing registered and for a missing session binding, so the call is
   * wrapped — the pane's fallback is the external link.
   */
  const sidebarBrowser = (): { openTab(kind: string, options?: { params?: Record<string, unknown> }): void } | undefined => {
    const tabs = ctx.get('sidebarRightTabs') as { get(kind: string): unknown } | undefined
    if (tabs?.get('browser') === undefined) return undefined
    return ctx.get('sidebarRight') as { openTab(kind: string, options?: { params?: Record<string, unknown> }): void } | undefined
  }

  /**
   * Fetch one entry's article and cache the extraction.
   *
   * The split is the host/browser boundary: the host owns the network (its
   * sanctioned egress seam), this process owns the DOM, and neither can do the
   * other's half — so the view calls this one function and both halves happen.
   */
  const fetchEntryBody = async (entryId: string, url: string): Promise<ReaderEntryBodyView> => {
    const fetched = await remote.fetchEntryBody({ entryId, url })
    if (!fetched.ok) {
      return { entryId, cached: false, fresh: false, fromFeed: false, error: fetched.error.message }
    }
    const value = fetched.value
    if (value.raw === undefined || value.url === undefined) {
      return { entryId, cached: false, fresh: false, fromFeed: false, error: value.error ?? 'fetch-failed' }
    }
    const extracted = extractArticle(value.raw, value.url)
    if (!extracted.ok) {
      return { entryId, cached: false, fresh: false, fromFeed: false, error: extracted.error }
    }
    const meta = {
      ...(extracted.title === undefined ? {} : { title: extracted.title }),
      ...(extracted.excerpt === undefined ? {} : { excerpt: extracted.excerpt }),
    }
    const stored = await remote.storeEntryBody({
      entryId,
      url: value.url,
      html: extracted.html,
      // The entry's translation map is keyed to the body's hash: a refetch that
      // changes the body retires the map in the same commit.
      bodyHash: translationHash(extracted.html),
      ...meta,
      ...(value.truncated === true ? { truncated: true } : {}),
      ...(extracted.scriptFigures === undefined ? {} : { scriptFigures: extracted.scriptFigures }),
    })
    return stored.ok
      ? { ...stored.value, ...meta }
      : { entryId, cached: false, fresh: false, fromFeed: false, error: stored.error.message }
  }

  /** The injected business face, identical for whichever session mounts it. */
  const face = (sessionId: SessionId): ReaderPaneInjected => ({
    capabilities: () => remote.capabilities(),
    listSources: () => remote.listSources(),
    addSource: url => remote.addSource({ url }),
    updateSource: request => remote.updateSource(request),
    removeSource: (id, entryIds) => remote.removeSource({ id, ...(entryIds === undefined ? {} : { entryIds }) }),
    refresh: ids => remote.refresh(ids === undefined ? {} : { ids }),
    getBodies: ids => remote.getBodies({ ids }),
    quoteToSideChat: request => remote.quoteToSideChat(request),
    entryFetchStates: entryIds => remote.entryFetchStates({ entryIds }),
    getRawBody: entryId => remote.getRawBody({ entryId }),
    storeEntryBody: request => remote.storeEntryBody(request),
    listBackfillCandidates: entries => remote.listBackfillCandidates({ entries }),
    getEntryBody: request => remote.getEntryBody(request),
    fetchEntryBody,
    fetchImage: url => remote.fetchImage({ url }),
    getEntryTranslation: entryId => remote.getEntryTranslation({ entryId }),
    getSentenceTranslations: request => remote.getSentenceTranslations(request),
    rememberSentences: request => remote.rememberSentences(request),
    entryTags: entryId => remote.entryTags({ entryId }),
    listTags: () => remote.listTags(),
    createTag: name => remote.createTag({ name }),
    tagEntry: (entryId, tagId, on) => remote.tagEntry({ entryId, tagId, on }),
    renameTag: (id, name) => remote.renameTag({ id, name }),
    deleteTag: id => remote.deleteTag({ id }),
    pruneTags: () => remote.pruneTags(),
    recordRead: request => remote.recordRead(request),
    listRecent: () => remote.listRecent(),
    clearRecent: () => remote.clearRecent(),
    getCachePolicy: () => remote.getCachePolicy(),
    setCachePolicy: (ttlHours, maxEntries, translationBudgetChars) => remote.setCachePolicy({
      ttlHours,
      ...(maxEntries === undefined ? {} : { maxEntries }),
      ...(translationBudgetChars === undefined ? {} : { translationBudgetChars }),
    }),
    getStorageStats: () => remote.getStorageStats(),
    clearTranslations: () => remote.clearTranslations(),
    readDraft: () => readDraft(sessionId),
    setDraft: merged => { setDraft(sessionId, merged) },
    copyText,
    openExternal,
    browserTabAvailable: () => sidebarBrowser() !== undefined,
    openBrowserTab: url => {
      const browser = sidebarBrowser()
      if (browser === undefined) return false
      try {
        browser.openTab('browser', { params: { url } })
        return true
      } catch {
        return false
      }
    },
    // The capture package (the ingest proposal's M1): probed live per gesture,
    // absent today — the 「渲染抓取」 slot renders only while this answers.
    captureRemote: () => {
      const capture = ctx.get('remote.capture') as ReaderCaptureRemote | undefined
      return typeof capture?.render === 'function' ? capture : undefined
    },
  })

  /** The conversation input for a session, when the composition has one. */
  const inputFor = (sessionId: SessionId): { state: { getSnapshot(): { draft: string } }, setDraft(value: string): void } | undefined => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    return scope?.get('conversation')?.input.for(scope) as
      | { state: { getSnapshot(): { draft: string } }, setDraft(value: string): void }
      | undefined
  }

  /** Read the session's current draft; an empty string when there is none. */
  const readDraft = (sessionId: SessionId): string => {
    const input = inputFor(sessionId)
    return input?.state.getSnapshot().draft ?? ''
  }

  /** Replace the session's draft; a silent no-op without a conversation surface. */
  const setDraft = (sessionId: SessionId, merged: string): void => {
    inputFor(sessionId)?.setDraft(merged)
  }

  // Two-stage right-Sidebar registration: the type into the registry, the body
  // into the keyed pane seat under the type's id. Both ride `ctx.effect` so a
  // reload or unload removes them.
  ctx.effect(() => ctx.sidebarRightTabs.register(readerDefinition(t)), 'reader: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: READER_TAB_ID,
    locale: NS,
    store: createReaderStore,
    inject: face,
  }, ReaderPane)), 'reader: sidebar tab body')

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
