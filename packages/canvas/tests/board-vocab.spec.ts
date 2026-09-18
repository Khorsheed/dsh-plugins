/**
 * The canvas space's pure vocabulary: the canvas id and title rules that keep
 * a state directory inside the state root, the id shape (time-ordered, so the
 * state dir's lexical order is chronological), the tolerant `canvas.json`
 * read (a hand-edited file must never make the space unopenable), and the
 * counters every list row and self-tuning rule reads. Tested without a
 * filesystem, exactly like the pad's own vocabulary spec.
 */
import { describe, expect, it } from 'vitest'
import {
  computeKindCounts, documentHeadingOf, isLongCardText, makeBoardId, normalizeBoard,
  normalizeCanvasId, sanitizeCanvasTitle, summarizeBoard, MAX_CANVAS_TITLE_LENGTH,
  type BoardCard, type CanvasBoard,
} from '../src/types.ts'

const NOW = '2026-09-16T00:00:00.000Z'

/** One well-formed card the tests bend out of shape. */
function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'c_1',
    kind: 'fragment',
    text: '沉默并不总是因为恐惧',
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** One well-formed board the tests bend out of shape. */
function board(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'canvas_01234567abcdefgh',
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: ['/ws/report'],
    chat: { sessionId: null },
    cards: [card()],
    stats: { proposed: { accepted: 1, rejected: 2 }, kindCounts: { fragment: 99 }, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('sanitizeCanvasTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeCanvasTitle('  沉默的\n  两种成因  ')).toBe('沉默的 两种成因')
  })

  it('replaces control characters instead of dying on them', () => {
    expect(sanitizeCanvasTitle('a\u0000b\u001fc\u007f')).toBe('a b c')
  })

  it('refuses an empty title', () => {
    expect(sanitizeCanvasTitle('   ')).toBeUndefined()
    expect(sanitizeCanvasTitle('')).toBeUndefined()
  })

  it('caps the length', () => {
    expect(sanitizeCanvasTitle('长'.repeat(200))).toHaveLength(MAX_CANVAS_TITLE_LENGTH)
  })
})

describe('normalizeCanvasId', () => {
  it('accepts the id shape the service mints', () => {
    expect(normalizeCanvasId('canvas_01234567abcdefgh')).toBe('canvas_01234567abcdefgh')
  })

  it('refuses traversal, separators, and foreign prefixes before any path is joined', () => {
    expect(normalizeCanvasId('../etc')).toBeUndefined()
    expect(normalizeCanvasId('canvas_..')).toBeUndefined()
    expect(normalizeCanvasId('canvas_a/b')).toBeUndefined()
    expect(normalizeCanvasId('x_01234567abcdefgh')).toBeUndefined()
    expect(normalizeCanvasId('canvas_SHORT')).toBeUndefined()
    expect(normalizeCanvasId('')).toBeUndefined()
    expect(normalizeCanvasId(7)).toBeUndefined()
  })
})

describe('makeBoardId', () => {
  it('mints a lowercase id that passes its own validation', () => {
    const id = makeBoardId('canvas', Date.UTC(2026, 8, 16), 'ABC123def')
    expect(normalizeCanvasId(id)).toBe(id)
  })

  it('orders lexically by time — the state dir lists chronologically', () => {
    const earlier = makeBoardId('canvas', Date.UTC(2026, 0, 1), 'zzzzzzzzzz')
    const later = makeBoardId('canvas', Date.UTC(2026, 8, 16), '0000000000')
    expect(earlier < later).toBe(true)
  })
})

