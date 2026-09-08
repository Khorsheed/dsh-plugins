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
 * @module @khorsheed/dsh-eval
 */
import type { MissionFinalizeFace } from './faces.ts'

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
}

/** Options of {@link finalizeRun}. */
export interface FinalizeOptions {
  /** Caller tag for the mission writes. Default `eval-orchestrator`. */
  by?: string
  /** Progress sink (the slash and CLI wrappers print these lines). */
  log?: (message: string) => void
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
 * Walk every cell of `runId` through the release gate.
 * @param mission - the mission ledger face (run projection + the two writes).
 * @param runId - the run to finalize.
 * @param options - caller tag and progress sink.
 * @returns what happened to every cell.
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

  const cells: FinalizeCellOutcome[] = []
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
    // The same two edges the run loop's --finalize takes, guards and all.
    let reached = row.state
    try {
      await mission.transition(row.id, 'releasable', { runId, by })
      reached = 'releasable'
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
      cells.push({ missionId: row.id, state: row.state, action: 'refused', finalState: reached, reason })
      continue
    }
    log(`cell ${row.id}: archived → releasable → released`)
    cells.push({ missionId: row.id, state: row.state, action: 'released', finalState: 'released' })
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
  return {
    runId,
    cells,
    released: cells.filter(cell => cell.action === 'released').length,
    refused: cells.filter(cell => cell.action === 'refused').length,
    skipped: cells.filter(cell => cell.action === 'skipped').length,
    skippedByCategory,
    skippedByState,
  }
}
