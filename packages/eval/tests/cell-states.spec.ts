/**
 * T80c — the finished-cell set both halves read, the time a record RAN, and
 * the run-records word built on them.
 */
import { describe, expect, it } from 'vitest'
import { attemptElapsedMs, isJudgedOrBeyond } from '../src/cell-states.ts'
import { recordPhrase } from '../src/client/vocab.ts'
import { isJudgedOrBeyond as fromExperiments } from '../src/experiments.ts'

describe('the finished-cell set', () => {
  it('is ONE set: the status rule re-exports the module the browser reads', () => {
    expect(fromExperiments).toBe(isJudgedOrBeyond)
  })
})

describe('how long a record ran (P1-7)', () => {
  it('stops at the first finished state, not at the release two days later', () => {
    const enteredAt = { 'ws-ready': 1_000, 'stage-1': 7_000, 'judged': 255_000, 'released': 172_800_000 }
    expect(attemptElapsedMs(enteredAt, 'released', 999_999_999)).toBe(254_000)
  })

  it('counts to now while the cell still moves', () => {
    expect(attemptElapsedMs({ 'ws-ready': 1_000, 'stage-2': 5_000 }, 'stage-2', 191_000)).toBe(190_000)
  })

  it('has no number when the ledger timed nothing, or not the finish', () => {
    expect(attemptElapsedMs(undefined, 'stage-1', 5)).toBeNull()
    expect(attemptElapsedMs({ 'ws-ready': 1_000 }, 'released', 5_000)).toBeNull()
  })
})

describe('the run-records word (P1-7)', () => {
  it('says 完成 for every finished state but halted, 失败 for halted, the stage otherwise', () => {
    for (const state of ['judged', 'archived', 'releasable', 'released']) {
      expect(recordPhrase(state)).toEqual({ key: 'runs.filter.done' })
    }
    expect(recordPhrase('halted')).toEqual({ key: 'runs.filter.failed' })
    expect(recordPhrase('stage-2')).toEqual({ key: 'stage.stage-2' })
  })
})
