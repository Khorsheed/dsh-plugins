import { expect, it, vi } from 'vitest'
import { MobileRooms, RoomFailure, type RoomRemoteFace } from '../src/client/rooms.ts'
it('degrades without a remote and never registers or invokes another plugin', async () => {
  const rooms = new MobileRooms(() => undefined)
  expect(rooms.available()).toBe(false); expect(await rooms.refresh('s')).toBeUndefined()
  await expect(rooms.mutate('invite', {})).rejects.toMatchObject({ code: 'unavailable' })
})
it('distinguishes ordinary sessions from transport failure and deduplicates cached roster requests', async () => {
  const getState = vi.fn().mockResolvedValue({ ok: true, value: { ok: false, error: { code: 'not-a-room' } } })
  const rooms = new MobileRooms(() => ({ getState }))
  await Promise.all([rooms.refresh('s'), rooms.refresh('s')]); expect(getState).toHaveBeenCalledOnce(); expect(rooms.get('s')).toBeNull()
  getState.mockResolvedValue({ ok: false })
  expect(await rooms.refresh('unknown')).toBeUndefined(); expect(rooms.get('unknown')).toBeUndefined()
})
it('preserves mutation semantics, reports business failures and ignores late results on removal', async () => {
  let finish!: (v: unknown) => void
  const remote = {
    getState: vi.fn(() => new Promise(resolve => { finish = resolve })),
    invite: vi.fn().mockResolvedValue({ ok: true, value: { ok: false, error: { code: 'duplicate-name' } } }),
  } as unknown as RoomRemoteFace
  const rooms = new MobileRooms(() => remote), changed = vi.fn(); rooms.subscribe(changed)
  await expect(rooms.mutate('invite', { sessionId: 's', name: 'ada', provider: 'codex' })).rejects.toBeInstanceOf(RoomFailure)
  expect(remote.invite).toHaveBeenCalledWith({ sessionId: 's', name: 'ada', provider: 'codex' })
  const request = rooms.refresh('s'); rooms.dispose(); finish({ ok: true, value: { ok: true, value: { members: [], runs: [] } } }); await request
  expect(changed).not.toHaveBeenCalled(); expect(rooms.get('s')).toBeUndefined()
})
