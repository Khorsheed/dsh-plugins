import { describe, expect, it } from 'vitest'
import { decodeGameRef, encodeGameRef, gameRefCodec, pickChip } from '../src/client/refs.ts'

describe('game reference chips', () => {
  it('shows a short label and hands the model the full reference', () => {
    const chip = pickChip({ id: 'fox', inst: 'fox-1', state: '摆尾中', region: '阴坡', point: { x: -4.04, y: 0.2, z: 1.51 } }, '狐', '地面')
    expect(chip).toEqual({ label: '狐 · 摆尾中', text: '〔狐（fox #fox-1） · 阴坡 (-4, 1.5) · 摆尾中〕' })
    expect(pickChip({ id: 'tree' }, undefined, '地面')).toEqual({ label: 'tree', text: '〔tree（tree）〕' })
    expect(pickChip({ id: null, ground: true, point: { x: 3, y: 0, z: 7.26 }, region: '阳坡' }, undefined, '地面'))
      .toEqual({ label: '地面 · 阳坡', text: '〔地面 · 阳坡 · (3, 7.3)〕' })
  })

  it('round-trips through the codec and refuses a corrupt chip', async () => {
    const raw = encodeGameRef({ label: 'a', text: '〔a〕' })
    expect(decodeGameRef(raw)).toEqual({ label: 'a', text: '〔a〕' })
    expect(await gameRefCodec.serialize(raw)).toBe('〔a〕')
    expect(gameRefCodec.clipboardText(raw)).toBe('〔a〕')
    await expect(gameRefCodec.serialize('{')).rejects.toThrow('corrupt')
  })
})
