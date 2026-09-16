/**
 * `finalize` — the re-entry point for a run that already stopped at
 * `archived` (pilot A · G13).
 *
 * `--finalize` on `/eval run` only exists at the moment the run starts, and
 * judging-then-final-review is exactly the work that happens AFTER archiving.
 * Pilot A therefore pushed twelve cells through `dsh-mission transition` by
 * hand, one at a time. This verb is that walk, mechanized: for every
 * `archived` cell of a run it takes the SAME gate (`archived → releasable →
 * released`, the archive gate's non-empty `verdicts/` file-check included),
 * and for every cell that is not `archived` it says so and moves on.
 *
 * Two things it deliberately does not do. It does not force: a gate refusal
 * is recorded against that cell (`finalize-refused` in the orchestrator ns)
 * and the cell stays where it is — the gate is the reason the archive means
 * anything. And it does not touch a cell that never reached `archived`: a
 * pending or mid-stage cell is unfinished work, not un-released work.
 *
 * Since T57 the walk also DESTROYS the cell's unit, in the one place the gate
 * authorizes it: between the two transitions. Before that it moved the ledger
 * and nothing else, so a container run finalized after the fact reached
 * `released` with every container still up and no gate left that could
 * release them — the shape T39's G18 found on 3171. The unit face is
 * optional, because one caller (the CLI, which drives `dsh-mission` in a
 * child process) has no lab to hand it; absent face, absent destroy, and the
 * report says so rather than implying the containers went away.
 * @module @khorsheed/dsh-eval
 */
import type { LabUnitRow, MissionFinalizeFace } from './faces.ts'

/** Thrown when finalize cannot even look at the run (no service, unknown run). */
export class EvalFinalizeRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvalFinalizeRefused'
  }
}

/** The one state finalize acts on; everything else is reported and skipped. */
export const FINALIZE_FROM_STATE = 'archived'

/**
 * The slice of lab finalize needs: which units are still up, and the one
 * destroy verb. Deliberately two methods and not the whole {@link LabFace} —
 * the release walk has no business populating or archiving anything.
 */
export interface FinalizeUnitsFace {
  status(unitId?: string): Promise<readonly LabUnitRow[]>
  release(unitId: string, options?: { force?: boolean }): Promise<void>
}

/** What the walk did with one cell's unit. */
export interface FinalizeCellUnit {
  id: string
  resource: string
  /** True when the destroy went through; false when it was attempted and failed. */
  released: boolean
  /** lab's verbatim refusal, when the destroy failed. */
  reason?: string
}

/**
 * A unit still up when the walk ended, with the reason no gate could authorize
 * its destroy. This is the list the report page's 未回收 count is drawn from,
 * and every entry names something a human can act on — which is the whole
 * point of reporting it rather than leaving it to `docker ps`.
 */
export interface FinalizeHeldUnit {
  id: string
  resource: string
  /** The cell it belongs to, or null for a unit of this run bound to none. */
  missionId: string | null
  /** That cell's state when the walk ended; null when the run does not own it. */
  missionState: string | null
  /** Why it is still up, in the terms the reader can act on. */
  reason: string
}

/**
 * Why a cell was skipped, coarse enough to summarize a whole run in one line:
 * it is already done, the run was interrupted before it archived, or it never
 * started at all.
 */
export type FinalizeSkipCategory = 'already-released' | 'interrupted' | 'not-started'

/** What finalize did to one cell. */
export interface FinalizeCellOutcome {
  missionId: string
  /** The state the cell was in when finalize looked at it. */
  state: string
  action: 'released' | 'refused' | 'skipped'
  /** Where the cell ended up (unchanged for a skip; the last state a refused gate allowed). */
  finalState: string
  /** The gate's refusal, or why the cell was skipped. */
  reason?: string
  /** Set on skipped cells only. */
  category?: FinalizeSkipCategory
  /** Set when this cell held a unit the walk tried to destroy. */
  unit?: FinalizeCellUnit
}

/** The finalize answer: what moved, what refused, and what was left alone. */
export interface FinalizeReport {
  runId: string
  /** One entry per cell of the run, in the ledger's order. */
  cells: FinalizeCellOutcome[]
  released: number
  refused: number
  skipped: number
  /** Skipped cells per category — the operator's one-line summary. */
  skippedByCategory: Record<FinalizeSkipCategory, number>
  /** Skipped cells per raw state, for the per-cell listing's totals. */
  skippedByState: Record<string, number>
  /** Units the walk destroyed, one per released cell that held one. */
  unitsReleased: number
  /**
   * Units of this run still up when the walk ended, each with the reason. An
   * EMPTY list and an UNAVAILABLE list are different facts: see
   * {@link FinalizeReport.unitsKnown}.
   */
  unitsHeld: FinalizeHeldUnit[]
  /**
   * Whether the unit list is knowable at all — false when the caller handed no
   * unit face, or lab could not be asked. A caller that reports `0 held` off a
   * false here is inventing the fact this whole field exists to prevent.
   */
  unitsKnown: boolean
}

