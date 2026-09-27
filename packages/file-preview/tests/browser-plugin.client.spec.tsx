// @vitest-environment jsdom
/**
 * file-preview browser half on a real cordis Context with fake slots /
 * remote / sidebarRight faces and a recording tab-type registry: the plugin
 * mounts its Remote and registers the ONE surface form both host lines share
 * (plan B — embedding into the official document tab — landed and was vetoed
 * the same day, 2026-09-24):
 *
 * - the `file-preview` page type goes into `ctx.sidebarRightTabs` (guide entry
 *   PLUS `dsh-resource://file/**` renderable-suffix claims — extension band,
 *   outranking the official document tab's fallback band on both lines), its
 *   body into the keyed `sidebar.right.pane.tab` seat;
 * - the turn row registers into `conversation.chat.turnTail`: list-kind slots
 *   (0.1.6-alpha.2+) get a plain `id` entry PLUS a lower-priority empty body
 *   under the official deliverables entry's cell id (first-class list
 *   shadowing — the cell's lowest-priority entry renders, so the official
 *   present/changes cards stop while their registration, and the child slot
 *   it declares, stay live); a chain-declared slot (0.1.5) drives the old
 *   select + priority -1 preemption instead.
 *
 * Registration disposal rides the plugin fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { FilePreviewTabInjected, FilePreviewTurnRowInjected } from '../src/client/contract.ts'

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over fake faces; the filePreview Remote records calls. */
async function bench(opts: { host?: boolean; turnTailKind?: 'list' | 'chain'; officialTail?: boolean } = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const list = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'list', args })
    return { ok: true, value: { entries: [{ path: 'src/agent.ts', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: -1, truncated: false } }
  })
  const read = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'read', args })
    return { ok: true, value: { kind: 'text', path: 'docs/a.md', content: '# a', truncated: false } }
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
  let host: FilePreviewService | undefined
  if (opts.host !== false) {
    Object.assign(ctx, { fs: {} as FileSystem })
    host = new FilePreviewService(ctx, { captureBashWrites: false })
    ctx.provide('remote.filePreview', {
      capabilities: () => Promise.resolve({ ok: true, value: host!.capabilities() }),
      list, read, turnFiles, reveal, openExternal,
    })
  }
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
  const openResource = vi.fn()
  ctx.provide('sidebarRight', { openTab, openResource })
  await ctx.plugin(SlotRegistry).await()
  // Declare the target slots (normally declared by ui-sidebar-right /
  // ui-chat). turnTail is list-kind since 0.1.6-alpha.2; `turnTailKind:
  // 'chain'` reproduces the 0.1.5 declaration.
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'conversation.chat.turnTail': { kind: opts.turnTailKind ?? 'list', scope: 'session', owner: {} },
    },
  } as never, (() => null) as never)
  // An official-card stand-in, registered before the plugin applies: the
  // deliverables row's registration shape on the list-kind slot.
  if (opts.officialTail === true && (opts.turnTailKind ?? 'list') === 'list') {
    ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: '@deepseek-ai/dsh-client-ui-deliverables',
      inject: () => ({}),
    } as never, (() => null) as never)
  }
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, host, calls, list, read, turnFiles, reveal, openExternal, mount, registered, openTab, openResource }
}

/** The tab body entry's inject factory, called the way the outlet would. */
function tabApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')[0]
  const injected = (entry?.inject as unknown as ((sessionId: SessionId) => FilePreviewTabInjected) | undefined)?.(sid('s1'))
  return { entry, injected }
}

/** The turn card entry's inject factory, called the way the outlet would. */
function turnApi(b: Awaited<ReturnType<typeof bench>>) {
  // The list arm also registers the deliverables shadow (same slot, another
  // cell id), so pick the row by its identity rather than by position; the
  // chain arm's row carries a select instead of an id.
  const entry = b.ctx.slots.entries('conversation.chat.turnTail')
    .find(e => (e.options as { id?: string }).id === FILE_PREVIEW_ID || typeof (e as { select?: unknown }).select === 'function')
  const injected = (entry?.inject as unknown as (() => FilePreviewTurnRowInjected) | undefined)?.()
  return { entry, injected }
}

