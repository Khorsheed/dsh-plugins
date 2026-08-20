// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the conversation.view entry, the injected face, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { DatasetsViewInjected } from '../src/client/contract.ts'

/** Stub Remote namespace: carried result envelopes like production. */
function remoteStub() {
  return {
    binding: vi.fn(async () => ({ ok: true as const, value: null })),
    bind: vi.fn(async (_sid: string, binding: unknown) => ({ ok: true as const, value: binding })),
    unbind: vi.fn(async () => ({ ok: true as const, value: null })),
    list: vi.fn(async () => ({ ok: true as const, value: { kind: 'datasets' as const, datasets: [] } })),
    show: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    read: vi.fn(async () => ({ ok: true as const, value: { content: 'x', commit: 'abc' } })),
  }
}

/** Real cordis composition with the slot registry, locale runtime, and stub remotes. */
async function bench(options: { mountFails?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remoteService = {
    $mount: options.mountFails === true
      ? vi.fn(async (): Promise<() => Promise<void>> => { throw new Error('already mounted') })
      : vi.fn(async (): Promise<() => Promise<void>> => async () => {}),
  }
  ctx.provide('remote', remoteService as never)
  const remote = remoteStub()
  ctx.provide('remote.datasets', remote as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The view ring as ui-conversation declares it in production.
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  return { ctx, slots, remote, remoteService }
}

describe('datasets client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale'])
  })

  it('mounts the Remote and registers the datasets view entry', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'datasets', order: 30 })
    expect(typeof entries[0]!.options.label).toBe('function')
  })

  it('still registers the view when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('the injected face binds every verb to the Remote namespace with the session id', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')

    await face.fetchBinding('s1')
    expect(remote.binding).toHaveBeenCalledWith('s1')

    const binding = { repoPath: '/repo', layers: ['visible'] }
    await face.bindSession('s1', binding)
    expect(remote.bind).toHaveBeenCalledWith('s1', binding)

    await face.unbindSession('s1')
    expect(remote.unbind).toHaveBeenCalledWith('s1')

    await face.listDatasets('s1')
    expect(remote.list).toHaveBeenCalledWith('s1', {})
    await face.listDatasets('s1', 'alpha')
    expect(remote.list).toHaveBeenCalledWith('s1', { dataset: 'alpha' })

    const query = { dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' }
    await face.readFile('s1', query)
    expect(remote.read).toHaveBeenCalledWith('s1', query)
  })

  it('collapses the view entry on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.view')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('conversation.view')).toHaveLength(0)
  })
})
