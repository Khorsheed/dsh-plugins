// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the slot entries, store wiring, teardown. */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { apply, inject } from '../src/client/index.ts'
import { InviteAgentAction } from '../src/client/InviteAgentAction.tsx'
import type { InviteAgentInjected, RoomComposerInjected } from '../src/client/slots.ts'
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
    invite: vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { name: 'ada', pendingFirstTask: false } } })),
    listProviders: vi.fn(async () => ({ ok: true as const, value: { localAgentAvailable: true, providers: [] } })),
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
  // Host 0.1.2's registry seat: uiConversation.events (the standalone
  // conversationEvents service is gone).
  ctx.provide('uiConversation', { events: conversationEvents } as never)
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
  const slots = ctx.get('slots') as SlotRegistry
  // The slot declarations as their owning packages declare them in production.
  slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
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
    expect(inject).toEqual(['slots', 'sessions', 'remote', 'locale'])
  })

  it('mounts the Remote, registers the five Definitions and the slot entries with the right shapes', async () => {
    const { ctx, slots, remoteService, conversationEvents } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    expect(conversationEvents.register).toHaveBeenCalledTimes(5)

    const header = slots.entries('conversation.session.header.actions')
    expect(header).toHaveLength(1)
    expect(header[0]!.options.id).toBe('room-invite-agent')

    const composer = slots.entries('conversation.composer')
    expect(composer).toHaveLength(1)
    expect(composer[0]!.options.priority).toBe(-10)
    // The chain selector declines while nothing is cached (no session here).
    const select = (composer[0] as { select?: (owner: object) => unknown }).select
    expect(select).toBeTypeOf('function')
    expect(select!({ pendingInteraction: undefined })).toBeNull()

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
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(slots.entries('conversation.composer')).toHaveLength(1)
    expect(slots.entries('conversation.view')).toHaveLength(1)
    expect(slots.entries('conversation.chat.node')).toHaveLength(5)
  })

  it('the header action face invites through the Remote bound to the session (its own cwd rides as the placeholder)', async () => {
    const { ctx, slots, remote } = await bench({ current: { id: 's-1', cwd: '/home/user/work' } })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.session.header.actions')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => InviteAgentInjected)('s-1')
    expect(face.roomCwd).toBe('/home/user/work')
    const outcome = await face.invite({ provider: 'kimi-cli', name: 'ada' })
    expect(outcome).toEqual({ ok: true, pendingFirstTask: false })
    expect(remote.invite).toHaveBeenCalledWith({ sessionId: 's-1', provider: 'kimi-cli', name: 'ada' })
  })

  it('the composer selector claims exactly the cached-room sessions', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.composer')[0]!
    const select = (entry as unknown as { select: (owner: object) => unknown }).select
    // No session, or an uncached one: decline (the official bar stays).
    expect(select({ pendingInteraction: undefined, sessionId: undefined })).toBeNull()
    expect(select({ pendingInteraction: undefined, sessionId: 'plain' })).toBeNull()
    // Prime the cache through the injected store (the isRoom stub: only 'room-1' is a room).
    // The composer inject binds the task-board actions to the session id.
    const face = (entry.inject as unknown as (sessionId: string) => RoomComposerInjected)('room-1')
    await face.roomStore.ensure('room-1' as never)
    expect(select({ pendingInteraction: undefined, sessionId: 'room-1' })).toEqual({ room: true })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('conversation.composer')).toHaveLength(0)
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('the header action chip opens the invite dialog on click', async () => {
    const face: InviteAgentInjected = {
      roomCwd: '/home/user/room',
      invite: vi.fn(async () => ({ ok: true as const, pendingFirstTask: false })),
      listProviders: vi.fn(async () => ({ localAgentAvailable: true, providers: [] })),
      browseDirectory: vi.fn(async () => null),
      listNames: vi.fn(() => []),
      // The criterion's fail-open stub: everything shows.
      roomChrome: { show: () => true, subscribe: () => () => {} },
    }
    render(<InviteAgentAction {...({ ...face, t: (key: string) => key } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.inviteAgent' }))
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(face.listProviders).toHaveBeenCalled()
  })
})
