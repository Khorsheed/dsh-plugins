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

/** A mount declared at acquire time — the zero-copy path for inputs and for persistent state. */
export interface MountSpec {
  /**
   * What is mounted: a host directory for `'bind'` (e.g. a datasets
   * `worktree_path` product), a docker volume NAME for `'volume'`.
   */
  source: string
  /** Absolute path inside the unit. */
  target: string
  /** Mounted read-only when true (the input-materialization default). */
  readonly?: boolean
  /**
   * Mount kind; defaults to `'bind'`. A `'volume'` mount is how state that
   * must outlive one unit is carried — a per-harness credential volume whose
   * token refresh has to be written back, for instance.
   */
  type?: 'bind' | 'volume'
}

/** Default in-unit working directory (checkpoint commits here; populate targets it by default). */
export const DEFAULT_WORKSPACE = '/workspace'

/**
 * Resource ceilings declared at acquire time. They are applied to the unit
 * AND hashed into the environment fingerprint — the same image under a
 * different CPU or memory ceiling is a different environment, and a
 * time-sensitive measurement taken under one ceiling is not comparable with
 * one taken under another.
 */
export interface ResourceLimits {
  /** Docker `--cpus`: a decimal count of CPUs (`'2'`, `'0.5'`). */
  cpus?: string | number
  /** Docker `--memory`: a byte count with an optional b/k/m/g suffix (`'4g'`). */
  memory?: string | number
}

/**
 * The components the composite environment fingerprint hashes. The shape never
 * varies: an undeclared scalar is `null` rather than an omitted key, an
 * undeclared list is empty. Host absolute paths and env VALUES never appear
 * here — the components are printed, labeled, and archived.
 */
export interface FingerprintComponents {
  /** Version of the HASHING RULES (canonicalization, normalization, the undeclared-is-absent rule). */
  version: number
  /** Resolved image digest (repo digest, falling back to the local image id); null when unresolvable. */
  image: string | null
  /** Normalized ceilings — cpus as a decimal literal, memory as a byte count; null when undeclared. */
  resources: { cpus: string | null; memory: string | null }
  /** Mount layout as the container sees it, sorted by target — no host paths, no volume names. */
  mounts: { target: string; type: string; readonly: boolean }[]
  /** Sorted names of the injected environment variables — names only, never values. */
  envKeys: string[]
  /**
   * Docker network the unit joins (`'none'`, or a network name); null when
   * undeclared, which is docker's default bridge — a NAT'd network with
   * egress. A network name is a daemon-local label, not host information, so
   * unlike a mount's `source` it is safe to record.
   */
  network: string | null
  /** In-container user (`uid[:gid]` or a name); null when undeclared, which is the image's own `USER`. */
  user: string | null
}

/** A resolved environment fingerprint: the opaque string plus what it was computed from. */
export interface EnvironmentFingerprint {
  /** `lab-env:<sha256 hex>` over the canonical component JSON; opaque to mission. */
  fingerprint: string
  /** The components that produced it, printable as-is. */
  components: FingerprintComponents
}

