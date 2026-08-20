/**
 * Public contract of `@khorsheed/dsh-lab`: controlled experiment units.
 *
 * A unit is an isolated, reproducible execution environment. The plugin
 * acquires it, materializes inputs into it, collects outputs back, and
 * releases it — it records facts and never judges outcomes, holds no state
 * machine, and fires no work. State and indexes belong to mission (consumed
 * optionally through {@link MissionFace}); content arrives as plain directory
 * paths (a datasets `worktree_path` product or any caller-supplied path —
 * lab never meets datasets in code).
 *
 * @module @khorsheed/dsh-lab
 */

/** A bind mount declared at acquire time — the zero-copy, read-only path for inputs. */
export interface MountSpec {
  /** Host directory (e.g. a datasets worktree_path product). */
  source: string
  /** Absolute path inside the unit. */
  target: string
  /** Mounted read-only when true (the input-materialization default). */
  readonly?: boolean
}

/** Default in-unit working directory (checkpoint commits here; populate targets it by default). */
export const DEFAULT_WORKSPACE = '/workspace'

/** What {@link Lab.acquire} needs to prepare one isolated unit. */
export interface AcquireSpec {
  /** Provider kind; only `'docker'` ships in this line (the worktree shape is reserved). */
  provider?: 'docker'
  /** Container image reference; the resolved digest becomes the environment fingerprint. */
  image: string
  /** Zero-copy mounts declared now (container mounts cannot be added after creation). */
  mounts?: MountSpec[]
  /** Extra environment entries inside the unit. */
  env?: Record<string, string>
  /** Keep-alive command; defaults to `['sleep', 'infinity']` (the image must ship it). */
  command?: string[]
  /** Working directory inside the unit. */
  workdir?: string
  /** Mission this unit serves; its refs receive the resource id and fingerprint. */
  missionId?: string
  /** Run hint forwarded to mission service calls. */
  runId?: string
}

/** One acquired unit. */
export interface UnitInfo {
  /** Opaque unit id (`dsh-lab-<hex>` suffix). */
  id: string
  /** Provider kind that owns the unit. */
  provider: string
  /** Provider-side resource handle (container name) — opaque to callers. */
  resource: string
  /** Environment fingerprint (image digest, falling back to image id). */
  fingerprint: string
  /** In-unit working directory (checkpoint commits here); from `workdir`, default `/workspace`. */
  workspace: string
  /** Mission this unit is registered to, when any. */
  missionId?: string
  /** Run hint recorded at acquire. */
  runId?: string
  /** Epoch ms of acquisition. */
  createdAt: number
}

/** A unit as observed by {@link Lab.status}. */
export interface UnitStatus extends UnitInfo {
  /** The resource is currently running. */
  running: boolean
}

/** {@link Lab.populate} options: copy a host directory INTO a running unit. */
export interface PopulateOptions {
  /** Host directory whose contents enter the unit. */
  source: string
  /** Absolute in-unit target directory (created when missing); defaults to the unit's workspace. */
  target?: string
}

/** {@link Lab.collect} options: copy a path OUT of the unit onto the host. */
export interface CollectOptions {
  /** Absolute in-unit source directory. */
  source: string
  /** Host directory that receives the contents (created when missing). */
  target: string
  /** Artifact kind registered with mission; defaults to `'collection'`. */
  kind?: string
}

/** {@link Lab.release} options. */
export interface ReleaseOptions {
  /**
   * Required when no mission gate protects this unit (no missionId, or the
   * mission plugin is absent): the irreversible destroy then runs on the
   * caller's own guarantee, with a warning. When the gate IS present it
   * cannot be bypassed — no force flag overrides `isReleasable`.
   */
  force?: boolean
}

/** {@link Lab.checkpoint} options. */
export interface CheckpointOptions {
  /** Checkpoint name; becomes the in-unit git tag. */
  name: string
}

/** {@link Lab.verify} options: mount verification material, execute, record. */
export interface VerifyOptions {
  /** Command executed inside the unit with the workspace as its cwd. */
  command: string[]
  /** Host directory of verification material, copied to a scratch dir for the run, removed after. */
  source?: string
  /** Bound the execution; expiry terminates the client (the in-container pid stays sweepable). */
  timeoutMs?: number
}

