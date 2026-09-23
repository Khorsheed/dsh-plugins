// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { RoomRequestIds } from '../src/client/request-ids.ts'

describe('room input retry identity', () => {
  it('retains the same identity until acceptance and changes it for new text or targets', () => {
    const ids = new RoomRequestIds()
    const original = ids.forInput('room', 'text', ['a', 'b'])
    expect(ids.forInput('room', ' text ', ['b', 'a', 'a'])).toBe(original)
    expect(ids.forInput('other', 'text', ['a', 'b'])).not.toBe(original)
    const changed = ids.forInput('room', 'changed', ['a', 'b'])
    expect(changed).not.toBe(original)
    ids.complete('room', original)
    expect(ids.forInput('room', 'changed', ['a', 'b'])).toBe(changed)
    ids.complete('room', changed)
    expect(ids.forInput('room', 'changed', ['a', 'b'])).not.toBe(changed)
  })

  it('generates retry identities on LAN HTTP without randomUUID', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
    try {
      const random = vi.spyOn(globalThis.crypto, 'getRandomValues')
      const ids = new RoomRequestIds()
      expect(ids.forInput('room', 'text')).toMatch(/^[a-f0-9]{32}$/)
      expect(random).toHaveBeenCalledOnce()
      random.mockRestore()
    } finally {
      if (original === undefined) delete (globalThis.crypto as Partial<Crypto>).randomUUID
      else Object.defineProperty(globalThis.crypto, 'randomUUID', original)
    }
  })
})
