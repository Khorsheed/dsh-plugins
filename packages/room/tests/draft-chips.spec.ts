/**
 * The room composer's chip mapping: the typed text around reference chips,
 * a chip's detect index, and free-text edits planned as detect-span
 * replacements that never delete a chip outside the edited range.
 */
import { describe, expect, it } from 'vitest'
import { chipDetectIndex, draftSegments, freeText, planFreeEdit, type DraftChip } from '../src/client/draft-chips.ts'

/** A chip occupying `[offset, offset+length)` of the clipboard projection. */
const chip = (offset: number, length: number, id = offset): DraftChip =>
  ({ occurrenceId: id, source: 'quote', ref: `r${id}`, offset, length, label: `L${id}` })

// 'ab' + a 7-char chip + ' cd'.
const DRAFT = 'ab[QUOTE] cd'
const CHIPS = [chip(2, 7)]

describe('draft segments', () => {
  it('splits the typed text around the chips and drops the chip text', () => {
    expect(draftSegments(DRAFT, CHIPS)).toEqual(['ab', ' cd'])
    expect(freeText(DRAFT, CHIPS)).toBe('ab cd')
    expect(freeText('plain', [])).toBe('plain')
  })

  it('locates each chip in detect coordinates (earlier chips fold to one char)', () => {
    const draft = 'x[AAA]y[BB]'
    const chips = [chip(1, 5, 1), chip(7, 4, 2)]
    expect(chipDetectIndex(draft, chips, 0)).toBe(1)
    expect(chipDetectIndex(draft, chips, 1)).toBe(3)
  })
})

describe('planFreeEdit', () => {
  it('plans nothing for an unchanged text', () => {
    expect(planFreeEdit(DRAFT, CHIPS, 'ab cd')).toEqual([])
  })

  it('types after the chip in the tail segment', () => {
    // free 'ab cd' → 'ab cde': index 5 is in the tail (k=1) → detect 6.
    expect(planFreeEdit(DRAFT, CHIPS, 'ab cde')).toEqual([{ start: 6, end: 6, text: 'e' }])
  })

  it('types BEFORE the chip on its boundary (keeps a quote block closed)', () => {
    // free index 2 is both the end of 'ab' and the start of ' cd' → before the chip.
    expect(planFreeEdit(DRAFT, CHIPS, 'abX cd')).toEqual([{ start: 2, end: 2, text: 'X' }])
  })

  it('a deletion swept across a chip deletes text on both sides, never the chip', () => {
    // 'ab cd' → 'ad': removes 'b' (k=0, detect 1..2) and ' c' (k=1, free 2..4 → detect 3..5).
    expect(planFreeEdit(DRAFT, CHIPS, 'ad')).toEqual([
      { start: 3, end: 5, text: '' },
      { start: 1, end: 2, text: '' },
    ])
  })

  it('a replacement lands where it starts and clears the rest last-first', () => {
    // Select-all and type: 'ab cd' → 'Z'.
    expect(planFreeEdit(DRAFT, CHIPS, 'Z')).toEqual([
      { start: 3, end: 6, text: '' },
      { start: 0, end: 2, text: 'Z' },
    ])
  })
})