/** What a {@link Lab.verify} run factually produced — recorded verbatim, never judged. */
export interface VerifyResult {
  /** The command's exit code; -1 when the client was terminated (e.g. timeout) before one existed. */
  exitCode: number
  /** Collected stdout, verbatim. */
  stdout: string
  /** Collected stderr, verbatim. */
  stderr: string
  /** Wall-clock duration of the execution. */
  durationMs: number
  /** The timeout fired (a fact, not a verdict). */
  timedOut: boolean
}

/** {@link Lab.archive} options: export the workspace plus an integrity manifest. */
export interface ArchiveOptions {
  /** Host directory receiving `workspace/` and `manifest.json` (created when missing). */
  target: string
  /** Artifact kind registered with mission; defaults to `'archive'`. */
  kind?: string
}

/** The lab service face (`ctx.lab`). Records, never judges; never fires work. */
export interface Lab {
  /**
   * Prepare one isolated unit. Refuses when `maxConcurrentUnits` units are
   * already held. Writes resource id + environment fingerprint into the
   * mission's refs when `missionId` is given and the mission plugin is
   * present (registration failures warn and skip — they never block acquire).
   * @param spec - unit specification.
   * @returns the acquired unit facts.
   */
  acquire(spec: AcquireSpec): Promise<UnitInfo>
  /**
   * Materialize a host directory into a running unit (a copy into the unit's
   * writable layer — for zero-copy read-only inputs declare `mounts` at
   * acquire time instead).
   * @param unitId - unit to populate.
   * @param options - source directory and in-unit target.
   */
  populate(unitId: string, options: PopulateOptions): Promise<void>
  /**
   * Collect a path out of the unit onto the host; registered as a mission
   * artifact when the unit carries a missionId and mission is present.
   * @param unitId - unit to collect from.
   * @param options - in-unit source and host target.
   */
  collect(unitId: string, options: CollectOptions): Promise<void>
  /**
   * Destroy the unit. With a mission gate this is THE enforcement point:
   * `isReleasable` must pass, a query failure fails closed, and no option
   * bypasses the check. Without a gate, `force: true` is required and a
   * warning is emitted. In-container processes recorded in the unit's
   * pidfile directory are terminated before the resource is removed.
   * @param unitId - unit to release.
   * @param options - force flag for the gate-less path.
   */
  release(unitId: string, options?: ReleaseOptions): Promise<void>
  /**
   * Record a rewindable point: commit the workspace (auto-initialized as a
   * git repo on first use) and tag it; the commit sha goes into the
   * mission's checkpoint `ref` when a mission face is present.
   * @param unitId - unit to checkpoint.
   * @param options - checkpoint name.
   * @returns the recorded ref (commit sha).
   */
  checkpoint(unitId: string, options: CheckpointOptions): Promise<{ ref: string }>
  /**
   * Run a command inside the unit and record the outcome VERBATIM (exit
   * code, stdout, stderr, duration, timeout fact) — as the return value and,
   * when a mission face is present, as an annotation in the `lab` namespace.
   * lab never derives a verdict from the outcome.
   * @param unitId - unit to verify in.
   * @param options - command, optional material, optional timeout.
   * @returns the verbatim outcome.
   */
  verify(unitId: string, options: VerifyOptions): Promise<VerifyResult>
  /**
   * Export the unit's workspace plus a sha256 integrity manifest into a host
   * directory; registered as a mission artifact when a mission face is
   * present.
   * @param unitId - unit to archive.
   * @param options - host target and artifact kind.
   */
  archive(unitId: string, options: ArchiveOptions): Promise<void>
  /**
   * List managed units (reconciled against the provider, so units survive a
   * host restart), or one unit when `unitId` is given.
   * @param unitId - optional unit selector.
   * @returns matching unit statuses.
   */
  status(unitId?: string): Promise<UnitStatus[]>
}

/**
 * The structural slice of `@khorsheed/dsh-mission`'s service that lab
 * consumes. Probed via `ctx.get('mission')` at call time; when absent, lab
 * degrades (registration warns and skips, release requires `force`) — there
 * is no code-level dependency on the mission package.
 */
