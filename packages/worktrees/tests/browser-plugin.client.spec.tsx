// @vitest-environment jsdom
/**
 * worktrees browser half on a real cordis Context with fake slots / remote /
 * sidebarRight faces: the plugin mounts its Remote, registers the `worktrees`
 * page type into `ctx.sidebarRightTabs`, the tab body into the keyed
 * `sidebar.right.pane.tab` seat under the type's id, the badge into the
 * session-header utilities list, and the local-files browser into
 * `shell.overlay`. The badge's branch capsule routes through
 * `ctx.sidebarRight.openTab` with the mode as navigation params, silently
 * degrading when no session surface is mounted. Registration disposal rides
 * the plugin fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { WORKTREES_KIND, WORKTREES_TAB_ID } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { WorktreesBadgeInjected, WorktreesTabInjected } from '../src/client/contract.ts'

/** Boot the plugin over fake faces; the worktrees Remote records calls. */
async function bench(options: {
  /** Publish the 0.1.5-shaped list (top-level `current`, no per-row retention). */
  legacyCurrent?: boolean
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string) => vi.fn(async (...args: unknown[]) => {
    calls.push({ method, args })
    return { ok: true, value: undefined }
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  // The plugin mounts its own contribution through $mount; fake it by
  // exposing the $mount entry and providing the worktrees namespace as a
  // real service (the apply reads it back from the global store via
  // `ctx.get('remote.worktrees')` after the mount settles).
  const mount = vi.fn(async () => () => {})
  // The forwarded-event carrier: records live subscriptions by event name.
  const forwarded = new Map<string, (sessionId: string) => void>()
  const on = vi.fn((event: string, listener: (sessionId: string) => void) => {
    forwarded.set(event, listener)
    return () => { forwarded.delete(event) }
  })
  Object.assign(ctx.remote, { $mount: mount, $on: on })
  ctx.provide('remote.worktrees', {
    summary: record('summary'),
    badgeConfig: record('badgeConfig'),
    changes: record('changes'),
    repoFiles: record('repoFiles'),
    commitLog: record('commitLog'),
    commitFiles: record('commitFiles'),
    listWorktrees: record('listWorktrees'),
    switchWorktree: record('switchWorktree'),
    directAgent: record('directAgent'),
    fileDiff: record('fileDiff'),
    readFile: record('readFile'),
    readFileAtCommit: record('readFileAtCommit'),
    readRepoImage: record('readRepoImage'),
    listLocalDirectory: record('listLocalDirectory'),
    readLocalFile: record('readLocalFile'),
    readLocalImage: record('readLocalImage'),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    list: {
      // The on-screen session: 0.1.6-alpha.2 reads the row's main-view
      // retention count; `legacyCurrent` exercises the 0.1.5 `current`
      // fallback instead.
      getSnapshot: () => (options.legacyCurrent === true
        ? { byId: { s1: { id: 's1' } }, current: 's1' }
        : { byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }),
      subscribe: () => () => {},
    },
  })
  ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } })
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
  // Declare the target slots (normally declared by ui-conversation / ui-layout
  // / ui-sidebar-right).
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, calls, mount, registered, openTab, forwarded, on }
}

/** The tab body entry's inject factory, called the way the outlet would. */
function tabApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('sidebar.right.pane.tab')[0]
  const injected = (entry?.inject as unknown as (() => WorktreesTabInjected) | undefined)?.()
  return { entry, injected }
}

/** The badge entry's inject factory, called the way the outlet would. */
function badgeApi(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.ctx.slots.entries('conversation.session.header.utilities')[0]
  const injected = (entry?.inject as unknown as (() => WorktreesBadgeInjected) | undefined)?.()
  return { entry, injected }
}

describe('worktrees browser plugin', () => {
  it('mounts the Remote and registers the tab type, the body, the badge, and the browser', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    // Stage one: the page type, entered from the guide, claiming no address.
    const definition = b.registered.find(d => d.kind === WORKTREES_KIND)
    expect(definition?.id).toBe(WORKTREES_TAB_ID)
    expect(definition?.patterns).toBeUndefined()
    expect(definition?.priority).toBeUndefined()
    expect(definition?.title('sidebar://worktrees')).toBeTruthy()
    expect(definition?.guide?.length).toBe(1)
    // Stage two: the body under the type's id, with the store and the locale.
    const { entry } = tabApi(b)
    expect(entry?.options).toMatchObject({ key: WORKTREES_TAB_ID })
    expect(entry?.locale).toBe('worktrees')
    expect(entry?.store).toBeTruthy()
    // The badge keeps the utilities list slot (the corner is single and
    // already occupied by ui-sidebar-right's ExpandButton), ordered leftmost:
    // list slots render priority asc then order asc, and the official
    // neighbors sit at -10 (open-in-app) and 0 (session-log-export "…").
    const { entry: badge } = badgeApi(b)
    expect(badge?.options).toMatchObject({ id: 'worktrees-badge', order: -20 })
    // The frame-wide local-files browser surface was removed 2026-09-23: its
    // only opener (the badge's folder capsule) had already gone in ea531c4b, so
    // the mounted-but-unreachable drawer is gone and file browsing belongs to
    // @khorsheed/dsh-local-files alone (proposal preview-kernel).
    expect(b.ctx.slots.entries('shell.overlay').length).toBe(0)
    await b.fiber.dispose()
  })

  it('registers the tab type on a 0.1.5-shaped list (legacy current fallback)', async () => {
    const b = await bench({ legacyCurrent: true })
    expect(b.registered.some(d => d.kind === WORKTREES_KIND)).toBe(true)
    await b.fiber.dispose()
  })
  it('subscribes to the two forwarded session events and releases them on disposal', async () => {
    const b = await bench()
    // The official api/remotes allowlist forwards exactly these two events that
    // mean "this session's state moved" (an agent running flip, a new user
    // message); the badge re-reads on them instead of polling. A plugin-declared
    // event is NOT forwardable — see the upstream seam registry.
    expect([...b.forwarded.keys()].sort()).toEqual(['api-session/activity', 'api-session/status'])
    await b.fiber.dispose()
    expect(b.forwarded.size).toBe(0)
  })

  it('routes the badge branch capsule through sidebarRight.openTab with the mode', async () => {
    const b = await bench()
    const { injected } = badgeApi(b)
    if (injected === undefined) throw new Error('badge inject missing')
    injected.open('commits')
    expect(b.openTab).toHaveBeenCalledWith(WORKTREES_KIND, { params: { mode: 'commits' } })
    // A throw from the page service (no mounted surface) stays contained.
    b.openTab.mockImplementationOnce(() => { throw new Error('sidebarRight: no session surface is mounted') })
    expect(() => { injected.open('worktree') }).not.toThrow()
    await b.fiber.dispose()
  })

  it('routes the tab body callbacks through the worktrees Remote', async () => {
    const b = await bench()
    const { injected } = tabApi(b)
    if (injected === undefined) throw new Error('tab inject missing')
    await injected.fetchSummary('s1' as never)
    await injected.fetchChanges('s1' as never)
    expect(b.calls).toEqual([
      // The tab-visibility controller's one-per-page config fetch, kicked off
      // at apply (the criterion's visiblePresets override input).
      { method: 'badgeConfig', args: [] },
      { method: 'summary', args: ['s1'] },
      { method: 'changes', args: ['s1'] },
    ])
    await b.fiber.dispose()
  })

  it('unregisters every surface on fiber disposal', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(b.ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(b.registered.some(d => d.kind === WORKTREES_KIND)).toBe(false)
  })
})
