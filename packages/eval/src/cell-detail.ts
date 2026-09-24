/**
 * The CELL DRAWER's projection (ui-spec §五): everything about ONE cell —
 * its attempts with their refs, checkpoints, artifacts and transitions, what
 * each annotation namespace has to say, the verify output verbatim, the
 * delegation's child session, the JUDGE's rounds and the sessions they ran
 * in, and whether its resources may be destroyed.
 *
 * This is the companion of `runCells`, which answers about a RUN's cells; the
 * drawer needs one cell in full, and a list that carried this much per row
 * would be a wire payload nobody reads. Both go through the structural mission
 * face — eval imports nothing from mission, and the browser half reads eval's
 * own Remote, never mission's (ui-spec R2).
 *
 * The verify output deserves its own note. There is no `lab` annotation
 * namespace on this line: the probes the container path runs through
 * `lab.verify` (and the host path runs directly) are recorded by the
 * orchestrator as a `kind: 'probes'` annotation, and THAT is what the drawer
 * shows whole. Reporting it as "lab's" would name a source that does not
 * exist; reporting it summarized would hide the exit codes and the skip
 * reasons, which is the whole reason a person opens this drawer.
 * @module @khorsheed/dsh-eval
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MissionActionFace, MissionAttemptFace, MissionReadFace } from './faces.ts'
import { EvalReadRefused } from './read.ts'
import type {
  EvalCellAnnotationNs, EvalCellAttempt, EvalCellDetail, EvalCellJudgeSession, EvalCellProbeRun,
} from './types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * Where the orchestrator wrote one attempt's run data. The layout is mission's
 * store's and eval's run loop writes into exactly this path, so this is a
 * shared convention rather than a guess — but it is still only read on a face
 * that reports `dataDir`, and the absence degrades to "hash unknown".
 */
export function attemptDataDir(dataDir: string, runId: string, missionId: string, attempt: number): string {
  return join(dataDir, 'runs', runId, 'data', missionId, `attempt-${attempt}`)
}

/**
 * The materialization digest of one attempt: the `sha256` field of the
 * `materialization.json` the run loop wrote beside the cell. Null for every
 * reason a file can be missing — a run that predates the record, a ledger root
 * this composition cannot see, a half-written attempt. Never guessed.
 * @param dataDir - the mission data root, or undefined on a face without one.
 * @param runId - the run.
 * @param missionId - the cell.
 * @param attempt - the attempt whose material is wanted.
 * @returns the digest, or null.
 */
export async function materializationShaOf(
  dataDir: string | undefined,
  runId: string,
  missionId: string,
  attempt: number,
): Promise<string | null> {
  if (dataDir === undefined) return null
  try {
    const text = await readFile(join(attemptDataDir(dataDir, runId, missionId, attempt), 'materialization.json'), 'utf8')
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? stringOrNull(parsed['sha256']) : null
  } catch {
    return null
  }
}

/** One annotation as the ledger hands it over. */
interface LedgerAnnotation {
  ns: string
  attempt: number
  payload: unknown
  createdAt: number
  by?: string
}

/** A one-line digest of an annotation payload: its `kind`, else its shape. */
function digestOf(payload: unknown): string {
  if (isPlainObject(payload)) {
    const kind = stringOrNull(payload['kind'])
    if (kind !== null) return kind
    const keys = Object.keys(payload)
    return keys.length === 0 ? '{}' : `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`
  }
  if (Array.isArray(payload)) return `[${payload.length}]`
  return typeof payload === 'string' ? payload.slice(0, 80) : String(payload)
}

/** ns → count + the newest entry's digest, namespace-sorted. */
export function summarizeAnnotations(annotations: readonly LedgerAnnotation[]): EvalCellAnnotationNs[] {
  const byNs = new Map<string, LedgerAnnotation[]>()
  for (const annotation of annotations) {
    if (!byNs.has(annotation.ns)) byNs.set(annotation.ns, [])
    byNs.get(annotation.ns)?.push(annotation)
  }
  return [...byNs.keys()].sort().map((ns) => {
    const entries = byNs.get(ns) as LedgerAnnotation[]
    // Annotations are append-only, so the last one written is the newest.
    const latest = entries[entries.length - 1]
    return {
      ns,
      count: entries.length,
      latestAt: latest === undefined ? null : latest.createdAt,
      latest: latest === undefined ? null : digestOf(latest.payload),
      by: latest?.by ?? null,
    }
  })
}

