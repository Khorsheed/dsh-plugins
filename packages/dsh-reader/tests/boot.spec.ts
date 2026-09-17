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

  it('boots in a composition with no fs, web, sideChat or quote', async () => {
    const ctx = await boot()
    const service = ctx.get('reader') as ReaderService
    // No filesystem: state is memory-only and the handshake must say so rather
    // than pretending persistence is available.
    expect((await service.capabilities()).hasFs).toBe(false)
    expect((await service.capabilities()).hasSideChat).toBe(false)
    // No web seam: adding a source must come back as a domain refusal, never
    // as a thrown boot failure.
    expect(await service.addSource({ url: 'https://example.com/feed.xml' })).toBe('unsupported-content')
    // With no fs there is nothing to list, and that is an empty list, not an error.
    expect(await service.listSources()).toEqual({ sources: [] })
  })
})
