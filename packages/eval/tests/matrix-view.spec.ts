import { describe, expect, it } from 'vitest'
import { DEFAULT_STUCK_MS, pivotMatrix, repDot, type MatrixInputCell } from '../src/matrix-view.ts'

/**
 * I5·T35b — the matrix pivot. Rows are the task, the column is one factor, the
 * rest band or pin. Every assertion here is about the ARRANGEMENT rule, which
 * is why the function is pure: "why is this cell red" has one answer.
 */

const BASE = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: 'a'.repeat(64) },
  env: { keys: [] },
} as const

/** Four conditions over two factors: the harness, and the scope. */
const CONDITIONS = [
  { id: 'codex-a', document: { ...BASE, scope: 'a' } },
  { id: 'codex-b', document: { ...BASE, scope: 'b' } },
  { id: 'dsh-a', document: { ...BASE, harness: { name: 'dsh', version: '0.1.1', drive: 'exec' }, scope: 'a' } },
  { id: 'dsh-b', document: { ...BASE, harness: { name: 'dsh', version: '0.1.1', drive: 'exec' }, scope: 'b' } },
]

/** One cell, with the defaults a healthy archived cell has. */
function cell(over: Partial<MatrixInputCell> & Pick<MatrixInputCell, 'missionId' | 'task' | 'condition' | 'rep'>): MatrixInputCell {
  return {
    state: 'archived',
    bucket: 'done',
    inStateMs: 1_000,
    materializationSha: `sha-${over.task ?? ''}`,
    fingerprint: 'lab-env:aaaa',
    ...over,
  }
}

/** Two items × the four conditions × one rep. */
function grid(): MatrixInputCell[] {
  const cells: MatrixInputCell[] = []
  for (const task of ['P0', 'P1']) {
    for (const condition of CONDITIONS.map(entry => entry.id)) {
      cells.push(cell({ missionId: `${task}-${condition}-rep1`, task, condition, rep: 1 }))
    }
  }
  return cells
}

describe('repDot', () => {
  it('is solid past judged, hollow before anything started, half in between', () => {
    for (const state of ['judged', 'halted', 'archived', 'releasable', 'released']) {
      expect(repDot(state)).toBe('filled')
    }
    expect(repDot('pending')).toBe('empty')
    expect(repDot('ws-ready')).toBe('half')
    expect(repDot('stage-2')).toBe('half')
  })
})

describe('pivotMatrix — the factor set and the column', () => {
  it('derives the factors from the condition documents and takes the first as the column', () => {
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid() })
    expect(view.factors).toEqual(['harness.name', 'harness.version', 'scope'])
    expect(view.column).toBe('harness.name')
    expect(view.columns.map(column => column.label)).toEqual(['codex', 'dsh'])
    expect(view.columns[0]?.conditions).toEqual(['codex-a', 'codex-b'])
  })

  it('puts the reader\'s factor on the columns instead', () => {
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid(), column: 'scope' })
    expect(view.column).toBe('scope')
    expect(view.columns.map(column => column.label)).toEqual(['a', 'b'])
    expect(view.columns[0]?.conditions).toEqual(['codex-a', 'dsh-a'])
  })

  it('ignores a column that is not a factor, and reports every factor\'s values for the filter', () => {
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid(), column: 'model.declared' })
    expect(view.column).toBe('harness.name')
    expect(view.factorValues.find(entry => entry.factor === 'scope')?.values.map(value => value.label))
      .toEqual(['a', 'b'])
  })

  it('conditions that agree on everything give one unnamed column', () => {
    const one = [{ id: 'only', document: BASE }]
    const view = pivotMatrix({
      runId: 'r',
      conditions: one,
      cells: [cell({ missionId: 'P0-only-rep1', task: 'P0', condition: 'only', rep: 1 })],
    })
    expect(view.factors).toEqual([])
    expect(view.column).toBeNull()
    expect(view.columns).toEqual([{ key: '', label: '全部', conditions: ['only'] }])
    expect(view.groups[0]?.rows[0]?.cells[0]?.reps).toHaveLength(1)
  })
})

describe('pivotMatrix — rows, groups and the filter', () => {
  it('rows are always the task, one row per task per band', () => {
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid() })
    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]?.rows.map(row => row.task)).toEqual(['P0', 'P1'])
  })

  it('groups the rows by a remaining factor, and never by the column itself', () => {
    const view = pivotMatrix({
      runId: 'r',
      conditions: CONDITIONS,
      cells: grid(),
      column: 'harness.name',
      groupBy: ['scope', 'harness.name'],
    })
    expect(view.groupBy).toEqual(['scope'])
    expect(view.groups.map(group => group.label)).toEqual(['scope a', 'scope b'])
    // Each band still has both items, and each row still has both columns.
    expect(view.groups[0]?.rows.map(row => row.task)).toEqual(['P0', 'P1'])
    expect(view.groups[0]?.rows[0]?.cells).toHaveLength(2)
  })

  it('pins a remaining factor with the filter, and drops the conditions that do not match', () => {
    const view = pivotMatrix({
      runId: 'r',
      conditions: CONDITIONS,
      cells: grid(),
      column: 'harness.name',
      filter: { scope: '"a"' },
    })
    expect(view.columns.map(column => column.conditions)).toEqual([['codex-a'], ['dsh-a']])
    const reps = view.groups[0]?.rows[0]?.cells.flatMap(entry => entry?.reps ?? []) ?? []
    expect(reps.map(rep => rep.condition).sort()).toEqual(['codex-a', 'dsh-a'])
  })

  it('a factor that is neither the column nor grouped rides along, visibly, inside the cell', () => {
    // scope is left alone: each column's cell then carries BOTH scopes' reps
    // and names both conditions, rather than silently showing one.
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid(), column: 'harness.name' })
    const first = view.groups[0]?.rows[0]?.cells[0]
    expect(first?.conditions).toEqual(['codex-a', 'codex-b'])
    expect(first?.reps).toHaveLength(2)
  })
})