describe('normalizeBoard', () => {
  it('reads a well-formed file and recomputes the kind counts from the cards', () => {
    const read = normalizeBoard(board(), 'canvas_01234567abcdefgh', NOW)
    expect(read).toMatchObject({
      id: 'canvas_01234567abcdefgh',
      title: '为什么人们不愿表达异议',
      attachedWorkspaces: ['/ws/report'],
      chat: { sessionId: null },
      archivedAt: null,
      stats: { proposed: { accepted: 1, rejected: 2 }, kindCounts: { fragment: 1 } },
    })
  })

  it('refuses a file that is not this canvas — never rewrite the wrong board', () => {
    expect(normalizeBoard(board({ id: 'canvas_other' }), 'canvas_01234567abcdefgh', NOW)).toBeUndefined()
    expect(normalizeBoard(null, 'canvas_01234567abcdefgh', NOW)).toBeUndefined()
    expect(normalizeBoard('nonsense', 'canvas_01234567abcdefgh', NOW)).toBeUndefined()
    expect(normalizeBoard(board({ title: '' }), 'canvas_01234567abcdefgh', NOW)).toBeUndefined()
  })

  it('drops a malformed card and keeps the good ones', () => {
    const read = normalizeBoard(board({ cards: [card(), { no: 'id' }, 'junk', card({ id: 'c_2', kind: 'reference' })] }), 'canvas_01234567abcdefgh', NOW)
    expect(read?.cards.map(entry => entry.id)).toEqual(['c_1', 'c_2'])
  })

  it('defaults a missing status to kept and a foreign createdBy to user', () => {
    const raw = card() as unknown as Record<string, unknown>
    delete raw['status']
    delete raw['createdBy']
    const read = normalizeBoard(board({ cards: [raw] }), 'canvas_01234567abcdefgh', NOW)
    expect(read?.cards[0]).toMatchObject({ status: 'kept', createdBy: 'user' })
  })

  it('gives a question card its open state and drops the state from other kinds', () => {
    const question = { ...card({ id: 'c_q' }), kind: 'question' }
    const fragment = { ...card({ id: 'c_f' }), question: { state: 'answered' } }
    const read = normalizeBoard(board({ cards: [question, fragment] }), 'canvas_01234567abcdefgh', NOW)
    expect(read?.cards[0]?.question).toEqual({ state: 'open' })
    expect(read?.cards[1]?.question).toBeUndefined()
  })

  it('keeps a question state the file already holds', () => {
    const question = { ...card({ id: 'c_q' }), kind: 'question', question: { state: 'answered' } }
    const read = normalizeBoard(board({ cards: [question] }), 'canvas_01234567abcdefgh', NOW)
    expect(read?.cards[0]?.question).toEqual({ state: 'answered' })
  })

  it('filters malformed comments and defaults missing timestamps', () => {
    const withComments = {
      ...card(),
      comments: [
        { id: 'm_1', author: 'agent', text: '这里隐含一个假设' },
        { id: 7, text: 'no id' },
        'junk',
      ],
    }
    delete (withComments as { updatedAt?: string }).updatedAt
    const read = normalizeBoard(board({ cards: [withComments] }), 'canvas_01234567abcdefgh', NOW)
    expect(read?.cards[0]?.comments).toEqual([
      { id: 'm_1', author: 'agent', text: '这里隐含一个假设', createdAt: NOW },
    ])
    expect(read?.cards[0]?.updatedAt).toBe(NOW)
  })

  it('tolerates absent optional sections', () => {
    const bare: Record<string, unknown> = { id: 'canvas_01234567abcdefgh', title: '主题' }
    const read = normalizeBoard(bare, 'canvas_01234567abcdefgh', NOW)
    expect(read).toMatchObject({
      attachedWorkspaces: [],
      chat: { sessionId: null },
      cards: [],
      stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
      archivedAt: null,
    })
  })
})

describe('computeKindCounts + summarizeBoard', () => {
  const cards = [
    card({ id: 'c_1', kind: 'fragment' }),
    card({ id: 'c_2', kind: 'fragment', status: 'proposed' }),
    card({ id: 'c_3', kind: 'fragment', status: 'archived' }),
    card({ id: 'c_4', kind: 'question', question: { state: 'open' } }),
    card({ id: 'c_5', kind: 'question', question: { state: 'exploring' } }),
    card({ id: 'c_6', kind: 'question', question: { state: 'answered' } }),
  ]

  it('counts the visible cards by kind (kept + proposed; archived never)', () => {
    expect(computeKindCounts(cards)).toEqual({ fragment: 2, question: 3 })
  })

  it('projects the list row: visible cards, still-open questions, activity, archive flag', () => {
    const raw = normalizeBoard(board({ cards, archivedAt: NOW }), 'canvas_01234567abcdefgh', NOW)
    if (raw === undefined) throw new Error('expected a readable board')
    const boardValue: CanvasBoard = raw
    expect(summarizeBoard(boardValue)).toEqual({
      id: 'canvas_01234567abcdefgh',
      title: '为什么人们不愿表达异议',
      cardCount: 5,
      openQuestions: 2,
      archivedAt: NOW,
      lastActiveAt: NOW,
    })
  })
})

describe('isLongCardText', () => {
  it('is false for a short card', () => {
    expect(isLongCardText('沉默并不总是因为恐惧')).toBe(false)
  })

  it('is true past the character budget', () => {
    expect(isLongCardText('长'.repeat(241))).toBe(true)
  })

  it('is true past the line budget even when short in characters', () => {
    expect(isLongCardText(Array.from({ length: 7 }, (_, i) => `第${i}行`).join('\n'))).toBe(true)
  })
})

describe('documentHeadingOf', () => {
  it('takes the first markdown heading and drops that line from the body', () => {
    const read = documentHeadingOf('# 大模型心理学：综述\n\n第一段正文。\n## 第二章\n更多。')
    expect(read).toEqual({ title: '大模型心理学：综述', body: '\n第一段正文。\n## 第二章\n更多。' })
  })

  it('skips blank lines before the heading', () => {
    expect(documentHeadingOf('\n\n## 标题\n正文')?.title).toBe('标题')
  })

  it('falls back to the first non-empty line only when no heading exists, and keeps the body whole', () => {
    const read = documentHeadingOf('开篇就是正文。\n紧接的第二行。\n更多。')
    expect(read).toEqual({ title: '开篇就是正文。', body: '开篇就是正文。\n紧接的第二行。\n更多。' })
  })

  it('prefers a later heading over a prose first line', () => {
    expect(documentHeadingOf('开篇是导语。\n# 真正的标题\n正文。')?.title).toBe('真正的标题')
  })

  it('treats a bare hash run as no heading and keeps scanning', () => {
    expect(documentHeadingOf('##\n# 真标题\n正文')?.title).toBe('真标题')
  })

  it('caps the title and reports an empty text', () => {
    expect(documentHeadingOf(`# ${'长'.repeat(100)}`)?.title).toHaveLength(60)
    expect(documentHeadingOf('   \n  ')).toBeUndefined()
  })
})
