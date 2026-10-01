/**
 * The one door every run-level eval MARK goes through — the export note
 * (`orchestrator` / kind `export`), the closure (`eval-closure`) and the
 * archive flag (`eval-archive`).
 *
 * Since T89 mission has run-level annotations of its own (`annotateRun` /
 * `runAnnotations`: append-only, namespace-isolated, on the run record). Until
 * then a run had no writable record (`run.meta` is frozen at `runCreate`), so
 * each mark was written on the run's FIRST cell and read by scanning every
 * cell. Both halves change here and nowhere else:
 *
 * - **write**: run level when mission has the verb; an older mission without
 *   it gets the first-cell write exactly as before, so the mark still lands.
 * - **read**: the run-level list PLUS every cell's list. Runs written before
 *   T89 (or against an older mission) carry their marks on a cell, and those
 *   stay readable forever — nothing is migrated, nothing is rewritten. The
 *   readers already pick the newest across all lists, so an old first-cell
 *   mark and a newer run-level one compose without a rule of their own.
 * @module @khorsheed/dsh-eval
 */
import type { MissionAnnotateFace, MissionReadFace } from './faces.ts'

/** One annotation as the mark readers fold it. */
export type RunNoteAnnotation = { ns: string; payload: unknown; createdAt: number }

/** What a mark write did: where it landed, or why it did not. */
export type RunNoteWrite =
  | { ok: true; level: 'run' | 'cell' }
  | { ok: false; refusal: 'no-cell' | 'ledger'; detail: string }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Write one run-level mark.
 * @param annotate - mission's annotate face (`annotateRun` preferred when present).
 * @param runId - the run.
 * @param ns - annotation namespace.
 * @param payload - the mark.
 * @param by - caller tag.
 * @param firstCell - the legacy fallback's cell: called ONLY when mission has
 *   no `annotateRun`; may throw (a ledger error) or return undefined (no cell).
 * @returns where it landed, or the refusal.
 */
export async function writeRunNote(
  annotate: MissionAnnotateFace,
  runId: string,
  ns: string,
  payload: Record<string, unknown>,
  by: string | undefined,
  firstCell: () => string | undefined,
): Promise<RunNoteWrite> {
  if (typeof annotate.annotateRun === 'function') {
    try {
      await annotate.annotateRun(runId, ns, payload, by === undefined ? {} : { by })
      return { ok: true, level: 'run' }
    } catch (error) {
      return { ok: false, refusal: 'ledger', detail: message(error) }
    }
  }
  let missionId: string | undefined
  try {
    missionId = firstCell()
  } catch (error) {
    return { ok: false, refusal: 'ledger', detail: message(error) }
  }
  if (missionId === undefined) return { ok: false, refusal: 'no-cell', detail: `run ${runId} holds no cell` }
  try {
    await annotate.annotate(missionId, ns, payload, { runId, ...(by === undefined ? {} : { by }) })
    return { ok: true, level: 'cell' }
  } catch (error) {
    return { ok: false, refusal: 'ledger', detail: message(error) }
  }
}

/**
 * The run's own annotation list; empty when mission predates the verb or the
 * read fails (a report page is not where a ledger error surfaces).
 * @param mission - mission's read face.
 * @param runId - the run.
 * @returns run-level annotations, oldest first.
 */
export function runLevelAnnotations(mission: MissionReadFace, runId: string): readonly RunNoteAnnotation[] {
  if (typeof mission.runAnnotations !== 'function') return []
  try {
    return mission.runAnnotations(runId)
  } catch {
    return []
  }
}
