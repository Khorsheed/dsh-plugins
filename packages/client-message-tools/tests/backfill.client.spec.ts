import { describe, expect, it } from 'vitest'
import { mergedDraft } from '../src/client/backfill.ts'

describe('mergedDraft', () => {
  it('fills an empty draft directly', () => {
    expect(mergedDraft('', '原文')).toBe('原文')
  })

  it('treats a blank draft as empty', () => {
    expect(mergedDraft('   ', '原文')).toBe('原文')
  })

  it('appends on a new line when the draft has content', () => {
    expect(mergedDraft('写到一半', '原文')).toBe('写到一半\n原文')
  })
})
