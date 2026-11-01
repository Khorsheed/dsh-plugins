/**
 * The room desk line for a novel write: cards added/changed/commented/
 * archived and chapters written, each card named by its category's title
 * field, then a name field, then its text — never left empty when anything
 * names it.
 */
import { describe, expect, it } from 'vitest'
import { novelCardName, novelWriteItems } from '../src/desk.ts'

const card = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'k_char', text: '', status: 'active', comments: [] as unknown[], ...over })

describe('novelCardName', () => {
  it('prefers the category\'s title field, then a name field, then the text\'s first line, then any filled field', () => {
    expect(novelCardName(card('a', { fields: { 称呼: '林川', 身份: '标注员' } }), '称呼')).toBe('林川')
    expect(novelCardName(card('a', { fields: { 名字: '林川' } }))).toBe('林川')
    expect(novelCardName(card('a', { text: '## 命名规则\n正文' }))).toBe('命名规则')
    expect(novelCardName(card('a', { fields: { 身份: '标注员' } }))).toBe('标注员')
    expect(novelCardName(card('a'))).toBe('')
  })
})

describe('novelWriteItems', () => {
  it('tells new, archived, commented and changed cards, and new or rewritten chapters', () => {
    const before = {
      title: '潜梦者',
      cards: [card('c1', { text: '林川' }), card('c2', { text: '命名' }), card('c3', { text: '旧' })],
      chapters: [{ chapter: { n: 1, title: '别替我起名' }, phase: 'planned' }],
    }
    const after = {
      title: '潜梦者',
      cards: [
        card('c1', { text: '林川', comments: ['好'] }),
        card('c2', { text: '命名（修订）' }),
        card('c3', { text: '旧', status: 'archived' }),
        card('c4', { text: '青崖' }),
      ],
      chapters: [{ chapter: { n: 1, title: '别替我起名' }, phase: 'written' }, { chapter: { n: 2, title: '雨夜' }, phase: 'planned' }],
    }
    const kinds = () => ({ label: '人物' })
    expect(novelWriteItems(before, after, kinds)).toEqual([
      { action: 'commented', title: '林川', cardId: 'c1', kind: '人物' },
      { action: 'changed', title: '命名（修订）', cardId: 'c2', kind: '人物' },
      { action: 'archived', title: '旧', cardId: 'c3', kind: '人物' },
      { action: 'added', title: '青崖', cardId: 'c4', kind: '人物' },
      { action: 'chapter', title: '第 1 章《别替我起名》', chapter: 1 },
      { action: 'chapter', title: '第 2 章《雨夜》', chapter: 2 },
    ])
    expect(novelWriteItems(before, before, kinds)).toEqual([])
  })
})
