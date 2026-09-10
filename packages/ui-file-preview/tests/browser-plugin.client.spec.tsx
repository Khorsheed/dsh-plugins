// @vitest-environment jsdom
/**
 * ui-file-preview browser half on a real cordis Context with fake slots /
 * remote / sidebarRight faces and a real tab-type registry: the plugin mounts
 * its Remote, registers the `file-preview` page type into
 * `ctx.sidebarRightTabs`, the tab body into the keyed `sidebar.right.pane.tab`
 * seat under the type's id, and the per-turn file row into the turnTail chain
 * at default priority (no more `priority: -1` preemption — the official
 * deliverables row elects first). Registration disposal rides the plugin
 * fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { FilePreviewTabInjected, FilePreviewTurnRowInjected } from '../src/client/contract.ts'

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over fake faces; the filePreview Remote records calls. */
async function bench() {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const list = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'list', args })
    return { ok: true, value: { entries: [], asOfSeq: -1, truncated: false } }
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
  ctx.provide('remote.filePreview', { list, turnFiles })
  ctx.provide('locale', new LocaleRuntime(ctx))
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
  await ctx.plugin(SlotRegistry).await()
  // Declare the target slots (normally declared by ui-sidebar-right / ui-chat).
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session', owner: {} },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, calls, list, turnFiles, mount, registered, openTab }
}

/** The tab body entry's inject factory, called the way the outlet would. */
function tabApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')[0]
  const injected = (entry?.inject as unknown as (() => FilePreviewTabInjected) | undefined)?.()
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
    // Stage one: the page type, entered from the guide, claiming no address.
    const definition = b.registered.find(d => d.kind === FILE_PREVIEW_KIND)
    expect(definition?.id).toBe(FILE_PREVIEW_ID)
    expect(definition?.patterns).toBeUndefined()
    expect(definition?.title('sidebar://file-preview')).toBeTruthy()
    expect(definition?.guide?.length).toBe(1)
    // Stage two: the body under the type's id, with the store and the locale.
    const { entry } = tabApi(b)
    expect(entry?.options).toMatchObject({ key: FILE_PREVIEW_ID })
    expect(entry?.locale).toBe('filePreview')
    expect(entry?.store).toBeTruthy()
    // The turn row: default priority (no preemption of the official row).
    const { entry: turnEntry } = turnApi(b)
    expect(turnEntry).toBeTruthy()
    expect(turnEntry?.options.priority).toBeUndefined()
    expect(turnEntry?.locale).toBe('filePreview')
    await b.fiber.dispose()
  })

  it('routes the tab body and turn card callbacks through the filePreview Remote', async () => {
    const b = await bench()
    const { injected } = tabApi(b)
    if (injected === undefined) throw new Error('tab inject missing')
    const listResult = await injected.listFiles(sid('s1'))
    expect(listResult).toMatchObject({ ok: true, value: { entries: [] } })
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

  it('unregisters every surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === FILE_PREVIEW_KIND)).toBe(false)
  })
})
