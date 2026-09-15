/**
 * Structural faces of the three upstream services the run loop drives
 * (`ctx.datasets`, `ctx.mission`, `ctx.localAgent`). Deliberately structural
 * and minimal: eval imports NOTHING from sibling @khorsheed packages — the
 * faces describe only what the orchestrator calls, resolved at run time with
 * `ctx.get` (degrade-don't-explode: a missing service is a refusal that names
 * it, never a boot failure).
 *
 * The delegation options carry T11's `cwd` (the per-cell working directory)
 * and `onProgress` (the settled read-back). Against a facade that predates
 * the option the cwd field is ignored and the child inherits the parent
 * session's cwd — the run loop detects that by the stage files' absence and
 * fails the cell honestly (submission-rejected), never silently
 * mis-attributes output. `delegationOf` is optional on the face: a facade
 * predating T11 leaves the observed model null.
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
    /**
     * Dataset-level (shared) layer content, layer name → layer-relative paths.
     * OPTIONAL on the face: a facade predating it simply materializes no
     * shared verify layer, and the item's own probes still run — degrade,
     * don't explode.
     */
    datasetLayers?: Record<string, string[]>
    /**
     * The dataset descriptor, verbatim. The judging side reads ONE thing out
     * of it: the `register` entries, which say which of an item's layer files
     * are re-homed (their display path is item-relative) and which follow the
     * convention (their display path is relative to `items/<id>/<layer>/`).
     * Without it the judging directory cannot reproduce the repository's real
     * relative layout, and a probe's `../../../..` to the dataset-level
     * library lands one level off. OPTIONAL on the face: a facade that does
     * not report it degrades to the convention layout, which is what every
     * caller got before.
     */
    descriptor?: Record<string, unknown>
  }>
  read(scope: DatasetsScope, query: {
    dataset: string
    item?: string
    layer: string
    path: string
    commit?: string
  }): Promise<{ content: string; commit: string }>
}

/**
 * The capability catalog's read face — OPTIONAL, and only ever read for
 * provenance.
 *
 * The orchestrating instance has a capability face of its own (its planning
 * agent's tools and skills), and it is not a factor: the orchestrator does
 * not answer the dataset's questions, the players do. But it decides what the
 * apparatus could do while the run happened, so a bundle that cannot say what
 * the orchestrator was leaves a reader unable to reproduce the run's
 * conditions. It is recorded in `run.meta.orchestrator.capabilities` and
 * never compared.
 *
 * Structural, like every other face here: eval imports nothing from
 * `@khorsheed/dsh-capability-catalog`, and a composition without the catalog
 * simply records no capability line.
 */
export interface CapabilityCatalogFace {
  /**
   * The capability face of one preset, with its hash. `presetId` omitted
   * reads the deployment default — which is what the orchestrating instance
   * runs on. A named preset the roster cannot resolve REJECTS rather than
   * degrading to the global layer: a fingerprint that falls back is a false
   * one, not a weaker one.
   */
  snapshotFor(presetId?: string, workdir?: string): Promise<CapabilitySnapshotFace>
  /**
   * The digest of a snapshot the caller already holds. OPTIONAL, and the
   * fallback rather than the first choice: `snapshotFor` stamps `sha`
   * itself, so this is only reached against a catalog whose snapshot verb
   * predates the stamp. It is a module function on the catalog package and
   * may well be absent from the mounted service — probe, then degrade.
   */
  hashOf?(snapshot: CapabilitySnapshotFace): string
}