describe('file-preview browser plugin', () => {
  it('client only: a missing host handshake leaves every UI surface absent', async () => {
    const b = await bench({ host: false })
    expect(b.mount).toHaveBeenCalledTimes(1)
    expect(b.registered).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    await b.fiber.dispose()
  })

  it('host only: the real host service exposes a zero-session protocol handshake without UI', () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: {} as FileSystem })
    const host = new FilePreviewService(ctx, { captureBashWrites: false })
    expect(host.capabilities()).toEqual({ protocolVersion: 1 })
    expect(ctx.get('sidebarRightTabs')).toBeUndefined()
  })

  it('paired: the client probes the real host handler before installing the surfaces', async () => {
    const b = await bench()
    expect(b.host).toBeInstanceOf(FilePreviewService)
    // One form on both lines: the page type + its body + the turn row pair
    // (row + deliverables shadow on the list-kind slot).
    expect(b.registered.map(d => d.kind)).toEqual([FILE_PREVIEW_KIND])
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(2)
    await b.fiber.dispose()
  })

  it('registers the self-drawn tab type and its body, claiming the renderable file addresses', async () => {
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
    // canOpen is deterministic: renderable session-scoped files claim
    // immediately (no data dependency); session-less addresses and
    // unrenderable suffixes decline to the official document tab.
    expect(definition?.canOpen?.('dsh-resource://file/session/s1/src/agent.ts')).toBe(true)
    expect(definition?.canOpen?.('dsh-resource://file/session/s1/docs/report.pdf')).toBe(false)
    expect(definition?.canOpen?.('dsh-resource://file/session/s1/assets/logo.png')).toBe(true)
    expect(definition?.canOpen?.('dsh-resource://file/absolute/tmp/a.md')).toBe(false)
    // Stage two: the body under the type's id, with the store and the locale.
    const { entry } = tabApi(b)
    expect(entry?.options).toMatchObject({ key: FILE_PREVIEW_ID })
    expect(entry?.locale).toBe('filePreview')
    expect(entry?.store).toBeTruthy()
    await b.fiber.dispose()
  })

  it('registers the turn row as a plain list entry plus the deliverables shadow', async () => {
    const b = await bench()
    // The row: a plain entry under the package id — no select, no priority;
    // it self-hides without data.
    const { entry: turnEntry } = turnApi(b)
    expect(turnEntry).toBeTruthy()
    expect(turnEntry?.options).toMatchObject({ id: FILE_PREVIEW_ID })
    expect(turnEntry?.options.priority).toBeUndefined()
    expect(turnEntry?.select).toBeUndefined()
    expect(turnEntry?.locale).toBe('filePreview')
    // The shadow: same cell id as the official card, priority -1, empty body.
    const shadow = b.ctx.slots.entries('conversation.chat.turnTail')
      .find(e => (e.options as { id?: string }).id === '@deepseek-ai/dsh-client-ui-deliverables')
    expect(shadow).toBeTruthy()
    expect(shadow?.options.priority).toBe(-1)
    expect((shadow?.component as () => unknown)()).toBeNull()
    await b.fiber.dispose()
  })

  it('shadows the official deliverables card on the list-kind turnTail slot', async () => {
    const b = await bench({ officialTail: true })
    const entries = b.ctx.slots.entries('conversation.chat.turnTail')
    // All three registrations coexist on the ledger — the official entry is
    // never unregistered (its declared `deliverables.file.actions` child slot
    // must stay alive for ui-open-in-app's contributions).
    expect(entries.map(entry => (entry.options as { id?: string }).id).sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-deliverables',
      '@deepseek-ai/dsh-client-ui-deliverables',
      FILE_PREVIEW_ID,
    ].sort())
    // The cell's winner is the lowest-priority live entry: our empty shadow
    // (priority -1), never the official card (default 0) — the list outlet
    // renders entriesOfSlot's projection.
    const winners = b.ctx.slots.entriesOfSlot('conversation.chat.turnTail')
    const deliverablesWinner = winners.find(e => (e.options as { id?: string }).id === '@deepseek-ai/dsh-client-ui-deliverables')
    expect(deliverablesWinner?.options.priority).toBe(-1)
    // The winning body is the empty shadow.
    expect((deliverablesWinner?.component as () => unknown)()).toBeNull()
    // Our row keeps its own cell and stays renderable.
    expect(winners.some(e => (e.options as { id?: string }).id === FILE_PREVIEW_ID)).toBe(true)
    await b.fiber.dispose()
  })

  it('falls back to the preemptive chain registration on a 0.1.5 (chain-kind) host', async () => {
    const b = await bench({ turnTailKind: 'chain' })
    const { entry } = turnApi(b)
    expect(entry).toBeTruthy()
    // The 0.1.5 shape: the select claims every turn and priority -1 elects
    // ascending, ahead of the official deliverables entry's default 0.
    expect(entry?.options.priority).toBe(-1)
    expect(entry?.select).toBeTypeOf('function')
    expect(entry?.options.id).toBeUndefined()
    expect(entry?.locale).toBe('filePreview')
    // The chain arm has no shadowing concept — no deliverables shadow entry.
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(1)
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

  it('wraps chatFileMentions so mention opens route to the sidebar address', async () => {
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
      capabilities: vi.fn(async () => ({ ok: true, value: { protocolVersion: 1 } })),
      list: vi.fn(async () => ({ ok: true, value: { entries: [], asOfSeq: -1, truncated: false } })),
      read: vi.fn(), turnFiles: vi.fn(), reveal: vi.fn(), openExternal: vi.fn(),
    })
    ctx2.provide('sidebarRightTabs', { register: () => () => {} })
    const openResource = vi.fn()
    ctx2.provide('sidebarRight', { openResource })
    await ctx2.plugin(SlotRegistry).await()
    ctx2.slots.register({
      name: 'root',
      children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' }, 'conversation.chat.turnTail': { kind: 'list', scope: 'session', owner: {} } },
    } as never, (() => null) as never)
    const fiber = ctx2.plugin({ inject: [...inject], apply })
    await fiber.await()
    const openFile = vi.fn()
    const resolved = original.forClosing({ openFile } as never, 's1' as never)
    const hit = resolved!.resolve('a.md')
    // The official "在默认程序中打开" label is replaced by the sidebar wording.
    expect(hit?.label).not.toBe('打开 a.md')
    hit?.open()
    // The canonical file address — the same content id the deliverables
    // card's open resolves to, so one file is one tab.
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1//work/a.md')
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

  it('unregisters every surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
  })
})
