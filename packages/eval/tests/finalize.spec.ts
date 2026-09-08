/**
 * `finalize` — the post-run release walk (pilot A · G13), against a fake
 * mission ledger whose transitions enforce the same two things the real one
 * does: only declared edges, and the archive gate's non-empty `verdicts/`.
 * The interesting run is the MIXED one, because that is the only shape a
 * re-entry point ever meets: an interrupted run holds released cells,
 * mid-stage cells and cells that never started, all at once.
 */
import { describe, expect, it } from 'vitest'
import { finalizeRun, EvalFinalizeRefused, skipCategoryOf } from '../src/finalize.ts'
import { parseMissionRow } from '../src/mission-cli.ts'
import type { MissionFinalizeFace } from '../src/faces.ts'

/** A ledger of `id → state`, with the release edges and the archive gate. */
class FakeLedger implements MissionFinalizeFace {
  readonly annotations: Array<{ missionId: string; ns: string; payload: unknown }> = []
  readonly transitions: Array<{ missionId: string; to: string }> = []
  constructor(
    private readonly states: Map<string, string>,
    /** Cells whose verdicts/ is empty: the archive gate refuses them. */
    private readonly emptyVerdicts: ReadonlySet<string> = new Set(),
    private readonly unknownRun = false,
  ) {}

  runStatus(runId: string): { rows: ReadonlyArray<{ id: string; state: string }> } {
    if (this.unknownRun) throw new Error(`run ${runId} does not exist`)
    return { rows: [...this.states].map(([id, state]) => ({ id, state })) }
  }

  async transition(missionId: string, to: string): Promise<{ changed: boolean }> {
    const from = this.states.get(missionId)
    const declared: Record<string, string> = { archived: 'releasable', releasable: 'released' }
    if (from === undefined || declared[from] !== to) {
      throw new Error(`mission: transition ${String(from)} → ${to} is not declared`)
    }
    if (to === 'releasable' && this.emptyVerdicts.has(missionId)) {
      throw new Error('mission: file-check guard failed: empty archive/verdicts/')
    }
    this.transitions.push({ missionId, to })
    this.states.set(missionId, to)
    return { changed: true }
  }

  async annotate(missionId: string, ns: string, payload: unknown): Promise<{ added: boolean }> {
    this.annotations.push({ missionId, ns, payload })
    return { added: true }
  }
}

/** The pilot-a-round1 shape: 3 released, 2 interrupted mid-stage, 7 pending. */
function pilotShapedLedger(): Map<string, string> {
  return new Map([
    ['f2-codex-rep1', 'pending'],
    ['f2-codex-rep2', 'released'],
    ['f2-codex-rep3', 'pending'],
    ['f2-dsh-rep1', 'pending'],
    ['f2-dsh-rep2', 'pending'],
    ['f2-dsh-rep3', 'stage-2'],
    ['f3-codex-rep1', 'released'],
    ['f3-codex-rep2', 'pending'],
    ['f3-codex-rep3', 'pending'],
    ['f3-dsh-rep1', 'released'],
    ['f3-dsh-rep2', 'stage-1'],
    ['f3-dsh-rep3', 'pending'],
  ])
}

describe('finalizeRun — a run of mixed states', () => {
  it('releases the archived cells, lists every other one with its state, and classifies the skips', async () => {
    const states = new Map([
      ['cell-archived-a', 'archived'],
      ['cell-archived-b', 'archived'],
      ['cell-released', 'released'],
      ['cell-midstage', 'stage-2'],
      ['cell-pending', 'pending'],
      ['cell-halted', 'halted'],
    ])
    const ledger = new FakeLedger(states)
    const report = await finalizeRun(ledger, 'run-mixed')

    expect(report.released).toBe(2)
    expect(report.refused).toBe(0)
    expect(report.skipped).toBe(4)
    expect(report.skippedByCategory).toEqual({ 'already-released': 1, interrupted: 2, 'not-started': 1 })
    expect(report.skippedByState).toEqual({ released: 1, 'stage-2': 1, halted: 1, pending: 1 })

    // Both archived cells took BOTH edges, in order — the same gate the run
    // loop's --finalize takes, not a jump straight to released.
    expect(ledger.transitions).toEqual([
      { missionId: 'cell-archived-a', to: 'releasable' },
      { missionId: 'cell-archived-a', to: 'released' },
      { missionId: 'cell-archived-b', to: 'releasable' },
      { missionId: 'cell-archived-b', to: 'released' },
    ])
    // Nothing was written to a cell finalize skipped.
    expect(ledger.annotations).toEqual([])
    expect(report.cells.filter(cell => cell.action === 'skipped').map(cell => [cell.missionId, cell.state, cell.category]))
      .toEqual([
        ['cell-released', 'released', 'already-released'],
        ['cell-midstage', 'stage-2', 'interrupted'],
        ['cell-pending', 'pending', 'not-started'],
        ['cell-halted', 'halted', 'interrupted'],
      ])
  })

  it('reproduces the pilot-a-round1 tally: 3 released, 2 interrupted, 7 pending, nothing to finalize', async () => {
    const ledger = new FakeLedger(pilotShapedLedger())
    const report = await finalizeRun(ledger, 'run-20260907184513-1x84')
    expect(report.released).toBe(0)
    expect(report.skipped).toBe(12)
    expect(report.skippedByCategory).toEqual({ 'already-released': 3, interrupted: 2, 'not-started': 7 })
    // A run with nothing archived writes nothing at all.
    expect(ledger.transitions).toEqual([])
    expect(ledger.annotations).toEqual([])
  })
})

