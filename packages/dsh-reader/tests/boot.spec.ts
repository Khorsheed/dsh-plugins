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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import { ReaderRemoteService } from '../src/remote.ts'
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

describe('an article too large to keep', () => {
  it('serves the body but does not put it in the state document', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    const html = `<p>${'x'.repeat(4 * 1024 * 1024 + 1)}</p>`
    const view = await service.storeEntryBody({ entryId: 'e1', url: 'https://example.com/big', html })
    expect(view.tooLarge).toBe(true)
    expect(view.html).toBe(html)
    // Nothing was committed: reopening the entry will fetch it again rather
    // than pay for a multi-megabyte JSON document on every reader operation.
    const again = await service.getEntryBody({ entryId: 'e1', url: 'https://example.com/big' })
    expect(again.cached).toBe(false)
    expect(again.html).toBeUndefined()
  })

  it('still caches a body under the budget', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    const html = '<p>small enough</p>'
    const view = await service.storeEntryBody({ entryId: 'e2', url: 'https://example.com/small', html })
    expect(view.cached).toBe(true)
    expect(view.tooLarge).toBeUndefined()
    const again = await service.getEntryBody({ entryId: 'e2', url: 'https://example.com/small' })
    expect(again.html).toBe(html)
  })
})
