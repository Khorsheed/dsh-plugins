import { describe, expect, it } from 'vitest'
import { prefixTextChange } from '../src/prefix-diff.ts'
import { InspectorStore } from '../src/store.ts'

describe('full-text prefix difference', () => {
  it('centers a change beyond identical previews and keeps unchanged context separate', () => {
    const start = '相同开头'.repeat(500)
    const d = prefixTextChange(start + '旧值。共同结尾', start + '新值。共同结尾')
    expect(d).toMatchObject({ offset: start.length, leadingOmitted: true, removed: '旧', added: '新', trailing: '值。共同结尾', removedChars: 1, addedChars: 1 })
    expect(d.leading).toHaveLength(48)
  })
  it('distinguishes insertions, deletions and whole-message removal', () => {
    expect(prefixTextChange('abc', 'abc extra')).toMatchObject({ offset: 3, removedChars: 0, added: ' extra' })
    expect(prefixTextChange('abc extra', 'abc')).toMatchObject({ offset: 3, removed: ' extra', addedChars: 0 })
    expect(prefixTextChange('abc', '')).toMatchObject({ offset: 0, removed: 'abc', added: '' })
  })
  it('bounds long replacements, measures full spans and preserves Unicode characters', () => {
    const d = prefixTextChange('😀' + '旧'.repeat(200) + '尾'.repeat(80), '😀' + '新'.repeat(300) + '尾'.repeat(80))
    expect(d).toMatchObject({ offset: 1, leading: '😀', removedChars: 200, addedChars: 300, trailingOmitted: true })
    expect(d.removed).toHaveLength(160)
    expect(d.added).toHaveLength(160)
    expect(d.trailing).toHaveLength(48)
  })
  it('uses same-agent full content across turns and returns a neutral baseline without a predecessor', () => {
    const store = new InspectorStore({ maxTurnsPerSession: 1 })
    const begin = (text: string, at: number) => store.beginRequest({ sessionId: 's', config: {}, messages: [{ id: 'fixed', role: 'user', content: [{ type: 'text', text }] }] }, at)!
    store.turnStart('s', 1, 0)
    const first = begin('x'.repeat(200) + 'old', 1)
    store.settleRequest(first, 2)
    const read = (seq: number) => { const r = store.getRequest('s', seq)!; if ('refused' in r) throw Error('refused'); return r }
    expect(read(first.seq).prefix).toBeUndefined()
    const next = begin('x'.repeat(200) + 'new', 3)
    store.settleRequest(next, 4)
    expect(read(next.seq).prefix?.changed?.text).toMatchObject({ offset: 200, removed: 'old', added: 'new' })
    expect(read(next.seq).prefix?.changed?.before).toContain('old')
  })
})
