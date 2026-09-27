/**
 * The quote blocks the canvas writes into the main conversation's input
 * (「与 Agent 对谈」, 「开始写作」, 「追问」): the card's words as a blockquote,
 * the attribution line that names the card's handle, the html pointer, the
 * length cut, the comment window, and the read-merge with a draft the user
 * already typed.
 */
import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import {
  MAX_QUOTE_CARD_CHARS, MAX_QUOTE_COMMENTS, cardQuoteOf, cardsQuoteOf, commentQuoteOf, mergedDraft,
} from '../src/client/quote.ts'
import type { BoardCard, BoardComment } from '../src/types.ts'

const NOW = '2026-09-27T08:00:00.000Z'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as TranslateNS<'canvas'>

function card(id: string, overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id, kind: 'fragment', text: `卡片 ${id}`, status: 'kept', comments: [],
    createdBy: 'user', createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function comment(id: string, text: string, author: 'user' | 'agent' = 'user'): BoardComment {
  return { id, author, text, createdAt: NOW }
}

const where = { canvasTitle: '雨夜', kindLabel: '碎片' }

describe('cardQuoteOf', () => {
  it('quotes every line of the words, then names the canvas, the category and the handle', () => {
    const block = cardQuoteOf(t, card('c_1', { text: '第一行\n\n第三行' }), where)
    expect(block).toBe(`> 第一行\n>\n> 第三行\n\n${t('quote.source', { canvas: '雨夜', kind: '碎片', id: 'c_1' })}`)
  })

  it('points at an html card instead of pasting the page', () => {
    const html = '<!DOCTYPE html><html><head><title>报告</title></head><body><p>正文</p></body></html>'
    const block = cardQuoteOf(t, card('c_h', { kind: 'document', text: html }), where)
    expect(block).not.toContain('<p>')
    expect(block).toContain(t('quote.html', { title: '报告', count: String(html.length) }))
  })

  it('cuts a long card and states its full length', () => {
    const text = '字'.repeat(MAX_QUOTE_CARD_CHARS + 50)
    const block = cardQuoteOf(t, card('c_l', { text }), where)
    expect(block).toContain(`${'字'.repeat(MAX_QUOTE_CARD_CHARS)}…`)
    expect(block).not.toContain('字'.repeat(MAX_QUOTE_CARD_CHARS + 1))
    expect(block).toContain(t('quote.truncated', { count: String(text.length) }))
  })

  it('says a drawing is there, and carries only the newest comments', () => {
    const comments = Array.from({ length: MAX_QUOTE_COMMENTS + 2 }, (_, index) => comment(`m_${index}`, `评论${index}`))
    const block = cardQuoteOf(t, card('c_d', {
      text: '',
      draw: [{ tool: 'pen', color: '#000', width: 2, points: [[0, 0], [1, 1]] }] as unknown as BoardCard['draw'],
      comments,
    }), where)
    expect(block).toContain(t('quote.draw', { strokes: '1' }))
    expect(block).not.toContain('评论0')
    expect(block).not.toContain('评论1\n')
    expect(block).toContain(`评论${MAX_QUOTE_COMMENTS + 1}`)
  })
})

describe('cardsQuoteOf / commentQuoteOf', () => {
  it('joins cards in the order given, a blank line apart', () => {
    const block = cardsQuoteOf(t, [
      { card: card('c_2'), kindLabel: '碎片' },
      { card: card('c_1'), kindLabel: '问题' },
    ], '雨夜')
    expect(block.indexOf('c_2')).toBeLessThan(block.indexOf('c_1'))
    expect(block).toContain(t('quote.source', { canvas: '雨夜', kind: '问题', id: 'c_1' }))
  })

  it('quotes the comment and names the card it hangs on', () => {
    const block = commentQuoteOf(t, '这里隐含一个假设', card('c_1', { text: '效能假说\n正文' }), '雨夜')
    expect(block).toBe(`> 这里隐含一个假设\n\n${t('quote.commentSource', { canvas: '雨夜', card: '效能假说', id: 'c_1' })}`)
  })
})

describe('mergedDraft', () => {
  it('takes the block as the whole draft when nothing was typed', () => {
    expect(mergedDraft('', '> a')).toBe('> a')
    expect(mergedDraft('  \n', '> a')).toBe('> a')
  })

  it('keeps what the user typed and puts the block a blank line after it', () => {
    expect(mergedDraft('帮我看看\n\n', '> a')).toBe('帮我看看\n\n> a')
  })
})
