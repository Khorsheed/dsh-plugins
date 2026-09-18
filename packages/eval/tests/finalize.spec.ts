/**
 * `finalize` — the post-run release walk (pilot A · G13), against a fake
 * mission ledger whose transitions enforce the same two things the real one
 * does: only declared edges, and the archive gate's non-empty `verdicts/`.
 * The interesting run is the MIXED one, because that is the only shape a
 * re-entry point ever meets: an interrupted run holds released cells,
 * mid-stage cells and cells that never started, all at once.
 */
import { describe, expect, it } from 'vitest'
import { finalizeRun, EvalFinalizeRefused, skipCategoryOf, type FinalizeUnitsFace } from '../src/finalize.ts'
import { parseMissionRow } from '../src/mission-cli.ts'
import type { LabUnitRow, MissionFinalizeFace } from '../src/faces.ts'

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

/**
 * A lab whose `release` consults the SAME gate the real one does — the ledger
 * this walk is moving. That is what makes the ORDER assertions mean something:
 * a destroy attempted after `released` is refused here exactly as it would be
 * on a host, which is the bug this face exists to pin.
 */
class FakeUnits implements FinalizeUnitsFace {
  readonly released: string[] = []
  constructor(
    private readonly rows: LabUnitRow[],
    private readonly states: Map<string, string>,
    /** Units whose destroy fails at the provider, however the gate answers. */
    private readonly broken: ReadonlySet<string> = new Set(),
  ) {}

  async status(): Promise<readonly LabUnitRow[]> {
    return this.rows.filter(row => !this.released.includes(row.id))
  }

  async release(unitId: string, options?: { force?: boolean }): Promise<void> {
    const row = this.rows.find(entry => entry.id === unitId)
    if (row === undefined) throw new Error(`fake lab: unknown unit ${unitId}`)
    if (options?.force !== true && row.missionId !== undefined && this.states.get(row.missionId) !== 'releasable') {
      throw new Error(
        `lab: release of ${unitId} refused — mission ${row.missionId} is not in a releasable state;`
        + ' archive and pass its gate first',
      )
    }
    if (this.broken.has(unitId)) throw new Error(`docker: could not remove ${row.resource}`)
    this.released.push(unitId)
  }
}

