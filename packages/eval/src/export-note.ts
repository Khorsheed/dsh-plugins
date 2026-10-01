/**
 * The run-level EXPORT NOTE: where this run's bundle went, when, and what was
 * exported into it — plus the two timestamps that decide whether the bundle
 * still says what the ledger says.
 *
 * A bundle is not reachable from `run.meta`. The meta names the plan and the
 * dataset repository, and a run started with `--out <dir>` put its bundle
 * under neither, so the report page could only call an exported bundle 未导出
 * and offer a text box to type the directory into (I5·T53). The note is the
 * missing record: every export — the orchestrator's own at the end of a run,
 * the dialog's, and a re-export after the final verdicts — writes one, and the
 * report page reads the newest.
 *
 * It is a run-level fact and, since T89, recorded as one: a RUN-LEVEL
 * annotation in the `orchestrator` namespace (mission's `annotateRun`; see
 * {@link ./run-notes.ts}). Before T89 the ledger had only a per-cell door, so
 * the note went on the run's FIRST cell; an older mission still gets exactly
 * that, and the reader scans the run-level list plus every cell, so a note an
 * older run left on any cell is still found. A run with no note at all makes
 * the page fall back to the directory candidates, as it always did.
 *
 * The second half is G17. The bundle is exported when the run ends; the final
 * verdicts are written afterwards, from the judge bench, and they do not
 * travel back into a directory that was already written. Nothing said so: the
 * walkthrough learned it by reading `manifest.json`'s `exportedAt` and noticing
 * it predated the human-final by minutes. Both timestamps are read here, in one
 * pass, so the report page can say the sentence instead of a reader finding it.
 * @module @khorsheed/dsh-eval
 */
import type { MissionAnnotateFace, MissionReadFace } from './faces.ts'
import { runLevelAnnotations, writeRunNote } from './run-notes.ts'

/** The `orchestrator` annotation kind this module writes and reads. */
export const EXPORT_NOTE_KIND = 'export'

/** The dataset snapshot reference an export was made against. */
export interface EvalExportSnapshotRef {
  repo: string
  commit: string
  dataset: string | null
}

/** What one export of a run wrote, and where. */
export interface EvalExportNote {
  /** The directory the export was pointed at — the bundle's PARENT. */
  outDir: string
  /** The bundle itself (`<outDir>/<runId>-bundle`). */
  bundleDir: string
  /** Epoch ms the export was made; the field the staleness sentence compares. */
  exportedAt: number
  /** The layers that export included, so a re-export can repeat exactly it. */
  layers: string[]
  /** The materialized snapshot directory the layers were copied from, if any. */
  snapshotDir: string | null
  /** The snapshot reference recorded into the bundle's manifest, if any. */
  snapshot: EvalExportSnapshotRef | null
  /** `report/summary.md`, written by the same action; null when it could not be. */
  summaryPath: string | null
  /** Why the report was not written beside the bundle; null when it was. */
  reportError: string | null
}

