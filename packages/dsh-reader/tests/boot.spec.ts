/**
 * The host half's boot, against a real Cordis context.
 *
 * Every other host test here drives a pure function; this one drives the
 * plugin body. That distinction is the whole point: the package this one
 * replaces shipped a host half that provided nothing and a browser half that
 * rendered nothing, and both defects lived exactly in the wiring that the pure
 * tests could not see. A plugin whose `apply` forgets `ctx.provide('reader')`
 * leaves every Remote call throwing into a proxy, and the visible result is a
 * tab that opens and stays blank.
 *
 * The context here is deliberately minimal: no `fs`, no `web`, no `sideChat`,
 * no `quote`. Those are the host's optional capabilities, so the composition
 * that must survive is the one that has none of them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import { ReaderRemoteService } from '../src/remote.ts'
import { MAX_RECENT_ENTRIES } from '../src/store.ts'
import type { ReaderService } from '../src/service.ts'
import { linkEntryId } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []

/** A throwaway state root; the plugin never touches the real deployment's. */
function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-reader-boot-'))
  roots.push(root)
  return root
}

/** Boot the host half on a fresh context and settle its injection. */
async function boot(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  apply(ctx, { stateRoot: stateRoot() })
  // The Remote mount is a fiber waiting on `inject: ['reader']`; settle the
  // lifecycle before reading what it registered.
  await ctx.fiber.await()
  return ctx
}

/**
 * Boot with a scripted `web` seam mounted.
 *
 * `ctx.web.fetch` is the one host capability the reader cannot fake: the seam
 * is probed structurally, so a plain object with a `fetch` method is the whole
 * contract.
 *
 * @param fetch - what the seam answers or throws.
 * @returns the booted context.
 */
async function bootWithWeb(fetch: (request: { url: string }) => Promise<unknown>): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('web', { fetch } as never)
  apply(ctx, { stateRoot: stateRoot() })
  await ctx.fiber.await()
  return ctx
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('the host half boots and provides its service', () => {
  it('declares the loader-facing plugin name it is mounted under', () => {
    // The identity triangle's third leg: cordis.patch.yml's row id, the
    // tsdown clientBundle id, and this name all move together on a rename.
    expect(name).toBe('reader')
  })

  it('provides `reader` — the service every Remote method delegates to', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService | undefined
    expect(service).toBeDefined()
    // The handshake is the browser's first call; if the service were not
    // reachable this would throw instead of reporting capabilities.
    const capabilities = await (service as ReaderService).capabilities()
    expect(capabilities.protocolVersion).toBe(1)
  })

  it('mounts the Remote face under its own service key', async () => {
    // A missing mount is silent on the host and fatal in the browser: the
    // client's `remote.reader` proxy would reject every gesture, which is what
    // "the tab opens and shows nothing" looks like from the user's side.
    //
    // Read through `ctx.get`, not `ctx.readerRemote`: nothing in this test
    // declares the service as a dependency, so the proxy would refuse the
    // property read — which is itself the behaviour under test's premise.
    const ctx = await boot()
    const remote = ctx.get('readerRemote') as ReaderRemoteService | undefined
    expect(remote).toBeDefined()
    // Not just present: actually delegating to the core through the wire face.
    // Compared field by field: `capabilities()` derives `nextRefreshAt` from
    // Date.now(), so two calls can legitimately differ by a millisecond.
    const viaRemote = await (remote as ReaderRemoteService).capabilities()
    const viaCore = await ctx.get('reader').capabilities()
    expect(viaRemote.protocolVersion).toBe(viaCore.protocolVersion)
    expect(viaRemote.hasFs).toBe(viaCore.hasFs)
    expect(viaRemote.hasSideChat).toBe(viaCore.hasSideChat)
    expect(typeof viaRemote.nextRefreshAt).toBe(typeof viaCore.nextRefreshAt)
  })

  it('persists state with native fs even when a SESSION-FENCED ctx.fs is mounted', async () => {
    // The acceptance-instance defect, as a regression test: `ctx.fs` is the
    // sandboxed filesystem and fences every mutation by the calling session's
    // policy, so a workspace-write session refuses a write under
    // `$DSH_HOME/state` with FS_SANDBOX_DENIED. The plugin must therefore not
    // route deployment-owned state through it — the state below lands on disk
    // while a `ctx.fs` that throws on any use sits right there in the context.
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    let touched = false
    const deny = (): never => {
      touched = true
      throw new Error('FS_SANDBOX_DENIED: file access denied under workspace-write mode')
    }
    ctx.provide('fs', { writeText: deny, readText: deny, resolve: deny, stat: deny } as never)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()

    const service = ctx.get('reader') as ReaderService
    const outcome = await service.addSource({ url: 'https://example.com/feed.xml' })
    // No web seam here, so nothing can be read — but the LINK still lands, with
    // the reason recorded. That is the change this suite exists to hold: a URL
    // the reader pasted is theirs even when this deployment cannot fetch it.
    expect(outcome).toMatchObject({ outcome: 'saved-link', kind: 'link', failure: { code: 'unreachable' } })
    expect(touched).toBe(false)
    expect(ctx.get('fs')).toBeDefined()
  })

  it('boots in a composition with no web, sideChat or quote', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    expect((await service.capabilities()).hasSideChat).toBe(false)
    // No web seam: adding must not throw a boot failure and must not lose the
    // URL — it comes back as a saved link whose reason is classified.
    expect(await service.addSource({ url: 'https://example.com/feed.xml' }))
      .toMatchObject({ outcome: 'saved-link', kind: 'link', failure: { code: 'unreachable' } })
    expect((await service.listSources()).sources).toHaveLength(1)
  })

  it('round-trips a source through the state file on disk', async () => {
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('web', {
      fetch: async () => ({
        url: 'https://example.com/feed.xml',
        statusCode: 200,
        body: {
          kind: 'text' as const,
          content: `<rss version="2.0"><channel><title>hn</title><item><title>一条</title></item></channel></rss>`,
        },
        truncated: false,
      }),
    } as never)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/feed.xml' })).toMatchObject({ outcome: 'subscribed' })

    // A SECOND host on the same root sees the subscription: this is the
    // difference between durable state and a session variable.
    const second = new Context()
    contexts.push(second)
    apply(second, { stateRoot: root })
    await second.fiber.await()
    const listed = await (second.get('reader') as ReaderService).listSources()
    expect(listed.sources).toHaveLength(1)
    expect(listed.sources[0]?.kind).toBe('rss')
  })
})