/** What {@link Lab.acquire} needs to prepare one isolated unit. */
export interface AcquireSpec {
  /** Provider kind; only `'docker'` ships in this line (the worktree shape is reserved). */
  provider?: 'docker'
  /** Container image reference; its resolved digest is the fingerprint's image component. */
  image: string
  /** Zero-copy mounts declared now (container mounts cannot be added after creation). */
  mounts?: MountSpec[]
  /** CPU and memory ceilings; applied to the unit and hashed into the fingerprint. */
  resources?: ResourceLimits
  /**
   * Docker network the unit joins — a network name, or `'none'` for no
   * networking. Undeclared means docker's default bridge, which HAS egress;
   * "the unit cannot reach the internet" is only expressible by naming an
   * `--internal` network here. Applied to the unit and hashed.
   */
  network?: string
  /**
   * In-container user (`uid[:gid]` or a name); undeclared means the image's
   * own `USER`. Applied to the unit and hashed — some CLIs refuse their
   * sandbox mode under root, so the user is part of what makes two cells
   * comparable.
   */
  user?: string
  /** Extra environment entries inside the unit. */
  env?: Record<string, string>
  /** Keep-alive command; defaults to `['sleep', 'infinity']` (the image must ship it). */
  command?: string[]
  /** Working directory inside the unit. */
  workdir?: string
  /**
   * Create {@link AcquireSpec.workdir} inside the unit and hand it to the
   * unit's own user, before any other verb runs.
   *
   * `docker run --workdir X` creates a missing X as `root:root`. A unit that
   * declares a non-root `user` — or an image that ships one, as the
   * evaluation image does — then cannot write the directory its whole working
   * life happens in: `populate` still succeeds (the daemon copies as root)
   * and the FIRST write from inside the unit fails, which is the worst place
   * to find out. Opt-in, because creating directories on the caller's behalf
   * is not something `acquire` should do unasked; an image that already ships
   * a writable workspace needs nothing.
   *
   * Not a fingerprint component: the shape of {@link FingerprintComponents}
   * never varies, and who owns a directory the unit was going to be given
   * anyway does not make two otherwise identical environments incomparable.
   */
  ownWorkdir?: boolean
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
  /** Composite environment fingerprint (`lab-env:<hex>`), or a legacy bare image digest. */
  fingerprint: string
  /** What the fingerprint was computed from; absent for a legacy bare-digest unit. */
  fingerprintComponents?: FingerprintComponents
  /** In-unit working directory (checkpoint commits here); from `workdir`, default `/workspace`. */
  workspace: string
  /** Mission this unit is registered to, when any. */
  missionId?: string
  /** Run hint recorded at acquire. */
  runId?: string
  /** Epoch ms of acquisition. */
  createdAt: number
  /**
   * Overall materialization hash of the last {@link Lab.populate}, when this
   * process performed it. It is what {@link UnitStatus.taskHash} reports;
   * absent for a unit adopted by reconcile after a host restart, which falls
   * back to reading the registered materialization artifact.
   */
  taskSha?: string
}

/** A unit as observed by {@link Lab.status}. */
export interface UnitStatus extends UnitInfo {
  /** The resource is currently running. */
  running: boolean
  /**
   * Epoch ms of the newest workspace file — in-container activity, NOT the
   * last lab verb call (lab is not invoked while work runs inside the unit).
   * Absent when unreadable (e.g. an image without GNU stat/date).
   */
  lastActivityAt?: number
  /** Cumulative container CPU usage in microseconds (cgroup cpu.stat), when readable. */
  cpuUsageUsec?: number
  /** Current attempt's state, when the unit is mission-bound and the face answers. */
  missionState?: string
  /** The mission's coordinate labels, when joined. */
  missionLabels?: Record<string, string>
  /** Short prefix of the materialization manifest hash, read from the mission artifact. */
  taskHash?: string
}

/** {@link Lab.populate} options: copy a host directory INTO a running unit. */
export interface PopulateOptions {
  /** Host directory whose contents enter the unit. */
  source: string
  /** Absolute in-unit target directory (created when missing); defaults to the unit's workspace. */
  target?: string
  /**
   * Host file the materialization manifest is written to. Required for the
   * manifest to be registered as a mission artifact (kind
   * `materialization`) — lab owns no state directory of its own, so the
   * caller names the location (the attempt's run-data directory in the
   * evaluation flow).
   */
  manifestPath?: string
  /** Path registered with mission (relative to the attempt's run-data directory); defaults to `manifestPath`. */
  artifactPath?: string
}

/** The materialization manifest {@link Lab.populate} returns — the fairness evidence. */
export interface PopulateResult {
  /** Overall content hash: sha256 over the sorted `path  sha` lines. Identical inputs hash identically. */
  sha: string
  /** Number of entries. */
  count: number
  /** One entry per file (content hash) or symlink (hash of `symlink:<target>`), sorted by path. */
  files: { path: string; sha: string }[]
}

