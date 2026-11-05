import { describe, expect, it } from 'vitest'
import { relationAt, relationViewBox } from '../src/client/relation-history.ts'
import type { CodexRelation } from '../src/types.ts'

const relation: CodexRelation = {
  cardId: 'r1', pair: ['c1', 'c2'], type: '友情', stage: '投缘', steps: [
    { chapter: 1, kind: 'stage', event: 'start', stage: '接触', level: 1, label: '接触' },
    { chapter: 2, kind: 'points', delta: 2, label: '+2' },
    { chapter: 3, kind: 'stage', event: 'up', stage: '合作', level: 2, label: '合作' },
    { chapter: 4, kind: 'stage', event: 'crack', stage: '裂痕', label: '裂痕' },
    { chapter: 5, kind: 'stage', event: 'fix', stage: '合作', level: 2, label: '合作' },
    { chapter: 6, kind: 'stage', event: 'type', fromType: '同盟', toType: '对手', stage: '接触', level: 1, label: '接触' },
  ],
}

describe('relation history at a chapter', () => {
  it('replays type, stage, rift and progress instead of using the current card', () => {
    expect(relationAt(relation, 2)).toMatchObject({ type: '同盟', stage: '接触', progress: 2, trend: 'up' })
    expect(relationAt(relation, 3)).toMatchObject({ stage: '合作', progress: 0 })
    expect(relationAt(relation, 4)).toMatchObject({ stage: '裂痕', trend: 'down' })
    expect(relationAt(relation, 5)).toMatchObject({ stage: '合作', level: 2, trend: 'repair' })
    expect(relationAt(relation, 6)).toMatchObject({ type: '对手', stage: '接触', level: 1, trend: 'type' })
    expect(relationAt(relation, 0)).toBeUndefined()
  })

  it('zooms around the current center', () => {
    expect(relationViewBox(2, { x: 280, y: 160 })).toBe('140 80 280 160')
  })
})
