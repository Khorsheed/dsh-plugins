import { describe, expect, it } from 'vitest'
import { readinessTable, type ReadinessInput } from '../src/client/readiness-basis.ts'
import type { EvalConditionRow, EvalPlanCheck, EvalReadinessLine } from '../src/types.ts'

const ready = (id: string, role: string) => ({
  id, role, sha: `${id}`.padEnd(64, '0'), status: 'ready' as const,
  lock: { present: true, matches: true, homeSha: 'h'.repeat(64) },
})

const registry = (id: string, model: string | null) => ({ id, model }) as unknown as EvalConditionRow

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    reviewed: true,
    dataset: { id: 'harness-comparison', commit: 'd9af6bc3'.padEnd(40, '0') },
    stages: ['stage1', 'stage2'],
    expectedNs: ['probe', 'llm-draft', 'human'],
    players: ['lean', 'full'],
    judges: ['judge'],
    conditions: [ready('lean', 'player'), ready('full', 'player'), { ...ready('judge', 'judge'), lock: { present: true, matches: true, homeSha: null } }],
    checks: [],
    probes: [],
    registry: [registry('lean', 'm-a'), registry('full', 'm-a'), registry('judge', 'm-b')],
    ...over,
  }
}

describe('readinessTable (T84 §三)', () => {
  it('a clean plan: dataset, each group, the judge, the verdict sources — all ready, offline', () => {
    const { rows, attached } = readinessTable(input())
    expect(rows.map(row => row.key)).toEqual(['dataset', 'player:lean', 'player:full', 'judge:judge', 'sources'])
    expect(rows.every(row => row.state === 'ok')).toBe(true)
    expect(rows[0]?.basis.map(part => part.key)).toEqual(['basis.dataset.commitShort', 'basis.dataset.schemasShort'])
    expect(rows[0]?.basis[1]?.params).toEqual({ ok: 2, n: 2 })
    expect(rows[1]?.basis.map(part => part.key)).toEqual(['basis.subject.lockMatchShort', 'basis.subject.homeShort', 'basis.subject.provisionedShort'])
    // Before a start the probe line says when the real probe happens.
    expect(rows[1]?.lines.at(-1)?.key).toBe('basis.probe.atStart')
    // A judge in the default home: a neutral fact, not a failure.
    expect(rows[3]?.lines.find(line => line.key === 'basis.subject.homeDefault')?.tone).toBe('neutral')
    expect(attached.size).toBe(0)
  })

  it('a stage schema missing counts against N/N and the dataset row owns its warning', () => {
    const missing: EvalPlanCheck = { severity: 'warn', code: 'STAGE_SCHEMA_MISSING', message: 'schemas/stage2.json missing', condition: null }
    const { rows, attached } = readinessTable(input({ checks: [missing] }))
    expect(rows[0]?.state).toBe('warn')
    expect(rows[0]?.basis[1]?.params).toEqual({ ok: 1, n: 2 })
    expect(rows[0]?.warns).toEqual([missing])
    expect(attached.has(missing)).toBe(true)
  })

  it('a stale lock is the row\'s reason; a warning on a READY group moves under it, one on an unready group stays a blocker', () => {
    const stale = { ...ready('full', 'player'), status: 'unready' as const, lock: { present: true, matches: false, homeSha: 'h'.repeat(64) } }
    const onReady: EvalPlanCheck = { severity: 'warn', code: 'CAPABILITIES_UNMEASURED', message: 'lean capabilities unmeasured', condition: 'lean' }
    const onUnready: EvalPlanCheck = { severity: 'warn', code: 'CAPABILITIES_UNMEASURED', message: 'full capabilities unmeasured', condition: 'full' }
    const { rows, attached } = readinessTable(input({
      conditions: [ready('lean', 'player'), stale, ready('judge', 'judge')],
      checks: [onReady, onUnready],
    }))
    const lean = rows.find(row => row.key === 'player:lean')
    const full = rows.find(row => row.key === 'player:full')
    expect(lean?.state).toBe('warn')
    expect(lean?.warns).toEqual([onReady])
    expect(full?.state).toBe('danger')
    expect(full?.basis[0]?.key).toBe('basis.subject.lockStaleShort')
    expect(full?.warns).toEqual([])
    expect(attached.has(onReady)).toBe(true)
    expect(attached.has(onUnready)).toBe(false)
  })

  it('a group the plan names but the review never resolved is a red row, not a missing one', () => {
    const { rows } = readinessTable(input({ conditions: [ready('lean', 'player'), ready('judge', 'judge')] }))
    const full = rows.find(row => row.key === 'player:full')
    expect(full?.state).toBe('danger')
    expect(full?.lines[0]?.key).toBe('basis.subject.missing')
  })

  it('a judge on a player\'s model is marked as grading itself', () => {
    const { rows } = readinessTable(input({ registry: [registry('lean', 'm-a'), registry('full', 'm-b'), registry('judge', 'm-a')] }))
    const judge = rows.find(row => row.kind === 'judge')
    expect(judge?.selfJudge).toBe(true)
    expect(judge?.lines.some(line => line.key === 'basis.judge.self')).toBe(true)
  })

  it('once a run started, the real probe decides the group\'s state and leads its 依据', () => {
    const probe = (condition: string, ok: boolean): EvalReadinessLine => ({
      condition, role: 'player', harness: 'dsh', provider: 'dsh', ok, startedAt: 0, durationMs: 4200,
      childSessionId: `child-${condition}`, declaredModel: 'm-a', requestedModel: 'm-a', observedModel: 'm-a',
      scope: null, reason: ok ? null : 'login expired', infrastructure: null, unit: null,
    })
    const { rows } = readinessTable(input({ probes: [probe('lean', true), probe('full', false)] }))
    const lean = rows.find(row => row.key === 'player:lean')
    const full = rows.find(row => row.key === 'player:full')
    expect(lean?.basis[0]?.key).toBe('basis.probe.okShort')
    expect(lean?.lines.at(-1)).toMatchObject({ key: 'basis.probe.ok', params: { model: 'm-a', seconds: 4.2 } })
    expect(full?.state).toBe('danger')
    expect(full?.lines.at(-1)).toMatchObject({ key: 'basis.probe.failed', params: { reason: 'login expired' } })
  })

  it('the verdict-sources row reads EXPECTED_NS_* and the judge requirement', () => {
    const noProbe: EvalPlanCheck = { severity: 'warn', code: 'EXPECTED_NS_NO_PROBE', message: 'P0 has no probe', condition: null }
    const { rows } = readinessTable(input({ checks: [noProbe] }))
    const sources = rows.find(row => row.kind === 'sources')
    expect(sources?.state).toBe('warn')
    expect(sources?.basis[0]).toEqual({ key: 'basis.sources.badShort', params: { n: 1 } })
    expect(sources?.warns).toEqual([noProbe])
  })
})
