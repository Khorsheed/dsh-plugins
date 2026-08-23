// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the slot entries, store wiring, teardown. */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { apply, inject } from '../src/client/index.ts'
import { NewRoomAction } from '../src/client/NewRoomAction.tsx'
import { en } from '../src/client/locales.ts'
import type { NewRoomInjected, RoomComposerInjected } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
})

/** An empty room state as the host's getState returns it. */
export const EMPTY_ROOM: RoomState = { members: [], relays: [], tasks: [], runs: [] }

/** Real cordis composition with the slot registry, locale runtime, and stub services. */
async function bench(options: {
  mountFails?: boolean
  /** Current session id and its cwd (undefined cwd = a session without one). */
  current?: { id: string; cwd?: string }
  /** Workspace rows the client list carries. */
  workspaces?: { workspaceId: string; path: string; sessionIds: string[] }[]
  /** The recent-workspace projection. */
  recentWorkspaceId?: string
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remoteService = {
    $mount: options.mountFails === true
      ? vi.fn(async (): Promise<() => Promise<void>> => { throw new Error('already mounted') })
      : vi.fn(async (): Promise<() => Promise<void>> => async () => {}),
  }
  ctx.provide('remote', remoteService as never)
  const remote = {
    createRoom: vi.fn(async () => ({ ok: true as const, value: { sessionId: 'room-1' } })),
    isRoom: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      ok: true as const, value: sessionId === 'room-1',
    })),
    getState: vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: EMPTY_ROOM } })),
    postMessage: vi.fn(async () => ({
      ok: true as const,
      value: { ok: true as const, value: { parsed: { targets: [], text: 'x' }, seq: 1 } },
    })),
  }
  ctx.provide('remote.room', remote as never)
  const conversationEvents = { register: vi.fn(() => () => {}) }
  ctx.provide('conversationEvents', conversationEvents as never)
  const sessions = {
    open: vi.fn(),
    list: createSnapshotStore({
      ids: options.current === undefined ? [] as string[] : [options.current.id],
      byId: options.current === undefined
        ? {}
        : { [options.current.id]: { ...(options.current.cwd === undefined ? {} : { cwd: options.current.cwd }) } },
      current: options.current?.id as string | undefined,
      phase: 'pending',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }),
  }
  ctx.provide('sessions', sessions as never)
  const workspaces = {
    list: createSnapshotStore({
      items: options.workspaces ?? [],
      archivedSessionIds: [],
      state: 'idle', phase: 'pending', error: null,
      baselinesReady: true,
      recentWorkspaceId: options.recentWorkspaceId as string | undefined,
    }),
  }
  ctx.provide('workspaces', workspaces as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The slot declarations as their owning packages declare them in production.
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, remote, remoteService, sessions, conversationEvents }
}

