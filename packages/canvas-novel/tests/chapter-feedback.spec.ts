import { describe, expect, it } from 'vitest'
import {
  activeChapterFeedback, chapterFeedbackBlocks, emptyChapterFeedback, formatChapterFeedbackRequest, locateChapterFeedback,
  normalizeChapterFeedback, type ChapterFeedbackIdea,
} from '../src/chapter-feedback.ts'

const idea: ChapterFeedbackIdea = {
  id: 'f1', chapter: 2, quote: '坦率地说，进展有限。', start: 3, end: 13,
  before: '前文。', after: '后文。', baseBodyHash: 'hash', text: '补一拍心理变化。', createdAt: '2026-11-03T00:00:00.000Z',
}

describe('chapter feedback vocabulary', () => {
  it('normalizes the durable document and separates unbatched ideas', () => {
    const doc = normalizeChapterFeedback({
      version: 1,
      ideas: [idea, { ...idea, id: 'f2', quote: undefined, text: '结尾再含蓄一点。' }],
      batches: [{ id: 'fb1', sessionId: 's1', canvasId: 'canvas_1', chapter: 2, chapterTitle: '醒来的地方', ideas: [idea], baseBodyHash: 'hash', status: 'archived', createdAt: 'now' }],
      nextIdea: 3,
      nextBatch: 2,
    })!
    expect(doc.ideas).toHaveLength(2)
    expect(activeChapterFeedback(doc, 2).map(row => row.id)).toEqual(['f2'])
    expect(normalizeChapterFeedback({ version: 2 })).toBeUndefined()
    expect(normalizeChapterFeedback(null)).toBeUndefined()
  })

  it('starts empty and puts every quoted original beside its thought', () => {
    expect(emptyChapterFeedback().batches).toEqual([])
    const text = formatChapterFeedbackRequest('潜梦者', '醒来的地方', 2, [idea, { ...idea, id: 'f2', quote: undefined, start: undefined, end: undefined, text: '整章再收一点。' }])
    expect(text).toContain('《潜梦者》第 2 章《醒来的地方》')
    expect(text).toContain('原文：“坦率地说，进展有限。”')
    expect(text).toContain('想法：补一拍心理变化。')
    expect(text).toContain('第 2 章 · 整章')
    expect(text).toContain('不要求只修改对应选区')
  })

  it('keeps offsets when possible and uses context to disambiguate a moved quote', () => {
    const body = '前文。坦率地说，进展有限。后文。'
    expect(locateChapterFeedback(idea, body)).toEqual({ start: 3, end: 13 })
    const moved = `别处。坦率地说，进展有限。无关。前文。坦率地说，进展有限。后文。`
    const start = moved.lastIndexOf(idea.quote!)
    expect(locateChapterFeedback(idea, moved)).toEqual({ start, end: start + idea.quote!.length })
    expect(locateChapterFeedback({ ...idea, quote: '已经删掉的话。' }, body)).toBeUndefined()
    expect(locateChapterFeedback({ ...idea, quote: undefined }, body)).toBeUndefined()
  })

  it('keeps raw text offsets across headings and blank lines', () => {
    const body = '# 标题\n\n第一段。\n  第二段。\n'
    expect(chapterFeedbackBlocks(body)).toEqual([
      { start: 0, end: 4, text: '# 标题', heading: true },
      { start: 6, end: 10, text: '第一段。', heading: false },
      { start: 13, end: 17, text: '第二段。', heading: false },
    ])
  })
})
