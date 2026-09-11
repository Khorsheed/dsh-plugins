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
it('opens the installed Room invite action, never a second mutation implementation', async () => {
  document.documentElement.setAttribute('data-dsh-mobile', '')
  const anchor = document.createElement('div'); anchor.innerHTML = '<div data-slot="main.conversation"><div data-slot="conversation.session.header.actions"><button aria-label="Invite agent">Invite agent</button></div></div>'; document.body.append(anchor)
  const action = vi.fn(); anchor.querySelector('button')!.onclick = action
  const { invite } = fixture(); fireEvent.click(await screen.findByRole('button', { name: en.members }))
  fireEvent.click(screen.getByRole('button', { name: en.inviteMember }))
  expect(action).toHaveBeenCalledOnce(); expect(invite).not.toHaveBeenCalled()
  anchor.remove(); document.documentElement.removeAttribute('data-dsh-mobile')
})
