/**
 * The pure vocabulary: the quote block a composer insert writes (every line
 * prefixed, the attribution closing the same blockquote) and the draft merge
 * that never overwrites a typed draft.
 */
import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, encodeQuoteRef, formatQuoteBlock, mergedQuoteDraft } from '../src/types.ts'

describe('formatQuoteBlock', () => {
  it('prefixes every quoted line and closes the blockquote with the attribution', () => {
    expect(formatQuoteBlock('第一行\n第二行', '—— 引用自「主会话」'))
      .toBe('> 第一行\n> 第二行\n> —— 引用自「主会话」')
  })

  it('trims surrounding blank space before quoting', () => {
    expect(formatQuoteBlock('  内容 \n', 'attr')).toBe('> 内容\n> attr')
  })

  it('keeps interior blank lines as quoted blank lines', () => {
    expect(formatQuoteBlock('上\n\n下', 'attr')).toBe('> 上\n> \n> 下\n> attr')
  })
})

describe('mergedQuoteDraft', () => {
  it('fills a blank draft directly', () => {
    expect(mergedQuoteDraft('', '> 引用')).toBe('> 引用')
    expect(mergedQuoteDraft('  \n ', '> 引用')).toBe('> 引用')
  })

  it('appends after one blank line when a draft exists, never overwriting it', () => {
    expect(mergedQuoteDraft('已经打的字', '> 引用')).toBe('已经打的字\n\n> 引用')
  })
})

describe('quote ref wire (encodeQuoteRef/decodeQuoteRef)', () => {
  it('round-trips the chip clipboard text (multi-line, quotes, unicode)', () => {
    const text = '\n\n> 第一行\n> —— 引用自「主会话”引号」'
    expect(decodeQuoteRef(encodeQuoteRef(text))).toBe(text)
  })

  it('decodes to undefined on garbage, non-objects, and a missing text field', () => {
    expect(decodeQuoteRef('not json')).toBeUndefined()
    expect(decodeQuoteRef('42')).toBeUndefined()
    expect(decodeQuoteRef('{"v":1}')).toBeUndefined()
  })
})