/** A capability snapshot as eval reads it — rows counted, never interpreted. */
export interface CapabilitySnapshotFace {
  /** The capability hash, stamped by the fingerprint verb. */
  sha?: string
  /** The preset the face was taken under; absent when the scope resolved to none. */
  preset?: string
  skills: readonly unknown[]
  tools: readonly unknown[]
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
  /**
   * Write the current attempt's refs. `sessions` is the delegation trail;
   * `resource` and `fingerprint` are the unit's, written by the orchestrator
   * right after `acquire` so the «环境一致» invariant has something to check
   * (pilot A left it blank and the invariant read `unverifiable` forever).
   */
  setRefs(missionId: string, refs: { sessions?: string[]; resource?: string; fingerprint?: string }, options?: { runId?: string; by?: string }): Promise<void>
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

/** Token usage as the settled event carries it (structural TokenUsage). */
export interface DelegationUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * One settled round's tool-call accounting as the facade reports it. `count`
 * is the only cross-harness comparable: `byName` keys are each CLI's own tool
 * vocabulary, recorded verbatim and never normalized (see the family's
 * `LocalAgentToolCalls`).
 */
export interface DelegationToolCalls {
  count: number
  byName?: Record<string, number>
}

/**
 * One progress event as the facade emits it. Only the `settled` kind carries
 * the read-back; every other kind (heartbeat / mirror / delta) is ignored
 * here, so `kind` stays open and the payload optional — a facade emitting
 * further variants stays assignable to this callback rather than failing to
 * type-check at the seam.
 */
export interface DelegationProgress {
  kind: string
  /** `settled` only: the model the provider observed for this round (T11). */
  observedModel?: string
  /** `settled` only: the CLI build the round actually ran, when read back. */
  cliVersion?: string
  /** `settled` only: the round's token usage, when the harness reported one. */
  usage?: DelegationUsage
  /** `settled` only: the round's tool calls, when the harness counted any. */
  toolCalls?: DelegationToolCalls
}

/**
 * A settled round's read-back (T11): the observed model and usage, either
 * optional — absence is recorded, never guessed.
 */
export interface DelegationSettled extends DelegationProgress {
  kind: 'settled'
}

/**
 * Delegation call options, including T11's `cwd` (the per-cell directory)
 * and `onProgress` (the settled read-back channel).
 */
export interface EvalDelegationOptions {
  label?: string
  signal?: AbortSignal
  cwd?: string
  onProgress?: (event: DelegationProgress) => void
  /**
   * T17's container target: run this round's CLI inside an already-acquired
   * unit (`docker exec -w <workdir> [-e NAME…] <container> <the same argv>`).
   * `cwd` is NOT passed alongside it — inside the unit the host cwd means
   * nothing, and the workdir is the workspace the unit was populated into.
   *
   * `env` must name the harness's in-container scoped-home variable
   * (`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`); the
   * provider refuses the round before any process when it is missing, because
   * forwarding its host path would start the CLI in a directory the unit does
   * not have. Values travel in the docker client's own environment, never on
   * the argv.
   */
  exec?: { container: string; workdir: string; env?: Record<string, string> }
  /**
   * T30b's per-delegation model: the condition's declared model, REQUESTED
   * rather than merely compared against. `start` only — the family refuses it
   * on `resume`, where the delegation re-requests what its first round
   * recorded. Absent (a condition that declares none) leaves the harness's own
   * configuration to decide, exactly as before.
   */
  model?: string
  /**
   * T29's scoped home: run this round against the harness's NAMED scoped home
   * (`<homesRoot>/<harness>@<scope>`) instead of its default one — the
   * condition's own `scope` field, so two conditions of the same harness can
   * be two accounts. Absent means the default scoped home, which is what
   * every condition without the field asks for.
   *
   * The scope must be the same on a cell's later rounds as on its first: the
   * family anchors it in the delegation record and refuses a resume that
   * names another (continuing a CLI session under another account's
   * credentials is not a thing that can be repaired later).
   */
  scope?: string
}

/** The read-only delegation projection T11's `delegationOf` returns. */
export interface DelegationInfo {
  childSessionId: string
  provider: string
  parentSessionId: string
  cwd?: string
  observedModel?: string
  /** The named scoped home the delegation ran against; absent means the default one. */
  scope?: string
}

/**
 * How much is known about one scoped home's credential, as the family grades
 * it. `absent` and `rejected` both mean "provision has nothing usable to
 * anchor": one has no record at all, the other has one the endpoint refused.
 */
export type LocalAgentCredentialGrade = 'absent' | 'present-unverified' | 'verified' | 'rejected'

/**
 * The fairness-relevant effective settings of ONE scoped home (structurally
 * the family's `LocalAgentEffectiveSettings`). Every knob is optional because
 * absence is a real answer — "this harness has no such knob" — and provision
 * records it as such rather than substituting a default.
 *
 * Credential-free by contract: an endpoint reports its HOSTNAME only, never a
 * URL whose path could carry a tenant or project id.
 */
export interface LocalAgentEffectiveSettingsFace {
  drive: string
  /** codex: the sandbox policy every round passes to `codex exec --sandbox`. */
  sandbox?: string
  /** claude-code: the `claude -p` permission handling (`skip` / `normal`). */
  permissionMode?: string
  /** kimi: whether the scoped config's rules auto-approve tool use. */
  autoApprove?: boolean
  /** The reasoning effort in force, when the harness has one. */
  reasoningEffort?: string
  /** Whether a non-default endpoint is in force. */
  baseUrlSet: boolean
  /** The endpoint's hostname, present exactly when `baseUrlSet`. */
  baseUrlHost?: string
  /** The CLI's own version, as the CLI itself reports it. */
  cliVersion?: string
  /** The configured model a round with no model of its own would run. */
  model?: string
}

/** One scoped home's status snapshot (structurally the family's `LocalAgentStatus`). */
export interface LocalAgentScopeStatus {
  name: string
  /** Absolute scoped home of the scope this status describes. */
  homeDir: string
  /** How much is actually known about the credential. */
  credentialState: LocalAgentCredentialGrade
  /** The named scope; absent means the default one. */
  scope?: string
  /** Whether the harness declares a device-code login flow (`/<name> login`). */
  loginable?: boolean
  /** The snapshot, when the harness declares one. */
  effectiveSettings?: LocalAgentEffectiveSettingsFace
}

/** The localAgent verbs the run loop uses. */
export interface LocalAgentFace {
  start(parentSessionId: string, provider: string, prompt: Array<{ type: 'text'; text: string }>, options?: EvalDelegationOptions): Promise<DelegationRun>
  resume(parentSessionId: string, provider: string, childSessionId: string, prompt: Array<{ type: 'text'; text: string }>, options?: EvalDelegationOptions): Promise<DelegationRun>
  cancel(childSessionId: string): boolean
  /** Harness lookup (name → delegationProvider); absent harness = undefined. */
  get(name: string): { delegationProvider?: string } | undefined
  /** T11 read-back: the delegation record without the resume handle; absent when unknown. */
  delegationOf?(childSessionId: string): DelegationInfo | undefined
  /**
   * The host scoped home of one harness (`<homesRoot>/<name>`) — where that
   * harness's credentials live and where its CLI writes the rollout / session
   * log the read-back parses.
   *
   * The container path mounts exactly THIS directory into the unit. It has to
   * be the same one: a round inside a unit writes its rollout to the bound
   * directory, and the read-back looks for it under `homeDir(harness)`. Point
   * the two at different places and nothing errors — the read-back simply
   * finds nothing, forever, and `model.observed` is null on every round while
   * the readiness check reports `ready, model —` and «受试对象一致» never gets
   * past ⚠️. That is the bug T20 shipped by staging a separate credential
   * tree, and pilot B paid for it before anyone saw it.
   *
   * The second parameter names a SCOPE: with it the facade returns — and
   * materializes — `<homesRoot>/<harness>@<scope>`, the sibling directory
   * that condition's rounds read their credentials from, so two conditions of
   * one harness mount two different directories.
   *
   * OPTIONAL on the face: only the container path needs it, and a facade that
   * predates it makes that path a refusal naming the method, never a silent
   * mount of the wrong directory.
   */
  homeDir?(harness: string, scope?: string): string
  /**
   * One scoped home's auth status — the credential grade `conditions
   * provision` gates on. OPTIONAL on the face: a facade predating it makes
   * provision a refusal that names the method, never a lock written against
   * a credential nobody checked.
   */
  statusOf?(harness: string, scope?: string): Promise<LocalAgentScopeStatus>
  /**
   * One scoped home's fairness-relevant effective settings — the READ side of
   * the condition hash, and what `conditions provision` checks a condition
   * against field by field. OPTIONAL for the same reason as
   * {@link LocalAgentFace.statusOf}; `undefined` (rather than absent) means
   * the harness declares no snapshot at all, and provision then records that
   * it could compare nothing.
   */
  effectiveSettings?(harness: string, scope?: string): Promise<LocalAgentEffectiveSettingsFace | undefined>
}

/**
 * The datasets verb the READ tools use: which repository this session is
 * bound to, and which dataset sets its human allowed. Binding WRITES are a
 * human act (`/datasets bind`); the tools only resolve one.
 */
export interface DatasetsBindingFace {
  binding(session: { id: string }): { repoPath: string; datasets?: string[]; layers?: string[] } | undefined
}

/** One mission row of a run's projection (mission's `MissionView`, structurally). */
export interface MissionStatusRow {
  id: string
  labels: Record<string, string>
  state: string
  bucket: string
  currentAttempt: number
  /**
   * Epoch ms the current state was entered — the duration column of the cell
   * list. OPTIONAL on the face: a projection predating it leaves the duration
   * null, and the cell projection then falls back to the attempt's own
   * `enteredAt` map before giving up. Absence is reported, never guessed.
   */
  enteredCurrentAt?: number
}

/**
 * One attempt of a mission as the CELL projection reads it (mission's
 * `AttemptRecord`, structurally). Every field past the attempt number is
 * optional: the face this widened already existed for annotations only, and
 * a ledger that answers less must degrade to nulls rather than throw.
 */
export interface MissionAttemptFace {
  attempt: number
  state?: string
  /** The unit this attempt holds: container name and environment fingerprint. */
  refs?: { resource?: string; fingerprint?: string; sessions?: readonly string[] }
  /** state → first entry timestamp (epoch ms), the duration fallback. */
  enteredAt?: Record<string, number>
  /** Progress points inside the attempt, in the order they were reached. */
  checkpoints?: ReadonlyArray<{ name: string; at?: number; ref?: string; artifacts?: readonly string[] }>
  /**
   * Files the attempt registered (`materialization.json`, the archive, the
   * populate manifest). OPTIONAL like everything else here: a ledger that
   * answers less reports an empty list, never a throw. Widened for the cell
   * drawer (I5·T35b), which lists them.
   */
  artifacts?: ReadonlyArray<{ path: string; kind: string; addedAt?: number }>
  /** Present only on attempts a retry opened — the auditable reason for THIS attempt. */
  retry?: { reason?: string; category?: string; at?: number; by?: string }
  /** Applied transitions, oldest first; the drawer shows the last few. */
  history?: ReadonlyArray<{ from: string; to: string; at?: number; by?: string }>
}

/**
 * The mission READ verbs the two read projections go through —
 * `eval_run_status` (the run's digest) and `eval_cells` (a row per cell).
 * Separate from {@link MissionFace} because the run loop and the read tools
 * need different slices: the loop needs the current attempt's state, the
 * readers need the annotations, refs and checkpoints the loop wrote.
 */
export interface MissionReadFace {
  runStatus(runId: string): {
    run: { id: string; state: string; createdAt: number; templateName?: string; meta: Record<string, unknown> }
    rows: MissionStatusRow[]
    buckets: Record<string, string[]>
    unreleased: string[]
  }
  get(missionId: string, runId?: string): {
    mission: {
      /** The attempt every per-attempt field below is read from. */
      currentAttempt?: number
      attempts?: readonly MissionAttemptFace[]
      annotations: ReadonlyArray<{ ns: string; attempt: number; payload: unknown; createdAt: number; by?: string }>
      /** The cell's human title, when the template gave it one. */
      title?: string
      /** The matrix coordinates as labels; the row carries them too. */
      labels?: Record<string, string>
    }
  }
  /**
   * The mission data root, so a reader can find the run-data tree
   * (`<dataDir>/runs/<runId>/data/<missionId>/attempt-<n>/`) the orchestrator
   * wrote `materialization.json` into. OPTIONAL: a face without it makes the
   * matrix report the per-task hash as UNVERIFIABLE rather than guessing.
   */
  readonly dataDir?: string
}

/**
 * The two mission WRITES the cell drawer forwards, and the release question it
 * asks before offering to destroy anything. Separate from {@link MissionFace}
 * because the run loop and the drawer need different slices: the loop writes
 * the ledger, the drawer only re-opens an attempt and asks whether a unit may
 * go.
 *
 * Both are HUMAN gestures from the tab — never the model's. eval forwards them
 * and adds no policy of its own: `retry` still demands an auditable reason,
 * and `isReleasable` still answers about the state machine's own
 * `releasableStates`.
 */
export interface MissionActionFace {
  retry(missionId: string, options: { runId?: string; reason: string; category: string; by?: string }): Promise<{ attempt: number }>
  isReleasable(missionId: string, runId?: string): boolean
}

/**
 * The ONE mission write the JUDGE BENCH makes: append a `human-final`
 * annotation (I5·T37). Separate from {@link MissionActionFace} because the
 * drawer's two gestures and the bench's one are granted independently — a
 * composition may mount a ledger that can be read and annotated but whose
 * retry path is absent — and separate from {@link MissionFace} because the
 * bench is not the run loop and must not be able to transition, submit, or
 * set refs.
 *
 * Narrow on purpose: this interface is the entire surface through which
 * `human-final` can be written in this family, and keeping it to one verb is
 * how ui-spec R1 (终评是人的) stays a structural fact rather than a rule
 * someone has to remember.
 */
export interface MissionAnnotateFace {
  annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string; by?: string }): Promise<{ added: boolean }>
}