/** {@link Lab.collect} options: copy a path OUT of the unit onto the host. */
export interface CollectOptions {
  /** Absolute in-unit source directory. */
  source: string
  /** Host directory that receives the contents (created when missing). */
  target: string
  /** Artifact kind registered with mission; defaults to `'collection'`. */
  kind?: string
  /** Path registered with mission (relative to the attempt's run-data directory); defaults to `target`. */
  artifactPath?: string
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
  /** Path registered with mission (relative to the attempt's run-data directory); defaults to `target`. */
  artifactPath?: string
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
   * acquire time instead). Returns the materialization manifest; when
   * `manifestPath` is given and the unit carries a missionId, the manifest
   * file is written and registered as a `materialization` artifact — the
   * byte-level proof that parallel units received identical inputs, and the
   * baseline a later `collect` diffs against.
   * @param unitId - unit to populate.
   * @param options - source directory, in-unit target, optional manifest file.
   * @returns the materialization manifest.
   */
  populate(unitId: string, options: PopulateOptions): Promise<PopulateResult>
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
  /**
   * Hash a component set into a fingerprint string — the same function
   * `acquire` and the CLI use, exposed because a caller sometimes needs to
   * ask what a DIFFERENT component set would hash to.
   *
   * The evaluation orchestrator is the case this exists for: comparing cells
   * needs "the same environment as the plan declared", not "the same unit",
   * and those differ by exactly the components each condition contributes (its
   * own credential mount, its own env variable). It takes the unit's
   * components, drops those, and asks for the hash of what is left. Doing that
   * arithmetic here rather than re-implementing the canonicalization keeps one
   * hashing rule in the repository — a second copy would drift the first time
   * a component is added.
   *
   * Pure: no unit, no provider, no daemon.
   * @param components - any component set, not necessarily a live unit's.
   * @returns `lab-env:<sha256 hex>` over the canonical component JSON.
   */
  fingerprintOf(components: FingerprintComponents): string
}

/**
 * The structural slice of a mission's record that lab's status view joins
 * against. The in-host `MissionService.get` and the `dsh-mission get` bin's
 * JSON both satisfy it.
 */
export interface MissionSnapshot {
  /** Coordinate labels of the mission. */
  labels: Record<string, string>
  /** Current attempt number. */
  currentAttempt: number
  /** Attempts; the current one carries the live state and artifact index. */
  attempts: { attempt: number; state: string; artifacts: { path: string; kind: string }[] }[]
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
  /** May this mission's held resources be destroyed? (async-tolerant: the CLI face spawns `dsh-mission`.) */
  isReleasable(missionId: string, runId?: string): boolean | Promise<boolean>
  /** Register a checkpoint; `ref` is filled only by the resource holder (lab). */
  addCheckpoint(
    missionId: string,
    checkpoint: { name: string; ref?: string; artifacts?: string[] },
    options?: { runId?: string },
  ): Promise<{ added: boolean }>
  /** Append a namespace-isolated, append-only annotation. */
  annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string }): Promise<{ added: boolean }>
  /** Read one mission's record (the status view's join source). */
  get(missionId: string, runId?: string): { mission: MissionSnapshot } | Promise<{ mission: MissionSnapshot }>
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
   * Resolve the composite environment fingerprint for a spec (image digest —
   * pulling when absent locally — plus resource ceilings, mount layout, and
   * injected env key names).
   * @param spec - acquire specification.
   * @returns the fingerprint string recorded into mission refs, with its components.
   */
  fingerprint(spec: AcquireSpec): Promise<EnvironmentFingerprint>
  /**
   * Create and start the unit's resource.
   * @param id - unit id assigned by the service.
   * @param spec - acquire specification.
   * @param fingerprint - resolved fingerprint and components (both ride the resource labels).
   * @returns the provider-side resource handle.
   */
  acquire(id: string, spec: AcquireSpec, fingerprint: EnvironmentFingerprint): Promise<string>
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
   * Sample in-container activity: newest workspace file mtime (primary —
   * work writes files) and cumulative container CPU (secondary, cgroup
   * cpu.stat). Both best-effort; absence of either is not an error.
   * @param resource - provider resource handle.
   * @param workspace - in-unit working directory.
   * @returns the activity facts that were readable.
   */
  activity(resource: string, workspace: string): Promise<{ mtime?: number; cpuUsageUsec?: number }>
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