export interface MissionFace {
  /** Write the current attempt's refs (resource handle, environment fingerprint). */
  setRefs(
    missionId: string,
    refs: { resource?: string; fingerprint?: string; sessions?: string[] },
    options?: { runId?: string },
  ): Promise<void>
  /** Index one artifact of the current attempt. */
  addArtifact(
    missionId: string,
    artifact: { path: string; kind: string },
    options?: { runId?: string },
  ): Promise<{ added: boolean }>
  /** May this mission's held resources be destroyed? */
  isReleasable(missionId: string, runId?: string): boolean
  /** Register a checkpoint; `ref` is filled only by the resource holder (lab). */
  addCheckpoint(
    missionId: string,
    checkpoint: { name: string; ref?: string; artifacts?: string[] },
    options?: { runId?: string },
  ): Promise<{ added: boolean }>
  /** Append a namespace-isolated, append-only annotation. */
  annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string }): Promise<{ added: boolean }>
}

/** One finished subprocess invocation. */
export interface ExecResult {
  /** Process exit code; -1 when terminated before an exit code existed. */
  exitCode: number
  /** Collected stdout. */
  stdout: string
  /** Collected stderr. */
  stderr: string
  /** The caller's timeout fired and terminated the process. */
  timedOut?: boolean
}

/**
 * Host command runner the providers shell out through (`docker …`). The
 * plugin entry adapts `ctx.subprocess`; tests inject a scripted fake.
 * @param argv - executable and arguments, never shell-interpreted.
 * @param options - optional execution bound.
 */
export type Exec = (argv: string[], options?: { timeoutMs?: number }) => Promise<ExecResult>

/** One provider-managed resource as listed from the provider itself. */
export interface ManagedResource {
  /** Unit id recovered from the resource's labels. */
  id: string
  /** Provider-side resource handle. */
  resource: string
  /** All provider labels (fingerprint / mission binding ride here). */
  labels: Record<string, string>
  /** The resource is currently running. */
  running: boolean
  /** Epoch ms of creation, when the provider reports it. */
  createdAt?: number
}

/**
 * Isolation provider: the object that actually acquires, populates, collects
 * from, and destroys units. Only `docker` ships in this line; the interface
 * is shaped to also hold a future `worktree` provider.
 */
export interface UnitProvider {
  /** Provider kind key (`'docker'`). */
  readonly kind: string
  /**
   * Resolve the environment fingerprint for a spec (image digest; pulls the
   * image when absent locally).
   * @param spec - acquire specification.
   * @returns the fingerprint string recorded into mission refs.
   */
  fingerprint(spec: AcquireSpec): Promise<string>
  /**
   * Create and start the unit's resource.
   * @param id - unit id assigned by the service.
   * @param spec - acquire specification.
   * @param fingerprint - resolved fingerprint (rides the resource labels).
   * @returns the provider-side resource handle.
   */
  acquire(id: string, spec: AcquireSpec, fingerprint: string): Promise<string>
  /**
   * Copy a host directory into the unit.
   * @param resource - provider resource handle.
   * @param options - source and resolved in-unit target.
   */
  populate(resource: string, options: PopulateOptions & { target: string }): Promise<void>
  /**
   * Copy a path out of the unit onto the host.
   * @param resource - provider resource handle.
   * @param options - in-unit source and host target.
   */
  collect(resource: string, options: CollectOptions): Promise<void>
  /**
   * Record a rewindable point inside the unit: commit the workspace (git,
   * auto-initialized when absent) and tag it with the checkpoint name.
   * @param resource - provider resource handle.
   * @param workspace - in-unit working directory.
   * @param name - checkpoint name (becomes the tag).
   * @returns the commit sha (the checkpoint ref).
   */
  checkpoint(resource: string, workspace: string, name: string): Promise<string>
  /**
   * Execute a command inside the unit and return the outcome verbatim —
   * non-zero exits are data here, never thrown.
   * @param resource - provider resource handle.
   * @param workspace - in-unit working directory (the command's cwd).
   * @param options - command, optional material, optional timeout.
   * @returns the verbatim outcome.
   */
  verify(resource: string, workspace: string, options: VerifyOptions): Promise<VerifyResult>
  /**
   * List every resource this provider manages (label-selected), so the
   * service can rebuild its registry after a host restart.
   * @returns managed resources with their labels.
   */
  listManaged(): Promise<ManagedResource[]>
  /**
   * Destroy the resource: terminate pidfile-recorded in-container processes
   * first (best effort), then remove the resource itself.
   * @param resource - provider resource handle.
   */
  terminate(resource: string): Promise<void>
}