/**
 * mission's own Remote service, host-side — the ONE place the bundle export's
 * leak gate lives.
 *
 * eval forwards `exportPlan` / `exportRun` to it rather than re-deriving the
 * guarded-layer set from mission's `planExport`, and that is the whole point:
 * the gate (every `modelFacing: false` layer confirmed against a FRESH plan,
 * fail-closed) plus the datasets probe that decides WHICH layers are guarded
 * are mission's, and a second implementation of a leak gate is a second place
 * for it to be wrong. eval only relays the caller's confirmations; it can
 * narrow nothing and widen nothing.
 *
 * Structural and optional: a composition that mounts mission without a Typert
 * gateway has no Remote service, and the export verbs then refuse naming it.
 */
export interface MissionExportRemoteFace {
  exportPlan(agent: unknown, request: {
    runId: string
    outDir: string
    layers?: string[]
    snapshotDir?: string
    snapshot?: { repo: string; commit: string; dataset?: string }
    guarded?: string[]
  }): Promise<{ bundleDir: string; guardedLayers: string[]; expectedNs: string[] | null; missions: number; attempts: number }>
  exportRun(agent: unknown, request: {
    runId: string
    outDir: string
    layers?: string[]
    snapshotDir?: string
    snapshot?: { repo: string; commit: string; dataset?: string }
    guarded?: string[]
    confirmed: string[]
  }): Promise<{ bundleDir: string; files: number }>
}

