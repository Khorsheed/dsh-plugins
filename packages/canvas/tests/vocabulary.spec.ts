/**
 * The pad's pure vocabulary: the name rules that keep a title inside its kind
 * directory, the kind round trip, the tolerant index read, and the display
 * order. Everything here is what the host's name guard and the list's order
 * are built on, so it is tested without a filesystem.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_INDEX, itemNameOf, kindOfItemName, MAX_TITLE_LENGTH, normalizeIndex,
  orderItemNames, sanitizeItemTitle, titleOfItemName,
} from '../src/types.ts'

describe('sanitizeItemTitle', () => {
  it('keeps a plain title', () => {
    expect(sanitizeItemTitle('第一章 雨夜')).toBe('第一章 雨夜')
  })

  it('drops a trailing extension — the extension is ours to add', () => {
    expect(sanitizeItemTitle('第一章.md')).toBe('第一章')
  })

  it('replaces path separators and other illegal characters', () => {
    expect(sanitizeItemTitle('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('strips leading dots so an item can never land a dotfile in the pad', () => {
    expect(sanitizeItemTitle('...hidden')).toBe('hidden')
  })

  it('refuses an empty or dot-only title', () => {
    expect(sanitizeItemTitle('   ')).toBeUndefined()
    expect(sanitizeItemTitle('...')).toBeUndefined()
    expect(sanitizeItemTitle('.md')).toBeUndefined()
  })

  it('caps the length', () => {
    expect(sanitizeItemTitle('长'.repeat(200))).toHaveLength(MAX_TITLE_LENGTH)
  })
})

describe('the name vocabulary', () => {
  it('round-trips kind and title through a name', () => {
    for (const kind of ['article', 'card'] as const) {
      const name = itemNameOf(kind, '第一章 雨夜')
      expect(kindOfItemName(name)).toBe(kind)
      expect(titleOfItemName(name)).toBe('第一章 雨夜')
    }
  })

  it('refuses a name outside a kind directory', () => {
    expect(kindOfItemName('杂项/x.md')).toBeUndefined()
    expect(kindOfItemName('x.md')).toBeUndefined()
  })

  it('refuses traversal and deeper nesting', () => {
    expect(kindOfItemName('../文章/x.md')).toBeUndefined()
    expect(kindOfItemName('文章/../x.md')).toBeUndefined()
    expect(kindOfItemName('文章/sub/x.md')).toBeUndefined()
    expect(kindOfItemName('文章\\x.md')).toBeUndefined()
  })

  it('refuses a file with a foreign extension', () => {
    expect(kindOfItemName('文章/x.txt')).toBeUndefined()
  })
})

describe('normalizeIndex', () => {
  it('reads a well-formed index', () => {
    expect(normalizeIndex({ order: ['文章/a.md'], archivedIds: ['卡片/b.md'] })).toEqual({
      order: ['文章/a.md'], archivedIds: ['卡片/b.md'],
    })
  })

  it('degrades anything unusable to empty rather than throwing', () => {
    expect(normalizeIndex(null)).toBe(EMPTY_INDEX)
    expect(normalizeIndex('nonsense')).toBe(EMPTY_INDEX)
    expect(normalizeIndex({ order: 'x', archivedIds: 7 })).toEqual({ order: [], archivedIds: [] })
    expect(normalizeIndex({ order: ['a', 7, null, 'a'], archivedIds: [] })).toEqual({
      order: ['a'], archivedIds: [],
    })
  })
})

describe('orderItemNames', () => {
  it('follows the index order, then appends outsiders by name', () => {
    expect(orderItemNames(
      ['文章/c.md', '文章/a.md', '卡片/z.md'],
      ['卡片/z.md', '文章/c.md'],
    )).toEqual(['卡片/z.md', '文章/c.md', '文章/a.md'])
  })

  it('is stable when the index is empty', () => {
    expect(orderItemNames(['b.md', 'a.md'], [])).toEqual(['a.md', 'b.md'])
  })
})