/** The `probes` annotations, verbatim — the verify output, oldest first. */
export function probeRunsOf(annotations: readonly LedgerAnnotation[]): EvalCellProbeRun[] {
  const runs: EvalCellProbeRun[] = []
  for (const annotation of annotations) {
    if (annotation.ns !== 'orchestrator' || !isPlainObject(annotation.payload)) continue
    const kind = stringOrNull(annotation.payload['kind'])
    if (kind !== 'probes' && kind !== 'probes-failed') continue
    const list = Array.isArray(annotation.payload['probes']) ? annotation.payload['probes'] : []
    runs.push({
      at: annotation.createdAt,
      where: stringOrNull(annotation.payload['where']),
      // Whole, pretty — a probe's exit code and skip reason are exactly what a
      // reader opens this for, and a summary would drop them.
      raw: JSON.stringify(annotation.payload, null, 2),
      probes: list.flatMap((entry) => {
        if (!isPlainObject(entry)) return []
        return [{
          probe: stringOrNull(entry['probe']),
          origin: stringOrNull(entry['origin']),
          exitCode: numberOrNull(entry['exitCode']),
          outcome: stringOrNull(entry['outcome']),
          ok: entry['ok'] === true,
          verdicts: numberOrNull(entry['verdicts']),
          durationMs: numberOrNull(entry['durationMs']),
          error: stringOrNull(entry['error']),
          reason: stringOrNull(entry['reason']),
        }]
      }),
    })
  }
  return runs
}

/**
 * The JUDGE rounds recorded on a cell, oldest first.
 *
 * The orchestrator writes one `kind: 'judge'` annotation per judge round, and
 * that annotation has carried the round's `childSessionId` since judging
 * existed — the judge is delegated to exactly like a player, so its
 * transcript is a host session with its messages and tool calls in it. What
 * was missing was never the record, only a door: the drawer read ONE session
 * id for the whole cell, so a person who wanted to know why a verdict came
 * out the way it did had nothing but the verdict's own `evidence` line.
 *
 * A round that failed before the delegation started is kept, with a null
 * session and its error: «这次判官没跑起来» is an answer, and dropping the
 * row would make it look like the judge never ran at all.
 * @param annotations - the cell's annotations, ledger order.
 * @returns one entry per judge round.
 */
export function judgeSessionsOf(annotations: readonly LedgerAnnotation[]): EvalCellJudgeSession[] {
  const rounds: EvalCellJudgeSession[] = []
  for (const annotation of annotations) {
    if (annotation.ns !== 'orchestrator' || !isPlainObject(annotation.payload)) continue
    if (stringOrNull(annotation.payload['kind']) !== 'judge') continue
    const payload = annotation.payload
    rounds.push({
      judgeCondition: stringOrNull(payload['judgeCondition']),
      judgeModel: stringOrNull(payload['judgeModel']),
      sample: numberOrNull(payload['sample']),
      attempt: numberOrNull(payload['attempt']),
      childSessionId: stringOrNull(payload['childSessionId']),
      at: annotation.createdAt,
      selfJudged: payload['selfJudged'] === true,
      error: stringOrNull(payload['error']),
    })
  }
  return rounds
}

/** Project one attempt record onto the wire shape. */
function attemptView(attempt: MissionAttemptFace): EvalCellAttempt {
  const retry = attempt.retry
  return {
    attempt: attempt.attempt,
    state: attempt.state ?? null,
    retry: retry === undefined
      ? null
      : {
        reason: retry.reason ?? null,
        category: retry.category ?? null,
        at: retry.at ?? null,
        by: retry.by ?? null,
      },
    refs: {
      resource: attempt.refs?.resource ?? null,
      fingerprint: attempt.refs?.fingerprint ?? null,
      sessions: [...(attempt.refs?.sessions ?? [])],
    },
    checkpoints: (attempt.checkpoints ?? []).map(checkpoint => ({ name: checkpoint.name, at: checkpoint.at ?? null })),
    artifacts: (attempt.artifacts ?? []).map(artifact => ({
      path: artifact.path,
      kind: artifact.kind,
      addedAt: artifact.addedAt ?? null,
    })),
    history: (attempt.history ?? []).map(entry => ({ from: entry.from, to: entry.to, at: entry.at ?? null })),
  }
}

/** The current attempt of a record, structurally (the same rule `runCells` applies). */
export function currentAttemptOf(
  attempts: readonly MissionAttemptFace[],
  currentAttempt: number | undefined,
  fallback: number,
): MissionAttemptFace | undefined {
  if (attempts.length === 0) return undefined
  const wanted = currentAttempt ?? fallback
  return attempts.find(attempt => attempt.attempt === wanted) ?? attempts[attempts.length - 1]
}