/**
 * The mission verb the LAB LIST needs on top of {@link MissionReadFace}: every
 * run the ledger holds, so the listing can pick out the ones eval started
 * (their `meta.evalVersion`). OPTIONAL on the face for the same reason every
 * widening here is — a ledger that cannot list runs degrades to "drafts only"
 * with a note saying so, never a throw.
 */
export interface MissionRunListFace extends MissionReadFace {
  runList?(): ReadonlyArray<{ id: string }>
}

/**
 * The mission slice `finalize` drives: the run projection it walks, and the
 * two writes it makes. Structural and narrower than {@link MissionFace} on
 * purpose — the in-host `ctx.mission` satisfies it, and so does a face backed
 * by the `dsh-mission` CLI (the process-external form, which has no mission
 * service to call and must not import the package either).
 */
export interface MissionFinalizeFace {
  /** The run's cells with their current state; anything else in the row is ignored. */
  runStatus(runId: string): { rows: ReadonlyArray<{ id: string; state: string }> }
  transition(missionId: string, to: string, options?: { runId?: string; by?: string; note?: string }): Promise<{ changed: boolean }>
  annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string; by?: string }): Promise<{ added: boolean }>
}

/* ─────────────────────────── the lab face (I3) ────────────────────────── */

/**
 * One mount declared at acquire time. The container path declares exactly
 * ONE: the condition's scoped credential directory, bound read-write so the
 * CLI's own credential refresh lands back on the host (T17's decision — a
 * named volume would put `docker cp` in every read-back path).
 */
