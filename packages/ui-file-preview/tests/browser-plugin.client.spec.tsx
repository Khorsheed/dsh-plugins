// @vitest-environment jsdom
/**
 * ui-file-preview browser half on a real cordis Context with fake slots /
 * remote / sidebarRight faces and recording registries: the plugin mounts its
 * Remote, registers the `file-preview` page type into `ctx.sidebarRightTabs`,
 * the tab body into the keyed `sidebar.right.pane.tab` seat under the type's
 * id, the change-history renderer into `ctx.documentPreviews` (builtin band —
 * listed in the document tab's dropdown, never the default) plus the keyed
 * `sidebar.right.tab.document` seat, and the per-turn file row into the
 * turnTail chain at default priority (no more `priority: -1` preemption — the
 * official deliverables row elects first). Registration disposal rides the
 * plugin fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND } from '../src/client/definition.tsx'
import { FILE_HISTORY_ID } from '../src/client/history-definition.ts'
import { apply, inject } from '../src/client/index.ts'
import type { FilePreviewTabInjected, FilePreviewTurnRowInjected } from '../src/client/contract.ts'

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over fake faces; the filePreview Remote records calls. */
async function bench(opts: { documentPreviews?: boolean } = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const list = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'list', args })
    return { ok: true, value: { entries: [{ path: 'src/agent.ts', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: -1, truncated: false } }
  })
  const turnFiles = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'turnFiles', args })
    return { ok: true, value: { asOfSeq: 0, turns: [] } }
  })
  const reveal = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'reveal', args })
    return { ok: true, value: { revealed: true } }
  })
  const openExternal = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'openExternal', args })
    return { ok: true, value: { opened: true } }
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
  ctx.provide('remote.filePreview', { list, turnFiles, reveal, openExternal })
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: sid('s1'), byId: { s1: { cwd: '/work' } } }) },
  })
  // A fake tab-type registry recording registrations; the real registry's
  // ranking/coexistence rules are the host's own test coverage.
  const registered: SidebarRightTabDefinition[] = []
  ctx.provide('sidebarRightTabs', {
    register: (definition: SidebarRightTabDefinition) => {
      registered.push(definition)
      return () => { registered.splice(registered.indexOf(definition), 1) }
    },
  })
  const openTab = vi.fn()
  ctx.provide('sidebarRight', { openTab })
  // A fake document-renderer registry recording registrations; the real
  // registry's suffix ranking is the host's own test coverage.
  const previews: DocumentPreviewDefinition[] = []
  if (opts.documentPreviews !== false) {
    ctx.provide('documentPreviews', {
      register: (definition: DocumentPreviewDefinition) => {
        previews.push(definition)
        return () => { previews.splice(previews.indexOf(definition), 1) }
      },
    })
  }
  await ctx.plugin(SlotRegistry).await()
  // Declare the target slots (normally declared by ui-sidebar-right /
  // ui-sidebar-documentpreview / ui-chat).
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.tab.document': { kind: 'keyed', scope: 'session' },
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session', owner: {} },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, calls, list, turnFiles, reveal, openExternal, mount, registered, previews, openTab }
}

/** The tab body entry's inject factory, called the way the outlet would. */
function tabApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')[0]
  const injected = (entry?.inject as unknown as ((sessionId: SessionId) => FilePreviewTabInjected) | undefined)?.(sid('s1'))
  return { entry, injected }
}

/** The document renderer entry's inject factory, called the way the outlet would. */
function historyApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.tab.document')[0]
  const injected = (entry?.inject as unknown as (() => Pick<FilePreviewTabInjected, 'listFiles'>) | undefined)?.()
  return { entry, injected }
}

/** The turn card entry's inject factory, called the way the outlet would. */
function turnApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('conversation.chat.turnTail')[0]
  const injected = (entry?.inject as unknown as (() => FilePreviewTurnRowInjected) | undefined)?.()
  return { entry, injected }
}

