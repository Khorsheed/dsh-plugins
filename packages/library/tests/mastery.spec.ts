/**
 * Knowledge-point mastery (mastery.ts): open misses, retakes resolving them,
 * coach notes, and the three states.
 */
import { describe, expect, it } from 'vitest'
import { masteryChanges, stationMastery } from '../src/mastery.ts'
import type { LibraryAssessment, LibraryAttempt, LibraryQuizQuestion, RoadmapNode } from '../src/types.ts'

const q = (id: string, point: string): LibraryQuizQuestion => ({ id, kind: 'fill', prompt: `p-${id}`, answer: 'a', point, target: { kind: 'topic' }, evidence: { kind: 'knowledge' } })
const node = (notes: { point: string; at: string }[] = []): RoadmapNode => ({
  id: 's1', title: '站', gate: 'quiz', goals: [], dependsOn: [], covers: [], state: 'current',
  points: [
    { id: 'p1', title: '函数与图像', ...(notes.some(n => n.point === 'p1') ? { notes: notes.filter(n => n.point === 'p1').map(n => ({ text: '混了', at: n.at })) } : {}) },
    { id: 'p2', title: '三角学基础' },
    { id: 'p3', title: '未考的' },
  ],
})
const paper: LibraryAssessment = { id: 'qa', type: 'quiz', scope: { nodeId: 's1' }, questions: [q('q1', 'p1'), q('q2', 'p1'), q('q3', 'p2')], createdAt: '2026-10-19T00:00:00.000Z' }
const sitting = (id: string, assessmentId: string, at: string, verdicts: [string, boolean][]): LibraryAttempt => ({
  id, assessmentId, at, ratio: 0, verdicts: verdicts.map(([task, pass]) => ({ task, criterion: 'c', pass, evidence: 'e', by: 'self' })),
})

describe('stationMastery', () => {
  it('a missed question is open and weakens its point; a right one masters its point; no probe is untested', () => {
    const m = stationMastery(node(), [paper], [sitting('a1', 'qa', '2026-10-19T01:00:00.000Z', [['q1', false], ['q2', true], ['q3', true]])])
    expect(m.open.map(miss => miss.key)).toEqual(['qa:q1'])
    expect(m.points.map(point => [point.id, point.state, point.open.length])).toEqual([['p1', 'weak', 1], ['p2', 'mastered', 0], ['p3', 'untested', 0]])
  })

  it('a retake that answers the miss right closes it and masters the point; a retake never needs a station', () => {
    const retake: LibraryAssessment = { id: 'rt', type: 'retake', scope: { nodeId: 's1' }, questions: [{ ...q('r1', 'p1'), origin: { assessmentId: 'qa', questionId: 'q1' } }], createdAt: '2026-10-19T02:00:00.000Z' }
    const attempts = [
      sitting('a1', 'qa', '2026-10-19T01:00:00.000Z', [['q1', false], ['q2', true]]),
      sitting('a2', 'rt', '2026-10-19T02:00:00.000Z', [['r1', true]]),
    ]
    const m = stationMastery(node(), [paper, retake], attempts)
    expect(m.open).toEqual([])
    expect(m.points[0]?.state).toBe('mastered')
  })

  it('a coach note newer than the last right answer keeps the point weak until a newer probe passes', () => {
    const attempts = [sitting('a1', 'qa', '2026-10-19T01:00:00.000Z', [['q1', true], ['q2', true]])]
    expect(stationMastery(node([{ point: 'p1', at: '2026-10-19T03:00:00.000Z' }]), [paper], attempts).points[0]?.state).toBe('weak')
    expect(stationMastery(node([{ point: 'p1', at: '2026-10-19T00:30:00.000Z' }]), [paper], attempts).points[0]?.state).toBe('mastered')
    // A note alone (never asked) is weak, not untested.
    expect(stationMastery(node([{ point: 'p1', at: '2026-10-19T03:00:00.000Z' }]), [paper], []).points[0]?.state).toBe('weak')
  })

  it('void verdicts count for nothing; a later re-sitting of the paper decides', () => {
    const attempts = [
      sitting('a1', 'qa', '2026-10-19T01:00:00.000Z', [['q1', false]]),
      { ...sitting('a2', 'qa', '2026-10-19T02:00:00.000Z', [['q1', true]]), verdicts: [{ task: 'q1', criterion: 'c', pass: true, evidence: 'e', by: 'self' as const, void: true }] },
    ]
    expect(stationMastery(node(), [paper], attempts).open.map(miss => miss.key)).toEqual(['qa:q1'])
    const resat = stationMastery(node(), [paper], [...attempts, sitting('a3', 'qa', '2026-10-19T03:00:00.000Z', [['q1', true]])])
    expect(resat.open).toEqual([])
  })

  it('masteryChanges reports only the points that moved', () => {
    const before = stationMastery(node(), [paper], [])
    const after = stationMastery(node(), [paper], [sitting('a1', 'qa', '2026-10-19T01:00:00.000Z', [['q1', false], ['q3', true]])])
    expect(masteryChanges('s1', before, after).map(change => [change.pointId, change.from, change.to])).toEqual([['p1', 'untested', 'weak'], ['p2', 'untested', 'mastered']])
  })
})