export interface LabMountSpec {
  /** Host directory for `bind`, a volume NAME for `volume`. */
  source: string
  /** Absolute path inside the unit. */
  target: string
  readonly?: boolean
  type?: 'bind' | 'volume'
}

/** CPU and memory ceilings; applied to the unit AND hashed into its fingerprint. */
export interface LabResourceLimits {
  cpus?: string | number
  memory?: string | number
}

/** What one unit is acquired with (structural `AcquireSpec`). */
export interface LabAcquireSpec {
  image: string
  mounts?: LabMountSpec[]
  resources?: LabResourceLimits
  /** Docker network; undeclared is docker's default bridge, which HAS egress. */
  network?: string
  /** In-container user (`uid[:gid]`); undeclared is the image's own USER. */
  user?: string
  /** Environment entries inside the unit — NAMES enter the fingerprint, values never do. */
  env?: Record<string, string>
  /** In-unit working directory. */
  workdir?: string
  /**
   * Create `workdir` and hand it to the unit's user before any other verb.
   * The container path always asks for it: a missing `--workdir` is created
   * root-owned, and a unit declaring a non-root `user` then cannot write the
   * directory its own work is supposed to happen in.
   */
  ownWorkdir?: boolean
  /** Mission this unit serves; its refs receive the resource id and fingerprint. */
  missionId?: string
  runId?: string
}

