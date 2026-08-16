import { describe, expect, it, vi } from 'vitest'
import { withdrawAndBackfill } from '../src/client/withdraw-backfill.ts'

describe('withdrawAndBackfill', () => {
  it('backfills the text after a successful withdrawal', async () => {
    const backfill = vi.fn()
    await withdrawAndBackfill({ withdraw: () => Promise.resolve(), backfill }, '原文')
    expect(backfill).toHaveBeenCalledWith('原文')
  })

  it('backfills nothing when the withdrawal fails', async () => {
    const backfill = vi.fn()
    await expect(withdrawAndBackfill({
      withdraw: () => Promise.reject(new Error('denied')),
      backfill,
    }, '原文')).rejects.toThrow('denied')
    expect(backfill).not.toHaveBeenCalled()
  })

  it('skips the backfill for an empty text (image-only message)', async () => {
    const backfill = vi.fn()
    await withdrawAndBackfill({ withdraw: () => Promise.resolve(), backfill }, '')
    expect(backfill).not.toHaveBeenCalled()
  })
})
