/**
 * The pre-run readiness check (pilot A · G4).
 *
 * `/<harness> status` reports `authenticated: yes` for a credential record
 * that merely has the right SHAPE — an expired, unrefreshable grant reads the
 * same as a working one. Pilot A ran with that answer and every claude
 * delegation returned 401: six of twenty-four cells were doomed before the
 * run started, and the first evidence of it arrived at the first delegation.
 *
 * So this module does not ask. It spends one minimal delegation per condition
 * through the SAME facade the cells use — same provider, same cwd rule, same
 * read-back — and a condition is ready only when that delegation actually
 * completed. The cost is one short round per condition; the alternative is a
 * whole run's worth of cells discovering the same fact one at a time.
 *
 * The check also catches the misattribution the run loop can only find at its
 * first stage round: a facade that reads back a model different from the
 * condition's declared one (frozen decision 5).
 * @module @khorsheed/dsh-eval
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DelegationProgress, DelegationResult, LocalAgentFace } from './faces.ts'
import { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'

/**
 * The probe task, byte-for-byte. One sentence, no tools, no files: the point
 * is whether a delegation on this condition can start and complete at all,
 * and every additional requirement would turn an authentication failure into
 * an ambiguous one.
 */
export const READINESS_PROMPT
  = 'Readiness check: reply with the single word READY and nothing else. Do not use any tools and do not write any files.\n'

/** Default wall-clock cap on one readiness probe. */
export const DEFAULT_READINESS_TIMEOUT_MS = 120_000

/** One condition's readiness verdict — the payload of the `readiness` annotation. */
export interface ReadinessRecord {
  /** `readiness` — the annotation kind, carried in the record itself. */
  kind: 'readiness'
  condition: string
  harness: string
  /** The local-agent delegation provider the condition resolved to. */
  provider: string
  /** True only when a real delegation started AND completed. */
  ok: boolean
  /** Epoch ms the probe started. */
  startedAt: number
  /** How long the probe took, including a cancelled timeout. */
  durationMs: number
  /** The child session the probe ran in; null when the start itself failed. */
  childSessionId: string | null
  /** The condition's declared model. */
  declaredModel: string | null
  /** The model the facade read back for the probe; null when it reads none. */
  observedModel: string | null
  /** Why the condition is not ready; absent when it is. */
  reason?: string
}

/** One condition as the readiness check needs it (the run loop's resolved shape). */
export interface ReadinessSubject {
  id: string
  harnessName: string
  declaredModel: string | null
  provider: string
}

/** Inputs of {@link checkReadiness}. */
export interface ReadinessInput {
  localAgent: LocalAgentFace
  /** The conditions to probe, in plan order. */
  conditions: readonly ReadinessSubject[]
  /** The session every delegation parents to — the slash session. */
  parentSessionId: string
  /** Root of the per-condition probe directories (`<stateRoot>/readiness/<token>`). */
  probeDirBase: string
  /** Wall-clock cap per probe. */
  timeoutMs?: number
  /** Post-settle read-back wait (see {@link awaitObservedModel}). */
  readbackWaitMs?: number
  now?: () => number
  log?: (message: string) => void
}

/**
 * Probe every condition once. Never throws: a condition that cannot be
 * delegated to is a `ok: false` record with the reason, which is what the
 * caller refuses (or, with `--ignore-readiness`, records against the cells it
 * skips).
 * @param input - facade, conditions, and the probe directory root.
 * @returns one record per condition, in the order given.
 */
export async function checkReadiness(input: ReadinessInput): Promise<ReadinessRecord[]> {
  const now = input.now ?? ((): number => Date.now())
  const log = input.log ?? ((): void => {})
  const timeoutMs = input.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const readbackWaitMs = input.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS
  const records: ReadinessRecord[] = []
  for (const condition of input.conditions) {
    records.push(await probeOne(input.localAgent, condition, {
      parentSessionId: input.parentSessionId,
      cwd: join(input.probeDirBase, condition.id),
      timeoutMs,
      readbackWaitMs,
      now,
      log,
    }))
  }
  return records
}

