/**
 * The model-facing card text contract (the proposal §8 boundary): an HTML
 * card's content NEVER enters the model context in full — the ref and the
 * grounding section carry a pointer (title + card id + size), and the agent
 * asks the user for an excerpt; a long markdown card is capped with the
 * truncation stated. Also the raised cap itself: 256KB lands, the next char
 * truncates.
 */
import { describe, expect, it } from 'vitest'
import { cardToRef, drawPromptOf, MAX_PROMPT_CARD_CHARS, promptFormOf, renderCanvasPrompt } from '../src/prompt.ts'
import {
  MAX_CARD_TEXT_LENGTH, type BoardCard, type CanvasBoard, type CanvasStroke,
} from '../src/types.ts'

const NOW = '2026-09-16T08:00:00.000Z'

/** One card fixture. */
function card(text: string, overrides: Record<string, unknown> = {}): BoardCard {
  return {
    id: 'c_1',
    kind: 'reference',
    text,
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as BoardCard
}

/** One board fixture around one card. */
function boardOf(card: BoardCard): CanvasBoard {
  return {
    id: 'canvas_01234567abcdefgh',
    title: '主题',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards: [card],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const HTML_DOC = `<!DOCTYPE html><html><head><title>三次排期反馈记录</title></head><body><table><tr><td>7/02</td><td>排期过紧</td></tr></table><p>沉默的代价</p></body></html>`

describe('promptFormOf — the model-facing form', () => {
  it('an HTML card is a pointer: title + size + card id, and ZERO body bytes', () => {
    const out = promptFormOf(card(HTML_DOC))
    expect(out).toContain('[html]')
    expect(out).toContain('三次排期反馈记录')
    expect(out).toContain(String(HTML_DOC.length))
    expect(out).toContain('c_1')
    // The boundary itself: no markup, no content words from the body.
    expect(out).not.toContain('<!DOCTYPE')
    expect(out).not.toContain('<table>')
    expect(out).not.toContain('排期过紧')
    expect(out).not.toContain('沉默的代价')
  })

  it('an HTML card without a <title> falls back to its first line', () => {
    const out = promptFormOf(card('<html><body><p>仅正文</p><p>第二段</p></body></html>'))
    expect(out).toContain('[html]')
    expect(out).not.toContain('<p>')
  })

  it('a short markdown card carries its full text', () => {
    expect(promptFormOf(card('沉默并不总是因为恐惧'))).toBe('沉默并不总是因为恐惧')
  })

  it('a long markdown card is capped with the truncation stated', () => {
    const text = '长'.repeat(MAX_PROMPT_CARD_CHARS + 100)
    const out = promptFormOf(card(text))
    expect(out).toHaveLength(MAX_PROMPT_CARD_CHARS + `\n…(truncated, full text ${text.length} chars on card c_1)`.length)
    expect(out).toContain(`…(truncated, full text ${text.length} chars on card c_1)`)
    expect(out.startsWith('长'.repeat(100))).toBe(true)
  })
})

describe('the drawing in the model-facing form (§11.4)', () => {
  const stroke = (x: number, y: number): CanvasStroke => ({
    pts: [{ x, y, w: 5 }, { x: x + 40.46, y: y + 10, w: 3 }],
    color: 'ink',
  })

  it('hands the points over, in the logical box, one line per stroke', () => {
    const block = drawPromptOf([stroke(0, 0), stroke(200, 100)])
    expect(block).toContain('<board width="600" height="400" strokes="2">')
    expect(block).toContain('0.0,0.0,5.0 40.5,10.0,3.0')
    expect(block).toContain('200.0,100.0,5.0 240.5,110.0,3.0')
    // The block opens with a newline (it is appended after the card's words):
    // header, one line per stroke, close.
    expect(block.trim().split('\n')).toHaveLength(4)
  })

  it('says nothing when there is nothing inked', () => {
    expect(drawPromptOf([])).toBe('')
  })

  it('rides along with a plain card, after its text', () => {
    const out = promptFormOf(card('沉默并不总是因为恐惧', { draw: [stroke(10, 10)] }))
    expect(out.startsWith('沉默并不总是因为恐惧\n<board')).toBe(true)
  })

  it('is content on its own: a card with no words still reports its ink', () => {
    const out = promptFormOf(card('', { draw: [stroke(10, 10)] }))
    expect(out).toContain('<board')
    expect(out).not.toContain('undefined')
  })

  it('stays with an HTML pointer, because the ink is not the part being pointed out', () => {
    const out = promptFormOf(card(HTML_DOC, { draw: [stroke(10, 10)] }))
    expect(out).toContain('[html]')
    expect(out).not.toContain('<table>')
    expect(out).toContain('<board')
  })

  it('summarizes a drawing-only card by its strokes, not by a blank line', () => {
    const segment = renderCanvasPrompt(boardOf(card('', { draw: [stroke(1, 1), stroke(2, 2)] })))
    expect(segment).toContain('2-stroke drawing')
  })
})

describe('cardToRef', () => {  it('labels from the <title> for HTML cards and leaks no body', () => {
    const ref = cardToRef(card(HTML_DOC))
    expect(ref.label).toBe('三次排期反馈记录')
    expect(ref.text).toBe(promptFormOf(card(HTML_DOC)).replace(/^/, '[reference] '))
    expect(ref.text).not.toContain('<!DOCTYPE')
    expect(ref.text).not.toContain('<table>')
  })

  it('caps a long markdown card with the truncation note inside the ref', () => {
    const text = '碎'.repeat(MAX_PROMPT_CARD_CHARS + 50)
    const ref = cardToRef(card(text, { kind: 'fragment' }))
    expect(ref.text).toContain(`…(truncated, full text ${text.length} chars on card c_1)`)
    expect(ref.text.startsWith('[fragment] ')).toBe(true)
  })
})

describe('renderCanvasPrompt — the grounding guardrail is pointer-safe too', () => {
  it('an HTML grounding card enters the segment as a pointer, never the document', () => {
    const groundingCard = card(HTML_DOC, { kind: 'grounding' })
    const segment = renderCanvasPrompt(boardOf(groundingCard))
    expect(segment).toContain('[html]')
    expect(segment).toContain('三次排期反馈记录')
    expect(segment).not.toContain('<!DOCTYPE')
    expect(segment).not.toContain('<table>')
    expect(segment).not.toContain('排期过紧')
  })
})

describe('the raised card cap', () => {
  it('is 256KB', () => {
    expect(MAX_CARD_TEXT_LENGTH).toBe(256_000)
  })
})
