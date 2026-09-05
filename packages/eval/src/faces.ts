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

/** The datasets verbs the run loop uses (all explicit-visible-layer reads). */
export interface DatasetsFace {
  snapshot(scope: { repo: string }, datasetId: string, commit?: string): Promise<{
    repoPath: string
    commit: string
    datasetId: string
  }>
  worktreePath(scope: { repo: string }, datasetId: string, options?: {
    commit?: string
    layers?: readonly string[]
  }): Promise<{ path: string; commit: string; layers: string[]; reused: boolean }>
  show(scope: { repo: string }, datasetId: string, itemId?: string, commit?: string): Promise<{
    items: Array<{ id: string; layers: Record<string, string[]> }>
  }>
  read(scope: { repo: string }, query: {
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

/** The terminal result of one delegation run (structural SubagentResult). */
export interface DelegationResult {
  stopReason: string
  diagnostic?: string
  output?: unknown
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
