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
 * condition's declared one (frozen decision 5) — and, before spending any
 * delegation at all, a condition whose declared `preset` has no measured
 * capability face behind it (see {@link capabilityRefusal}).
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

/** What a probed condition is FOR: a subject under test, or the blind judge. */
export type ReadinessRole = 'player' | 'judge'

/** One condition's readiness verdict — the payload of the `readiness` annotation. */
export interface ReadinessRecord {
  /** `readiness` — the annotation kind, carried in the record itself. */
  kind: 'readiness'
  condition: string
  /**
   * Whether this condition is a player or the judge. A judge that cannot be
   * delegated to costs the WHOLE round's judging, not one cell — pilot B's
   * two judge samples both dropped while the run walked on to `released`
   * with an empty llm-draft namespace — so it is probed on the same rule and
   * refuses the run the same way.
   */
  role: ReadinessRole
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
  /**
   * The model the probe REQUESTED — the declared model when the condition
   * names one, null when it names none and the harness's own configuration
   * decided. Recorded beside {@link ReadinessRecord.observedModel} so a
   * reader can tell "asked for X, got X" from "asked for nothing, got X".
   */
  requestedModel: string | null
  /** The named scoped home the probe ran against; absent means the default one. */
  scope?: string
  /**
   * The capability fingerprint of the environment this condition runs in,
   * from its lock's `provisioned.capabilities`. Recorded so the bundle
   * carries WHICH capability face each subject was measured at, not merely
   * that one existed. Absent for a condition that composes no preset.
   */
  capabilities?: { sha: string; preset?: string | null }
  /** The model the facade read back for the probe; null when it reads none. */
  observedModel: string | null
  /** Why the condition is not ready; absent when it is. */
  reason?: string
  /**
   * Set on the container path: the throwaway unit this probe ran in. Its
   * fingerprint is the same composite the cells will get, so a probe that
   * passed proves the credential works in THAT environment rather than on the
   * host — which is the whole reason the probe moved into a unit.
   */
  unit?: { resource: string; fingerprint: string }
}

/** One condition as the readiness check needs it (the run loop's resolved shape). */
export interface ReadinessSubject {
  id: string
  harnessName: string
  declaredModel: string | null
  provider: string
  /** Defaults to `player`; the plan's judge conditions come through as `judge`. */
  role?: ReadinessRole
  /**
   * The condition's named scoped home, when it declares one. The probe runs
   * against the SAME scope the cells will, because that is where the
   * credential it is proving lives: probing the default scope for a
   * scope-`b` condition would prove another account's login.
   */
  scope?: string
  /** The condition's declared preset, or null / absent for none. */
  preset?: string | null
  /**
   * The capability fingerprint the condition's lock records, when provision
   * measured one. A condition that declares a preset and has none of these
   * is refused before its delegation: see {@link capabilityRefusal}.
   */
  capabilities?: { sha: string; preset?: string | null }
}

/**
 * Why a condition's capability claim fails, or undefined when it holds.
 *
 * A `preset` is a claim about the subject's capability FACE — which tools and
 * skills the model has. It enters the condition hash, so two conditions
 * differing only in preset are two subjects; if nothing checks it, they are
 * two subjects on paper and one in fact, and the run's whole comparison rests
 * on a field nobody measured. Provision measures it (the catalog's capability
 * hash over the provisioned environment) and records it in the lock; this is
 * where the record is required to exist and to agree.
 *
 * The check is cheap and local — it reads the lock, not the machine — and it
 * runs beside the delegation probe because it answers the same question:
 * is this subject the one the declaration names?
 * @param condition - the probed condition.
 * @returns the refusal reason, or undefined when nothing is claimed or all agrees.
 */
export function capabilityRefusal(condition: ReadinessSubject): string | undefined {
  const preset = condition.preset ?? null
  if (preset === null) return undefined
  if (condition.capabilities === undefined) {
    return `the condition declares preset ${JSON.stringify(preset)} but its lock records no provisioned.capabilities`
      + ' — the capability face was never measured, so the declared preset is a claim with nothing behind it'
      + ' (run `conditions provision` for this condition)'
  }
  const measured = condition.capabilities.preset
  if (measured !== undefined && measured !== preset) {
    return `the condition declares preset ${JSON.stringify(preset)} but its capability record was taken under ${JSON.stringify(measured)}`
      + ' — the provisioned environment belongs to another subject'
  }
  return undefined
}

/**
 * A throwaway probe unit: where the round runs, and how to destroy it. The
 * caller owns both — this module never acquires or releases anything itself,
 * so the run loop keeps exactly one destroy path.
 */
