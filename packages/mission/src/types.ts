/**
 * Data model for the mission store (proposal §1). Everything here is plain
 * JSON — one run one `runs/<runId>.json` file, human-readable and auditable.
 * The plugin holds no domain vocabulary: coordinates live in `labels`, scene
 * semantics in `meta`, resource handles in opaque `refs`.
 *
 * Two concepts are deliberately unmixable: an **attempt** is a full re-run of
 * a mission (independent; the old attempt stays immutable), a **checkpoint**
 * is a continuous progress point INSIDE one attempt (later points build on
 * earlier ones).
 */

/** Transition guard: a precondition checked deterministically at transition time. */
export type Guard =
  | {
    /** Every expectedFile must exist under `<runDataDir>/<missionId>/attempt-<N>/<dir>`. No interpolation. */
    type: 'file-check'
    /** Relative to the attempt's run-data directory; absolute paths and `..` are rejected. */
    dir: string
    /** Entries ending in `/` must be directories; the rest must be plain files. */
    expectedFiles: string[]
  }
  | {
    /** The named JSON input must validate against this JSON Schema (subset, see schema.ts). */
    type: 'schema-check'
    /** Resolved against the template's directory (absolute paths used as-is). */
    schemaPath: string
    /**
     * What to validate: `'submission'` (default) — the payload recorded by
     * `submit`; `'run-meta'` — the run's `meta` object (e.g. a template can
     * require dataset-snapshot fields on the earliest transition, pinning
     * comparability the way `refs.fingerprint` pins the environment).
     */
    inputFrom?: 'submission' | 'run-meta'
  }
  | {
    /** An external script/human attested this key for the current attempt (`attest`). */
    type: 'attested'
    key: string
  }

/** One declared edge of a run's frozen state machine. */
export interface TransitionDecl {
  from: string
  to: string
  guard?: Guard
}

/** The state machine a run template declares; frozen into the run at creation. */
export interface StateMachineDecl {
  states: string[]
  transitions: TransitionDecl[]
  /**
   * `isReleasable` query basis. Non-empty declares "this run holds resources
   * to release", which activates the lint rules (guarded entries, no
   * releasable-bypassing terminal).
   */
  releasableStates: string[]
}

/** A mission as declared by a run template. */
export interface TemplateMission {
  id: string
  title?: string
  labels?: Record<string, string>
  dependsOn?: string[]
  scheduledAt?: number
}

/** A run template: state machine policy plus an optional mission batch. v1 files are JSON. */
export interface RunTemplate {
  name?: string
  stateMachine: StateMachineDecl
  missions: TemplateMission[]
}

/** Opaque resource references of one attempt. */
export interface AttemptRefs {
  /** Container name, worktree path, … — opaque to mission. */
  resource?: string
  /** Environment fingerprint (image digest / base commit) — opaque to mission. */
  fingerprint?: string
  /** Session ids involved in this attempt. */
  sessions?: string[]
}

/** A continuous progress point inside one attempt. */
export interface CheckpointRecord {
  name: string
  at: number
  /** Filled only by the resource holder (e.g. a git tag); `submit` never sets it. */
  ref?: string
  artifacts: string[]
}

/** One applied state transition. */
export interface HistoryEntry {
  from: string
  to: string
  at: number
  /** Call origin: `tool:<sessionId>`, `cli`, `service`, … recorded automatically. */
  by: string
  note?: string
}

/** An artifact index entry; `path` lives inside the attempt's run-data directory. */
export interface ArtifactRecord {
  path: string
  kind: string
  addedAt: number
}

/** An `attested`-guard registration. */
export interface AttestationRecord {
  key: string
  by: string
  at: number
  note?: string
}

/** The payload a `submit` call recorded, re-validated by schema-check guards at transition time. */
export interface SubmissionRecord {
  json?: unknown
  at: number
  by: string
}

export interface AttemptRecord {
  attempt: number
  state: string
  refs: AttemptRefs
  /** state → first entry timestamp (epoch ms). */
  enteredAt: Record<string, number>
  checkpoints: CheckpointRecord[]
  history: HistoryEntry[]
  artifacts: ArtifactRecord[]
  attestations: AttestationRecord[]
  submission?: SubmissionRecord
}

/** Append-only, namespace-isolated note. Writers pick ns freely; integrity checks live on the reading side. */
export interface AnnotationRecord {
  missionId: string
  attempt: number
  ns: string
  payload: unknown
  createdAt: number
  by: string
}

export interface MissionRecord {
  /** Unique within its run. */
  id: string
  title?: string
  labels: Record<string, string>
  dependsOn?: string[]
  scheduledAt?: number
  currentAttempt: number
  attempts: AttemptRecord[]
  annotations: AnnotationRecord[]
}

export interface RunRecord {
  id: string
  createdAt: number
  state: 'active' | 'closed'
  /** Opaque scene semantics. */
  meta: Record<string, unknown>
  /** Session that created the run (default filter of the future missions tab). */
  originSession?: string
  templateName?: string
  /** Base directory for schema-check `schemaPath` resolution (template file location). */
  templateDir?: string
  stateMachine: StateMachineDecl
  missions: MissionRecord[]
}

/** The five-bucket projection bucket (derived from state-machine shape + plan data, never stored). */
export type Bucket = 'ready' | 'scheduled' | 'blocked' | 'active' | 'done'

/** One row of the projected run/mission view. */
export interface MissionView {
  runId: string
  id: string
  title?: string
  labels: Record<string, string>
  state: string
  bucket: Bucket
  currentAttempt: number
  dependsOn?: string[]
  /** Dependency ids whose current state is not terminal (empty when satisfied). */
  blockedOn: string[]
  scheduledAt?: number
  releasable: boolean
  /**
   * True while the current attempt holds `refs.resource` in a state UPSTREAM of the
   * release gate (not a releasable state and not reachable from one — `released`
   * terminals downstream of the gate are settled and stay silent).
   */
  resourceHeld: boolean
  /** Epoch ms when the current state was entered (the queue view's duration column). */
  enteredCurrentAt: number
}
