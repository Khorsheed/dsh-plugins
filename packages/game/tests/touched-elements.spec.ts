/**
 * Where a published version lands: the elements it touched — by their own
 * definition, or by a file their definition names (a re-modelled character).
 */
import { describe, expect, it } from 'vitest'
import { touchedElements } from '../src/store.ts'

const el = (name: string, extra: Record<string, unknown> = {}) => ({ name, json: JSON.stringify({ name, ...extra }) })

describe('touchedElements', () => {
  it('counts a changed definition, and an element whose model file changed', () => {
    const ayuan = el('阿沅', { look: { model: 'assets/ayuan.glb' } })
    const xingzhe = el('行者', { look: { model: 'assets/xingzhe.glb' } })
    const fei = el('蜚', { look: { model: 'assets/fei.glb' } })
    const before = new Map([['ayuan', ayuan], ['xingzhe', xingzhe], ['fei', fei]])
    // Only the two models were re-exported, and some code changed.
    expect(touchedElements(before, before, ['assets/ayuan.glb', 'assets/xingzhe.glb', 'src/main.js']).map(([id]) => id)).toEqual(['ayuan', 'xingzhe'])
    // One definition edited.
    const after = new Map(before); after.set('fei', el('蜚', { look: { model: 'assets/fei.glb' }, speed: 2 }))
    expect(touchedElements(before, after, []).map(([id]) => id)).toEqual(['fei'])
    // Code only: no element.
    expect(touchedElements(before, before, ['src/main.js'])).toEqual([])
  })
})
