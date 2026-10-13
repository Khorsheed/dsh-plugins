/**
 * What the run loop's pieces share (T89 split of run.ts): the refusal and
 * failure classes, the per-run judging inputs, per-cell state, and the
 * run-data file names. Moved verbatim from run.ts.
 */
import { createHash } from 'node:crypto'
import type { CapabilityCompositionEvidence, LabFace } from '../faces.ts'
import { type EvalDiagnostic, type LockedCapabilities } from '../contract/validate.ts'
import { type DeidentifyRule, type ResolvedJudge } from '../judge/judge.ts'
import type { EgressCheckDecl } from './unit.ts'
import { type CellUnitPlan } from './unit.ts'

/** Thrown when a run is REFUSED before anything executes (data problems, missing services). */
export class EvalRunRefused extends Error {
  readonly diagnostics: EvalDiagnostic[]
  constructor(message: string, diagnostics: EvalDiagnostic[] = []) {
    super(message)
    this.name = 'EvalRunRefused'
    this.diagnostics = diagnostics
  }
}

/** An infrastructure-class cell failure: spawn failure, facade error, timeout (decision 8). */
export class InfrastructureFailure extends Error {}

/** A cell's output failed the contract (schema violation, missing files): no retry (decision 7). */
export class SubmissionRejected extends Error {
  readonly violations: string[]
  readonly stage: string
  constructor(stage: string, violations: string[]) {
    super(violations.join('; '))
    this.name = 'SubmissionRejected'
    this.stage = stage
    this.violations = violations
  }
}

/** Declared model ≠ observed model (frozen decision 5): the run is misattributed — fail loud. */
export class MisattributedRun extends Error {}

/**
 * The run was cancelled from outside (the job's `cancel`, which is the ONLY
 * cancellation entry — see {@link RunOptions.signal}). Distinct from an
 * infrastructure failure on purpose: a cancelled cell is NOT retried, and it
 * is left exactly where the cancel found it, so `finalize` classifies it
 * `interrupted` — the category T23 added for precisely this shape.
 */
export class RunCancelled extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunCancelled'
  }
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Default cell-directory root: `$DSH_HOME/state/eval` (decision 3). */
export interface ResolvedCondition {
  declaredEffort: string | null
  id: string
  sha: string
  harnessName: string
  declaredModel: string | null
  provider: string
  /**
   * The condition's named harness scope, when it declares one: every round of
   * every cell of this condition runs against `<homesRoot>/<harness>@<scope>`
   * instead of the harness's default scoped home. Absent means the default
   * one — what every condition written before the field asks for.
   */
  scope?: string
  /**
   * The condition's declared preset — the agent composition its environment
   * runs under — or null for none. Only a harness whose composition this
   * family provisions may name one (validate refuses the rest), so in
   * practice this is the sub-dsh's sub-profile roster.
   */
  preset: string | null
  /**
   * The capability fingerprint the condition's lock records, when provision
   * has measured one. It is the only evidence the declared `preset` was
   * actually built; a condition that declares a preset without it is a
   * subject whose capability face nobody checked. For a lock recording the
   * bound member's `capabilityComposition`, the sha and preset come from
   * that record and the record itself rides in `composition`.
   */
  lockedCapabilities?: LockedCapabilities & { composition?: CapabilityCompositionEvidence }
  /** The full condition document (recorded into run.meta for the report's factor diff). */
  document: Record<string, unknown>
}

/** The judging inputs one cell needs; shared by every cell of a run. */
export interface JudgeEnv {
  /** Resolved judge conditions (empty = no LLM judging this run). */
  judges: ResolvedJudge[]
  /** Samples per judge condition (decision 9: at least two). */
  samples: number
  /** The run-wide de-identification table (harness names + every declared model). */
  rules: DeidentifyRule[]
  /** `<stateRoot>/judge/<runId>` — RETAINED after the run, for review. */
  judgeDirBase: string
  /** `<stateRoot>/probes/<runId>` — removed per cell once its probes have run. */
  probeDirBase: string
  probeTimeoutMs: number
}

/** Per-cell mutable state carried across infrastructure retries. */
export interface CellState {
  childSessionIds: string[]
  promptShas: Record<string, string>
  spentMs: number
}


/** What one cell needs to run inside a unit: the face, and the resolved spec. */
export interface CellUnitBinding {
  lab: LabFace
  plan: CellUnitPlan
  /** The plan's egress self-check, when it declares one. */
  egressCheck?: EgressCheckDecl
}

/**
 * The host mirror marker. `lab.collect` registers what it copied as a mission
 * artifact, and the attempt's run-data directory is what the bundle carries —
 * so pointing the registration at the workspace itself would put a second
 * copy of every cell's workspace in every bundle, beside the archive that
 * already holds one. The marker is the artifact instead: one small file
 * saying where the host mirror of this unit's workspace lives, registered
 * once and re-registered (as a no-op) by every later collect.
 */
export const WORKSPACE_MIRROR = 'workspace-mirror.json'

/** Where the raw per-probe verdict files are collected back to, under the attempt's run data. */
export const PROBE_VERDICTS = 'probe-verdicts'

/** lab's own hash of what it copied into the unit — the proof, not the comparability number. */
export const POPULATE_MANIFEST = 'populate-manifest.json'