describe('room client apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'remote', 'conversationEvents', 'locale'])
  })

  it('mounts the Remote, registers the five Definitions and the slot entries with the right shapes', async () => {
    const { ctx, slots, remoteService, conversationEvents } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    expect(conversationEvents.register).toHaveBeenCalledTimes(5)

    const footer = slots.entries('sidebar.footer.action')
    expect(footer).toHaveLength(1)
    expect(footer[0]!.options.id).toBe('room-new')

    const composer = slots.entries('conversation.composer')
    expect(composer).toHaveLength(1)
    expect(composer[0]!.options.priority).toBe(-10)
    // The chain selector declines while nothing is cached (no session here).
    const select = (composer[0] as { select?: (owner: object) => unknown }).select
    expect(select).toBeTypeOf('function')
    expect(select!({ interactions: [] })).toBeNull()

    const views = slots.entries('conversation.view')
    expect(views).toHaveLength(1)
    expect(views[0]!.options.id).toBe('room-members')
    expect((views[0]!.options.label as () => string)()).toBe('Members')

    const nodes = slots.entries('conversation.chat.node').map(entry => entry.options.key)
    expect(nodes).toEqual(['room-speech', 'room-run', 'room-event', 'room-relay', 'room-task-line'])

    // The dock capsules no longer occupy the input dock: that seat hides with
    // the official fallback under the composer takeover, so the takeover
    // renders the capsules itself and the dock stays untouched.
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('still registers every surface when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(slots.entries('conversation.composer')).toHaveLength(1)
    expect(slots.entries('conversation.view')).toHaveLength(1)
    expect(slots.entries('conversation.chat.node')).toHaveLength(5)
  })

  it('the footer action face creates a room through the Remote and opens it, inheriting the current session cwd', async () => {
    const { ctx, slots, remote, sessions } = await bench({ current: { id: 's-1', cwd: '/home/user/work' } })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => NewRoomInjected)()
    const outcome = await face.createRoom()
    expect(outcome).toEqual({ ok: true })
    expect(remote.createRoom).toHaveBeenCalledWith({ cwd: '/home/user/work' })
    expect(sessions.open).toHaveBeenCalledWith('room-1')
  })

  it('the footer action face falls back to the current session workspace, then the recent workspace', async () => {
    // Current session has no cwd of its own: the holding workspace's path wins.
    const held = await bench({
      current: { id: 's-1' },
      workspaces: [
        { workspaceId: 'ws-1', path: '/home/user/held', sessionIds: ['s-1'] },
        // The recency fallback exists but the holding workspace outranks it.
        { workspaceId: 'ws-2', path: '/home/user/recent', sessionIds: [] },
      ],
      recentWorkspaceId: 'ws-2',
    })
    await held.ctx.plugin({ inject: [...inject], apply }).await()
    const heldFace = (held.slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => NewRoomInjected)()
    await heldFace.createRoom()
    expect(held.remote.createRoom).toHaveBeenCalledWith({ cwd: '/home/user/held' })

    // No current session: the recent workspace's path is the fallback.
    const recent = await bench({
      workspaces: [{ workspaceId: 'ws-2', path: '/home/user/recent', sessionIds: [] }],
      recentWorkspaceId: 'ws-2',
    })
    await recent.ctx.plugin({ inject: [...inject], apply }).await()
    const recentFace = (recent.slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => NewRoomInjected)()
    await recentFace.createRoom()
    expect(recent.remote.createRoom).toHaveBeenCalledWith({ cwd: '/home/user/recent' })
  })

  it('the footer action face refuses creation without an inheritable cwd (Remote never called)', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => NewRoomInjected)()
    const outcome = await face.createRoom()
    expect(outcome).toEqual({ ok: false, message: en['action.error.noWorkspace'] })
    expect(remote.createRoom).not.toHaveBeenCalled()
  })

  it('the footer action face reports a transport failure as an outcome', async () => {
    const { ctx, slots, remote } = await bench({ current: { id: 's-1', cwd: '/home/user/work' } })
    remote.createRoom.mockResolvedValueOnce({ ok: false, error: { code: 'offline' } } as never)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => NewRoomInjected)()
    const outcome = await face.createRoom()
    expect(outcome).toEqual({ ok: false, message: expect.any(String) })
  })

  it('the composer selector claims exactly the cached-room sessions', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.composer')[0]!
    const select = (entry as unknown as { select: (owner: object) => unknown }).select
    // No session, or an uncached one: decline (the official bar stays).
    expect(select({ interactions: [], session: undefined })).toBeNull()
    expect(select({ interactions: [], session: { sessionId: 'plain' } })).toBeNull()
    // Prime the cache through the injected store (the isRoom stub: only 'room-1' is a room).
    // The composer inject binds the task-board actions to the session id.
    const face = (entry.inject as unknown as (sessionId: string) => RoomComposerInjected)('room-1')
    await face.roomStore.ensure('room-1' as never)
    expect(select({ interactions: [], session: { sessionId: 'room-1' } })).toEqual({ room: true })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.entries('conversation.composer')).toHaveLength(0)
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('the footer action button triggers creation on click', async () => {
    const createRoom = vi.fn(async () => ({ ok: true as const }))
    render(<NewRoomAction wide createRoom={createRoom} t={((key: string) => key) as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.newRoom' }))
    expect(createRoom).toHaveBeenCalledTimes(1)
  })

  it('the footer action button surfaces a refused creation as an error line', async () => {
    const createRoom = vi.fn(async () => ({ ok: false as const, message: 'action.error.noWorkspace' }))
    render(<NewRoomAction wide createRoom={createRoom} t={((key: string) => key) as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.newRoom' }))
    expect((await screen.findByRole('alert')).textContent).toBe('action.error.noWorkspace')
  })
})