describe('a failed fetch keeps the seam’s reason', () => {
  it('answers with the message the seam threw, not a bare verdict', async () => {
    const ctx = await bootWithWeb(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9')
    })
    const service = ctx.get('reader') as ReaderService
    const refusal = await service.addSource({ url: 'https://example.com/feed.xml' })
    // The acceptance instance is where this mattered: the same class of
    // transient failure showed as "failed" with nothing to diagnose. The
    // message is kept verbatim AND classified, because the code picks the
    // sentence while the message is what makes it diagnosable.
    expect(refusal).toMatchObject({
      outcome: 'saved-link',
      kind: 'link',
      failure: { code: 'unreachable', message: 'connect ECONNREFUSED 127.0.0.1:9' },
    })
    expect((await service.listSources()).sources).toHaveLength(1)
  })

  it('keeps a 404 as a link and records the HTTP error', async () => {
    // A 404 is not a transport failure: the request completed and there is no
    // source at that address. It is still the reader's URL, so it is saved —
    // with a code that says "the site answered an error", which is a different
    // sentence from "could not connect".
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/missing.xml',
      statusCode: 404,
      body: { kind: 'html' as const, content: '<!doctype html><title>not found</title>' },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/missing.xml' }))
      .toMatchObject({ outcome: 'saved-link', kind: 'link', failure: { code: 'http' } })
    expect((await service.listSources()).sources[0]?.hasBody).toBe(false)
  })

  it('saves an ordinary web page as a single link, not a subscription', async () => {
    // D15 by content: what comes back decides. An HTML page is the "saved
    // article" path, which is the whole second half of this package's scope.
    // The body is long enough to be a page: a near-empty payload is classified
    // as an interstitial instead of being stored as an article.
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/story',
      statusCode: 200,
      body: { kind: 'html' as const, content: `<article><p>${'正文。'.repeat(200)}</p></article>` },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/story' })).toMatchObject({
      outcome: 'saved-link',
      kind: 'link',
    })
    expect((await service.listSources()).sources[0]?.hasBody).toBe(true)
  })

  it('subscribes to a feed through the seam', async () => {
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/feed.xml',
      statusCode: 200,
      body: {
        kind: 'text' as const,
        content: '<rss version="2.0"><channel><title>hn</title><item><title>一条</title></item></channel></rss>',
      },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    const outcome = await service.addSource({ url: 'https://example.com/feed.xml' })
    expect(outcome).toMatchObject({ outcome: 'subscribed', kind: 'rss' })
    expect((await service.listSources()).sources).toHaveLength(1)
  })
})

