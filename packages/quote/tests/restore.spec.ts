/**
 * Quote blocks arriving whole in a draft (a withdrawal's refill, an edit, a
 * paste) turn back into chips: detection is bounded to the span one change
 * inserted, typing never triggers it, and the restore inserts the same chip
 * 引用到当前会话 does, last first, in detect coordinates.
 */
import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, QUOTE_REFERENCE_SOURCE } from '../src/types.ts'
import type { QuoteBailScope, QuoteInsertReferenceRequest, QuoteInputSnapshot } from '../src/client/reference.ts'
import { arrivedBlocks, restoreQuoteChips } from '../src/client/restore.ts'

const LOCATED = '> 正文\n> —— 引用自「README.md」（/home/user/r/README.md）'
const BARE = '> 对话里的一句话\n> —— 引用'

describe('arrivedBlocks', () => {
  it('finds a block a refill inserted whole, the closing newline included', () => {
    const next = `${BARE}\n 我的问题`
    expect(arrivedBlocks('', next)).toEqual([
      { start: 0, end: BARE.length + 1, clipboardText: `${BARE}\n`, label: '对话里的一句话' },
    ])
  })

  it('names a located block by its source label', () => {
    expect(arrivedBlocks('', LOCATED)[0]).toMatchObject({ start: 0, end: LOCATED.length, label: 'README.md' })
  })

  it('never triggers on typing (the block completes one keystroke at a time)', () => {
    const almost = BARE.slice(0, -1)
    expect(arrivedBlocks(almost, BARE)).toEqual([])
  })

  it('ignores a block already in the draft and one inside an existing chip', () => {
    expect(arrivedBlocks(BARE, `${BARE}\n加一句`)).toEqual([])
    expect(arrivedBlocks('', BARE, [{ offset: 0, length: BARE.length }])).toEqual([])
  })

  it('finds two blocks pasted in one go', () => {
    const next = `${BARE}\n中间\n${LOCATED}`
    expect(arrivedBlocks('', next).map(block => block.label)).toEqual(['对话里的一句话', 'README.md'])
  })
})

describe('restoreQuoteChips', () => {
  it('replaces each block with a chip, last first, folding earlier chips to one char', () => {
    const calls: QuoteInsertReferenceRequest[] = []
    const scope: QuoteBailScope = { bail: (_self, _event, payload) => { calls.push(payload); return true } }
    // An unrelated chip (5 clipboard chars) sits before the refilled text.
    const draft = `[ref]\n\n${BARE}\n 问`
    const snapshot: QuoteInputSnapshot = { draft, draftRev: 4, occurrences: [{ offset: 0, length: 5 }] }
    const blocks = arrivedBlocks('[ref]', draft, snapshot.occurrences)
    expect(restoreQuoteChips(scope, () => snapshot, blocks, label => `引用「${label}」`)).toBe(1)
    const { reference, span } = calls[0]!
    expect(reference.source).toBe(QUOTE_REFERENCE_SOURCE)
    expect(reference.label).toBe('引用「对话里的一句话」')
    expect(reference.clipboardText).toBe(`${BARE}\n`)
    expect(decodeQuoteRef(reference.ref)).toEqual({ text: `${BARE}\n`, label: '引用「对话里的一句话」' })
    // Clipboard 7..7+len+1 → detect minus the chip's 4 folded chars.
    expect(span).toEqual({ start: 3, end: 3 + BARE.length + 1, draftRev: 4 })
  })
})
