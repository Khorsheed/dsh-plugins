/**
 * The video host half writes the destination line through its own copy (host
 * faces are not bundled); this pins that copy to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav, and its kind to the tab kind.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK, PROPOSAL_CARD, SETTLED_CARD, VIDEO_NAV_KIND, withVideoDestination } from '../src/nav-line.ts'
import { VIDEO_KIND } from '../src/client/definition.tsx'

describe('video destination line', () => {
  it('uses the reference marker and the 剪辑 tab kind', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    expect(VIDEO_NAV_KIND).toBe(VIDEO_KIND)
    const answer = withVideoDestination('已提议 g_1', 'group:g_1', { projectId: 'p_1', tab: 'transcript', groupId: 'g_1' }, '粗剪提议')
    expect(answer.startsWith('已提议 g_1\n')).toBe(true)
    expect(readDestinations(answer)).toEqual([expect.objectContaining({
      kind: 'video-studio', label: '粗剪提议', params: { projectId: 'p_1', tab: 'transcript', groupId: 'g_1' },
    })])
  })
  it('hands the card data with it: a proposal waits for the person, a settled one does not', () => {
    const waiting = withVideoDestination('已提议 g_2', 'group:g_2', { projectId: 'p_1', tab: 'transcript', groupId: 'g_2' }, '剪掉「然后」', PROPOSAL_CARD)
    expect(readDestinations(waiting)[0]?.card).toEqual({ status: '等你过一遍', awaiting: true, door: '去文稿处理 →' })
    const settled = withVideoDestination('已采纳 g_2', 'settled:g_2', { projectId: 'p_1', tab: 'transcript', groupId: 'g_2' }, '已采纳 g_2', SETTLED_CARD)
    expect(readDestinations(settled)[0]?.card).toEqual({ status: '已处理', door: '查看 →' })
    expect(readDestinations(settled)[0]?.params).toEqual(readDestinations(waiting)[0]?.params)
  })
})