/** Options of {@link finalizeRun}. */
export interface FinalizeOptions {
  /** Caller tag for the mission writes. Default `eval-orchestrator`. */
  by?: string
  /** Progress sink (the slash and CLI wrappers print these lines). */
  log?: (message: string) => void
  /**
   * The unit face. Present: each cell that passes the gate has its unit
   * destroyed between the two transitions, and the walk reports what is still
   * up. Absent: the walk moves the ledger only, and says the unit list is
   * unknown rather than reporting zero.
   */
  units?: FinalizeUnitsFace
}

/**
 * Which class of "not archived" a state falls into. `releasable` counts as
 * interrupted on purpose: a cell there is mid-gate, which only happens when
 * a previous finalize was cut short.
 */
export function skipCategoryOf(state: string): FinalizeSkipCategory {
  if (state === 'released') return 'already-released'
  if (state === 'pending') return 'not-started'
  return 'interrupted'
}

/**
 * The units this run holds right now, keyed by the cell they belong to. Never
 * throws: a lab that cannot be asked leaves the walk doing what it did before
 * this face existed, and the caller is told the list is unknown.
 * @param units - the unit face.
 * @param runId - the run whose units to pick out of lab's whole list.
 * @param log - progress sink, for the one line an unreachable lab is worth.
 * @returns the rows of this run, or null when lab could not be asked.
 */