/**
 * The player's child session of one cell — the 打开子会话 target.
 *
 * refs' session trail is the delegation's own record; the orchestrator's
 * annotations are the fallback for a round that failed before refs existed.
 *
 * Only the PLAYER's rounds count here. Three annotation kinds carry a
 * `childSessionId` — `delegation`, `readiness` and `judge` — and the loop
 * used to take the last one of ANY kind, so a cell whose refs were empty
 * offered 打开子会话 on whatever ran last, which on a judged cell is the
 * JUDGE's session and on a refused one is the readiness probe. Both are
 * real sessions, so nothing failed; it just silently answered a different
 * question. The judge's rounds have their own door (`judgeSessions`).
 * @param current - the attempt whose refs are read first.
 * @param annotations - the cell's annotations, for the fallback.
 */
export function playerSessionOf(
  current: MissionAttemptFace | undefined,
  annotations: readonly LedgerAnnotation[],
): string | null {
  const sessions = current?.refs?.sessions
  if (sessions !== undefined && sessions.length > 0) return sessions[sessions.length - 1] as string
  let annotatedSession: string | null = null
  for (const annotation of annotations) {
    if (!isPlainObject(annotation.payload)) continue
    const kind = stringOrNull(annotation.payload['kind'])
    if (kind !== 'delegation' && kind !== 'delegation-failed') continue
    const child = annotation.payload['childSessionId']
    if (typeof child === 'string') annotatedSession = child
  }
  return annotatedSession
}

/**
 * Project ONE cell in full.
 * @param mission - the mission read face (`ctx.mission`).
 * @param actions - the release-check face; absent reports `releasable: false`
 *   rather than claiming a gate it could not ask.
 * @param runId - the run.
 * @param missionId - the cell.
 * @param options - the clock the duration is taken against.
 * @returns the drawer payload.
 * @throws {@link EvalReadRefused} when the run or the cell is not in the ledger.
 */
export async function runCellDetail(
  mission: MissionReadFace,
  actions: MissionActionFace | undefined,
  runId: string,
  missionId: string,
  options: { now?: number } = {},
): Promise<EvalCellDetail> {
  const status = mission.runStatus(runId)
  const row = status.rows.find(candidate => candidate.id === missionId)
  if (row === undefined) {
    throw new EvalReadRefused(`no cell ${JSON.stringify(missionId)} in run ${JSON.stringify(runId)}`)
  }
  const now = options.now ?? Date.now()

  // Same degrade as the list projections: a record the ledger cannot resolve
  // reads as no detail rather than failing the drawer.
  let record: {
    currentAttempt?: number
    attempts?: readonly MissionAttemptFace[]
    annotations: readonly LedgerAnnotation[]
    title?: string
    labels?: Record<string, string>
  } | undefined
  try {
    record = mission.get(missionId, runId).mission
  } catch {
    record = undefined
  }
  const attempts = record?.attempts ?? []
  const current = currentAttemptOf(attempts, record?.currentAttempt, row.currentAttempt)
  const annotations = record?.annotations ?? []

  const enteredCurrentAt = typeof row.enteredCurrentAt === 'number'
    ? row.enteredCurrentAt
    : numberOrNull(current?.enteredAt?.[row.state])

  let releasable = false
  if (actions !== undefined) {
    try {
      releasable = actions.isReleasable(missionId, runId)
    } catch {
      // A ledger that cannot answer the gate is not a releasable cell.
      releasable = false
    }
  }

  const rep = Number(row.labels['rep'])
  return {
    runId: status.run.id,
    missionId,
    title: record?.title ?? null,
    task: row.labels['task'] ?? null,
    condition: row.labels['condition'] ?? null,
    rep: Number.isFinite(rep) ? rep : null,
    labels: { ...row.labels },
    state: row.state,
    bucket: row.bucket,
    attempt: row.currentAttempt,
    enteredCurrentAt,
    inStateMs: enteredCurrentAt === null ? null : Math.max(0, now - enteredCurrentAt),
    refs: {
      resource: current?.refs?.resource ?? null,
      fingerprint: current?.refs?.fingerprint ?? null,
    },
    materializationSha: await materializationShaOf(mission.dataDir, runId, missionId, row.currentAttempt),
    childSessionId: playerSessionOf(current, annotations),
    // Every session on this page — the player's and each judge round's — is a
    // SUBAGENT of this one, and the host's reader refuses a subagent session
    // addressed without it.
    parentSessionId: status.run.originSession ?? null,
    judgeSessions: judgeSessionsOf(annotations),
    attempts: attempts.map(attemptView),
    annotations: summarizeAnnotations(annotations),
    probes: probeRunsOf(annotations),
    releasable,
  }
}
