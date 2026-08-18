// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the three spike slot entries, teardown. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { fireEvent, render, screen } from '@testing-library/react'
import { apply, inject } from '../src/client/index.ts'
import { NewRoomAction } from '../src/client/NewRoomAction.tsx'
import type { NewRoomInjected } from '../src/client/slots.ts'

/** Real cordis composition with the slot registry, locale runtime, and stub services. */
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
  const remote = {
    createRoom: vi.fn(async () => ({ ok: true as const, value: { sessionId: 'room-1' } })),
    isRoom: vi.fn(async () => ({ ok: true as const, value: false })),
  }
  ctx.provide('remote.room', remote as never)
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The three slot declarations as their owning packages declare them in production.
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, remote, remoteService, sessions }
}

describe('room client apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'remote', 'locale'])
  })

  it('mounts the Remote and registers the three spike slot entries with the right shapes', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(remoteService.$mount).toHaveBeenCalledTimes(1)

    const footer = slots.entries('sidebar.footer.action')
    expect(footer).toHaveLength(1)
    expect(footer[0]!.options.id).toBe('room-new')

    const composer = slots.entries('conversation.composer')
    expect(composer).toHaveLength(1)
    // Step 0: the chain selector never claims the composer.
    const select = (composer[0] as { select?: (owner: object) => unknown }).select
    expect(select).toBeTypeOf('function')
    expect(select!({})).toBeNull()

    const views = slots.entries('conversation.view')
    expect(views).toHaveLength(1)
    expect(views[0]!.options.id).toBe('room-members')
    expect((views[0]!.options.label as () => string)()).toBe('Members')
  })

  it('still registers every surface when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(slots.entries('conversation.composer')).toHaveLength(1)
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('the footer action face creates a room through the Remote and opens it', async () => {
    const { ctx, slots, remote, sessions } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => NewRoomInjected)()
    await face.createRoom()
    expect(remote.createRoom).toHaveBeenCalledWith({})
    expect(sessions.open).toHaveBeenCalledWith('room-1')
  })

  it('the footer action face rejects on a transport failure', async () => {
    const { ctx, slots, remote } = await bench()
    remote.createRoom.mockResolvedValueOnce({ ok: false, error: { code: 'offline' } } as never)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => NewRoomInjected)()
    await expect(face.createRoom()).rejects.toThrow('transport')
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.entries('conversation.composer')).toHaveLength(0)
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('the footer action button triggers creation on click', async () => {
    const createRoom = vi.fn(async () => {})
    render(<NewRoomAction wide createRoom={createRoom} t={((key: string) => key) as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.newRoom' }))
    expect(createRoom).toHaveBeenCalledTimes(1)
  })
})