describe('a link that cannot be previewed is still a link', () => {
  it('stores neither the challenge page nor a backfill debt', async () => {
    // The measured case: an OpenReview PDF link answered `302 /challenge?…`
    // with a 200 anti-bot page. The card must not BE that page, the detail view
    // must explain itself, and the automatic backfill must not keep asking a
    // wall it will never get past.
    const requested = 'https://openreview.net/pdf?id=1lyagkzogH'
    const ctx = await bootWithWeb(async () => ({
      url: 'https://openreview.net/challenge?redirect=%2Fpdf%3Fid%3D1lyagkzogH',
      statusCode: 200,
      body: {
        kind: 'html' as const,
        content: '<!doctype html><html><title>Just a moment…</title><body>Checking your browser before accessing</body></html>',
      },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: requested })).toMatchObject({
      outcome: 'saved-link',
      kind: 'link',
      failure: { code: 'blocked' },
    })

    const source = (await service.listSources()).sources[0]
    expect(source).toMatchObject({ kind: 'link', hasBody: false, failure: { code: 'blocked' } })
    const id = source?.id as string
    // No payload was stored: the challenge page never becomes a body.
    const bodies = await service.getBodies({ ids: [id] })
    expect(bodies.bodies[0]?.raw).toBeUndefined()
    expect(bodies.bodies[0]?.error).toBeDefined()

    // The detail view's one call answers with the reason, not a blank article.
    const entry = await service.getEntryBody({ entryId: linkEntryId(id), url: requested })
    expect(entry.html).toBeUndefined()
    expect(entry.error).toBeDefined()

    // The retry policy keys off the SOURCE, not just the annotation: the saved
    // link's entry carries the source's own (post-redirect) URL, and even an
    // entry id the annotation table does not know is refused. A feed entry at
    // the same URL is a different question and stays eligible — matched by the
    // `kind` guard.
    const savedUrl = source?.url as string
    const candidates = await service.listBackfillCandidates({
      entries: [
        { entryId: linkEntryId(id), url: savedUrl, label: 'x', hasBody: false },
        { entryId: `l:${savedUrl}`, url: savedUrl, label: 'x', hasBody: false },
      ],
    })
    expect(candidates.candidates).toHaveLength(0)
  })

  it('clears the recorded failure when a manual refresh finally works', async () => {
    // The reader's way out: the site may stop refusing us, or they may fix the
    // address. Saving the link is only useful if that path exists.
    let attempts = 0
    const ctx = await bootWithWeb(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:9')
      return {
        url: 'https://example.com/story',
        statusCode: 200,
        body: { kind: 'html' as const, content: `<article><p>${'正文。'.repeat(200)}</p></article>` },
        truncated: false,
      }
    })
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/story' }))
      .toMatchObject({ failure: { code: 'unreachable' } })
    const id = (await service.listSources()).sources[0]?.id as string

    await service.refresh({ ids: [id] })

    const after = (await service.listSources()).sources[0]
    expect(after?.failure).toBeUndefined()
    expect(after?.status).toBe('ok')
    expect(after?.hasBody).toBe(true)
  })
})

