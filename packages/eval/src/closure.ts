/**
 * The two run-level MARKS a human leaves on an experiment after it ran: the
 * CLOSURE (how human review ended — one of four exits) and the ARCHIVE flag.
 *
 * Both follow the export note's pattern ({@link ./export-note.ts}): a run has
 * no writable record of its own (`run.meta` is frozen at `runCreate`), so a
 * mark is written as an annotation on the run's FIRST cell and read by
 * scanning every cell for the newest. Written narrow, read wide.
 *
 * The closure is what moves an experiment from 评估中 to 已完成 (exits ①②③)
 * or to 评估不成立 (exit ④). Nothing else does: a run whose every cell was
 * released but that nobody closed is still 评估中, because "the judge is done"
 * and "a human has said what the result is" are different facts (T72).
 *
 * Rules the writer enforces, so the reader never has to adjudicate:
 * - the newest mark wins (ledger `createdAt`, then the payload's own `at`);
 * - `flagged` and `void` need a reason — they are the two exits whose whole
 *   point is the sentence that explains them;
 * - once the newest closure is `void`, further closures are refused. Voiding
 *   says the evaluation cannot stand; a later "final" over it would quietly
 *   turn a withdrawn result back into one.
 *
 * The archive mark changes GROUPING only. It never enters the status rule.
 * @module @khorsheed/dsh-eval
 */
import type { MissionAnnotateFace, MissionReadFace } from './faces.ts'
import type {
  EvalArchiveMark, EvalArchiveWrite, EvalClosure, EvalClosureExit, EvalClosureWrite, EvalRunMarks,
} from './types.ts'

export type { EvalArchiveMark, EvalClosure, EvalClosureExit, EvalClosureRefusal, EvalClosureWrite, EvalRunMarks } from './types.ts'

/** The annotation namespace closures are written in. */
export const CLOSURE_NS = 'eval-closure'
/** The annotation namespace archive marks are written in. */
export const ARCHIVE_NS = 'eval-archive'

export const CLOSURE_EXITS: readonly EvalClosureExit[] = ['final', 'flagged', 'unreviewed', 'void']

