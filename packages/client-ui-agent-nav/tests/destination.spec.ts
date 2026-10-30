/**
 * The destination line: written, read back, stripped; malformed lines and
 * lines not at a line start are ignored.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK, destinationLine, readDestinations, stripDestinations, withDestination } from '../src/destination.ts'

const chapter = { id: 'canvas:c1:ch3:1', kind: 'canvas', params: { canvasId: 'c1', face: 'manuscripts', item: '3', focus: 'plan' }, label: '第 3 章《雨夜》' }

describe('destination line', () => {
  it('round-trips through an answer, as text or content blocks', () => {
    const answer = withDestination('已登记第 3 章《雨夜》。', chapter)
    expect(answer.split('\n')[1]!.startsWith(NAV_MARK)).toBe(true)
    expect(readDestinations(answer)).toEqual([chapter])
    expect(readDestinations([{ type: 'text', text: answer }, { type: 'image' }])).toEqual([chapter])
    expect(stripDestinations(answer)).toBe('已登记第 3 章《雨夜》。')
  })

  it('reads several, and skips malformed ones and marks inside prose', () => {
    const other = { id: 'canvas:c1:board', kind: 'canvas', params: { canvasId: 'c1' }, label: '画布' }
    const text = [
      '答复',
      destinationLine(chapter),
      `${NAV_MARK}{not json`,
      `${NAV_MARK}{"id":"x","kind":"canvas"}`,
      `说明里提到 ${NAV_MARK}{"id":"y","kind":"canvas","params":{}}`,
      destinationLine(other),
    ].join('\n')
    expect(readDestinations(text).map(row => row.id)).toEqual([chapter.id, other.id])
  })

  it('defaults a missing label to empty', () => {
    expect(readDestinations(`${NAV_MARK}{"id":"a","kind":"k","params":{}}`)).toEqual([{ id: 'a', kind: 'k', params: {}, label: '' }])
  })
})