describe('a body too large to inline', () => {
  it('is written to its own file, served on the next read, and swept when evicted', async () => {
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()
    const service = ctx.get('reader') as ReaderService

    // 300 KB of markup: over the inline threshold, so the document keeps the
    // file name and its size instead of the text.
    const html = `<p>${'x'.repeat(300 * 1024)}</p>`
    const stored = await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/big', html })
    expect(stored.html).toBe(html)

    const onDisk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))
    const body = onDisk.annotations.e1.body
    expect(body.html).toBeUndefined()
    expect(typeof body.file).toBe('string')
    expect(body.chars).toBe(html.length)
    expect(readFileSync(join(root, 'bodies', body.file), 'utf8')).toBe(html)

    // The cache serves it without re-fetching, exactly like an inline body.
    const again = await service.getEntryBody({ entryId: 'e1', url: 'https://example.com/big' })
    expect(again.cached).toBe(true)
    expect(again.html).toBe(html)

    // Evicting the body takes its file with it.
    await service.setCachePolicy({ ttlHours: 24, maxEntries: 1 })
    await service.storeEntryBody({ entryId: 'e2', url: 'https://example.com/two', html })
    await service.storeEntryBody({ entryId: 'e3', url: 'https://example.com/three', html })
    // `maxEntries: 1` keeps the newest body only, and the sweep takes the files
    // of everything the document let go.
    const files = readdirSync(join(root, 'bodies'))
    expect(files).toHaveLength(1)
    expect(files).not.toContain(body.file)
  })

  it('still inlines a body under the threshold', async () => {
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()
    const service = ctx.get('reader') as ReaderService
    const html = '<p>small enough</p>'
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/small', html })
    const onDisk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))
    expect(onDisk.annotations.e1.body.html).toBe(html)
    expect(onDisk.annotations.e1.body.file).toBeUndefined()
  })
})

describe('a fetch the browser can walk away from', () => {
  it('stores the payload before answering, and extraction consumes it', async () => {
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('web', {
      fetch: async () => ({
        url: 'https://example.com/paper',
        statusCode: 200,
        body: { kind: 'html' as const, content: `<article><p>${'prose '.repeat(60)}</p></article>` },
        truncated: false,
      }),
    } as never)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()
    const service = ctx.get('reader') as ReaderService

    const fetched = await service.fetchEntryBody({ entryId: 'e1', url: 'https://example.com/paper' })
    expect(fetched.raw).toContain('prose')
    expect(typeof fetched.rawFile).toBe('string')

    // The payload survives the caller: a wall reopened later sees `raw` and can
    // extract it without going back to the network.
    expect(await service.entryFetchStates({ entryIds: ['e1'] })).toEqual({ states: { e1: { state: 'raw', at: expect.any(String) } } })
    const stored = await service.getRawBody({ entryId: 'e1' })
    expect(stored.raw).toBe(fetched.raw)
    expect(stored.url).toBe('https://example.com/paper')
    expect(readdirSync(join(root, 'bodies'))).toHaveLength(1)

    // Storing the extraction consumes it: the state flips to ready and the raw
    // file is swept.
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/paper', html: '<p>body</p>' })
    expect((await service.entryFetchStates({ entryIds: ['e1'] })).states.e1?.state).toBe('ready')
    expect(await service.getRawBody({ entryId: 'e1' })).toMatchObject({ error: 'no stored payload' })
    expect(readdirSync(join(root, 'bodies'))).toHaveLength(0)
  })

  it('reports a failure with its classified reason', async () => {
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/x',
      statusCode: 403,
      body: { kind: 'html' as const, content: 'denied' },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    await service.fetchEntryBody({ entryId: 'e1', url: 'https://example.com/x' })
    const states = (await service.entryFetchStates({ entryIds: ['e1'] })).states
    expect(states.e1?.state).toBe('failed')
    expect(states.e1?.state === 'failed' ? states.e1.code : undefined).toBe('blocked')
  })
})

