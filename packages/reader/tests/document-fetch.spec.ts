/**
 * The document fetcher: which fetcher a feed or page goes through.
 *
 * The case that motivated it: the official web service selecting the DeepSeek
 * Fetch API, whose answer is Markdown under a constant 200 (seam registry S22).
 * The stand-in seam below answers exactly that shape, and the reader must not
 * see it once the official provider is available.
 */
import { describe, expect, it, vi } from 'vitest'
import { DOCUMENT_FETCH_DEFAULTS, DocumentFetch, isOfficialWebService, type DocumentFetcher } from '../src/document-fetch.ts'

/** What `deepseek-fetch-api` answers for any URL: Markdown, 200, the request URL. */
function markdownSeam(): DocumentFetcher & { registerFetchProvider: () => () => void } {
  return {
    registerFetchProvider: () => () => {},
    fetch: vi.fn(async (request: { url: string }) => ({
      url: request.url, statusCode: 200, body: { kind: 'text' as const, content: '# A feed, as Markdown' }, truncated: false,
    })),
  }
}

/** A provider module whose constructor records the limits it was given. */
function fakeModule() {
  const built: unknown[] = []
  class HttpFetchProvider implements DocumentFetcher {
    constructor(limits: unknown) { built.push(limits) }
    async fetch(request: { url: string }) {
      return { url: request.url, statusCode: 200, body: { kind: 'text' as const, content: '<?xml version="1.0"?><rss/>' }, truncated: false }
    }
  }
  return { built, module: { HttpFetchProvider, DEFAULT_USER_AGENT: 'ua/1' } }
}

describe('isOfficialWebService', () => {
  it('recognizes the service by its provider registry, not by a plain fetch', () => {
    expect(isOfficialWebService(markdownSeam())).toBe(true)
    expect(isOfficialWebService({ fetch: async () => undefined })).toBe(false)
    expect(isOfficialWebService(undefined)).toBe(false)
  })
})

describe('DocumentFetch', () => {
  it('answers nothing without a web capability: no web, no fetch', async () => {
    const load = vi.fn()
    expect(await new DocumentFetch(() => undefined, undefined, load).current()).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })

  it('fetches through a seam that is not the official service, as before', async () => {
    const seam = { fetch: vi.fn() }
    const load = vi.fn()
    expect(await new DocumentFetch(() => seam, undefined, load).current()).toBe(seam)
    expect(load).not.toHaveBeenCalled()
  })

  it('bypasses a Markdown-answering selection with its own provider on the official service', async () => {
    const seam = markdownSeam()
    const { built, module } = fakeModule()
    const documents = new DocumentFetch(() => seam, undefined, async () => module)
    const fetcher = await documents.current()
    expect(fetcher).not.toBe(seam)
    const result = await fetcher?.fetch({ url: 'https://example.org/feed' })
    expect(result?.body.content.startsWith('<?xml')).toBe(true)
    expect(seam.fetch).not.toHaveBeenCalled()
    expect(built).toEqual([{ ...DOCUMENT_FETCH_DEFAULTS, userAgent: 'ua/1' }])
  })

  it('reads whole pages, not the http row\'s model-sized 100 000 characters', () => {
    // A 620 KB article page was cut mid-sentence at the row's default.
    expect(DOCUMENT_FETCH_DEFAULTS.maxBodyChars).toBe(2_000_000)
    expect(DOCUMENT_FETCH_DEFAULTS.maxResponseBytes).toBeGreaterThanOrEqual(DOCUMENT_FETCH_DEFAULTS.maxBodyChars)
  })

  it('builds the provider once and applies the configured limits', async () => {
    const { built, module } = fakeModule()
    const load = vi.fn(async () => module)
    const documents = new DocumentFetch(() => markdownSeam(), { maxBodyChars: 2_000_000, timeoutMs: 180_000 }, load)
    const first = await documents.current()
    expect(await documents.current()).toBe(first)
    expect(load).toHaveBeenCalledTimes(1)
    expect(built).toEqual([{ ...DOCUMENT_FETCH_DEFAULTS, maxBodyChars: 2_000_000, timeoutMs: 180_000, userAgent: 'ua/1' }])
  })

  it('falls back to the seam when the provider package is absent or will not construct', async () => {
    const seam = markdownSeam()
    expect(await new DocumentFetch(() => seam, undefined, async () => undefined).current()).toBe(seam)
    class Broken { constructor() { throw new Error('limits refused') } }
    const broken = { HttpFetchProvider: Broken as unknown as new () => DocumentFetcher }
    expect(await new DocumentFetch(() => seam, undefined, async () => broken).current()).toBe(seam)
  })

  it('loads the real official provider, which enforces its own address policy', async () => {
    const seam = markdownSeam()
    const fetcher = await new DocumentFetch(() => seam).current()
    expect(fetcher).not.toBe(seam)
    // A loopback target is refused by the provider's policy before any request.
    await expect(fetcher?.fetch({ url: 'http://127.0.0.1:9/feed' })).rejects.toMatchObject({ code: expect.stringMatching(/^WEB_/) })
    expect(seam.fetch).not.toHaveBeenCalled()
  })
})
