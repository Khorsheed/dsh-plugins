// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileRoomNavigation } from '../src/client/MobileRooms.tsx'
import { MobileRooms } from '../src/client/rooms.ts'
import type { NavigationCapabilities } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'
const instances: MobileRooms[] = []
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { cleanup(); instances.splice(0).forEach(r => r.dispose()) })
function fixture() {
  let members = [{ name: 'main', kind: 'main-agent' }, { name: 'ada', kind: 'cli', provider: 'codex-local', childSessionId: 'child-1' }]
  const open = vi.fn(), invite = vi.fn(async (request: Record<string, unknown>) => {
    members = [...members, { name: request.name as string, kind: 'cli' }]
    return { ok: true, value: { ok: true, value: { name: request.name } } }
  }), updateMember = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: {} } })
  const rooms = new MobileRooms(() => ({
    getState: async () => ({ ok: true, value: { ok: true, value: { members, runs: [] } } }), invite, updateMember,
    listProviders: async () => ({ ok: true, value: { localAgentAvailable: true, providers: [{ provider: 'codex-local', displayName: 'Codex', authenticated: true }] } }),
  })); instances.push(rooms)
  const navigation = { sessions: { list: { getSnapshot: () => ({ current: 'room-1' }), subscribe: () => () => {} }, open } } as unknown as NavigationCapabilities
  render(<MobileRoomNavigation rooms={rooms} navigation={navigation} prepareNavigation={() => {}} t={key => en[key]}/>)
  return { open, invite, updateMember }
}
it('opens the real child identity and distinguishes main from invitable members', async () => {
  const { open } = fixture(); fireEvent.click(await screen.findByRole('button', { name: en.members }))
  expect(screen.getByRole('button', { name: /main.*Main agent/ }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /ada.*codex-local/ }))
  expect(open).toHaveBeenCalledExactlyOnceWith('child-1')
})
it('invites through Room Remote without dispatching a first task and edits roles through the same service', async () => {
  const { invite, updateMember } = fixture(); fireEvent.click(await screen.findByRole('button', { name: en.members }))
  fireEvent.click(screen.getByRole('button', { name: en.inviteMember })); await waitFor(() => expect(screen.getByRole('combobox').value).toBe('codex-local'))
  fireEvent.change(screen.getByLabelText(en.memberName), { target: { value: 'lin' } })
  fireEvent.change(screen.getByLabelText(en.memberRole), { target: { value: 'Review changes' } })
  fireEvent.click(screen.getByRole('button', { name: en.inviteMember }))
  await waitFor(() => expect(invite).toHaveBeenCalledExactlyOnceWith({ sessionId: 'room-1', name: 'lin', provider: 'codex-local', instructions: 'Review changes' }))
  fireEvent.click(await screen.findByRole('button', { name: `${en.memberSettings} ada` }))
  fireEvent.change(screen.getByLabelText(en.memberRole), { target: { value: 'Check tests' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => expect(updateMember).toHaveBeenCalledExactlyOnceWith({ sessionId: 'room-1', name: 'ada', rename: 'ada', instructions: 'Check tests' }))
})