describe('pivotMatrix — the four things a cell carries', () => {
  it('a cell with no rep in a column is a hole, not an empty cell', () => {
    const cells = grid().filter(entry => entry.condition !== 'dsh-a' && entry.condition !== 'dsh-b')
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, column: 'harness.name' })
    expect(view.groups[0]?.rows[0]?.cells[1]).toBeNull()
  })

  it('the stage line is the state the reps agree on, else mixed', () => {
    const cells = [
      cell({ missionId: 'a', task: 'P0', condition: 'codex-a', rep: 1, state: 'archived' }),
      cell({ missionId: 'b', task: 'P0', condition: 'codex-b', rep: 2, state: 'stage-2' }),
    ]
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, column: 'harness.name' })
    expect(view.groups[0]?.rows[0]?.cells[0]?.stage).toBe('mixed (archived / stage-2)')
  })

  it('flags a cell that has been sitting in one state past the threshold, and never a settled one', () => {
    const cells = [
      cell({ missionId: 'slow', task: 'P0', condition: 'codex-a', rep: 1, state: 'stage-2', inStateMs: DEFAULT_STUCK_MS + 1 }),
      // Settled: the counter keeps running, but nothing is due, so nothing is stuck.
      cell({ missionId: 'done', task: 'P1', condition: 'codex-a', rep: 1, state: 'released', inStateMs: DEFAULT_STUCK_MS * 100 }),
    ]
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, column: 'harness.name' })
    expect(view.summary.stuck).toBe(1)
    expect(view.groups[0]?.rows[0]?.cells[0]?.stuck).toBe(true)
    expect(view.groups[0]?.rows[1]?.cells[0]?.stuck).toBe(false)
  })

  it('honours a caller-set threshold', () => {
    const cells = [cell({ missionId: 'a', task: 'P0', condition: 'codex-a', rep: 1, state: 'stage-2', inStateMs: 5_000 })]
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, stuckMs: 1_000 }).summary.stuck).toBe(1)
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, stuckMs: 10_000 }).summary.stuck).toBe(0)
  })

  it('marks the cell whose material disagrees with the rest of its ITEM, and only that one', () => {
    const cells = [
      cell({ missionId: 'a', task: 'P0', condition: 'codex-a', rep: 1, materializationSha: 'same' }),
      cell({ missionId: 'b', task: 'P0', condition: 'codex-b', rep: 1, materializationSha: 'same' }),
      cell({ missionId: 'c', task: 'P0', condition: 'dsh-a', rep: 1, materializationSha: 'ODD' }),
      cell({ missionId: 'd', task: 'P0', condition: 'dsh-b', rep: 1, materializationSha: 'same' }),
    ]
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells, column: 'harness.name', groupBy: ['scope'] })
    // scope a / dsh is the odd one out; scope a / codex and scope b are not.
    const bands = Object.fromEntries(view.groups.map(group => [group.label, group]))
    expect(bands['scope a']?.rows[0]?.cells[0]?.hashMismatch).toBe(false)
    expect(bands['scope a']?.rows[0]?.cells[1]?.hashMismatch).toBe(true)
    expect(bands['scope b']?.rows[0]?.cells[1]?.hashMismatch).toBe(false)
    expect(view.summary.materialization).toMatchObject({ status: 'violated' })
    expect(view.summary.materialization.detail).toContain('P0')
  })

  it('an unread material hash is unknown, never a mismatch', () => {
    const cells = grid().map(entry => ({ ...entry, materializationSha: null }))
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells })
    expect(view.groups[0]?.rows[0]?.cells[0]).toMatchObject({ hashMismatch: false, hashUnknown: true })
    expect(view.summary.materialization).toMatchObject({ status: 'unverifiable' })
  })
})

describe('pivotMatrix — the run summary', () => {
  it('reports the item material and the environment fingerprint as the report words them', () => {
    const view = pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid(), unreleased: ['P0-codex-a-rep1'] })
    expect(view.summary.materialization.status).toBe('ok')
    expect(view.summary.fingerprint.status).toBe('ok')
    expect(view.summary.unreleased).toBe(1)
    expect(view.summary.cells).toBe(8)
  })

  it('a run with no fingerprint at all is unverifiable, a partially recorded one is violated', () => {
    const hostPath = grid().map(entry => ({ ...entry, fingerprint: null }))
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: hostPath }).summary.fingerprint.status)
      .toBe('unverifiable')
    const partial = grid().map((entry, index) => ({ ...entry, fingerprint: index === 0 ? null : entry.fingerprint }))
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: partial }).summary.fingerprint.status)
      .toBe('violated')
    const mixed = grid().map((entry, index) => ({ ...entry, fingerprint: index === 0 ? 'lab-env:bbbb' : entry.fingerprint }))
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: mixed }).summary.fingerprint.status)
      .toBe('violated')
  })

  it('judge consistency is 待报告 until a report says otherwise — never guessed', () => {
    expect(pivotMatrix({ runId: 'r', conditions: CONDITIONS, cells: grid() }).summary.judgeConsistency).toBeNull()
    expect(pivotMatrix({
      runId: 'r', conditions: CONDITIONS, cells: grid(), judgeConsistency: 'κ 0.82',
    }).summary.judgeConsistency).toBe('κ 0.82')
  })
})
