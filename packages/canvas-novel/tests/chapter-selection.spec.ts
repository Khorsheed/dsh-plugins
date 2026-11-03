// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { chapterSelectionFromRange } from '../src/client/chapter-selection.ts'

afterEach(() => { document.body.innerHTML = '' })

function selection(body: string, start: number, end: number) {
  const root = document.querySelector('article')!
  const first = root.querySelector('p')!.firstChild!
  const last = root.querySelectorAll('p')[1]!.firstChild!
  const range = document.createRange()
  range.setStart(first, start)
  range.setEnd(last, end)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({}) })
  return chapterSelectionFromRange(body, root as HTMLElement, range)
}

describe('chapter text selection', () => {
  it('keeps raw offsets across paragraphs and surrounding context', () => {
    document.body.innerHTML = '<article><p data-feedback-start="0">今天天气</p><p data-feedback-start="6">转晴。</p></article>'
    const body = '今天天气\n\n转晴。'
    const found = selection(body, 2, 2)!
    expect(found.quote).toBe(body.slice(found.start, found.end))
    expect(found.start).toBe(2)
    expect(found.end).toBe(8)
    expect(found.before).toBe('今天')
    expect(found.after).toBe('。')
  })

  it('reads through highlighted elements rather than assuming one text node', () => {
    document.body.innerHTML = '<article><p data-feedback-start="0">今天<mark>天气</mark></p><p data-feedback-start="6">转晴。</p></article>'
    const body = '今天天气\n\n转晴。'
    const range = document.createRange()
    const mark = document.querySelector('mark')!.firstChild!
    range.setStart(mark, 0)
    range.setEnd(mark, 1)
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({}) })
    const found = chapterSelectionFromRange(body, document.querySelector('article')!, range)!
    expect(found.quote).toBe('天')
    expect(found.start).toBe(2)
    expect(found.end).toBe(3)
  })
})