/** The two facts the report page needs about a run's exports, in one ledger pass. */
export interface EvalExportState {
  /** The newest export of this run, or null when none was ever recorded. */
  note: EvalExportNote | null
  /** Epoch ms of the newest `human-final` verdict, or null when none exists. */
  lastHumanFinalAt: number | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** One annotation payload as a note, or null when it is some other orchestrator record. */
function noteOf(payload: unknown): EvalExportNote | null {
  if (!isPlainObject(payload) || payload['kind'] !== EXPORT_NOTE_KIND) return null
  const bundleDir = stringOrNull(payload['bundleDir'])
  const exportedAt = payload['exportedAt']
  if (bundleDir === null || typeof exportedAt !== 'number' || !Number.isFinite(exportedAt)) return null
  const snapshot = isPlainObject(payload['snapshot']) ? payload['snapshot'] : null
  const repo = snapshot === null ? null : stringOrNull(snapshot['repo'])
  const commit = snapshot === null ? null : stringOrNull(snapshot['commit'])
  return {
    outDir: stringOrNull(payload['outDir']) ?? bundleDir,
    bundleDir,
    exportedAt,
    layers: Array.isArray(payload['layers'])
      ? payload['layers'].filter((layer): layer is string => typeof layer === 'string')
      : [],
    snapshotDir: stringOrNull(payload['snapshotDir']),
    snapshot: repo === null || commit === null ? null : { repo, commit, dataset: stringOrNull(snapshot?.['dataset']) },
    summaryPath: stringOrNull(payload['summaryPath']),
    reportError: stringOrNull(payload['reportError']),
  }
}

/** The note as it goes on the wire into the ledger (plain JSON, nulls explicit). */
export function exportNotePayload(note: EvalExportNote): Record<string, unknown> {
  return {
    kind: EXPORT_NOTE_KIND,
    outDir: note.outDir,
    bundleDir: note.bundleDir,
    exportedAt: note.exportedAt,
    layers: [...note.layers],
    snapshotDir: note.snapshotDir,
    snapshot: note.snapshot === null ? null : { ...note.snapshot },
    summaryPath: note.summaryPath,
    reportError: note.reportError,
  }
}

/**
 * Record one export against the run.
 *
 * Written at run level (or, against a mission predating that, on the run's
 * FIRST cell — the choice that is the same on every call). Best-effort:
 * a composition whose ledger refuses the annotation still exported a bundle,
 * and losing the breadcrumb must not lose the artifact. What comes back says
 * which it was, so a caller can report the difference rather than imply one.
 * @param annotate - mission's annotate face.
 * @param mission - mission's read face (the run's cells).
 * @param runId - the run the export belongs to.
 * @param note - what was exported and where.
 * @param by - caller tag recorded against the annotation.
 * @returns whether the note reached the ledger, and why not when it did not.
 */
export async function recordExportNote(
  annotate: MissionAnnotateFace,
  mission: MissionReadFace,
  runId: string,
  note: EvalExportNote,
  by?: string,
): Promise<{ recorded: boolean; reason: string | null }> {
  return outcome(await writeRunNote(
    annotate, runId, 'orchestrator', exportNotePayload(note), by, () => mission.runStatus(runId).rows[0]?.id,
  ), runId)
}

function outcome(written: Awaited<ReturnType<typeof writeRunNote>>, runId: string): { recorded: boolean; reason: string | null } {
  if (written.ok) return { recorded: true, reason: null }
  return {
    recorded: false,
    reason: written.refusal === 'no-cell' ? `run ${runId} holds no cell to record the export against` : written.detail,
  }
}

/**
 * {@link recordExportNote} for a caller that already knows the run's first
 * cell — the run loop, which is holding its own ordered cell list at the
 * moment it exports and has no reason to ask the ledger for it again. The
 * cell is only the legacy fallback: a mission with `annotateRun` gets the
 * note at run level.
 * @param annotate - mission's annotate face.
 * @param missionId - the cell the note falls back to on an older mission.
 * @param runId - the run the export belongs to.
 * @param note - what was exported and where.
 * @param by - caller tag recorded against the annotation.
 * @returns whether the note reached the ledger, and why not when it did not.
 */
export async function recordExportNoteOn(
  annotate: MissionAnnotateFace,
  missionId: string | undefined,
  runId: string,
  note: EvalExportNote,
  by?: string,
): Promise<{ recorded: boolean; reason: string | null }> {
  return outcome(await writeRunNote(annotate, runId, 'orchestrator', exportNotePayload(note), by, () => missionId), runId)
}

/**
 * Read the run's newest export note and its newest human-final timestamp.
 *
 * ONE pass for both — the run-level list (where the note lives since T89),
 * then every cell (the pre-T89 note, and every human-final): they are read together on every report
 * render, and the pair is what the staleness sentence is made of. Every cell
 * the ledger cannot resolve contributes nothing rather than failing the read —
 * a report page is not the place to discover that one mission record is
 * unreadable.
 * @param mission - mission's read face.
 * @param runId - the run being read.
 * @returns the newest note (null when none) and the newest human-final time.
 */
export function readExportState(mission: MissionReadFace, runId: string): EvalExportState {
  let note: EvalExportNote | null = null
  let lastHumanFinalAt: number | null = null
  const lists: Array<ReadonlyArray<{ ns: string; payload: unknown; createdAt: number }>> = [runLevelAnnotations(mission, runId)]
  try {
    for (const row of mission.runStatus(runId).rows) {
      try {
        lists.push(mission.get(row.id, runId).mission.annotations)
      } catch {
        // an unreadable cell contributes nothing
      }
    }
  } catch {
    // no cell list: the run-level list alone
  }
  for (const annotations of lists) {
    for (const annotation of annotations) {
      if (annotation.ns === 'human-final') {
        if (lastHumanFinalAt === null || annotation.createdAt > lastHumanFinalAt) lastHumanFinalAt = annotation.createdAt
        continue
      }
      if (annotation.ns !== 'orchestrator') continue
      const candidate = noteOf(annotation.payload)
      if (candidate === null) continue
      if (note === null || candidate.exportedAt > note.exportedAt) note = candidate
    }
  }
  return { note, lastHumanFinalAt }
}

/**
 * The directory a RE-export goes into: a fresh one beside the first.
 *
 * mission names a bundle `<outDir>/<runId>-bundle`, so two exports of one run
 * into one directory are the same directory — the second would overwrite the
 * first, and the first is what a reader may already have quoted from. eval
 * cannot rename the bundle (the name is mission's), so it moves the PARENT:
 * a re-export is pointed at `<outDir>/re-<stamp>/`, which makes the bundle
 * `<outDir>/re-<stamp>/<runId>-bundle`. The old directory is left alone, and
 * the note points at the new one, which is how the page finds it.
 * @param outDir - the directory the previous export was pointed at.
 * @param at - epoch ms of the re-export (its stamp, so the name is its time).
 * @returns the directory to pass to the export verb.
 */
export function reexportDirOf(outDir: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  // Not `join`: the caller's directory may be relative and this must not
  // normalize it into something the note no longer matches.
  return `${outDir.replace(/\/+$/, '')}/re-${stamp}`
}
