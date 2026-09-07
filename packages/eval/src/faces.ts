/**
 * Structural faces of the three upstream services the run loop drives
 * (`ctx.datasets`, `ctx.mission`, `ctx.localAgent`). Deliberately structural
 * and minimal: eval imports NOTHING from sibling @khorsheed packages — the
 * faces describe only what the orchestrator calls, resolved at run time with
 * `ctx.get` (degrade-don't-explode: a missing service is a refusal that names
 * it, never a boot failure).
 *
 * The delegation options carry `cwd` (the per-cell working directory, T11's
 * facade option). Against a facade that predates the option the field is
 * ignored and the child inherits the parent session's cwd — the run loop
 * detects that by the stage files' absence and fails the cell honestly
 * (submission-rejected), never silently mis-attributes output.
 * @module @khorsheed/dsh-eval
 */

/**
 * The scope every datasets call carries. The run loop reads the player-facing
 * `visible` layer with the bare scope (the service's modelFacing floor is
 * exactly right there); the JUDGE path names its one sensitive layer
 * EXPLICITLY (`layers: ['grading']` / `['verify']`) — the narrowest thing that
 * reaches an answer key, and narrower than the operator bypass the
 * architecture table allows.
 */
export interface DatasetsScope {
  repo: string
  /** Explicit layer whitelist; absent means the service's modelFacing floor. */
  layers?: readonly string[]
}

/** The datasets verbs the run loop uses (all explicit-layer reads). */
export interface DatasetsFace {
  snapshot(scope: DatasetsScope, datasetId: string, commit?: string): Promise<{
    repoPath: string
    commit: string
    datasetId: string
  }>
  worktreePath(scope: DatasetsScope, datasetId: string, options?: {
    commit?: string
    layers?: readonly string[]
  }): Promise<{ path: string; commit: string; layers: string[]; reused: boolean }>
  show(scope: DatasetsScope, datasetId: string, itemId?: string, commit?: string): Promise<{
    items: Array<{ id: string; layers: Record<string, string[]> }>
  }>
  read(scope: DatasetsScope, query: {
    dataset: string
    item?: string
    layer: string
    path: string
    commit?: string
  }): Promise<{ content: string; commit: string }>
}

/** One file of a mission submission. */
export interface MissionSubmitFile {
  path: string
  content: string
}

/** The mission verbs the run loop uses (the run's ledger). */
export interface MissionFace {
  /** The mission data root (`<root>/runs/<runId>/data/…` is the run-data tree). */
  readonly dataDir: string
  runCreate(options: {
    templatePath?: string
    template?: unknown
    runId?: string
    meta?: Record<string, unknown>
    originSession?: string
    by?: string
    now?: number
  }): Promise<{ run: { id: string }; existed: boolean; lint: { errors: string[]; warnings: string[] } }>
  transition(missionId: string, to: string, options?: { runId?: string; by?: string; note?: string }): Promise<{ changed: boolean }>
  submit(missionId: string, options: {
    runId?: string
    by?: string
    to?: string
    json?: unknown
    files?: MissionSubmitFile[]
    checkpoint?: string
  }): Promise<{ written: string[]; artifacts: number; checkpoint: string }>
  annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string; by?: string }): Promise<{ added: boolean }>
  retry(missionId: string, options: { runId?: string; reason: string; category: string; by?: string }): Promise<{ attempt: number }>
  setRefs(missionId: string, refs: { sessions?: string[] }, options?: { runId?: string; by?: string }): Promise<void>
  addArtifact(missionId: string, artifact: { path: string; kind: string }, options?: { runId?: string; by?: string }): Promise<{ added: boolean }>
  /** One mission's record as far as the loop needs it (current attempt state). */
  get(missionId: string, runId?: string): {
    mission: {
      currentAttempt: number
      attempts: Array<{ attempt: number; state: string }>
    }
  }
  exportRun(request: {
    runId: string
    outDir: string
    layers?: Array<{ name: string; guarded: boolean }>
    snapshotDir?: string
    snapshot?: { repo: string; commit: string; dataset?: string }
    now?: number
  }): { bundleDir: string; files: number }
}

/**
 * The terminal result of one delegation run (structural SubagentResult).
 * `usage` and `observedModel` are OPTIONAL supersets of today's result: a
 * facade that does not carry them leaves the judge's cost record null rather
 * than inventing one (the player path's read-back is T8b's).
 */
export interface DelegationResult {
  stopReason: string
  diagnostic?: string
  output?: unknown
  /** Normalized token usage, when the facade reports it. */
  usage?: unknown
  /** The model that actually served, when the facade reads it back. */
  observedModel?: string | null
}

/** One started delegation run (structural SubagentRun). */
export interface DelegationRun {
  /** The dsh child session id — the resume handle and the cancel key. */
  id: string
  result: Promise<DelegationResult>
}

/**
 * Delegation call options, including T11's `cwd` (the per-cell directory).
 * Structurally a superset of the current DelegationCallOptions: a facade
 * without the option ignores it.
 */
export interface EvalDelegationOptions {
  label?: string
  signal?: AbortSignal
  cwd?: string
}

/** The localAgent verbs the run loop uses. */
export interface LocalAgentFace {
  start(parentSessionId: string, provider: string, prompt: Array<{ type: 'text'; text: string }>, options?: EvalDelegationOptions): Promise<DelegationRun>
  resume(parentSessionId: string, provider: string, childSessionId: string, prompt: Array<{ type: 'text'; text: string }>, options?: EvalDelegationOptions): Promise<DelegationRun>
  cancel(childSessionId: string): boolean
  /** Harness lookup (name → delegationProvider); absent harness = undefined. */
  get(name: string): { delegationProvider?: string } | undefined
}