describe('finalizeRun — a refused gate', () => {
  it('records the refusal against the cell and leaves it where the gate stopped it, never forcing', async () => {
    const states = new Map([['cell-empty', 'archived'], ['cell-ok', 'archived']])
    const ledger = new FakeLedger(states, new Set(['cell-empty']))
    const report = await finalizeRun(ledger, 'run-gate', { by: 'tester' })

    expect(report.released).toBe(1)
    expect(report.refused).toBe(1)
    const refused = report.cells.find(cell => cell.missionId === 'cell-empty')
    expect(refused?.action).toBe('refused')
    // The cell stayed archived: neither edge was taken.
    expect(refused?.finalState).toBe('archived')
    expect(states.get('cell-empty')).toBe('archived')
    expect(refused?.reason).toContain('empty archive/verdicts/')
    expect(ledger.annotations).toEqual([{
      missionId: 'cell-empty',
      ns: 'orchestrator',
      payload: { kind: 'finalize-refused', from: 'archived', error: expect.stringContaining('file-check') },
    }])
  })

  it('records the state the gate DID reach when only the second edge refuses', async () => {
    // A ledger that allows archived → releasable but not releasable → released.
    const ledger: MissionFinalizeFace = {
      runStatus: () => ({ rows: [{ id: 'cell', state: 'archived' }] }),
      transition: async (_id, to) => {
        if (to === 'released') throw new Error('mission: releasable → released is not declared')
        return { changed: true }
      },
      annotate: async () => ({ added: true }),
    }
    const report = await finalizeRun(ledger, 'run-half')
    expect(report.cells[0]?.action).toBe('refused')
    expect(report.cells[0]?.finalState).toBe('releasable')
  })
})

describe('finalizeRun — refusals it cannot work around', () => {
  it('refuses loudly when the run cannot be projected', async () => {
    const ledger = new FakeLedger(new Map(), new Set(), true)
    await expect(finalizeRun(ledger, 'run-nope')).rejects.toBeInstanceOf(EvalFinalizeRefused)
  })
})

describe('skipCategoryOf', () => {
  it('splits done from interrupted from never-started', () => {
    expect(skipCategoryOf('released')).toBe('already-released')
    expect(skipCategoryOf('pending')).toBe('not-started')
    // Mid-gate counts as interrupted: only a cut-short finalize leaves a cell there.
    expect(skipCategoryOf('releasable')).toBe('interrupted')
    expect(skipCategoryOf('stage-1')).toBe('interrupted')
    expect(skipCategoryOf('judged')).toBe('interrupted')
  })
})

describe('parseMissionRow — the dsh-mission list row the CLI face reads', () => {
  it('reads id and state from a padded row and ignores the header and the tail', () => {
    expect(parseMissionRow('f2-multi-agent-room-dsh-exec-rep3 active     stage-2      task=F2,rep=3      -'))
      .toEqual({ id: 'f2-multi-agent-room-dsh-exec-rep3', state: 'stage-2' })
    expect(parseMissionRow('id              bucket    state       labels            plan')).toBeNull()
    expect(parseMissionRow('(12 mission(s))')).toBeNull()
    expect(parseMissionRow('')).toBeNull()
  })
})
