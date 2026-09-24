// @vitest-environment jsdom
/**
 * ui-file-preview browser half on a real cordis Context with fake slots /
 * remote / sidebarRight faces and recording registries: the plugin mounts its
 * Remote and then registers the surfaces of the host line actually serving.
 *
 * - rc.1 line (`documentPreviews` provided): the content renderer (extension
 *   band — the official document tab's default body, renderer-owned loading)
 *   and the change-history renderer (builtin band — listed in the toolbar
 *   dropdown, never the default) go into `ctx.documentPreviews`, their bodies
 *   into the keyed `sidebar.right.tab.document` seat; the self-drawn content
 *   tab type is NOT registered — the `file-artifacts` list shell (page type +
 *   keyed pane body) is the line's session-products entry instead.
 * - 0.1.5 line (no `documentPreviews`): the `file-preview` page type goes
 *   into `ctx.sidebarRightTabs`, its body into the keyed
 *   `sidebar.right.pane.tab` seat, and no renderer registrations exist.
 * - Late arrival: a `documentPreviews` provided after apply retires the
 *   legacy tab and installs the renderers (deferred inject, never a version
 *   read).
 *
 * turnTail re-kinded chain → list at 0.1.6-alpha.2 on both lines: the default
 * bench declares the list — the row registers a plain `id` entry AND a
 * lower-priority empty body under the official deliverables entry's cell id
 * (list shadowing: the cell's lowest-priority entry renders, so the official
 * present/changes cards stop); a chain-declared bench drives the 0.1.5
 * fallback (select + priority -1 preemption). Registration disposal rides the
 * plugin fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND } from '../src/client/definition.tsx'
import { FILE_ARTIFACTS_ID, FILE_ARTIFACTS_KIND } from '../src/client/artifacts-definition.ts'
import { FILE_CONTENT_ID } from '../src/client/content-definition.ts'
import { FILE_HISTORY_ID } from '../src/client/history-definition.ts'
import { apply, inject } from '../src/client/index.ts'
import type { FileArtifactsInjected, FileContentBodyInjected, FilePreviewTabInjected, FilePreviewTurnRowInjected } from '../src/client/contract.ts'

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over fake faces; the filePreview Remote records calls. */
async function bench(opts: { documentPreviews?: boolean; host?: boolean; turnTailKind?: 'list' | 'chain'; officialTail?: boolean } = {}) {
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
  // A fake document-renderer registry recording registrations; the real
  // registry's suffix ranking is the host's own test coverage. Provided by
  // default (the rc.1 line); `documentPreviews: false` reproduces 0.1.5.
  const previews: DocumentPreviewDefinition[] = []
  const providePreviews = (): void => {
    ctx.provide('documentPreviews', {
      register: (definition: DocumentPreviewDefinition) => {
        previews.push(definition)
        return () => { previews.splice(previews.indexOf(definition), 1) }
      },
    })
  }
  if (opts.documentPreviews !== false) providePreviews()
  await ctx.plugin(SlotRegistry).await()
  // Declare the target slots (normally declared by ui-sidebar-right /
  // ui-sidebar-documentpreview / ui-chat). turnTail is list-kind since
  // 0.1.6-alpha.2; `turnTailKind: 'chain'` reproduces the 0.1.5 declaration.
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.tab.document': { kind: 'keyed', scope: 'session' },
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
  return { ctx, fiber, host, calls, list, read, turnFiles, reveal, openExternal, mount, registered, previews, openTab, openResource, providePreviews }
}

/** Flush pending nested-fiber activations (a late-provided documentPreviews wakes the rc.1 arm). */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/** The legacy tab body entry's inject factory, called the way the outlet would (0.1.5 line). */
function tabApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')[0]
  const injected = (entry?.inject as unknown as ((sessionId: SessionId) => FilePreviewTabInjected) | undefined)?.(sid('s1'))
  return { entry, injected }
}

/** One document renderer entry by its registration key, with its inject factory. */
function documentApi<K>(b: Awaited<ReturnType<typeof bench>>, key: string) {
  const entry = b.ctx.slots.entries('sidebar.right.tab.document').find(e => (e.options as { key?: string }).key === key)
  const injected = (entry?.inject as unknown as (() => K) | undefined)?.()
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

/** The artifacts shell body entry (rc.1 line), with its inject factory. */
function artifactsApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')
    .find(e => (e.options as { key?: string }).key === FILE_ARTIFACTS_ID)
  const injected = (entry?.inject as unknown as ((sessionId: SessionId) => FileArtifactsInjected) | undefined)?.(sid('s1'))
  return { entry, injected }
}

