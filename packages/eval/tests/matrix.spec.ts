/**
 * Matrix expansion and seeded ordering: one cell per (item × condition ×
 * rep); the order is reproducible from the seed and, with interleave,
 * prefers not placing two cells of the same condition back to back.
 */
import { describe, expect, it } from 'vitest'
import { expandMatrix, missionIdFor, orderCells } from '../src/matrix.ts'
import type { EvalCell } from '../src/matrix.ts'

const PLAN = {
  dataset: { items: ['F2-multi-agent-room', 'F3-self-restart-report'] },
  conditions: ['codex-exec', 'claude-exec'],
  reps: 2,
}

function conditionsOf(cells: readonly EvalCell[]): string[] {
  return cells.map(cell => cell.labels.condition)
}

describe('expandMatrix', () => {
  it('expands the (item × condition × rep) cross product with ids, labels, and titles', () => {
    const cells = expandMatrix(PLAN)
    expect(cells).toHaveLength(2 * 2 * 2)
    expect(cells[0]).toEqual({
      missionId: 'f2-multi-agent-room-codex-exec-rep1',
      title: 'F2-multi-agent-room × codex-exec × rep1',
      labels: { task: 'F2-multi-agent-room', condition: 'codex-exec', rep: '1' },
    })
    expect(cells.at(-1)?.missionId).toBe('f3-self-restart-report-claude-exec-rep2')
  })

  it('mission ids stay mission-id-safe for awkward item ids', () => {
    expect(missionIdFor('P0-placeholder', 'dsh-exec', 1)).toBe('p0-placeholder-dsh-exec-rep1')
    expect(missionIdFor('Weird Id/With Spaces', 'dsh', 1)).toBe('weird-id-with-spaces-dsh-rep1')
  })
})

describe('orderCells — seeded reproducibility (frozen decision 11)', () => {
  const cells = expandMatrix(PLAN)

  it('is deterministic for a seed and preserves the full matrix', () => {
    const a = orderCells(cells, 42, false)
    const b = orderCells(cells, 42, false)
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x.missionId < y.missionId ? -1 : 1))
      .toEqual([...cells].sort((x, y) => x.missionId < y.missionId ? -1 : 1))
  })

  it('different seeds give different orders (a fixed order would defeat the shuffle)', () => {
    const orders = new Set(Array.from({ length: 12 }, (_, seed) => orderCells(cells, seed, false).map(c => c.missionId).join('|')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('with interleave, same-condition adjacency is preferred away', () => {
    // Across many seeds, the interleaved order should produce far fewer
    // same-condition adjacencies than the raw shuffle — and never duplicate.
    let adjacent = 0
    let shuffles = 0
    for (let seed = 0; seed < 50; seed++) {
      shuffles += conditionsOf(orderCells(cells, seed, false)).filter((c, i, arr) => i > 0 && arr[i - 1] === c).length
      adjacent += conditionsOf(orderCells(cells, seed, true)).filter((c, i, arr) => i > 0 && arr[i - 1] === c).length
    }
    expect(adjacent).toBeLessThan(shuffles)
    for (let seed = 0; seed < 20; seed++) {
      const ordered = orderCells(cells, seed, true)
      expect(new Set(ordered.map(c => c.missionId)).size).toBe(ordered.length)
    }
  })
})
