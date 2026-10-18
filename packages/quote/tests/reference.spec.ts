/**
 * The quote reference chip path: the end-of-draft span math (clipboard →
 * detect projection fold), the blank-line prefix riding inside the chip's
 * clipboard text, the rev-race retry, the decline → false contract arming
 * the plain-text fallback, and the codec's refuse-on-corruption (never a
 * silent downgrade).
 */
import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, QUOTE_REFERENCE_SOURCE } from '../src/types.ts'
import {
  insertQuoteChip, quoteReferenceCodec, quoteTriggerSource, type QuoteBailScope, type QuoteChipInput,
  type QuoteInputSnapshot,
} from '../src/client/reference.ts'

/** A fake session scope whose bail answer is scripted. */
function scopeWith(answers: readonly boolean[]): QuoteBailScope & { calls: { reference: { source: string; ref: string; label: string; clipboardText: string }; span: { start: number; end: number; draftRev: number } }[] } {
  let index = 0
  const calls: { reference: { source: string; ref: string; label: string; clipboardText: string }; span: { start: number; end: number; draftRev: number } }[] = []
  return {
    calls,
    bail(self, event, payload) {
      expect(self).toBe(this)
      expect(event).toBe('slash/input-insert-reference')
      calls.push(payload)
      return answers[Math.min(index++, answers.length - 1)]
    },
  }
}

/** A fake input face publishing the given snapshot. */
function inputWith(snapshot: QuoteInputSnapshot): QuoteChipInput {
  return { state: { getSnapshot: () => snapshot } }
}

describe('insertQuoteChip', () => {
  it('inserts at the end of a blank draft with no prefix', () => {
    const scope = scopeWith([true])
    const applied = insertQuoteChip(scope, inputWith({ draft: '', draftRev: 3, occurrences: [] }), '> 引用\n> —— 引用自「A」', '引用「A」')
    expect(applied).toBe(true)
    expect(scope.calls).toHaveLength(1)
    const { reference, span } = scope.calls[0]!
    expect(reference.source).toBe(QUOTE_REFERENCE_SOURCE)
    expect(reference.label).toBe('引用「A」')
    expect(reference.clipboardText).toBe('> 引用\n> —— 引用自「A」')
    expect(decodeQuoteRef(reference.ref)).toBe(reference.clipboardText)
    expect(span).toEqual({ start: 0, end: 0, draftRev: 3 })
  })

  it('appends to a non-blank draft with the blank-line prefix inside the chip', () => {
    const scope = scopeWith([true])
    insertQuoteChip(scope, inputWith({ draft: '已经打的字', draftRev: 7, occurrences: [] }), '> 引用', '引用「A」')
    expect(scope.calls[0]!.reference.clipboardText).toBe('\n\n> 引用')
    expect(scope.calls[0]!.span).toEqual({ start: 5, end: 5, draftRev: 7 })
  })

  it('folds existing chips out of the end coordinate (clipboard → detect projection)', () => {
    const scope = scopeWith([true])
    // draft = 'ab' + one chip whose clipboard text is 5 long + 'c' → 8 clipboard
    // chars, while the detect projection folds the chip to 1: end = 8 − (5−1).
    insertQuoteChip(scope, inputWith({ draft: 'ab_____c', draftRev: 1, occurrences: [{ length: 5 }] }), '> 引用', 'L')
    expect(scope.calls[0]!.span.start).toBe(4)
  })

  it('retries once with a fresh snapshot when the CAS declines, then reports false', () => {
    const scope = scopeWith([false, true])
    const applied = insertQuoteChip(scope, inputWith({ draft: '', draftRev: 0, occurrences: [] }), '> 引用', 'L')
    expect(applied).toBe(true)
    expect(scope.calls).toHaveLength(2)
    const declinedTwice = scopeWith([false, false])
    expect(insertQuoteChip(declinedTwice, inputWith({ draft: '', draftRev: 0, occurrences: [] }), '> 引用', 'L')).toBe(false)
    expect(declinedTwice.calls).toHaveLength(2)
  })

  it('treats a missing occurrences field (old hosts) as no chips', () => {
    const scope = scopeWith([true])
    insertQuoteChip(scope, inputWith({ draft: 'abc', draftRev: 2 }), '> 引用', 'L')
    expect(scope.calls[0]!.span.start).toBe(3)
  })
})

describe('quoteReferenceCodec', () => {
  it('projects and serializes to exactly the chip clipboard text', async () => {
    const scope = scopeWith([true])
    insertQuoteChip(scope, inputWith({ draft: '已有', draftRev: 0, occurrences: [] }), '> 引用块', 'L')
    const ref = scope.calls[0]!.reference.ref
    expect(quoteReferenceCodec.clipboardText(ref)).toBe('\n\n> 引用块')
    await expect(quoteReferenceCodec.serialize(ref, new AbortController().signal)).resolves.toBe('\n\n> 引用块')
  })

  it('refuses a corrupt ref at serialize (the send blocks, never downgrades)', async () => {
    await expect(quoteReferenceCodec.serialize('garbage', new AbortController().signal)).rejects.toThrow()
  })
})

describe('quoteTriggerSource (the headless codec carrier)', () => {
  it('never produces a menu row and never claims a pick', async () => {
    expect(quoteTriggerSource.name).toBe(QUOTE_REFERENCE_SOURCE)
    await expect(quoteTriggerSource.candidates()).resolves.toEqual([])
    expect(quoteTriggerSource.onPick()).toBeUndefined()
  })
})
