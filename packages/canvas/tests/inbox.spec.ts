/**
 * The canvas inbox (client/inbox.ts): another plugin's way to put a kept card
 * on a canvas the user chose. Lands as 灵感 unless told otherwise; a canvas
 * that retired 灵感 answers with the categories it takes instead of guessing.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCanvasInbox, type CanvasInboxRemote } from '../src/client/inbox.ts'

const ok = <T,>(value: T) => ({ ok: true as const, value })

function remote(categories: { id: string; label: string; enabled: boolean }[]) {
  const putCard = vi.fn(async (_sessionId: string, request: { kind: string; text: string }) => ok({
    ok: true as const,
    version: 'v2',
    board: { categories, cards: [{ id: 'old' }, { id: 'new', kind: request.kind, text: request.text }] },
  }))
  const face = {
    listCanvases: async () => ok({ items: [
      { id: 'a', title: 'A', cardCount: 1, openQuestions: 0, archivedAt: null, lastActiveAt: '2026-10-01' },
      { id: 'b', title: 'B', cardCount: 2, openQuestions: 0, archivedAt: null, lastActiveAt: '2026-10-19' },
      { id: 'z', title: 'Z', cardCount: 9, openQuestions: 0, archivedAt: '2026-09-01', lastActiveAt: '2026-10-20' },
    ] }),
    readBoard: async () => ok({ ok: true as const, version: 'v1', board: { categories, cards: [] } }),
    putCard,
  }
  return { face: face as unknown as CanvasInboxRemote, putCard }
}

describe('the canvas inbox', () => {
  it('lists live canvases, most recently active first', async () => {
    const { face } = remote([])
    const inbox = createCanvasInbox(() => face, category => category.label, () => null, () => undefined)
    expect((await inbox.listCanvases()).map(item => item.id)).toEqual(['b', 'a'])
  })

  it('lands a kept 灵感 card and answers its id', async () => {
    const { face, putCard } = remote([{ id: 'fragment', label: '', enabled: true }])
    const inbox = createCanvasInbox(() => face, category => category.label, () => null, () => undefined)
    const outcome = await inbox.addCard('s1' as never, { canvasId: 'b', text: 'hello', source: { type: 'url', ref: 'https://x' } })
    expect(outcome).toEqual({ ok: true, cardId: 'new' })
    expect(putCard).toHaveBeenCalledWith('s1', { canvasId: 'b', kind: 'fragment', text: 'hello', source: { type: 'url', ref: 'https://x' } })
  })

  it('asks for a category when the canvas retired 灵感', async () => {
    const { face, putCard } = remote([
      { id: 'fragment', label: '', enabled: false },
      { id: 'cat_abcdefghi', label: '人物', enabled: true },
    ])
    const inbox = createCanvasInbox(() => face, category => category.label, () => null, () => undefined)
    expect(await inbox.addCard('s1' as never, { canvasId: 'b', text: 'x' })).toEqual({
      ok: false, error: 'needs-kind', kinds: [{ id: 'cat_abcdefghi', label: '人物' }],
    })
    expect(putCard).not.toHaveBeenCalled()
    expect(await inbox.addCard('s1' as never, { canvasId: 'b', text: 'x', kind: 'cat_abcdefghi' })).toEqual({ ok: true, cardId: 'new' })
  })
})