/** Exits that cannot be taken without a reason. */
const REASON_REQUIRED: ReadonlySet<EvalClosureExit> = new Set(['flagged', 'void'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function isClosureExit(value: unknown): value is EvalClosureExit {
  return typeof value === 'string' && (CLOSURE_EXITS as readonly string[]).includes(value)
}

function closureOf(payload: unknown): EvalClosure | null {
  if (!isPlainObject(payload) || payload['kind'] !== 'closure') return null
  const exit = payload['exit']
  const at = stringOrNull(payload['at'])
  if (!isClosureExit(exit) || at === null) return null
  return { exit, reason: stringOrNull(payload['reason']), at, by: stringOrNull(payload['by']) }
}

function archiveOf(payload: unknown): EvalArchiveMark | null {
  if (!isPlainObject(payload) || payload['kind'] !== 'archive') return null
  const at = stringOrNull(payload['at'])
  if (typeof payload['archived'] !== 'boolean' || at === null) return null
  return { archived: payload['archived'], at, by: stringOrNull(payload['by']) }
}

/** Newer-than on (ledger createdAt, payload at) — the second breaks same-millisecond ties. */
function newer(a: { createdAt: number; at: string }, b: { createdAt: number; at: string } | null): boolean {
  if (b === null) return true
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt
  return a.at >= b.at
}

type Annotated = ReadonlyArray<{ ns: string; payload: unknown; createdAt: number }>

/**
 * Fold annotations (from any number of cells) into the run's marks.
 * @param lists - each cell's annotations.
 * @returns the newest closure, the newest archive mark, and the newest annotation time.
 */
export function foldRunMarks(lists: Iterable<Annotated>): EvalRunMarks {
  let closure: { value: EvalClosure; createdAt: number; at: string } | null = null
  let archive: { value: EvalArchiveMark; createdAt: number; at: string } | null = null
  let lastAnnotationAt: number | null = null
  for (const annotations of lists) {
    for (const annotation of annotations) {
      if (lastAnnotationAt === null || annotation.createdAt > lastAnnotationAt) lastAnnotationAt = annotation.createdAt
      if (annotation.ns === CLOSURE_NS) {
        const value = closureOf(annotation.payload)
        if (value === null) continue
        const candidate = { value, createdAt: annotation.createdAt, at: value.at }
        if (newer(candidate, closure)) closure = candidate
      } else if (annotation.ns === ARCHIVE_NS) {
        const value = archiveOf(annotation.payload)
        if (value === null) continue
        const candidate = { value, createdAt: annotation.createdAt, at: value.at }
        if (newer(candidate, archive)) archive = candidate
      }
    }
  }
  return { closure: closure?.value ?? null, archive: archive?.value ?? null, lastAnnotationAt }
}

/**
 * Read a run's marks by scanning every cell. A cell the ledger cannot resolve
 * contributes nothing rather than failing the read.
 * @param mission - mission's read face.
 * @param runId - the run.
 * @param rows - the run's rows when the caller already holds them.
 * @returns the run's marks.
 */
export function readRunMarks(
  mission: MissionReadFace,
  runId: string,
  rows?: ReadonlyArray<{ id: string }>,
): EvalRunMarks {
  let cells = rows
  if (cells === undefined) {
    try {
      cells = mission.runStatus(runId).rows
    } catch {
      return { closure: null, archive: null, lastAnnotationAt: null }
    }
  }
  const lists: Annotated[] = []
  for (const row of cells) {
    try {
      lists.push(mission.get(row.id, runId).mission.annotations)
    } catch {
      // an unreadable cell contributes no marks
    }
  }
  return foldRunMarks(lists)
}

async function writeOnFirstCell(
  annotate: MissionAnnotateFace,
  mission: MissionReadFace,
  runId: string,
  ns: string,
  payload: Record<string, unknown>,
  by: string | undefined,
): Promise<{ ok: true } | { ok: false; refusal: 'no-cell' | 'ledger'; detail: string }> {
  let missionId: string | undefined
  try {
    missionId = mission.runStatus(runId).rows[0]?.id
  } catch (error) {
    return { ok: false, refusal: 'ledger', detail: error instanceof Error ? error.message : String(error) }
  }
  if (missionId === undefined) return { ok: false, refusal: 'no-cell', detail: `run ${runId} holds no cell` }
  try {
    await annotate.annotate(missionId, ns, payload, { runId, ...(by === undefined ? {} : { by }) })
    return { ok: true }
  } catch (error) {
    return { ok: false, refusal: 'ledger', detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Take one of the four exits.
 * @param annotate - mission's annotate face.
 * @param mission - mission's read face.
 * @param runId - the run being closed.
 * @param request - the exit, its reason, who, and when (injectable for tests).
 * @returns whether it landed, and the closure now in force.
 */
export async function recordClosure(
  annotate: MissionAnnotateFace,
  mission: MissionReadFace,
  runId: string,
  request: { exit: unknown; reason?: string | null; by?: string; now?: Date },
): Promise<EvalClosureWrite> {
  const standing = readRunMarks(mission, runId).closure
  if (!isClosureExit(request.exit)) return { recorded: false, refusal: 'unknown-exit', detail: null, closure: standing }
  if (standing !== null && standing.exit === 'void') {
    return { recorded: false, refusal: 'already-void', detail: null, closure: standing }
  }
  const reason = stringOrNull(request.reason)
  if (REASON_REQUIRED.has(request.exit) && reason === null) {
    return { recorded: false, refusal: 'reason-required', detail: null, closure: standing }
  }
  const closure: EvalClosure = {
    exit: request.exit,
    reason: reason?.trim() ?? null,
    at: (request.now ?? new Date()).toISOString(),
    by: request.by ?? null,
  }
  const written = await writeOnFirstCell(annotate, mission, runId, CLOSURE_NS, {
    kind: 'closure', exit: closure.exit, reason: closure.reason, at: closure.at, by: closure.by,
  }, request.by)
  if (!written.ok) return { recorded: false, refusal: written.refusal, detail: written.detail, closure: standing }
  return { recorded: true, refusal: null, detail: null, closure }
}

/**
 * Archive or un-archive a run. Grouping only; the status rule never reads it.
 * @param annotate - mission's annotate face.
 * @param mission - mission's read face.
 * @param runId - the run.
 * @param request - the flag, who, and when.
 * @returns whether it landed.
 */
export async function recordArchive(
  annotate: MissionAnnotateFace,
  mission: MissionReadFace,
  runId: string,
  request: { archived: boolean; by?: string; now?: Date },
): Promise<EvalArchiveWrite> {
  const mark: EvalArchiveMark = {
    archived: request.archived,
    at: (request.now ?? new Date()).toISOString(),
    by: request.by ?? null,
  }
  const written = await writeOnFirstCell(annotate, mission, runId, ARCHIVE_NS, {
    kind: 'archive', archived: mark.archived, at: mark.at, by: mark.by,
  }, request.by)
  if (!written.ok) return { recorded: false, detail: written.detail, archive: readRunMarks(mission, runId).archive }
  return { recorded: true, detail: null, archive: mark }
}
