/**
 * The reader Remote: the browser-facing wire face, and nothing else.
 *
 * Every method is a one-line delegation to {@link ReaderService}; the value it
 * returns is the BARE domain value. The wire layer wraps that in the protocol's
 * own result envelope, so a domain refusal is a value inside that envelope —
 * never a second `{ ok }` object nested inside the first (which is how the
 * discarded scaffold managed to answer `{ ok: true }` twice and throw it away).
 *
 * @module @khorsheed/dsh-reader/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ReaderService } from './service.ts'
import type {
  ReaderAddFailure,
  ReaderAddOutcome,
  ReaderAddRefusal,
  ReaderAnnotationOutcome,
  ReaderEntryBodyView,
  ReaderBody,
  ReaderCapabilities,
  ReaderMutationOutcome,
  ReaderRefreshResult,
  ReaderSourceSummary,
  ReaderTag,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    readerRemote: ReaderRemoteService
  }
}

/** Reserved for future config-driven knobs; the service owns today's config. */
export interface ReaderRemoteConfig {}

/** The wire namespace is `reader`: the browser calls `remote.reader.*`. */
export class ReaderRemoteService extends TypertRemoteService<ReaderRemoteConfig> {
  static inject = ['reader']

  constructor(ctx: Context, _config: ReaderRemoteConfig = {}) {
    super(ctx, 'readerRemote', { namespace: 'reader' })
  }

  /** The service core this face delegates to. */
  private get core(): ReaderService {
    return this.ctx.reader
  }

  /** Capability handshake: what the browser may rely on in this composition. */
  @Remote('capabilities')
  capabilities(): Promise<ReaderCapabilities> {
    return this.core.capabilities()
  }

  /** The configured sources, without payloads. */
  @Remote('listSources')
  async listSources(): Promise<{ sources: ReaderSourceSummary[] }> {
    return this.core.listSources()
  }

  /** Add a source; the host decides whether the URL is a feed or an article. */
  @Remote('addSource')
  addSource(request: { url: string; label?: string }): Promise<ReaderAddOutcome | ReaderAddRefusal | ReaderAddFailure> {
    return this.core.addSource(request)
  }

  /** Change a source's label/enabled flag, or the global refresh time. */
  @Remote('updateSource')
  updateSource(request: {
    id: string
    enabled?: boolean
    label?: string
    url?: string
    timeOfDay?: string
  }): Promise<ReaderMutationOutcome> {
    return this.core.updateSource(request)
  }

  /** Drop a source. */
  @Remote('removeSource')
  removeSource(request: { id: string }): Promise<ReaderMutationOutcome> {
    return this.core.removeSource(request)
  }

  /** Fetch the named sources (or every enabled one) now. */
  @Remote('refresh')
  async refresh(request: { ids?: string[] }): Promise<{ results: ReaderRefreshResult[] }> {
    return this.core.refresh(request)
  }

  /** Hand back raw payloads for the browser to parse. */
  @Remote('getBodies')
  async getBodies(request: { ids: string[] }): Promise<{ bodies: ReaderBody[] }> {
    return this.core.getBodies(request)
  }

  /* ------------------------------------------- entry bodies and reader tags */

  /** What the detail view should render for one entry, and whether a fetch is worth offering. */
  @Remote('getEntryBody')
  getEntryBody(request: { entryId: string; url: string; feedHtml?: string }): Promise<ReaderEntryBodyView> {
    return this.core.getEntryBody(request)
  }

  /** Fetch one entry's article (the network half; the browser extracts). */
  @Remote('fetchEntryBody')
  fetchEntryBody(request: { entryId: string; url: string }): Promise<{ entryId: string; url?: string; raw?: string; truncated?: boolean; error?: string }> {
    return this.core.fetchEntryBody(request)
  }

  /** Cache the markup the browser extracted for one entry. */
  @Remote('storeEntryBody')
  storeEntryBody(request: { entryId: string; url: string; html: string; truncated?: boolean }): Promise<ReaderEntryBodyView> {
    return this.core.storeEntryBody(request)
  }

  /** The tag vocabulary, with how many entries carry each tag. */
  @Remote('listTags')
  listTags(): Promise<{ tags: ReaderTag[]; counts: Record<string, number> }> {
    return this.core.listTags()
  }

  /** Create a tag, or return the existing one with the same name. */
  @Remote('createTag')
  createTag(request: { name: string }): Promise<ReaderTag | ReaderAnnotationOutcome> {
    return this.core.createTag(request)
  }

  /** Rename a tag without touching the entries that carry it. */
  @Remote('renameTag')
  renameTag(request: { id: string; name: string }): Promise<ReaderAnnotationOutcome> {
    return this.core.renameTag(request)
  }

  /** Delete a tag and remove it from every entry. */
  @Remote('deleteTag')
  deleteTag(request: { id: string }): Promise<ReaderAnnotationOutcome> {
    return this.core.deleteTag(request)
  }

  /** Add or remove one tag on one entry. */
  @Remote('tagEntry')
  tagEntry(request: { entryId: string; tagId: string; on: boolean }): Promise<ReaderAnnotationOutcome> {
    return this.core.tagEntry(request)
  }

  /** The tags on one entry. */
  @Remote('entryTags')
  entryTags(request: { entryId: string }): Promise<{ tags: ReaderTag[] }> {
    return this.core.entryTags(request)
  }

  /** Read or set how long a fetched body is served. */
  @Remote('getCachePolicy')
  getCachePolicy(): Promise<{ ttlHours: number; maxEntries: number }> {
    return this.core.getCachePolicy()
  }

  @Remote('setCachePolicy')
  setCachePolicy(request: { ttlHours: number; maxEntries?: number }): Promise<ReaderAnnotationOutcome> {
    return this.core.setCachePolicy(request)
  }

  /** Drop tags nothing references any more. */
  @Remote('pruneTags')
  pruneTags(): Promise<{ removed: number }> {
    return this.core.pruneTags()
  }

  /** Forward a ref block to the side-chat service when one is composed. */
  @Remote('quoteToSideChat')
  quoteToSideChat(request: {
    contextKey: string
    label: string
    text: string
  }): Promise<'ok' | 'unavailable'> {
    return this.core.quoteToSideChat(request)
  }
}

export default ReaderRemoteService
