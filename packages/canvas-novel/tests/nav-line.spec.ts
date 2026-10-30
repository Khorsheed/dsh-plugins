/**
 * The novel host half writes the destination line through its own copy (host
 * faces are not bundled); this pins that copy to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav, and the chapter's place to the 章节 face.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK, withChapterDestination, withoutDestinations } from '../src/nav-line.ts'

describe('novel destination line', () => {
  it('names a chapter as the 章节 face showing that chapter', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    const answer = withChapterDestination('已建第 3 章《雨夜》（画布 c1 · 规划中 · 第3章.md）。', 'c1', 3, '雨夜', 'plan', '7')
    expect(readDestinations(answer)).toEqual([{
      id: 'canvas:c1:chapter:3:plan:7',
      kind: 'canvas',
      params: { canvasId: 'c1', face: 'manuscripts', item: '3', focus: 'plan' },
      label: '第 3 章《雨夜》',
    }])
    expect(withoutDestinations(answer)).toBe('已建第 3 章《雨夜》（画布 c1 · 规划中 · 第3章.md）。')
  })
})
