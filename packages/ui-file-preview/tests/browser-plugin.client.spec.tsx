// @vitest-environment jsdom
/**
 * ui-file-preview browser half on a real cordis Context with fake slots /
 * remote / sessions / locale / conversationEvents faces: the plugin mounts
 * its Remote, registers the file browser as the 'file-preview' entry in the
 * conversation view ring, a per-turn file row in the turnTail chain, and a
 * content-only drawer in the root overlay slot; the entries' inject factories
 * attach their stores to the controller, and the injected callbacks reach the
 * mounted filePreview Remote. Registration disposal rides the plugin fiber
 * (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { FilePreviewDrawerInjected, FilePreviewViewInjected } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over fake faces; the filePreview Remote records calls. */
async function bench(opts: { current?: SessionId | undefined; connectionSeat?: 'rc' | 'alpha' } = {}) {
  const current = 'current' in opts ? opts.current : sid('s1')
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const list = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'list', args })
    return { ok: true, value: { entries: [], asOfSeq: -1, truncated: false } }
  })
  const read = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'read', args })
    return { ok: true, value: { path: 'a.md', kind: 'text', content: 'x', truncated: false } }
  })
  const reveal = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'reveal', args })
    return { ok: true, value: { revealed: true } }
  })
  const turnFiles = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'turnFiles', args })
    return { ok: true, value: { asOfSeq: 0, turns: [] } }
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  // The plugin mounts its own contribution through $mount; fake it by
  // exposing the $mount entry and providing the filePreview namespace as a
  // real service (the apply reads it back from the global store via
  // `ctx.get('remote.filePreview')` after the mount settles).
  const mount = vi.fn(async () => () => {})
  Object.assign(ctx.remote, { $mount: mount })
  ctx.provide('remote.filePreview', { list, read, reveal, turnFiles })
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current, byId: current === undefined ? {} : { [current]: { cwd: '/work' } } }) },
  })
  const openPath = vi.fn(async () => {})
  ctx.provide('workspaces', { openPath })
  ctx.provide('connection', opts.connectionSeat === 'alpha'
    // 0.1.2 folded the host facts into the generation's opening frame
    // (Connection.hostDescription removed, upstream e14d354e83).
    ? {
      isLoopback: true,
      generation: { getSnapshot: () => ({ host: { home: '/h' } }), subscribe: () => () => {} },
    }
    : {
      isLoopback: true,
      hostDescription: { getSnapshot: () => ({ canOpenPath: true }), subscribe: () => () => {} },
    })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  // Declare the target slots (normally declared by ui-conversation / ui-layout).
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session', owner: {} },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, calls, list, read, reveal, turnFiles, mount, openPath }
}

/** The view entry's inject factory, called the way the outlet would. */
function viewApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('conversation.view')[0]
  const store = createFilePreviewStore().create()
  const injected = (entry?.inject as unknown as ((sessionId: SessionId, actions: never) => FilePreviewViewInjected) | undefined)?.(
    sid('s1'), store.actions as never)
  return { entry, store, injected }
}

/** The drawer entry's inject factory (root scope: actions only). */
function drawerApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('shell.overlay')[0]
  const store = createFilePreviewStore().create()
  const injected = (entry?.inject as unknown as ((actions: never) => FilePreviewDrawerInjected) | undefined)?.(
    store.actions as never)
  return { entry, store, injected }
}

