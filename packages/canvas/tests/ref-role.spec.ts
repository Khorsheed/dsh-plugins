/**
 * A ref field's refKind may name a genre category's role as well as a
 * category id (2026-11-01): a genre seed cannot know a board's category ids,
 * so 「属于 → 地点」 is written as refKind 'place'.
 */
import { describe, expect, it } from 'vitest'
import { refResolverOf } from '../src/tools.ts'
import type { CanvasBoard } from '../src/types.ts'

const board = {
  categories: [
    { id: 'cat_a', label: '地点', order: 1, enabled: true, role: 'place', definition: { version: 1, layout: 'entry', fields: [{ key: 'name', label: '名称', type: 'line', hint: '', required: true, face: true }] } },
    { id: 'cat_b', label: '势力', order: 2, enabled: true, role: 'faction', definition: { version: 1, layout: 'entry', fields: [{ key: 'name', label: '名称', type: 'line', hint: '', required: true, face: true }] } },
  ],
  cards: [
    { id: 'c_town', kind: 'cat_a', status: 'kept', text: '', fields: { name: '小镇' } },
    { id: 'c_co', kind: 'cat_b', status: 'kept', text: '', fields: { name: '小镇' } },
  ],
} as unknown as CanvasBoard

describe('refKind by role', () => {
  it('resolves a name within the category whose role the field names', () => {
    const resolve = refResolverOf(board)
    expect(resolve('小镇', 'place')).toBe('c_town')
    expect(resolve('小镇', 'faction')).toBe('c_co')
    expect(resolve('小镇', 'cat_a')).toBe('c_town')
    // Two cards answer the name with no refKind: ambiguous, so nothing.
    expect(resolve('小镇', undefined)).toBeUndefined()
  })
})
