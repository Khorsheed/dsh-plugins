/** The @ menu's matching and ranking, and the free-text → detect offset mapping. */
import { describe, expect, it } from 'vitest'
import { detectOffset, matchTier, memberMention, otherRows, rankByMatch, sessionRows, shortTime } from '../src/client/at-menu.ts'

describe('@ menu', () => {
  it('tiers: exact, prefix, contiguous, in order', () => {
    expect(['游戏大师', '游戏', '大师', '游大', '师游'].map(query => matchTier(query, '游戏大师'))).toEqual([0, 1, 2, 3, undefined])
    expect(matchTier('', 'x')).toBe(0)
    expect(matchTier('DSH', 'dsh')).toBe(0)
  })

  it('ranks by tier, then keeps recency order', () => {
    const titles = ['邀请克劳德代码加入游戏开发会话', '山海经 3D 游戏共创', '游戏大师', '游 戏']
    expect(rankByMatch('游戏', titles, title => title)).toEqual(['游戏大师', '邀请克劳德代码加入游戏开发会话', '山海经 3D 游戏共创', '游 戏'])
  })

  it('offers the recent five with nothing typed, never the excluded or duplicates', () => {
    const rows = ['a', 'room', 'b', 'a', 'c', 'd', 'e', 'f'].map(id => ({ sessionId: id, label: id, mention: id }))
    expect(sessionRows('', rows, new Set(['room'])).map(row => row.sessionId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(sessionRows('f', rows, new Set()).map(row => row.sessionId)).toEqual(['f'])
  })

  it('folds rooms until expanded; a typed query matches room members by name', () => {
    const room = { sessionId: 'z', label: '游戏开发', mention: '@[游戏开发](dsh-session:eg)', room: true, members: [{ name: 'dsh', kind: 'main-agent' }, { name: '游戏大师', kind: 'cli', provider: 'claude-local' }] }
    const plain = { sessionId: 's', label: '山海经游戏共创', mention: '@[山海经游戏共创](dsh-session:cw)' }
    const shape = (rows: ReturnType<typeof otherRows>) => rows.map(row => row.kind === 'session' ? row.candidate.sessionId : `${row.candidate.sessionId}/${row.member.name}`)
    expect(shape(otherRows('', [room, plain], new Set(), new Set()))).toEqual(['z', 's'])
    expect(shape(otherRows('', [room, plain], new Set(), new Set(['z'])))).toEqual(['z', 'z/dsh', 'z/游戏大师', 's'])
    expect(shape(otherRows('游戏', [room, plain], new Set(), new Set()))).toEqual(['z', 'z/游戏大师', 's'])
    expect(memberMention(room, room.members[1]!)).toEqual({ mention: '@[游戏大师（游戏开发）](dsh-session:eg)', label: '游戏大师（游戏开发）' })
  })

  it('maps a textarea offset past chips onto the draft\'s detect offset', () => {
    // 「去问问 」 [chip] 「 帮忙」: offsets after the chip move right by one.
    expect([0, 4, 5, 7].map(index => detectOffset(['去问问 ', ' 帮忙'], index))).toEqual([0, 4, 6, 8])
    expect(detectOffset(['abc'], 2)).toBe(2)
  })

  it('times today as HH:MM, older as M/D', () => {
    const now = new Date(2026, 9, 26, 10, 0).getTime()
    expect(shortTime(new Date(2026, 9, 26, 9, 5).getTime(), now)).toBe('09:05')
    expect(shortTime(new Date(2026, 8, 13, 9, 5).getTime(), now)).toBe('9/13')
  })
})