describe('ui-file-preview browser plugin', () => {
  it('client only: a missing host handshake leaves every UI surface absent', async () => {
    const b = await bench({ host: false })
    expect(b.mount).toHaveBeenCalledTimes(1)
    expect(b.registered).toHaveLength(0)
    expect(b.previews).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(0)
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

  it('paired: the client probes the real host handler before installing the rc.1 surfaces', async () => {
    const b = await bench()
    expect(b.host).toBeInstanceOf(FilePreviewService)
    // The artifacts page type + body and the turn row pair (row + deliverables
    // shadow) are the rc.1 arm's registrations; the legacy content tab stays off.
    expect(b.registered.map(d => d.kind)).toEqual([FILE_ARTIFACTS_KIND])
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(2)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(2)
    await b.fiber.dispose()
  })

  it('rc.1: registers the content and history renderers into the official document tab, never the legacy tab', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    // The self-drawn content tab type stays unregistered on this line; the
    // session-products entry returns as the file-artifacts list shell (a page
    // type with no address claims).
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
    const artifacts = b.registered.find(d => d.kind === FILE_ARTIFACTS_KIND)
    expect(artifacts?.id).toBe(FILE_ARTIFACTS_ID)
    expect(artifacts?.patterns).toBeUndefined()
    // The shell keeps the retired page's 「会话产物」 label on both the chip
    // and the guide capsule (the bench's locale runtime serves English).
    expect(artifacts?.title('')).toBe(artifacts?.guide?.[0]?.title())
    expect(artifacts?.title('')).toBeTruthy()
    expect(artifacts?.guide?.[0]?.description()).toBeTruthy()
    // The pane's keyed seat carries the shell body only (the legacy detail
    // view's seat is empty on this line).
    const { entry: artifactsEntry, injected: artifactsInjected } = artifactsApi(b)
    expect(artifactsEntry?.locale).toBe('filePreview')
    expect(artifactsEntry?.store).toBeTruthy()
    expect(artifactsInjected?.listFiles).toBeTypeOf('function')
    expect(artifactsInjected?.openArtifact).toBeTypeOf('function')
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    // The content renderer: extension band (the document tab's default body —
    // external implementations outrank the official ones), renderer-owned
    // loading (the read stays on our outside-workspace-capable Remote), avif
    // declared binary (the one image suffix the official viewer does not claim).
    const content = b.previews.find(d => d.id === FILE_CONTENT_ID)
    expect(content?.priority).toBe('extension')
    expect(content?.loading).toBe('renderer')
    expect(content?.title()).toBeTruthy()
    expect(content?.extensions).toContain('md')
    expect(content?.extensions).toContain('avif')
    expect(content?.extensions).not.toContain('png')
    expect(content?.binaryExtensions).toEqual(['avif'])
    // The change-history renderer: builtin band (never the default), cheapest
    // loading mode, body in the keyed document seat.
    const renderer = b.previews.find(d => d.id === FILE_HISTORY_ID)
    expect(renderer?.priority).toBe('builtin')
    expect(renderer?.loading).toBe('text-pages')
    expect(renderer?.title()).toBeTruthy()
    expect(renderer?.extensions).toContain('md')
    // Both bodies sit in the keyed document seat under their ids.
    const { entry: contentEntry, injected: contentInjected } = documentApi<FileContentBodyInjected>(b, FILE_CONTENT_ID)
    expect(contentEntry?.locale).toBe('filePreview')
    expect(contentInjected?.readFile).toBeTypeOf('function')
    expect(contentInjected?.copyPath).toBeTypeOf('function')
    const { entry: historyEntry, injected: historyInjected } = documentApi<Pick<FilePreviewTabInjected, 'listFiles'>>(b, FILE_HISTORY_ID)
    expect(historyEntry?.locale).toBe('filePreview')
    expect(historyInjected?.listFiles).toBeTypeOf('function')
    // The turn row on the list-kind slot: a plain entry under the package id
    // — no select, no priority; the row self-hides without data, and the
    // deliverables shadow (below) keeps the official cards off.
    const { entry: turnEntry } = turnApi(b)
    expect(turnEntry).toBeTruthy()
    expect(turnEntry?.options).toMatchObject({ id: FILE_PREVIEW_ID })
    expect(turnEntry?.options.priority).toBeUndefined()
    expect(turnEntry?.select).toBeUndefined()
    expect(turnEntry?.locale).toBe('filePreview')
    await b.fiber.dispose()
  })

  it('rc.1: the content renderer body reads through the filePreview Remote', async () => {
    const b = await bench()
    const { injected } = documentApi<FileContentBodyInjected>(b, FILE_CONTENT_ID)
    if (injected === undefined) throw new Error('content inject missing')
    const result = await injected.readFile(sid('s1'), 'docs/a.md')
    expect(result).toMatchObject({ ok: true, value: { kind: 'text' } })
    expect(b.read).toHaveBeenCalledWith('s1', 'docs/a.md')
    await b.fiber.dispose()
  })

  it('rc.1: the artifacts shell lists through the Remote and opens through the official resource route', async () => {
    const b = await bench()
    const { injected } = artifactsApi(b)
    if (injected === undefined) throw new Error('artifacts inject missing')
    const listResult = await injected.listFiles(sid('s1'))
    expect(listResult).toMatchObject({ ok: true })
    // A row click opens the canonical file address — the same content id the
    // turn row's openFile resolves to, so one file is one tab.
    injected.openArtifact('src/agent.ts')
    expect(b.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/src/agent.ts')
    // Outside-workspace absolutes keep their spelling inside the session
    // address (the content renderer reads them through the plugin's Remote).
    injected.openArtifact('/tmp/out.png')
    expect(b.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1//tmp/out.png')
    await b.fiber.dispose()
  })

  it('0.1.5: registers the self-drawn tab type, its body, and the turn row when no documentPreviews exists', async () => {
    const b = await bench({ documentPreviews: false })
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
    // No renderer registrations exist on this line — and no artifacts shell
    // either (the 0.1.5 page is already the full surface).
    expect(b.previews).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_ARTIFACTS_KIND)).toBe(false)
    // The turn row plus its deliverables shadow (list-kind bench slot).
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(2)
    await b.fiber.dispose()
  })

  it('retires the legacy tab and installs the renderers when documentPreviews arrives after apply', async () => {
    const b = await bench({ documentPreviews: false })
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(true)
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    b.providePreviews()
    await flush()
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
    // The artifacts shell takes over the pane seat (legacy body retired).
    expect(b.registered.some(d => d.kind === FILE_ARTIFACTS_KIND)).toBe(true)
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    expect(artifactsApi(b).entry).toBeTruthy()
    expect(b.previews.map(d => d.id).sort()).toEqual([FILE_CONTENT_ID, FILE_HISTORY_ID].sort())
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(2)
    // The turn row + shadow ride both lines, untouched by the switch.
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(2)
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

  it('the deliverables shadow renders nothing', async () => {
    const b = await bench()
    const shadow = b.ctx.slots.entries('conversation.chat.turnTail')
      .find(e => (e.options as { id?: string }).id === '@deepseek-ai/dsh-client-ui-deliverables')
    expect(shadow).toBeTruthy()
    expect(shadow?.options.priority).toBe(-1)
    expect((shadow?.component as () => unknown)()).toBeNull()
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
    await b.fiber.dispose()
  })

  it('routes the legacy tab body and turn card callbacks through the filePreview Remote', async () => {
    const b = await bench({ documentPreviews: false })
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
      children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' }, 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session' }, 'conversation.chat.turnTail': { kind: 'list', scope: 'session', owner: {} } },
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

  it('routes legacy row gestures: reveal through the Remote, IDE through openExternal', async () => {
    const b = await bench({ documentPreviews: false })
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

  it('unregisters every rc.1 surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.tab.document')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND || d.kind === FILE_ARTIFACTS_KIND)).toBe(false)
    expect(b.previews.some(d => d.id === FILE_HISTORY_ID || d.id === FILE_CONTENT_ID)).toBe(false)
  })

  it('unregisters every 0.1.5 surface on fiber disposal', async () => {
    const b = await bench({ documentPreviews: false })
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
  })
})