export interface ReadinessUnit {
  /** The container exec target the round runs in. */
  exec: { container: string; workdir: string; env?: Record<string, string> }
  /** The unit's composite environment fingerprint, recorded on the verdict. */
  fingerprint: string
  /** Destroy the unit. Called whatever the probe did, including when it threw. */
  release(): Promise<void>
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
  /**
   * Container path: acquire a throwaway unit for one condition and hand back
   * where to run and how to destroy it. Omitted, the probe runs on the host
   * in `<probeDirBase>/<condition>` — the pre-container behavior.
   *
   * The probe MUST meet the same environment the cells will: pilot A's whole
   * lesson (G4) is that a credential answering "authenticated" somewhere else
   * proves nothing, and a host probe for a container run would be exactly
   * that mistake one level up.
   *
   * Returning `undefined` declines a unit for that condition and probes it on
   * the host — which is right for the JUDGE: judging is a delegation from the
   * orchestrator, not from a cell, and it runs on the host even in a
   * container run. Probing it in a unit would test an environment it never
   * meets.
   */
  unitFor?: (condition: ReadinessSubject) => Promise<ReadinessUnit | undefined>
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
      ...(input.unitFor !== undefined ? { unitFor: input.unitFor } : {}),
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
    unitFor?: (condition: ReadinessSubject) => Promise<ReadinessUnit | undefined>
  },
): Promise<ReadinessRecord> {
  if (env.unitFor === undefined) return await probeIn(localAgent, condition, env, undefined)
  const startedAt = env.now()
  let unit: ReadinessUnit | undefined
  try {
    unit = await env.unitFor(condition)
  } catch (error) {
    const reason = `the probe unit could not be acquired: ${error instanceof Error ? error.message : String(error)}`
    env.log(`readiness ${condition.role === 'judge' ? 'judge ' : ''}${condition.id}: NOT READY — ${reason}`)
    return {
      kind: 'readiness',
      condition: condition.id,
      role: condition.role ?? 'player',
      harness: condition.harnessName,
      provider: condition.provider,
      declaredModel: condition.declaredModel,
      requestedModel: condition.declaredModel,
      ...(condition.scope === undefined ? {} : { scope: condition.scope }),
      ...(condition.capabilities === undefined ? {} : { capabilities: condition.capabilities }),
      ok: false,
      startedAt,
      durationMs: env.now() - startedAt,
      childSessionId: null,
      observedModel: null,
      reason,
    }
  }
  // Declined: this condition is probed on the host (the judge's case).
  if (unit === undefined) return await probeIn(localAgent, condition, env, undefined)
  const held = unit
  try {
    const record = await probeIn(localAgent, condition, env, held)
    return { ...record, unit: { resource: held.exec.container, fingerprint: held.fingerprint } }
  } finally {
    // Whatever the probe did, the unit goes. It is bound to no mission, so
    // this is the ONE destroy in the whole orchestrator that needs `force`.
    await held.release()
  }
}

async function probeIn(
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
  unit: ReadinessUnit | undefined,
): Promise<ReadinessRecord> {
  const base = {
    kind: 'readiness' as const,
    condition: condition.id,
    role: condition.role ?? 'player',
    harness: condition.harnessName,
    provider: condition.provider,
    declaredModel: condition.declaredModel,
    requestedModel: condition.declaredModel,
    ...(condition.scope === undefined ? {} : { scope: condition.scope }),
    ...(condition.capabilities === undefined ? {} : { capabilities: condition.capabilities }),
  }
  const startedAt = env.now()
  // Before spending a delegation: does the subject's capability claim have
  // anything behind it? A condition whose preset was never measured fails
  // here, at no token cost, instead of producing a whole run's worth of cells
  // attributed to a capability face nobody checked.
  const capabilityProblem = capabilityRefusal(condition)
  if (capabilityProblem !== undefined) {
    env.log(`readiness ${condition.role === 'judge' ? 'judge ' : ''}${condition.id}: NOT READY — ${capabilityProblem}`)
    return {
      ...base,
      ok: false,
      startedAt,
      durationMs: env.now() - startedAt,
      childSessionId: null,
      observedModel: null,
      reason: capabilityProblem,
    }
  }
  // Inside a unit the host cwd means nothing: the round runs in the unit's
  // workdir and no host directory is created for it.
  if (unit === undefined) mkdirSync(env.cwd, { recursive: true })

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
      ...(unit === undefined ? { cwd: env.cwd } : { exec: unit.exec }),
      // The scope is orthogonal to where the round runs: it names WHICH
      // scoped home the round reads credentials from, on the host and inside
      // a unit alike (the unit bind-mounts that same directory).
      ...(condition.scope === undefined ? {} : { scope: condition.scope }),
      // The probe asks for the SAME model the cells will: a readiness check
      // that ran the instance default while the cells run the declared model
      // would prove the wrong thing — which is exactly how a judge condition
      // declaring one model and inheriting another passed the probe and
      // failed the run (T22 step 5).
      ...(condition.declaredModel === null ? {} : { model: condition.declaredModel }),
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