/**
 * The components a lab fingerprint is computed from (structural
 * `FingerprintComponents`). The shape never varies: an undeclared scalar is
 * `null`, an undeclared list empty. Host paths and env VALUES never appear.
 */
export interface LabFingerprintComponents {
  version: number
  image: string | null
  resources: { cpus: string | null; memory: string | null }
  mounts: Array<{ target: string; type: string; readonly: boolean }>
  envKeys: string[]
  network: string | null
  user: string | null
}

/** One acquired unit (structural `UnitInfo`). */
export interface LabUnitInfo {
  id: string
  provider: string
  /** Provider-side resource handle — the container the delegation execs into. */
  resource: string
  /** Composite environment fingerprint (`lab-env:<hex>`) of the UNIT — every component, this condition's included. */
  fingerprint: string
  /**
   * What that fingerprint was computed from. The orchestrator needs the
   * components, not just the digest: the run's «环境一致» invariant compares
   * the environment the PLAN declared, which is these components minus the
   * ones each condition contributes. Absent for a legacy bare-digest unit,
   * and then no environment class can be derived — recorded as absent, never
   * guessed.
   */
  fingerprintComponents?: LabFingerprintComponents
  /** In-unit working directory. */
  workspace: string
  missionId?: string
  runId?: string
  createdAt: number
}

/** What one in-unit command factually produced (structural `VerifyResult`). */
export interface LabVerifyResult {
  /** Exit code; -1 when the client was terminated before one existed. */
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

/** The materialization manifest `populate` returns (structural `PopulateResult`). */
export interface LabPopulateResult {
  sha: string
  count: number
  files: Array<{ path: string; sha: string }>
}

/**
 * The lab verbs the container path drives (`ctx.lab`). Structural like every
 * other face here: eval imports nothing from the lab package, and a
 * composition without lab is a refusal that names it.
 *
 * All eight verbs are declared even though the run loop drives seven —
 * `status` is a human/CLI surface, and the loop reads the mission ledger
 * rather than asking the provider what state a cell is in.
 */
export interface LabFace {
  acquire(spec: LabAcquireSpec): Promise<LabUnitInfo>
  populate(unitId: string, options: {
    source: string
    target?: string
    /** Host file the materialization manifest is written to (and registered from). */
    manifestPath?: string
    /** Artifact path registered with mission, relative to the attempt's run-data directory. */
    artifactPath?: string
  }): Promise<LabPopulateResult>
  collect(unitId: string, options: { source: string; target: string; kind?: string; artifactPath?: string }): Promise<void>
  checkpoint(unitId: string, options: { name: string }): Promise<{ ref: string }>
  verify(unitId: string, options: { command: string[]; source?: string; timeoutMs?: number }): Promise<LabVerifyResult>
  archive(unitId: string, options: { target: string; kind?: string; artifactPath?: string }): Promise<void>
  /**
   * Destroy the unit. With a mission binding this is the gate's enforcement
   * point and no option bypasses it; `force` is only for a unit no gate
   * protects (the readiness probe unit, which is bound to no mission).
   */
  release(unitId: string, options?: { force?: boolean }): Promise<void>
  status(unitId?: string): Promise<Array<{ id: string; resource: string; running: boolean }>>
  /**
   * Hash a component set — the same rule `acquire` uses, as a pure function.
   * The orchestrator asks it what the ENVIRONMENT CLASS hashes to: the unit's
   * components with each condition's own contributions removed. Deriving that
   * here rather than re-implementing lab's canonicalization is deliberate —
   * two copies of a hashing rule drift the first time a component is added.
   */
  fingerprintOf(components: LabFingerprintComponents): string
}
