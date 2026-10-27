/**
 * The document fetcher: the reader's own instance of the official HTTP fetch
 * provider, so feeds and article pages arrive as the origin served them.
 *
 * Why not `ctx.web.fetch` alone: the seam runs whichever provider the host
 * selects, and from 0.2.1-rc.2 the web-search settings switch for the DeepSeek
 * Search/Fetch API moves `web.fetchProvider` too. That provider answers
 * Markdown (`body.kind: 'text'`), a constant 200, and the request URL as the
 * final URL — so `classifyPayload` reads every feed as a page, the extractor
 * gets no HTML, and the cross-origin redirect handling never fires. The
 * request carries only a URL; no caller can ask for the HTTP provider (seam
 * registry S22).
 *
 * So when the mounted `web` is the official service (it carries
 * `registerFetchProvider`), the reader fetches through its own
 * `HttpFetchProvider` — the same class the default `http` row registers, with
 * that row's default limits, so the policy (public addresses only, connection
 * pinned, same-origin redirects, charset decoding) and the errors
 * (`WEB_REDIRECT_BLOCKED` naming the target origin) are exactly today's.
 * `ctx.web` stays the permission: without it nothing is fetched. A host
 * without the provider package (or any other `web` shape, such as a test's
 * plain `{ fetch }`) is fetched through as before.
 *
 * Retire when the seam lets one request name its provider (S22).
 *
 * @module @khorsheed/dsh-reader/document-fetch
 */

/** The shape of one fetch result, declared structurally (no host import). */
export interface DocumentFetchResult {
  readonly url: string
  readonly statusCode: number
  readonly body: { readonly kind: 'html' | 'text'; readonly content: string }
  readonly truncated: boolean
}

/** Anything that fetches one URL: the web seam or a provider. */
export interface DocumentFetcher {
  fetch(request: { readonly url: string }, signal?: AbortSignal): Promise<DocumentFetchResult>
}

/** The limits the official provider takes (the `http` row's resolved config). */
interface HttpFetchLimits {
  readonly maxResponseBytes: number
  readonly maxBodyChars: number
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly userAgent: string
}

/** The provider package's runtime face, structurally. */
interface HttpProviderModule {
  readonly HttpFetchProvider: new (limits: HttpFetchLimits) => DocumentFetcher
  readonly DEFAULT_USER_AGENT?: string
}

/**
 * The reader's own fetch limits: the `http` row's defaults
 * (`@deepseek-ai/dsh-web-fetch-http` Config, 0.1.5 through 0.2.1-rc.3) except
 * `maxBodyChars`. The row's 100 000 is sized for a page handed to a model; the
 * reader extracts the article itself from the raw HTML, and a modern page
 * carries several hundred KB of inline script before its last paragraph
 * (measured: claude.com's articles, 620 KB, cut mid-sentence at 100 000). 2 000 000
 * is what deployments ran the row at while the reader still fetched through
 * it, and the per-source storage budget (`MAX_BODY_CHARS_PER_SOURCE`) is
 * sized to match. A deployment changes these with the reader's own
 * `fetchLimits`: the row's config does not reach this instance.
 */
export const DOCUMENT_FETCH_DEFAULTS = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 2_000_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
} as const

/** The limits a deployment may override (the user agent stays the provider's). */
export type DocumentFetchLimits = Partial<Pick<HttpFetchLimits, 'maxResponseBytes' | 'maxBodyChars' | 'timeoutMs' | 'maxRedirects'>>

/** Whether a mounted `web` is the official service rather than some other shape. */
export function isOfficialWebService(web: unknown): boolean {
  return typeof (web as { registerFetchProvider?: unknown } | undefined)?.registerFetchProvider === 'function'
}

/** Loads the provider package; injectable so tests never need the real one. */
export type HttpProviderLoader = () => Promise<HttpProviderModule | undefined>

const loadOfficialProvider: HttpProviderLoader = () =>
  import('@deepseek-ai/dsh-web-fetch-http').then(
    module => module as unknown as HttpProviderModule,
    () => undefined,
  )

/**
 * Pick the fetcher for raw documents.
 *
 * Built once per service: the first fetch on an official web service loads
 * the provider package and keeps the instance; a failed load is remembered
 * too, and every later fetch goes through the seam.
 */
export class DocumentFetch {
  private provider: Promise<DocumentFetcher | undefined> | undefined

  /**
   * @param web - the probed web seam, read on every call (it may come and go).
   * @param limits - the reader's configured fetch limits, over the defaults.
   * @param load - the provider package loader (tests inject one).
   */
  constructor(
    private readonly web: () => unknown,
    private readonly limits: DocumentFetchLimits = {},
    private readonly load: HttpProviderLoader = loadOfficialProvider,
  ) {}

  /**
   * The fetcher for this call, or undefined when no web capability is mounted.
   * @returns the reader's own provider on an official web service, else the seam itself.
   */
  async current(): Promise<DocumentFetcher | undefined> {
    const web = this.web()
    if (web === undefined || web === null) return undefined
    const seam = web as DocumentFetcher
    if (!isOfficialWebService(web)) return seam
    this.provider ??= this.load().then(module => {
      if (module === undefined || typeof module.HttpFetchProvider !== 'function') return undefined
      try {
        return new module.HttpFetchProvider({
          ...DOCUMENT_FETCH_DEFAULTS,
          ...this.limits,
          userAgent: module.DEFAULT_USER_AGENT ?? 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
        })
      } catch {
        return undefined
      }
    })
    return (await this.provider) ?? seam
  }
}