describe('finalizeRun — the containers (T57)', () => {
  it('destroys each passing cell\'s unit BETWEEN the two transitions, where the gate says yes', async () => {
    const states = new Map([['cell-a', 'archived'], ['cell-b', 'archived']])
    const ledger = new FakeLedger(states)
    const units = new FakeUnits([
      { id: 'u1', resource: 'dsh-lab-u1', running: true, missionId: 'cell-a', runId: 'run-1' },
      { id: 'u2', resource: 'dsh-lab-u2', running: true, missionId: 'cell-b', runId: 'run-1' },
    ], states)

    const report = await finalizeRun(ledger, 'run-1', { units })

    // The gate accepted both destroys, which is only possible at `releasable`:
    // the same face refuses at `archived` and at `released`.
    expect(units.released).toEqual(['u1', 'u2'])
    expect(report.unitsReleased).toBe(2)
    expect(report.unitsHeld).toEqual([])
    expect(report.unitsKnown).toBe(true)
    expect(report.cells.map(cell => cell.unit)).toEqual([
      { id: 'u1', resource: 'dsh-lab-u1', released: true },
      { id: 'u2', resource: 'dsh-lab-u2', released: true },
    ])
  })

  it('leaves a refused cell\'s container up, and says the gate is why', async () => {
    const states = new Map([['cell-empty', 'archived'], ['cell-ok', 'archived']])
    const ledger = new FakeLedger(states, new Set(['cell-empty']))
    const units = new FakeUnits([
      { id: 'u1', resource: 'dsh-lab-u1', running: true, missionId: 'cell-empty', runId: 'run-1' },
      { id: 'u2', resource: 'dsh-lab-u2', running: true, missionId: 'cell-ok', runId: 'run-1' },
    ], states)

    const report = await finalizeRun(ledger, 'run-1', { units })

    expect(units.released).toEqual(['u2'])
    expect(report.unitsReleased).toBe(1)
    expect(report.unitsHeld).toEqual([{
      id: 'u1',
      resource: 'dsh-lab-u1',
      missionId: 'cell-empty',
      missionState: 'archived',
      reason: 'the archive gate refused its cell, so nothing authorized the destroy',
    }])
  })

  it('reports a container whose cell is already past the gate as a human\'s call, and does not force it', async () => {
    // The G18 shape: a run finalized by the walk that only moved the ledger.
    // Nothing non-forcing can end these containers, and the report says so
    // instead of leaving them to `docker ps`.
    const states = new Map([['cell-done', 'released']])
    const ledger = new FakeLedger(states)
    const units = new FakeUnits(
      [{ id: 'u9', resource: 'dsh-lab-u9', running: true, missionId: 'cell-done', runId: 'run-1' }],
      states,
    )

    const report = await finalizeRun(ledger, 'run-1', { units })

    expect(units.released).toEqual([])
    expect(report.unitsHeld[0]?.reason).toContain('already past the gate')
    expect(report.unitsHeld[0]?.reason).toContain('dsh-lab release u9 --force')
  })

  it('never strands a cell mid-gate when the destroy itself fails', async () => {
    const states = new Map([['cell-a', 'archived']])
    const ledger = new FakeLedger(states)
    const units = new FakeUnits(
      [{ id: 'u1', resource: 'dsh-lab-u1', running: true, missionId: 'cell-a', runId: 'run-1' }],
      states,
      new Set(['u1']),
    )

    const report = await finalizeRun(ledger, 'run-1', { units })

    // The ledger fact is true and recorded: the cell DID pass its gate. Left
    // at `releasable` instead, no later walk would ever move it — finalize
    // acts on `archived` and would skip it as `interrupted` forever.
    expect(states.get('cell-a')).toBe('released')
    expect(report.released).toBe(1)
    expect(report.unitsReleased).toBe(0)
    expect(report.cells[0]?.unit).toMatchObject({ released: false, reason: expect.stringContaining('could not remove') })
    // The retention is on the cell, in the same ns and shape the run loop
    // writes it in.
    expect(ledger.annotations).toEqual([{
      missionId: 'cell-a',
      ns: 'orchestrator',
      payload: expect.objectContaining({ kind: 'unit-retained', unit: 'u1' }),
    }])
  })

  it('touches no unit of another run, and ignores one bound to no mission', async () => {
    const states = new Map([['cell-a', 'archived']])
    const ledger = new FakeLedger(states)
    const units = new FakeUnits([
      { id: 'u1', resource: 'dsh-lab-u1', running: true, missionId: 'cell-a', runId: 'run-1' },
      { id: 'u2', resource: 'dsh-lab-u2', running: true, missionId: 'someone-elses', runId: 'run-2' },
      { id: 'u3', resource: 'dsh-lab-u3', running: true, runId: 'run-1' },
    ], states)

    const report = await finalizeRun(ledger, 'run-1', { units })

    expect(units.released).toEqual(['u1'])
    // u2 belongs to another run and is not even listed; u3 is this run's but
    // bound to no cell, so no gate covers it and it is reported, not destroyed.
    expect(report.unitsHeld.map(held => held.id)).toEqual(['u3'])
    expect(report.unitsHeld[0]?.reason).toBe('it is bound to no cell of this run')
  })

  it('without a unit face the walk moves the ledger only, and says the list is unknown', async () => {
    const ledger = new FakeLedger(new Map([['cell-a', 'archived']]))
    const report = await finalizeRun(ledger, 'run-1')
    expect(report.released).toBe(1)
    // Not zero: the CLI face drives a ledger in a child process and has no lab
    // at all, and a confident `0 held` from there would be a lie.
    expect(report.unitsKnown).toBe(false)
    expect(report.unitsHeld).toEqual([])
  })

  it('survives a lab that cannot be asked, and still walks the gate', async () => {
    const ledger = new FakeLedger(new Map([['cell-a', 'archived']]))
    const lines: string[] = []
    const broken: FinalizeUnitsFace = {
      status: () => Promise.reject(new Error('docker daemon is not running')),
      release: () => Promise.reject(new Error('unreachable')),
    }
    const report = await finalizeRun(ledger, 'run-1', { units: broken, log: (line) => { lines.push(line) } })
    expect(report.released).toBe(1)
    expect(report.unitsKnown).toBe(false)
    expect(lines.join('\n')).toContain('docker daemon is not running')
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
