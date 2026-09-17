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
  ReaderAddOutcome,
  ReaderAddRefusal,
  ReaderBody,
  ReaderCapabilities,
  ReaderMutationOutcome,
  ReaderRefreshResult,
  ReaderSourceSummary,
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
  addSource(request: { url: string; label?: string }): Promise<ReaderAddOutcome | ReaderAddRefusal> {
    return this.core.addSource(request)
  }

  /** Change a source's label/enabled flag, or the global refresh time. */
  @Remote('updateSource')
  updateSource(request: {
    id: string
    enabled?: boolean
    label?: string
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
