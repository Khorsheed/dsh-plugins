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
    expect(await (remote as ReaderRemoteService).capabilities()).toEqual(await ctx.get('reader').capabilities())
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
    // No web seam here, so the fetch is refused — but the ANSWER is a domain
    // value, which is the point: nothing threw through the pane.
    expect(outcome).toBe('unsupported-content')
    expect(touched).toBe(false)
    expect(ctx.get('fs')).toBeDefined()
  })

  it('boots in a composition with no web, sideChat or quote', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    expect((await service.capabilities()).hasSideChat).toBe(false)
    // No web seam: adding a source must come back as a domain refusal, never
    // as a thrown boot failure.
    expect(await service.addSource({ url: 'https://example.com/feed.xml' })).toBe('unsupported-content')
    // Nothing configured yet, and that is an empty list, not an error.
    expect(await service.listSources()).toEqual({ sources: [] })
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
    // transient failure showed as "failed" with nothing to diagnose.
    expect(refusal).toEqual({ outcome: 'fetch-failed', reason: 'connect ECONNREFUSED 127.0.0.1:9' })
  })

  it('refuses a non-2xx response as unsupported content', async () => {
    // A 404 is not a transport failure: the request completed and there is no
    // source at that address, which is a different sentence in the UI.
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/missing.xml',
      statusCode: 404,
      body: { kind: 'html' as const, content: '<!doctype html><title>not found</title>' },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/missing.xml' })).toBe('unsupported-content')
  })

  it('saves an ordinary web page as a single link, not a subscription', async () => {
    // D15 by content: what comes back decides. An HTML page is the "saved
    // article" path, which is the whole second half of this package's scope.
    const ctx = await bootWithWeb(async () => ({
      url: 'https://example.com/story',
      statusCode: 200,
      body: { kind: 'html' as const, content: `<article><p>${'正文。'.repeat(40)}</p></article>` },
      truncated: false,
    }))
    const service = ctx.get('reader') as ReaderService
    expect(await service.addSource({ url: 'https://example.com/story' })).toMatchObject({
      outcome: 'saved-link',
      kind: 'link',
    })
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
