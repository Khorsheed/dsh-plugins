import { describe, expect, it } from 'vitest'
import { previewText } from '../src/client/preview.ts'

describe('previewText', () => {
  it('joins every text block with newlines', () => {
    expect(previewText([
      { type: 'text', text: '第一行' },
      { type: 'text', text: '第二行' },
    ])).toBe('第一行\n第二行')
  })

  it('skips non-text and empty text blocks', () => {
    expect(previewText([
      { type: 'image', attachment: null as never },
      { type: 'text', text: '' },
      { type: 'text', text: '有内容' },
    ])).toBe('有内容')
  })

  it('returns null when the message carries no text', () => {
    expect(previewText([])).toBeNull()
    expect(previewText([{ type: 'image', attachment: null as never }])).toBeNull()
  })
})