describe('the recent list is the reader’s, and it outlives the process', () => {
  it('puts the newest open first and moves a reopened entry back to the top', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    await service.recordRead({ entryId: 'e1', sourceId: 's1', title: '第一篇', url: 'https://example.com/1' })
    await service.recordRead({ entryId: 'e2', sourceId: 's1', title: '第二篇', url: 'https://example.com/2' })
    expect((await service.listRecent()).entries.map(entry => entry.entryId)).toEqual(['e2', 'e1'])
    // Reopening is not a second row: it is the same entry, read again now.
    await service.recordRead({ entryId: 'e1', sourceId: 's1', title: '第一篇（改过标题）', url: 'https://example.com/1' })
    const entries = (await service.listRecent()).entries
    expect(entries.map(entry => entry.entryId)).toEqual(['e1', 'e2'])
    expect(entries[0]?.title).toBe('第一篇（改过标题）')
    expect(entries[0]?.readAt >= entries[1]!.readAt).toBe(true)
  })

  it('refuses a record it could never reopen', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    expect(await service.recordRead({ entryId: '  ', sourceId: 's1', title: 'x' })).toEqual({ entries: 0 })
    expect(await service.recordRead({ entryId: 'e1', sourceId: '', title: 'x' })).toEqual({ entries: 0 })
    expect((await service.listRecent()).entries).toHaveLength(0)
  })

  it('caps the list, dropping the oldest read', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    for (let index = 0; index < MAX_RECENT_ENTRIES + 5; index += 1) {
      await service.recordRead({ entryId: `e${String(index)}`, sourceId: 's1', title: `第 ${String(index)} 篇` })
    }
    const entries = (await service.listRecent()).entries
    expect(entries).toHaveLength(MAX_RECENT_ENTRIES)
    expect(entries[0]?.entryId).toBe(`e${String(MAX_RECENT_ENTRIES + 4)}`)
    expect(entries.some(entry => entry.entryId === 'e0')).toBe(false)
  })

  it('survives a restart, and clearing it is durable too', async () => {
    const root = stateRoot()
    const first = new Context()
    contexts.push(first)
    apply(first, { stateRoot: root })
    await first.fiber.await()
    await (first.get('reader') as ReaderService).recordRead({
      entryId: 'e1',
      sourceId: 's1',
      title: '读过的一篇',
      url: 'https://example.com/1',
    })

    // A second host on the same root: "what was I reading" is a fact that has to
    // outlive the process, unlike the pane's session memory.
    const second = new Context()
    contexts.push(second)
    apply(second, { stateRoot: root })
    await second.fiber.await()
    const service = second.get('reader') as ReaderService
    expect((await service.listRecent()).entries.map(entry => entry.entryId)).toEqual(['e1'])
    expect(await service.clearRecent()).toEqual({ removed: 1 })
    expect((await service.listRecent()).entries).toHaveLength(0)

    const third = new Context()
    contexts.push(third)
    apply(third, { stateRoot: root })
    await third.fiber.await()
    expect((await (third.get('reader') as ReaderService).listRecent()).entries).toHaveLength(0)
  })
})