async function probeOne(
  localAgent: LocalAgentFace,
  condition: ReadinessSubject,
  env: {
    parentSessionId: string
    cwd: string
    timeoutMs: number
    readbackWaitMs: number
    now: () => number
    log: (message: string) => void
  },
): Promise<ReadinessRecord> {
  const base = {
    kind: 'readiness' as const,
    condition: condition.id,
    harness: condition.harnessName,
    provider: condition.provider,
    declaredModel: condition.declaredModel,
  }
  const startedAt = env.now()
  mkdirSync(env.cwd, { recursive: true })

  const controller = new AbortController()
  let timedOut = false
  let childSessionId: string | undefined
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    if (childSessionId !== undefined) localAgent.cancel(childSessionId)
  }, env.timeoutMs)
  let settledModel: string | undefined

  const fail = (reason: string): ReadinessRecord => ({
    ...base,
    ok: false,
    startedAt,
    durationMs: env.now() - startedAt,
    childSessionId: childSessionId ?? null,
    observedModel: null,
    reason,
  })

  let run: Awaited<ReturnType<LocalAgentFace['start']>>
  try {
    run = await localAgent.start(env.parentSessionId, condition.provider, [{ type: 'text', text: READINESS_PROMPT }], {
      label: `readiness ${condition.id}`,
      signal: controller.signal,
      cwd: env.cwd,
      onProgress: (event: DelegationProgress) => {
        if (event.kind === 'settled' && event.observedModel !== undefined) settledModel = event.observedModel
      },
    })
  } catch (error) {
    clearTimeout(timer)
    const reason = `the delegation failed to start: ${error instanceof Error ? error.message : String(error)}`
    env.log(`readiness ${condition.id}: NOT READY — ${reason}`)
    return fail(reason)
  }
  childSessionId = run.id

  let result: DelegationResult
  try {
    result = await run.result
  } catch (error) {
    clearTimeout(timer)
    const reason = `the delegation faulted: ${error instanceof Error ? error.message : String(error)}`
    env.log(`readiness ${condition.id}: NOT READY — ${reason}`)
    return fail(reason)
  }
  clearTimeout(timer)
  const observedModel = settledModel ?? await awaitObservedModel(localAgent, run.id, undefined, env.readbackWaitMs)
  const durationMs = env.now() - startedAt
  const record: ReadinessRecord = {
    ...base,
    ok: true,
    startedAt,
    durationMs,
    childSessionId: run.id,
    observedModel,
  }

  if (timedOut) {
    const reason = `the probe exceeded ${Math.round(env.timeoutMs / 1000)}s and was cancelled (${run.id})`
    env.log(`readiness ${condition.id}: NOT READY — ${reason}`)
    return { ...record, ok: false, reason }
  }
  if (result.stopReason !== 'completed') {
    // This is the G4 case: a live-looking credential whose delegation is
    // refused. The diagnostic carries the 401 the status surface cannot see.
    const reason = `the delegation ended with stopReason ${JSON.stringify(result.stopReason)}`
      + `${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`
    env.log(`readiness ${condition.id}: NOT READY — ${reason}`)
    return { ...record, ok: false, reason }
  }
  if (observedModel !== null && condition.declaredModel !== null && observedModel !== condition.declaredModel) {
    // Frozen decision 5, caught before the run instead of at its first stage
    // round: the whole run would be misattributed.
    const reason = `the probe ran ${JSON.stringify(observedModel)} but the condition declares ${JSON.stringify(condition.declaredModel)}`
      + ' — the run would be misattributed'
    env.log(`readiness ${condition.id}: NOT READY — ${reason}`)
    return { ...record, ok: false, reason }
  }
  env.log(`readiness ${condition.id}: ready (${(durationMs / 1000).toFixed(1)}s, model ${observedModel ?? '—'})`)
  return record
}
