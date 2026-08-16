import { describe, expect, it, vi } from 'vitest'
import { editInPlace } from '../src/client/edit-in-place.ts'

function steps() {
  return {
    cancel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitIdle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    edit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

describe('editInPlace', () => {
  it('cancels the running turn, waits for the settle, then edits (in order)', async () => {
    const s = steps()
    const order: string[] = []
    s.cancel.mockImplementation(() => { order.push('cancel'); return Promise.resolve() })
    s.waitIdle.mockImplementation(() => { order.push('waitIdle'); return Promise.resolve() })
    s.edit.mockImplementation(() => { order.push('edit'); return Promise.resolve() })
    await editInPlace(s, true)
    expect(order).toEqual(['cancel', 'waitIdle', 'edit'])
  })

  it('never cancels an idle session', async () => {
    const s = steps()
    await editInPlace(s, false)
    expect(s.cancel).not.toHaveBeenCalled()
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.edit).toHaveBeenCalledTimes(1)
  })

  it('rejects without editing when the cancel fails', async () => {
    const s = steps()
    s.cancel.mockRejectedValue(new Error('cancel denied'))
    await expect(editInPlace(s, true)).rejects.toThrow('cancel denied')
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.edit).not.toHaveBeenCalled()
  })

  it('propagates an edit failure after a clean cancel', async () => {
    const s = steps()
    s.edit.mockRejectedValue(new Error('already-withdrawn'))
    await expect(editInPlace(s, true)).rejects.toThrow('already-withdrawn')
    expect(s.cancel).toHaveBeenCalledTimes(1)
  })
})