describe('ui-file-preview browser plugin', () => {
  it('mounts the Remote and registers the tab type, the body, and the turn row', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    // Stage one: the type — page (guide entry) AND claimant of
    // `dsh-resource://file/**` for fold-recorded renderable products.
    const definition = b.registered.find(d => d.kind === FILE_PREVIEW_KIND)
    expect(definition?.id).toBe(FILE_PREVIEW_ID)
    expect(definition?.patterns).toEqual(['dsh-resource://file/**'])
    expect(definition?.title('sidebar://file-preview')).toBeTruthy()
    expect(definition?.title('dsh-resource://file/session/s1/docs/My%20Note.md')).toBe('My Note.md')
    expect(definition?.guide?.length).toBe(1)
    // canOpen: cold fold cache declines (the official document tab keeps the
    // open), and non-renderable suffixes never claim.
    expect(definition?.canOpen?.('dsh-resource://file/session/s1/src/agent.ts')).toBe(false)
    expect(definition?.canOpen?.('dsh-resource://file/absolute/tmp/a.md')).toBe(false)
    // Stage two: the body under the type's id, with the store and the locale.
    const { entry } = tabApi(b)
    expect(entry?.options).toMatchObject({ key: FILE_PREVIEW_ID })
    expect(entry?.locale).toBe('filePreview')
    expect(entry?.store).toBeTruthy()
    // The turn row: priority 1, explicitly AFTER the official deliverables
    // entry (default 0) — the official card wins every turn it claims; ours
    // renders only the turns official data misses.
    const { entry: turnEntry } = turnApi(b)
    expect(turnEntry).toBeTruthy()
    expect(turnEntry?.options.priority).toBe(1)
    expect(turnEntry?.locale).toBe('filePreview')
    // The change-history renderer: builtin band (never the default), cheapest
    // loading mode, body in the keyed document seat.
    const renderer = b.previews.find(d => d.id === FILE_HISTORY_ID)
    expect(renderer?.priority).toBe('builtin')
    expect(renderer?.loading).toBe('text-pages')
    expect(renderer?.title()).toBeTruthy()
    expect(renderer?.extensions).toContain('md')
    const { entry: historyEntry, injected: historyInjected } = historyApi(b)
    expect(historyEntry?.options).toMatchObject({ key: FILE_HISTORY_ID })
    expect(historyEntry?.locale).toBe('filePreview')
    expect(historyInjected?.listFiles).toBeTypeOf('function')
    await b.fiber.dispose()
  })

  it('claims addresses only after the fold cache warms, and never for unrenderable types', async () => {
    const b = await bench()
    const definition = b.registered.find(d => d.kind === FILE_PREVIEW_KIND)
    const address = 'dsh-resource://file/session/s1/src/agent.ts'
    expect(definition?.canOpen?.(address)).toBe(false)
    const { injected } = tabApi(b)
    if (injected === undefined) throw new Error('tab inject missing')
    await injected.listFiles(sid('s1'))
    expect(definition?.canOpen?.(address)).toBe(true)
    // The fold recorded it, but pdf stays with the official renderer.
    expect(definition?.canOpen?.('dsh-resource://file/session/s1/docs/report.pdf')).toBe(false)
    await b.fiber.dispose()
  })

  it('routes the tab body and turn card callbacks through the filePreview Remote', async () => {
    const b = await bench()
    const { injected } = tabApi(b)
    if (injected === undefined) throw new Error('tab inject missing')
    const listResult = await injected.listFiles(sid('s1'))
    expect(listResult).toMatchObject({ ok: true })
    const { injected: turnInjected } = turnApi(b)
    if (turnInjected === undefined) throw new Error('turn inject missing')
    // The turn card's host-fed loader reaches the turnFiles RPC (cached: the
    // second call for the same session+turn does not hit the wire again).
    await turnInjected.turnFiles(sid('s1'), 1)
    await turnInjected.turnFiles(sid('s1'), 1)
    expect(b.turnFiles).toHaveBeenCalledTimes(1)
    expect(b.turnFiles).toHaveBeenCalledWith('s1')
    expect(b.calls).toEqual([
      { method: 'list', args: ['s1'] },
      { method: 'turnFiles', args: ['s1'] },
    ])
    await b.fiber.dispose()
  })

  it('wraps chatFileMentions so mention opens route to our detail view', async () => {
    // Provided before the plugin applies (the nested fiber pends on the
    // service); the wrap keeps the claim logic and reroutes open + label.
    const nativeOpen = vi.fn()
    const ctx2 = new Context()
    const original = {
      forClosing: () => ({
        resolve: (value: string) =>
          value === 'a.md' ? { open: () => { nativeOpen(value) }, label: '打开 a.md', title: '/work/a.md' } : undefined,
      }),
    }
    ctx2.provide('chatFileMentions', original)
    ctx2.provide('locale', new LocaleRuntime(ctx2))
    ctx2.provide('sessions', { list: { getSnapshot: () => ({ current: undefined, byId: {} }) } })
    class RemoteService2 extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService2(ctx2)
    Object.assign(ctx2.remote, { $mount: vi.fn(async () => () => {}) })
    ctx2.provide('remote.filePreview', {
      list: vi.fn(async () => ({ ok: true, value: { entries: [], asOfSeq: -1, truncated: false } })),
      turnFiles: vi.fn(), reveal: vi.fn(), openExternal: vi.fn(),
    })
    ctx2.provide('sidebarRightTabs', { register: () => () => {} })
    const openTab = vi.fn()
    ctx2.provide('sidebarRight', { openTab })
    await ctx2.plugin(SlotRegistry).await()
    ctx2.slots.register({
      name: 'root',
      children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' }, 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session' }, 'conversation.chat.turnTail': { kind: 'chain', scope: 'session', owner: {} } },
    } as never, (() => null) as never)
    const fiber = ctx2.plugin({ inject: [...inject], apply })
    await fiber.await()
    const openFile = vi.fn()
    const resolved = original.forClosing({ openFile } as never, 's1' as never)
    const hit = resolved!.resolve('a.md')
    // The official "在默认程序中打开" label is replaced by the sidebar wording.
    expect(hit?.label).not.toBe('打开 a.md')
    hit?.open()
    expect(openTab).toHaveBeenCalledWith('file-preview', { params: { path: '/work/a.md' } })
    expect(openFile).not.toHaveBeenCalled()
    expect(nativeOpen).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('routes row gestures: reveal through the Remote, IDE through openExternal', async () => {
    const b = await bench()
    const { injected } = tabApi(b)
    if (injected === undefined) throw new Error('tab inject missing')
    injected.revealFolder('docs/a.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.reveal).toHaveBeenCalledWith('s1', 'docs/a.md')
    // IDE open requires a probed IDE id; the probe defaults to no answer in
    // this bench (no fetch), so kick it and stub the catalog.
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ apps: ['finder', 'cursor'] }))) as never
    try {
      injected.loadOpenInApps()
      await new Promise(resolve => setTimeout(resolve, 0))
      injected.openInIde('docs/a.md')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(b.openExternal).toHaveBeenCalledWith('s1', 'docs/a.md', 'cursor')
    } finally {
      globalThis.fetch = originalFetch
    }
    await b.fiber.dispose()
  })

  it('opens the file-preview page for an outside-workspace path, silently degrading without a surface', async () => {
    const b = await bench()
    const { injected } = turnApi(b)
    if (injected === undefined) throw new Error('turn inject missing')
    injected.openOutsideWorkspace(sid('s1'), '/tmp/artifact.html')
    expect(b.openTab).toHaveBeenCalledWith(FILE_PREVIEW_KIND, { params: { path: '/tmp/artifact.html' } })
    // A throw from the page service (no mounted surface) stays contained.
    b.openTab.mockImplementationOnce(() => { throw new Error('sidebarRight: no session surface is mounted') })
    expect(() => { injected.openOutsideWorkspace(sid('s1'), '/tmp/x') }).not.toThrow()
    await b.fiber.dispose()
  })

  it('skips the history renderer on a composition without documentPreviews', async () => {
    const b = await bench({ documentPreviews: false })
    expect(b.previews).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(0)
    // The rest of the plugin still registers.
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    await b.fiber.dispose()
  })

  it('unregisters every surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
    expect(b.previews.some(d => d.id === FILE_HISTORY_ID)).toBe(false)
  })
})
