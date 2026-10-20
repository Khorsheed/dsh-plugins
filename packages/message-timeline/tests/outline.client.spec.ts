/**
 * The turnOutline wire narrow: absent and malformed values read as
 * "capability absent" (the caller degrades to window paging), damaged
 * load-bearing fields drop their entry, and decorative fields degrade to ''.
 */
import { describe, expect, it } from 'vitest'
import { outlineEntries } from '../src/client/outline.ts'

/** One well-formed wire entry. */
function entry(turn: number, seq: number, prompt = `消息${turn}`, response = '') {
  return { turn, seq, prompt, response }
}

describe('outlineEntries', () => {
  it('reads undefined and non-array values as capability-absent', () => {
    expect(outlineEntries(undefined)).toBeUndefined()
    expect(outlineEntries(null)).toBeUndefined()
    expect(outlineEntries('turnOutline')).toBeUndefined()
    expect(outlineEntries({ turns: [] })).toBeUndefined()
  })

  it('passes a well-formed wire value through in order', () => {
    expect(outlineEntries([entry(0, 10), entry(1, 20)])).toEqual([entry(0, 10), entry(1, 20)])
  })

  it('narrows an empty array to an empty outline (a session without turns)', () => {
    expect(outlineEntries([])).toEqual([])
  })

  it('drops entries whose turn or seq is damaged and keeps the rest', () => {
    expect(outlineEntries([
      entry(0, 10),
      { turn: '1', seq: 20, prompt: 'x', response: '' },
      { turn: 2, seq: -1, prompt: 'x', response: '' },
      { turn: 3, seq: 30.5, prompt: 'x', response: '' },
      { turn: 1.5, seq: 15, prompt: 'x', response: '' },
      null,
      entry(4, 40),
    ])).toEqual([entry(0, 10), entry(4, 40)])
  })

  it('defaults damaged previews to empty strings instead of dropping the entry', () => {
    expect(outlineEntries([{ turn: 0, seq: 10, prompt: 7, response: null }])).toEqual([
      { turn: 0, seq: 10, prompt: '', response: '' },
    ])
  })
})