async function heldUnitsOf(
  units: FinalizeUnitsFace,
  runId: string,
  log: (message: string) => void,
): Promise<LabUnitRow[] | null> {
  try {
    return (await units.status()).filter(row => row.runId === runId)
  } catch (error) {
    log(`units: lab could not be asked which units this run holds — ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Why a unit of this run is still up, said in the terms its reader can act on.
 * The interesting case is the last one: a cell that is already `released` has
 * no gate left that can authorize a destroy (`releasable` is the only state
 * `isReleasable` says yes in), so the container outlives every non-forcing
 * path there is. Naming `--force` here is not an invitation — it is the fact
 * that the remaining move belongs to a human.
 * @param state - the cell's state when the walk ended, or null when this run
 *   owns no such cell.
 * @param unitId - the unit, for the command the reader would have to type.
 * @returns the reason line.
 */
function heldReasonOf(state: string | null, unitId: string): string {
  if (state === null) return 'it is bound to no cell of this run'
  if (state === FINALIZE_FROM_STATE) return 'the archive gate refused its cell, so nothing authorized the destroy'
  if (state === 'released') {
    return `its cell is already past the gate (released), so no releasable gate can authorize the destroy`
      + ` — \`dsh-lab release ${unitId} --force\` is a human's call`
  }
  return `its cell is ${state}: unfinished work, not un-released work`
}

/**
 * Destroy one cell's unit, at the one moment the gate authorizes it.
 *
 * NEVER throws, and that is the whole design of it. A destroy that failed is
 * a container left behind — bad, reported, recoverable by a human. A destroy
 * that failed and ALSO stranded its cell at `releasable` would be worse than
 * both: `releasable` is not a state finalize acts on, so the next walk would
 * skip the cell as `interrupted` and nothing would ever move it again. The
 * ledger fact ("this cell passed the gate") is true either way; the container
 * is a separate fact, and it goes in {@link FinalizeReport.unitsHeld}.
 * @param units - the unit face, or undefined when the caller has no lab.
 * @param row - the unit this cell holds, or undefined when it holds none.
 * @param env - the ledger face and the write tags, for the retention record.
 * @returns what happened, or undefined when there was nothing to destroy.
 */
async function releaseCellUnit(
  units: FinalizeUnitsFace | undefined,
  row: LabUnitRow | undefined,
  env: {
    mission: MissionFinalizeFace
    runId: string
    by: string
    missionId: string
    log: (message: string) => void
  },
): Promise<FinalizeCellUnit | undefined> {
  if (units === undefined || row === undefined) return undefined
  try {
    // No force, ever, on this path: the gate is the reason the archive means
    // anything, and a destroy that can be reached by asking twice is not a
    // gate. lab consults `mission.isReleasable` itself and will refuse if the
    // cell is not where this walk just put it.
    await units.release(row.id)
    return { id: row.id, resource: row.resource, released: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    env.log(`unit ${row.resource} was NOT released (the cell passed the archive gate): ${reason}`)
    await env.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'unit-retained',
      unit: row.id,
      resource: row.resource,
      why: 'the cell passed the archive gate',
      reason,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return { id: row.id, resource: row.resource, released: false, reason }
  }
}

/**
 * Walk every cell of `runId` through the release gate, destroying each
 * passing cell's unit on the way through.
 * @param mission - the mission ledger face (run projection + the two writes).
 * @param runId - the run to finalize.
 * @param options - caller tag, progress sink, and the optional unit face.
 * @returns what happened to every cell, and what is still up afterwards.
 * @throws {@link EvalFinalizeRefused} when the run cannot be projected.
 */
export async function finalizeRun(
  mission: MissionFinalizeFace,
  runId: string,
  options: FinalizeOptions = {},
): Promise<FinalizeReport> {
  const by = options.by ?? 'eval-orchestrator'
  const log = options.log ?? ((): void => {})

  let rows: ReadonlyArray<{ id: string; state: string }>
  try {
    rows = mission.runStatus(runId).rows
  } catch (error) {
    throw new EvalFinalizeRefused(
      `cannot project run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // The units this run holds, read ONCE before the walk: the map is what tells
  // each passing cell which container is its own, and re-reading it per cell
  // would ask lab the same question as many times as the run has cells.
  const units = options.units
  const before = units === undefined ? null : await heldUnitsOf(units, runId, log)
  const heldByMission = new Map<string, LabUnitRow>()
  for (const row of before ?? []) {
    if (row.missionId !== undefined) heldByMission.set(row.missionId, row)
  }

  const cells: FinalizeCellOutcome[] = []
  let unitsReleased = 0
  for (const row of rows) {
    if (row.state !== FINALIZE_FROM_STATE) {
      const category = skipCategoryOf(row.state)
      cells.push({
        missionId: row.id,
        state: row.state,
        action: 'skipped',
        finalState: row.state,
        category,
        reason: `not ${FINALIZE_FROM_STATE} (${row.state})`,
      })
      continue
    }
    // The same two edges the run loop takes, guards and all — and the same
    // destroy, in the same place between them.
    let reached = row.state
    let unit: FinalizeCellUnit | undefined
    try {
      await mission.transition(row.id, 'releasable', { runId, by })
      reached = 'releasable'
      // The gate has just said yes, and `releasable` is the ONLY state it says
      // yes in. Destroying after `released` would ask the gate a question it
      // answers no to, which is precisely how G18's containers survived their
      // own finalize.
      unit = await releaseCellUnit(units, heldByMission.get(row.id), { mission, runId, by, missionId: row.id, log })
      if (unit?.released === true) unitsReleased += 1
      await mission.transition(row.id, 'released', { runId, by })
      reached = 'released'
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // Recorded, never bypassed: an empty verdicts/ means the cell has no
      // judged evidence, and forcing it past the gate would erase that fact.
      await mission.annotate(row.id, 'orchestrator', {
        kind: 'finalize-refused',
        from: reached,
        error: reason,
      }, { runId, by }).catch(() => {})
      log(`cell ${row.id}: gate refused at ${reached} — ${reason}`)
      cells.push({
        missionId: row.id, state: row.state, action: 'refused', finalState: reached, reason,
        ...(unit === undefined ? {} : { unit }),
      })
      continue
    }
    log(`cell ${row.id}: archived → releasable → released${unit === undefined ? '' : ` (unit ${unit.resource}${unit.released ? ' released' : ' RETAINED'})`}`)
    cells.push({
      missionId: row.id, state: row.state, action: 'released', finalState: 'released',
      ...(unit === undefined ? {} : { unit }),
    })
  }

  const skippedByCategory: Record<FinalizeSkipCategory, number> = {
    'already-released': 0,
    interrupted: 0,
    'not-started': 0,
  }
  const skippedByState: Record<string, number> = {}
  for (const cell of cells) {
    if (cell.action !== 'skipped' || cell.category === undefined) continue
    skippedByCategory[cell.category] += 1
    skippedByState[cell.state] = (skippedByState[cell.state] ?? 0) + 1
  }
  // Re-read rather than derive: what is still up is lab's answer, not a
  // subtraction over what this walk believes it destroyed. A unit somebody
  // else released mid-walk, and one whose destroy silently did not take, are
  // both facts only the fresh list carries.
  const after = units === undefined ? null : await heldUnitsOf(units, runId, log)
  const stateOf = new Map(cells.map(cell => [cell.missionId, cell.finalState]))
  const unitsHeld: FinalizeHeldUnit[] = (after ?? []).map(row => {
    const missionId = row.missionId ?? null
    const missionState = missionId === null ? null : stateOf.get(missionId) ?? null
    return { id: row.id, resource: row.resource, missionId, missionState, reason: heldReasonOf(missionState, row.id) }
  })
  if (unitsHeld.length > 0) {
    log(`units: ${unitsHeld.length} unit(s) of this run are still up — ${unitsHeld.map(held => `${held.resource} (${held.reason})`).join('; ')}`)
  }

  return {
    runId,
    cells,
    released: cells.filter(cell => cell.action === 'released').length,
    refused: cells.filter(cell => cell.action === 'refused').length,
    skipped: cells.filter(cell => cell.action === 'skipped').length,
    skippedByCategory,
    skippedByState,
    unitsReleased,
    unitsHeld,
    unitsKnown: after !== null,
  }
}