describe('ui-file-preview browser plugin', () => {
  // Runs first: the document-level mention interceptor is per-bench, and an
  // undisposed earlier bench's listener would claim the click first.
  it('reroutes an official prose-mention click into the drawer', async () => {
    const b = await bench()
    const { store: drawerStore } = drawerApi(b)
    const code = document.createElement('code')
    const button = document.createElement('button')
    button.title = '/work/notes.md'
    button.textContent = 'notes.md'
    code.appendChild(button)
    document.body.appendChild(code)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(drawerStore.getSnapshot().open).toBe(true)
    expect(drawerStore.getSnapshot().selectedPath).toBe('/work/notes.md')
    await b.fiber.dispose()
    document.body.innerHTML = ''
  })

  it('mounts the Remote and registers the view tab, the turn row, and the drawer', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    const viewEntry = b.ctx.slots.entries('conversation.view')[0]
    expect(viewEntry?.options).toMatchObject({ id: 'file-preview', order: 20 })
    expect(viewEntry?.locale).toBe('filePreview')
    expect(viewEntry?.inject).toBeTypeOf('function')
    const label = viewEntry?.options.label
    if (typeof label === 'function') expect(label()).toBeTruthy()
    const turnEntry = b.ctx.slots.entries('conversation.chat.turnTail')[0]
    expect(turnEntry).toBeTruthy()
    expect(turnEntry?.options).toMatchObject({ priority: -1 })
    const drawerEntry = b.ctx.slots.entries('shell.overlay')[0]
    expect(drawerEntry?.options).toMatchObject({ id: 'file-preview-drawer', order: 110 })
    expect(drawerEntry?.inject).toBeTypeOf('function')
  })

  it('derives the host-facts hook from the connection generation on hosts without hostDescription (0.1.2)', async () => {
    const b = await bench({ connectionSeat: 'alpha' })
    const { injected } = viewApi(b)
    expect(injected?.hooks.hostDescription.getSnapshot()).toEqual({ home: '/h' })
    const drawer = drawerApi(b)
    expect(drawer.injected?.hooks.hostDescription.getSnapshot()).toEqual({ home: '/h' })
    await b.fiber.dispose()
  })

  it('routes view callbacks through the generated filePreview Remote', async () => {
    const b = await bench()
    const { injected } = viewApi(b)
    if (injected === undefined) throw new Error('view inject missing')
    const listResult = await injected.listFiles(sid('s1'))
    expect(listResult).toMatchObject({ ok: true, value: { entries: [] } })
    const readResult = await injected.readFile(sid('s1'), 'a.md')
    expect(readResult).toMatchObject({ ok: true, value: { kind: 'text' } })
    const { injected: drawerInjected } = drawerApi(b)
    if (drawerInjected === undefined) throw new Error('drawer inject missing')
    await drawerInjected.listFiles(sid('s1'))
    await drawerInjected.readFile(sid('s1'), 'a.md')
    expect(b.calls).toEqual([
      { method: 'list', args: ['s1'] },
      { method: 'read', args: ['s1', 'a.md'] },
      { method: 'list', args: ['s1'] },
      { method: 'read', args: ['s1', 'a.md'] },
    ])
  })

  it('routes a drawer gesture through the controller without a session handle', async () => {
    const b = await bench()
    const { store: drawerStore } = drawerApi(b)
    const turnEntry = b.ctx.slots.entries('conversation.chat.turnTail')[0]
    const turnInjected = (
      turnEntry?.inject as unknown as
      ((owner: never) => { openDrawer: (path: string) => void; turnFiles: (sessionId: SessionId, turn: number) => Promise<unknown> }) | undefined
    )?.({} as never)
    if (turnInjected === undefined) throw new Error('turn inject missing')
    turnInjected.openDrawer('notes.md')
    expect(drawerStore.getSnapshot().open).toBe(true)
    expect(drawerStore.getSnapshot().selectedPath).toBe('notes.md')
    // The turn card's host-fed loader reaches the turnFiles RPC (cached: the
    // second call for the same session+turn does not hit the wire again).
    await turnInjected.turnFiles(sid('s1'), 1)
    await turnInjected.turnFiles(sid('s1'), 1)
    expect(b.turnFiles).toHaveBeenCalledTimes(1)
    expect(b.turnFiles).toHaveBeenCalledWith('s1')
  })

  it('routes the drawer open gesture through workspaces.openPath and reveal through the Remote', async () => {
    const b = await bench()
    const { injected } = drawerApi(b)
    if (injected === undefined) throw new Error('drawer inject missing')
    injected.openExternal('docs/a.md')
    injected.revealFolder('/work/docs/a.md')
    injected.revealFolder('a.md')
    expect(b.openPath).toHaveBeenCalledWith('/work/docs/a.md')
    // Reveal selects through the Remote against the current session; a
    // successful reveal never falls back to the parent-folder open.
    expect(b.reveal).toHaveBeenCalledWith('s1', '/work/docs/a.md')
    expect(b.reveal).toHaveBeenCalledWith('s1', 'a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.openPath).not.toHaveBeenCalledWith('/work/docs')
    expect(b.openPath).not.toHaveBeenCalledWith('/work/.')
    // A host-side open failure stays silent (the native app owns the error dialog).
    b.openPath.mockRejectedValueOnce(new Error('denied'))
    injected.openExternal('/work/a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    await b.fiber.dispose()
  })

  it('falls back to opening the parent folder when reveal cannot select', async () => {
    const b = await bench()
    b.reveal.mockResolvedValue({ ok: false, error: { code: 'x', message: 'no select-capable file manager' } })
    const { injected } = drawerApi(b)
    if (injected === undefined) throw new Error('drawer inject missing')
    injected.revealFolder('/work/docs/a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.openPath).toHaveBeenCalledWith('/work/docs')
    injected.revealFolder('a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    // A rootless path reveals the session cwd itself (the official show-folder behavior).
    expect(b.openPath).toHaveBeenCalledWith('/work/.')
    await b.fiber.dispose()
  })

  it('reveals nothing without a current session (no session handle, no fallback)', async () => {
    const b = await bench({ current: undefined })
    const { injected } = drawerApi(b)
    if (injected === undefined) throw new Error('drawer inject missing')
    injected.revealFolder('/work/docs/a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.reveal).not.toHaveBeenCalled()
    expect(b.openPath).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('passes host-open paths through unresolved without a current session', async () => {
    const b = await bench({ current: undefined })
    const { injected } = drawerApi(b)
    if (injected === undefined) throw new Error('drawer inject missing')
    injected.openExternal('docs/a.md')
    expect(b.openPath).toHaveBeenCalledWith('docs/a.md')
    await b.fiber.dispose()
  })

  it('unregisters every surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('conversation.view')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
