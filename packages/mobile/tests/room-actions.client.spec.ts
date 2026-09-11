// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openRoomInvite, openRoomMemberSettings } from '../src/client/roomActions.ts'
afterEach(() => { document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile') })
it('invokes only the current session invite entry and respects its disabled state', () => {
  document.documentElement.setAttribute('data-dsh-mobile','')
  document.body.innerHTML = '<button aria-label="＋ Invite agent">Outside</button><div data-slot="main.conversation"><div data-slot="conversation.session.header.actions"><button aria-label="＋ Invite agent">Invite agent</button></div></div>'
  const original = document.querySelectorAll('button')[1]!, action = vi.fn(); original.onclick = action
  expect(openRoomInvite(document)).toBe(true); expect(action).toHaveBeenCalledOnce()
  original.disabled = true; expect(openRoomInvite(document)).toBe(false); expect(action).toHaveBeenCalledOnce()
})
it('waits for the authoritative member page and invokes the exact member edit callback', async () => {
  document.documentElement.setAttribute('data-dsh-mobile','')
  document.body.innerHTML = '<div data-slot="main.conversation"><button role="tab">Members</button></div>'
  const action = vi.fn(), root = document.querySelector('div')!
  document.querySelector('button')!.onclick = () => { queueMicrotask(() => { const card = document.createElement('div'); card.dataset.member = 'ada'; card.innerHTML = '<button>Edit</button>'; card.querySelector('button')!.onclick = action; root.append(card) }) }
  expect(await openRoomMemberSettings(document, 'ada', () => true)).toBe(true); expect(action).toHaveBeenCalledOnce()
})
it('does not apply a member action after navigation invalidates the request', async () => {
  document.documentElement.setAttribute('data-dsh-mobile','')
  document.body.innerHTML = '<div data-slot="main.conversation"><button role="tab">Members</button><div data-member="ada"><button>Edit</button></div></div>'
  expect(await openRoomMemberSettings(document, 'ada', () => false)).toBe(false)
})