describe('the translation store', () => {
  /** Boot the host half with the state root in hand (for reading the files). */
  async function bootWithRoot(): Promise<{ ctx: Context; root: string }> {
    const root = stateRoot()
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { stateRoot: root })
    await ctx.fiber.await()
    return { ctx, root }
  }

  const learn = (hash: string, source: string, target: string): { hash: string; source: string; target: string } =>
    ({ hash, source, target })

  it('persists the global memory keyed by language pair, across a restart', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    // The same sentence hash under two pairs: the pair is part of the key, so
    // two languages' reading of one string never share a translation.
    await service.rememberSentences({ pair: 'en→zh', entries: [learn('h1', 'Same text.', '同一句话。')] })
    await service.rememberSentences({ pair: 'de→zh', entries: [learn('h1', 'Same text.', '同一句话（德语）。')] })
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h1', 'missing'] })).translations)
      .toEqual({ h1: '同一句话。' })
    expect((await service.getSentenceTranslations({ pair: 'de→zh', hashes: ['h1'] })).translations)
      .toEqual({ h1: '同一句话（德语）。' })

    // A second host over the same root: the memory survived the process.
    const second = new Context()
    contexts.push(second)
    apply(second, { stateRoot: root })
    await second.fiber.await()
    const again = await (second.get('reader') as ReaderService).getSentenceTranslations({ pair: 'en→zh', hashes: ['h1'] })
    expect(again.translations).toEqual({ h1: '同一句话。' })
    // The table lives in its own named file, not inline in the document.
    const onDisk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { translationMemory?: { file: string } }
    expect(onDisk.translationMemory?.file).toBe('translation-memory.json')
  })

  it('stores an entry translation as a segment map keyed to the body hash', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    const entries = Array.from({ length: 10 }, (_, index) =>
      learn(`h${String(index)}`, `Sentence ${String(index)} of the paper.`, `论文的第 ${String(index)} 句。`))
    const written = await service.rememberSentences({ pair: 'en→zh', entries, entryId: 'e1', bodyHash: 'body-a' })
    expect(written).toEqual({ stored: 10 })

    const answer = await service.getEntryTranslation({ entryId: 'e1' })
    expect(answer.translation?.pair).toBe('en→zh')
    expect(answer.translation?.bodyHash).toBe('body-a')
    expect(Object.keys(answer.translation?.segments ?? {})).toHaveLength(10)
    expect(answer.translation?.segments.h3).toBe('论文的第 3 句。')
    // A small map stays inline in the document.
    const onDisk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { annotations: Record<string, { translation?: { file?: string } }> }
    expect(onDisk.annotations.e1?.translation?.file).toBeUndefined()
  })

  it('sidecars a large segment map, serves it, and sweeps the file on eviction', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    // 2 000 sentences with long translations: the segments JSON crosses the
    // inline threshold, so the document keeps a file name and its size instead.
    const entries = Array.from({ length: 2000 }, (_, index) =>
      learn(`h${String(index)}`, `Sentence number ${String(index)} of a long paper.`, `长文的第 ${String(index)} 句，${'译文'.repeat(60)}`))
    await service.rememberSentences({ pair: 'en→zh', entries, entryId: 'big', bodyHash: 'body-big' })
    const onDisk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as {
      annotations: Record<string, { translation?: { file?: string; chars?: number; segments?: unknown } }>
    }
    const record = onDisk.annotations.big?.translation
    expect(record?.segments).toBeUndefined()
    expect(typeof record?.file).toBe('string')
    const file = record?.file as string
    const served = await service.getEntryTranslation({ entryId: 'big' })
    expect(Object.keys(served.translation?.segments ?? {})).toHaveLength(2000)

    // Evict it via the budget: the file goes with the record.
    await service.setCachePolicy({ ttlHours: 24, translationBudgetChars: 10_000 })
    await service.rememberSentences({ pair: 'en→zh', entries: [learn('hx', 'One more.', '再来一句。')] })
    expect(await service.getEntryTranslation({ entryId: 'big' })).toEqual({})
    expect(readdirSync(join(root, 'bodies'))).not.toContain(file)
  })

  it('evicts the least-recently-used across both tiers when the budget is exceeded', async () => {
    const { ctx } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    // Wave 1: five global sentences, 100+100 characters each.
    const wave1 = Array.from({ length: 5 }, (_, index) => learn(`w1h${String(index)}`, 'a'.repeat(100), '早'.repeat(100)))
    await service.rememberSentences({ pair: 'en→zh', entries: wave1 })
    // A beat later (the LRU clock is the write's own timestamp), wave 2: an
    // entry map, whose sentences also join the memory at the NEWER clock.
    await new Promise(resolve => { setTimeout(resolve, 5) })
    const wave2 = Array.from({ length: 5 }, (_, index) => learn(`w2h${String(index)}`, 'c'.repeat(100), '新'.repeat(100)))
    await service.setCachePolicy({ ttlHours: 24, translationBudgetChars: 1900 })
    await service.rememberSentences({ pair: 'en→zh', entries: wave2, entryId: 'e1', bodyHash: 'body-a' })
    // Over budget, the older wave's memory sentences went — and the newer entry
    // map, a different tier entirely, stayed whole.
    for (const item of wave1) {
      expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: [item.hash] })).translations).toEqual({})
    }
    const served = await service.getEntryTranslation({ entryId: 'e1' })
    expect(Object.keys(served.translation?.segments ?? {})).toHaveLength(5)
    for (const item of wave2) {
      expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: [item.hash] })).translations[item.hash]).toBe('新'.repeat(100))
    }
  })

  it('reads a stale-schema record as a miss and never wipes it eagerly', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'A sentence from an older schema.', '旧 schema 的一句。')],
      entryId: 'e1',
      bodyHash: 'body-a',
    })

    // Doctor both tiers to an older schema version, as a hand edit would leave them.
    const stateFile = join(root, 'state.json')
    const doc = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      annotations: Record<string, { translation: { version: number } }>
      translationMemory: { version: number }
    }
    doc.annotations.e1!.translation.version = 0
    doc.translationMemory.version = 0
    writeFileSync(stateFile, JSON.stringify(doc))
    const memoryFile = join(root, 'bodies', 'translation-memory.json')
    const table = JSON.parse(readFileSync(memoryFile, 'utf8')) as { version: number }
    table.version = 0
    writeFileSync(memoryFile, JSON.stringify(table))

    // Both read as a miss…
    expect(await service.getEntryTranslation({ entryId: 'e1' })).toEqual({})
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h1'] })).translations).toEqual({})
    // …and both are still on disk — lazy eviction means the NEXT WRITE replaces
    // them, not the read that noticed.
    expect(JSON.parse(readFileSync(stateFile, 'utf8')) as typeof doc).toMatchObject({
      annotations: { e1: { translation: { version: 0 } } },
    })
    expect(readFileSync(memoryFile, 'utf8')).toContain('"version":0')

    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h2', 'A sentence from the current schema.', '当前 schema 的一句。')],
      entryId: 'e1',
      bodyHash: 'body-b',
    })
    expect((await service.getEntryTranslation({ entryId: 'e1' })).translation?.bodyHash).toBe('body-b')
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h2'] })).translations.h2)
      .toBe('当前 schema 的一句。')
  })

  it('bumps the use clock on recalled sentences instead of rewriting them', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.rememberSentences({ pair: 'en→zh', entries: [learn('h1', 'First written.', '先写下的。')] })
    const before = (JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { translationMemory: { updatedAt: string } })
      .translationMemory.updatedAt
    await new Promise(resolve => { setTimeout(resolve, 5) })
    // A recall report: no new sentences, just "this one served again".
    const result = await service.rememberSentences({
      pair: 'en→zh',
      entries: [],
      recalled: [learn('h1', 'First written.', '先写下的。')],
    })
    expect(result).toEqual({ stored: 0 })
    const after = (JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { translationMemory: { updatedAt: string } })
      .translationMemory.updatedAt
    expect(after > before).toBe(true)
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h1'] })).translations.h1).toBe('先写下的。')
  })

  /* --------------------------- the linkage rule: the map dies with the body */

  it('a body evicted by the budget takes its translation map — the global memory is untouched', async () => {
    const { ctx } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>' })
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'Sentence of entry one.', '条目一的一句。')],
      entryId: 'e1',
      bodyHash: 'body-1',
    })
    await service.setCachePolicy({ ttlHours: 24, maxEntries: 1 })
    // The budget keeps the newest body only: e1's goes, and its map goes with it.
    await service.storeEntryBody({ entryId: 'e2', url: 'https://example.com/2', html: '<p>two</p>' })
    expect(await service.getEntryTranslation({ entryId: 'e1' })).toEqual({})
    // …while the sentence h1 still serves from the global tier.
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h1'] })).translations.h1)
      .toBe('条目一的一句。')
  })

  it('drops the map when a refetch replaces the body, keeps it when the body is unchanged', async () => {
    const { ctx } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>', bodyHash: 'body-1' })
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'Sentence of entry one.', '条目一的一句。')],
      entryId: 'e1',
      bodyHash: 'body-1',
    })
    // A re-store of the SAME body (a re-extraction of the same payload): the
    // map is still exact, and survives.
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>', bodyHash: 'body-1' })
    expect((await service.getEntryTranslation({ entryId: 'e1' })).translation?.bodyHash).toBe('body-1')
    // A refetch that brings a DIFFERENT body: the old map answers nothing now.
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one, edited</p>', bodyHash: 'body-2' })
    expect(await service.getEntryTranslation({ entryId: 'e1' })).toEqual({})
  })

  it('keeps the map while an expired body is still on disk — expiry is a serving decision, not a removal', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>', bodyHash: 'body-1' })
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'Sentence of entry one.', '条目一的一句。')],
      entryId: 'e1',
      bodyHash: 'body-1',
    })
    // Doctor the deadline into the past: the body now serves as stale (no html)
    // but is NOT removed — and the linkage rule is about removal.
    const stateFile = join(root, 'state.json')
    const doc = JSON.parse(readFileSync(stateFile, 'utf8')) as { annotations: Record<string, { body: { expiresAt: string } }> }
    doc.annotations.e1!.body.expiresAt = '2020-01-01T00:00:00.000Z'
    writeFileSync(stateFile, JSON.stringify(doc))
    const view = await service.getEntryBody({ entryId: 'e1', url: 'https://example.com/1' })
    expect(view.cached).toBe(true)
    expect(view.fresh).toBe(false)
    expect(view.html).toBeUndefined()
    expect((await service.getEntryTranslation({ entryId: 'e1' })).translation?.bodyHash).toBe('body-1')
  })

  it('removing a source drops its entries’ translations — and nothing else', async () => {
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/story',
      statusCode: 200,
      body: { kind: 'html' as const, content: `<article><p>${'正文。'.repeat(200)}</p></article>` },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    await service.addSource({ url: 'https://example.com/story' })
    const sourceId = (await service.listSources()).sources[0]?.id as string
    const entryId = linkEntryId(sourceId)
    await service.storeEntryBody({ entryId, url: 'https://example.com/story', html: '<p>the story</p>', bodyHash: 'b1' })
    await service.rememberSentences({ pair: 'en→zh', entries: [learn('h1', 'A sentence.', '一句。')], entryId, bodyHash: 'b1' })
    // An unrelated entry's translation, to prove the sweep is scoped.
    await service.rememberSentences({ pair: 'en→zh', entries: [learn('h2', 'Another sentence.', '另一句。')], entryId: 'e-other', bodyHash: 'b2' })

    expect(await service.removeSource({ id: sourceId })).toBe('ok')
    expect(await service.getEntryTranslation({ entryId })).toEqual({})
    expect((await service.getEntryTranslation({ entryId: 'e-other' })).translation?.bodyHash).toBe('b2')
    // The deleted link's BODY stays (the body budget owns its lifetime) — only
    // the derived tier is linked.
    expect((await service.getEntryBody({ entryId, url: 'https://example.com/story' })).cached).toBe(true)
  })

  /* ------------------------------------------------- the storage surface */

  it('aggregates per-tier usage without shipping the tables', async () => {
    const { ctx } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>' })
    await service.storeEntryBody({ entryId: 'e2', url: 'https://example.com/2', html: '<p>two</p><p>two</p>' })
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'First.', '一。'), learn('h2', 'Second.', '二。')],
      entryId: 'e1',
      bodyHash: 'body-1',
    })
    const stats = await service.getStorageStats()
    expect(stats.bodies.entries).toBe(2)
    expect(stats.bodies.chars).toBe('<p>one</p>'.length + '<p>two</p><p>two</p>'.length)
    expect(stats.translations.entries).toBe(1)
    expect(stats.translations.memoryEntries).toBe(2)
    expect(stats.translations.memoryChars).toBeGreaterThan(0)
    expect(stats.translations.chars).toBeGreaterThan(0)
  })

  it('clears both translation tiers and nothing else', async () => {
    const { ctx, root } = await bootWithRoot()
    const service = ctx.get('reader') as ReaderService
    await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/1', html: '<p>one</p>', bodyHash: 'body-1' })
    await service.rememberSentences({
      pair: 'en→zh',
      entries: [learn('h1', 'A sentence.', '一句。')],
      entryId: 'e1',
      bodyHash: 'body-1',
    })
    await service.createTag({ name: 'AI' })
    await service.recordRead({ entryId: 'e1', sourceId: 's1', title: '读过的一篇' })

    const cleared = await service.clearTranslations()
    expect(cleared).toEqual({ clearedEntries: 1, clearedMemory: true })
    expect(await service.getEntryTranslation({ entryId: 'e1' })).toEqual({})
    expect((await service.getSentenceTranslations({ pair: 'en→zh', hashes: ['h1'] })).translations).toEqual({})
    // The file goes with the document's reference to it.
    expect(readdirSync(join(root, 'bodies'))).not.toContain('translation-memory.json')
    // Everything else stays: the body, the tag, the recent row, the source list.
    expect((await service.getEntryBody({ entryId: 'e1', url: 'https://example.com/1' })).html).toBe('<p>one</p>')
    expect((await service.listTags()).tags.map(tag => tag.name)).toEqual(['AI'])
    expect((await service.listRecent()).entries).toHaveLength(1)
    // A second clear is a no-op, honestly reported.
    expect(await service.clearTranslations()).toEqual({ clearedEntries: 0, clearedMemory: false })
  })
})
