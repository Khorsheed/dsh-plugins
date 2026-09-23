/**
 * The model-facing card text contract (the proposal §8 boundary): an HTML
 * card's content NEVER enters the model context in full — the ref and the
 * grounding section carry a pointer (title + card id + size), and the agent
 * asks the user for an excerpt; a long markdown card is capped with the
 * truncation stated. Also the raised cap itself: 256KB lands, the next char
 * truncates. And the thread: a card's 批注 ride its own form (the compose
 * templates tell the model to absorb them), capped to the newest rows with the
 * drop stated — while a comment-less card stays byte for byte what it was.
 */
import { describe, expect, it } from 'vitest'
import {
  cardToRef, COMPOSE_SEND_TEXT, commentPromptOf, drawPromptOf, GROUP_ASK_SEND_TEXT,
  MAX_PROMPT_CARD_CHARS, MAX_PROMPT_COMMENTS, promptFormOf, renderCanvasPrompt,
} from '../src/prompt.ts'
import {
  defaultCategories, MAX_CARD_TEXT_LENGTH,
  type BoardCard, type BoardComment, type CanvasBoard, type CanvasStroke,
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

/** One comment fixture — only the author and the text reach the model. */
function comment(author: BoardComment['author'], text: string): BoardComment {
  return { id: `m_${text.length}`, author, text, createdAt: NOW }
}

/** One stroke fixture: a diagonal pair inside the logical box. */
function stroke(x: number, y: number): CanvasStroke {
  return { pts: [{ x, y, w: 5 }, { x: x + 40.46, y: y + 10, w: 3 }], color: 'ink' }
}

/** One board fixture around one card. */
function boardOf(card: BoardCard): CanvasBoard {
  return {
    id: 'canvas_01234567abcdefgh',
    title: '主题',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards: [card],
    categories: defaultCategories(),
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

  it('says NOTHING for a card nobody has annotated: byte for byte the pre-thread prompt', () => {
    // The package's stability invariant, spelled for all three branches: an
    // empty thread emits no block, no leading newline, no count.
    const text = '长'.repeat(MAX_PROMPT_CARD_CHARS + 7)
    expect(promptFormOf(card('沉默并不总是因为恐惧'))).toBe('沉默并不总是因为恐惧')
    expect(promptFormOf(card('沉默并不总是因为恐惧', { draw: [stroke(10, 10)] })))
      .toBe('沉默并不总是因为恐惧\n<board width="600" height="400" strokes="1">\n10.0,10.0,5.0 50.5,20.0,3.0\n</board>')
    expect(promptFormOf(card(text))).toBe(`${text.slice(0, MAX_PROMPT_CARD_CHARS)}\n…(truncated, full text ${text.length} chars on card c_1)`)
    expect(promptFormOf(card(HTML_DOC))).toBe('[html] 三次排期反馈记录 — HTML document, '
      + `${HTML_DOC.length} chars, on canvas card c_1; ask the user to paste an excerpt when its content is needed`)
    expect(commentPromptOf(card('沉默', { comments: [] }))).toBe('')
  })
})

describe('the drawing in the model-facing form (§11.4)', () => {
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

describe('the comment thread in the model-facing form (stage ⑥)', () => {
  it('hangs the thread on the card: one row per comment, author spelled', () => {
    const out = promptFormOf(card('沉默并不总是因为恐惧', {
      comments: [
        comment('agent', '这里隐含一个假设：效能感比恐惧解释力更强。有数据吗？'),
        comment('user', '有，7/02 的排期记录里就是这句话'),
      ],
    }))
    expect(out).toBe('沉默并不总是因为恐惧\n<comments>\n'
      + '- agent: 这里隐含一个假设：效能感比恐惧解释力更强。有数据吗？\n'
      + '- user: 有，7/02 的排期记录里就是这句话\n'
      + '</comments>')
  })

  it('rides AFTER the <board> block: the words, then the ink, then the argument about them', () => {
    const out = promptFormOf(card('沉默并不总是因为恐惧', {
      draw: [stroke(10, 10)],
      comments: [comment('user', '这条已经被推翻')],
    }))
    expect(out.indexOf('沉默')).toBe(0)
    expect(out.indexOf('\n<board')).toBeLessThan(out.indexOf('\n<comments'))
    expect(out.endsWith('- user: 这条已经被推翻\n</comments>')).toBe(true)
  })

  it('keeps the newest rows at the cap and states the drop inside the block', () => {
    const comments = Array.from({ length: MAX_PROMPT_COMMENTS + 3 }, (_unused, index) => comment('user', `第${index}条`))
    const out = promptFormOf(card('沉默并不总是因为恐惧', { comments }))
    expect(out).toBe([
      '沉默并不总是因为恐惧',
      '<comments>',
      `- …(truncated, ${comments.length} comments on card c_1; newest ${MAX_PROMPT_COMMENTS} shown)`,
      ...comments.slice(-MAX_PROMPT_COMMENTS).map(row => `- user: ${row.text}`),
      '</comments>',
    ].join('\n'))
    // The head of a chronological thread is the dropped end: the recent end is
    // the argument, and a 50-comment card cannot dump the board.
    expect(out).not.toContain('第0条')
  })

  it('says nothing about a cap it never reached', () => {
    const comments = Array.from({ length: MAX_PROMPT_COMMENTS }, (_unused, index) => comment('agent', `第${index}条`))
    const out = promptFormOf(card('沉默并不总是因为恐惧', { comments }))
    expect(out).not.toContain('truncated')
    expect(out.match(/^- /gm)).toHaveLength(MAX_PROMPT_COMMENTS)
  })

  it('keeps an HTML card a pointer while its thread still rides — 生成文章 must not go silent', () => {
    const out = promptFormOf(card(HTML_DOC, { comments: [comment('user', '第二段推翻了我的理解')] }))
    expect(out).toBe('[html] 三次排期反馈记录 — HTML document, '
      + `${HTML_DOC.length} chars, on canvas card c_1; ask the user to paste an excerpt when its content is needed`
      + '\n<comments>\n- user: 第二段推翻了我的理解\n</comments>')
    expect(out).not.toContain('<table>')
  })

  it('lands after the text-cap note, never inside the capped slice', () => {
    const text = '长'.repeat(MAX_PROMPT_CARD_CHARS + 20)
    const out = promptFormOf(card(text, { comments: [comment('agent', '推翻第二条')] }))
    expect(out).toContain(`…(truncated, full text ${text.length} chars on card c_1)\n<comments>\n- agent: 推翻第二条\n</comments>`)
  })

  it('is not a summary: the board line stays the card, never its thread', () => {
    const segment = renderCanvasPrompt(boardOf(card('沉默并不总是因为恐惧', {
      comments: [comment('agent', '隐含一个假设')],
    })))
    expect(segment).toContain('- [reference] 沉默并不总是因为恐惧')
    expect(segment).not.toContain('隐含一个假设')
  })
})

describe('cardToRef', () => {
  it('labels from the <title> for HTML cards and leaks no body', () => {
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

  it('carries the thread: 生成文章 over the batch bar reads exactly this text', () => {
    const ref = cardToRef(card('沉默并不总是因为恐惧', { kind: 'fragment' }), 'fragment（灵感）')
    expect(ref.text).toBe('[fragment（灵感）] 沉默并不总是因为恐惧')
    const annotated = cardToRef(card('沉默并不总是因为恐惧', {
      kind: 'fragment',
      comments: [comment('agent', '这条把沉默归因给恐惧')],
    }))
    expect(annotated.text).toContain('<comments>\n- agent: 这条把沉默归因给恐惧\n</comments>')
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

  it('a guardrail card still carries its 批注: the thread is the user revising the stance', () => {
    const segment = renderCanvasPrompt(boardOf(card(HTML_DOC, {
      kind: 'grounding',
      comments: [comment('user', '这条只在工作区范围内成立')],
    })))
    expect(segment).toContain('<comments>\n- user: 这条只在工作区范围内成立\n</comments>')
    expect(segment).not.toContain('<table>')
  })
})

describe('the raised card cap', () => {
  it('is 256KB', () => {
    expect(MAX_CARD_TEXT_LENGTH).toBe(256_000)
  })
})

/**
 * The two compose send-texts are the model's instructions, so they are pinned
 * verbatim: rewording one is a change to what the model is told, not a copy
 * edit — it has to show up here as a failing assertion.
 */
describe('the stage ⑥ compose send-texts', () => {
  it('「生成文章」 asks for a draft and names the 批注 as revision notes', () => {
    expect(COMPOSE_SEND_TEXT).toBe('【生成文章】以这些卡片为材料写一篇成稿：保留卡片里的判断，把批注当作修改意见吸收进正文，被批注推翻的那条不要再写；结构自己定；末尾列出哪些卡片没有用到。')
  })

  it('「就这一组提问」 asks about the linked cluster as one argument', () => {
    // The prototype's line broke off mid-clause（「能把链接上的卡」）; the verb it
    // was reaching for is the whole point of the gesture, so the sentence is
    // completed here rather than carried forward broken.
    expect(GROUP_ASK_SEND_TEXT).toBe('【就这一组提问】这几张卡已被连线连成一簇：把它们当作同一论证的几段，指出这条链断在哪一步，并提议一张能把它们接起来的卡。')
  })
})
