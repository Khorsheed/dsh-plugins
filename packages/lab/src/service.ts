/**
 * The lab service kernel: verb semantics, the mission releasable gate, the
 * concurrency ceiling, and the restart-surviving registry (reconciled from
 * provider labels). Provider mechanics live in {@link UnitProvider}; mission
 * integration is a probed, optional {@link MissionFace}.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  DEFAULT_WORKSPACE,
  type AcquireSpec, type ArchiveOptions, type CheckpointOptions, type CollectOptions, type Lab,
  type MissionFace, type PopulateOptions, type PopulateResult, type ReleaseOptions, type UnitInfo,
  type UnitProvider, type UnitStatus, type VerifyOptions, type VerifyResult,
} from './types.ts'

/** Service wiring. */
export interface LabServiceOptions {
  /** Providers keyed by kind (`docker` ships in this line). */
  providers: Record<string, UnitProvider>
  /** Held-unit ceiling; `acquire` refuses at and above it. */
  maxConcurrentUnits: number
  /** Probe for the optional mission service face (called per verb). */
  getMission: () => MissionFace | undefined
  /** Warning channel (plugin logger in production). */
  warn: (message: string) => void
  /** Clock hook (tests). */
  now?: () => number
  /** Unit id hook (tests). */
  idgen?: () => string
}

/** The fixed annotation namespace lab writes verify outcomes into (mission-side convention). */
export const LAB_ANNOTATION_NS = 'lab'

/** Displayed prefix length of the materialization hash in status rows. */
const TASK_HASH_PREFIX = 8

/** The `ctx.lab` service. Records, never judges; never fires work. */
export class LabService implements Lab {
  private readonly units = new Map<string, UnitInfo>()
  private readonly runningUnits = new Set<string>()
  private reconciliation: Promise<void> | undefined
  private readonly now: () => number
  private readonly idgen: () => string

  /** @param options - service wiring. */
  constructor(private readonly options: LabServiceOptions) {
    this.now = options.now ?? (() => Date.now())
    this.idgen = options.idgen ?? (() => randomBytes(4).toString('hex'))
  }

  async acquire(spec: AcquireSpec): Promise<UnitInfo> {
    const kind = spec.provider ?? 'docker'
    const provider = this.options.providers[kind]
    if (provider === undefined) throw new Error(`lab: unknown provider ${JSON.stringify(kind)}`)
    await this.reconcile()
    if (this.units.size >= this.options.maxConcurrentUnits) {
      throw new Error(
        `lab: acquire refused — maxConcurrentUnits (${this.options.maxConcurrentUnits}) reached; `
        + 'release a unit first. The ceiling is a safety valve against accidental concurrency, not a scheduler.',
      )
    }
    const fingerprint = await provider.fingerprint(spec)
    const id = this.idgen()
    const resource = await provider.acquire(id, spec, fingerprint)
    const info: UnitInfo = {
      id,
      provider: kind,
      resource,
      fingerprint,
      workspace: spec.workdir ?? DEFAULT_WORKSPACE,
      createdAt: this.now(),
    }
    if (spec.missionId !== undefined) info.missionId = spec.missionId
    if (spec.runId !== undefined) info.runId = spec.runId
    this.units.set(id, info)
    this.runningUnits.add(id)
    if (info.missionId !== undefined) await this.registerRefs(info)
    return info
  }

  async populate(unitId: string, options: PopulateOptions): Promise<PopulateResult> {
    const { unit, provider } = await this.locate(unitId)
    // Hash the source BEFORE the copy: identical inputs must prove identical
    // (fairness evidence), and a bad source fails fast here instead of at
    // the provider. The manifest doubles as the baseline a later collect
    // diffs against (what was given vs what was produced).
    const files = hashTree(options.source).map((entry) => ({
      path: entry.path,
      sha: entry.sha256 ?? createHash('sha256').update(`symlink:${entry.symlink ?? ''}`).digest('hex'),
    }))
    const sha = createHash('sha256').update(files.map((file) => `${file.path}  ${file.sha}`).join('\n')).digest('hex')
    const target = options.target ?? unit.workspace
    await provider.populate(unit.resource, { source: options.source, target })
    const result: PopulateResult = { sha, count: files.length, files }
    if (options.manifestPath !== undefined) {
      const manifest = { source: options.source, target, sha, count: files.length, files, populatedAt: this.now() }
      writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      await this.registerArtifact(unit, options.artifactPath ?? options.manifestPath, 'materialization')
    }
    return result
  }

  async collect(unitId: string, options: CollectOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    mkdirSync(options.target, { recursive: true })
    await provider.collect(unit.resource, options)
    await this.registerArtifact(unit, options.artifactPath ?? options.target, options.kind ?? 'collection')
  }

  async release(unitId: string, options?: ReleaseOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    await this.checkReleaseGate(unit, options)
    await provider.terminate(unit.resource)
    this.units.delete(unitId)
    this.runningUnits.delete(unitId)
  }

  async checkpoint(unitId: string, options: CheckpointOptions): Promise<{ ref: string }> {
    if (options.name === '') throw new Error('lab: checkpoint name must be non-empty')
    const { unit, provider } = await this.locate(unitId)
    const ref = await provider.checkpoint(unit.resource, unit.workspace, options.name)
    if (unit.missionId === undefined) return { ref }
    const mission = this.options.getMission()
    if (mission === undefined) {
      this.options.warn(`lab: checkpointed ${unit.id} at ${ref} but the mission plugin is absent — no checkpoint was registered`)
      return { ref }
    }
    try {
      await mission.addCheckpoint(unit.missionId, { name: options.name, ref }, runIdOption(unit))
    } catch (error) {
      this.options.warn(`lab: checkpoint registration for mission ${unit.missionId} failed: ${String(error)}`)
    }
    return { ref }
  }

  async verify(unitId: string, options: VerifyOptions): Promise<VerifyResult> {
    if (options.command.length === 0) throw new Error('lab: verify command must be non-empty')
    const { unit, provider } = await this.locate(unitId)
    const result = await provider.verify(unit.resource, unit.workspace, options)
    // Record verbatim, never judge: the outcome lands in the fixed `lab`
    // namespace exactly as produced — exit code, both streams, the timeout
    // fact. "Passed?" is the consumer's semantics, not this plugin's.
    if (unit.missionId === undefined) return result
    const mission = this.options.getMission()
    if (mission === undefined) {
      this.options.warn(`lab: verified ${unit.id} (exit ${result.exitCode}) but the mission plugin is absent — the outcome was not recorded`)
      return result
    }
    try {
      await mission.annotate(unit.missionId, LAB_ANNOTATION_NS, {
        kind: 'verify',
        command: options.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      }, runIdOption(unit))
    } catch (error) {
      this.options.warn(`lab: verify annotation for mission ${unit.missionId} failed: ${String(error)}`)
    }
    return result
  }

  async archive(unitId: string, options: ArchiveOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    mkdirSync(options.target, { recursive: true })
    const workspaceOut = join(options.target, 'workspace')
    await provider.collect(unit.resource, { source: unit.workspace, target: workspaceOut })
    const manifest = {
      unit: {
        id: unit.id,
        provider: unit.provider,
        resource: unit.resource,
        fingerprint: unit.fingerprint,
        workspace: unit.workspace,
        ...(unit.missionId !== undefined ? { missionId: unit.missionId } : {}),
        ...(unit.runId !== undefined ? { runId: unit.runId } : {}),
      },
      archivedAt: this.now(),
      files: hashTree(workspaceOut),
    }
    writeFileSync(join(options.target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await this.registerArtifact(unit, options.artifactPath ?? options.target, options.kind ?? 'archive')
  }

  /** Artifact registration (collect / populate-manifest / archive): warns and skips, never blocks. */
  private async registerArtifact(unit: UnitInfo, path: string, kind: string): Promise<void> {
    if (unit.missionId === undefined) return
    const mission = this.options.getMission()
    if (mission === undefined) {
      this.options.warn(`lab: unit ${unit.id} produced a ${kind} artifact but the mission plugin is absent — it was not registered`)
      return
    }
    try {
      await mission.addArtifact(unit.missionId, { path, kind }, runIdOption(unit))
    } catch (error) {
      this.options.warn(`lab: artifact registration for mission ${unit.missionId} failed: ${String(error)}`)
    }
  }

  /**
   * The gate's enforcement point. With a mission binding AND the plugin
   * present, `isReleasable` decides — a failed query fails closed and no
   * option bypasses the check. Without a gate, `force: true` plus a warning
   * is the only way through.
   */
  private async checkReleaseGate(unit: UnitInfo, options: ReleaseOptions | undefined): Promise<void> {
    const mission = unit.missionId !== undefined ? this.options.getMission() : undefined
    if (unit.missionId !== undefined && mission !== undefined) {
      let releasable: boolean
      try {
        releasable = await mission.isReleasable(unit.missionId, unit.runId)
      } catch (error) {
        throw new Error(`lab: release of ${unit.id} refused — the releasable check for mission ${unit.missionId} failed closed: ${String(error)}`)
      }
      if (!releasable) {
        throw new Error(`lab: release of ${unit.id} refused — mission ${unit.missionId} is not in a releasable state; archive and pass its gate first`)
      }
      return
    }
    const why = unit.missionId === undefined
      ? 'it is registered to no mission'
      : `the mission plugin is absent (unit is bound to ${unit.missionId})`
    if (options?.force !== true) {
      throw new Error(`lab: release of ${unit.id} refused — ${why}, so no releasable gate protects this irreversible destroy; pass force to proceed on your own guarantee`)
    }
    this.options.warn(`lab: releasing unit ${unit.id} without a mission releasable gate (force) — ${why}; the caller guarantees archiving`)
  }

  async status(unitId?: string): Promise<UnitStatus[]> {
    await this.reconcile()
    const mission = this.options.getMission()
    const rows: UnitStatus[] = []
    for (const unit of this.units.values()) {
      if (unitId !== undefined && unit.id !== unitId) continue
      const row: UnitStatus = { ...unit, running: this.runningUnits.has(unit.id) }
      if (row.running) {
        const provider = this.options.providers[unit.provider]
        if (provider !== undefined) {
          const facts = await provider.activity(unit.resource, unit.workspace)
          if (facts.mtime !== undefined) row.lastActivityAt = facts.mtime
          if (facts.cpuUsageUsec !== undefined) row.cpuUsageUsec = facts.cpuUsageUsec
        }
      }
      if (unit.missionId !== undefined && mission !== undefined) {
        try {
          const { mission: snapshot } = await mission.get(unit.missionId, unit.runId)
          const attempt = snapshot.attempts.find((a) => a.attempt === snapshot.currentAttempt)
          if (attempt !== undefined) {
            row.missionState = attempt.state
            row.missionLabels = snapshot.labels
            // Newest materialization first: retry re-materializes, and a stale
            // or ghost record (unreadable file) must skip with a warning, not
            // blank the whole column.
            for (const artifact of attempt.artifacts.filter((a) => a.kind === 'materialization').reverse()) {
              try {
                const parsed = JSON.parse(readFileSync(artifact.path, 'utf8')) as { sha?: string }
                if (typeof parsed.sha === 'string') {
                  row.taskHash = parsed.sha.slice(0, TASK_HASH_PREFIX)
                  break
                }
                this.options.warn(`lab: materialization artifact ${artifact.path} has no sha — skipped`)
              } catch (error) {
                this.options.warn(`lab: materialization artifact ${artifact.path} unreadable — skipped: ${String(error)}`)
              }
            }
          }
        } catch (error) {
          this.options.warn(`lab: status join for mission ${unit.missionId} failed: ${String(error)}`)
        }
      }
      rows.push(row)
    }
    if (unitId !== undefined && rows.length === 0) throw new Error(`lab: unknown unit ${JSON.stringify(unitId)}`)
    return rows
  }

  /** Registration writes warn-and-skip: they never block the resource verb. */
  private async registerRefs(info: UnitInfo): Promise<void> {
    const missionId = info.missionId as string
    const mission = this.options.getMission()
    if (mission === undefined) {
      this.options.warn(`lab: unit ${info.id} is bound to mission ${missionId} but the mission plugin is absent — refs (resource + fingerprint) were not registered; release will require force`)
      return
    }
    try {
      await mission.setRefs(missionId, { resource: info.resource, fingerprint: info.fingerprint }, runIdOption(info))
    } catch (error) {
      this.options.warn(`lab: ref registration for mission ${missionId} failed: ${String(error)}`)
    }
  }

  /** Rebuild the registry from the providers' own labels (single-flight). */
  private reconcile(): Promise<void> {
    this.reconciliation ??= this.doReconcile()
    return this.reconciliation
  }

  private async doReconcile(): Promise<void> {
    this.runningUnits.clear()
    for (const provider of Object.values(this.options.providers)) {
      for (const managed of await provider.listManaged()) {
        if (managed.running) this.runningUnits.add(managed.id)
        if (this.units.has(managed.id)) continue
        const info: UnitInfo = {
          id: managed.id,
          provider: provider.kind,
          resource: managed.resource,
          fingerprint: managed.labels['dsh-lab.fingerprint'] ?? '',
          workspace: managed.labels['dsh-lab.workdir'] ?? DEFAULT_WORKSPACE,
          createdAt: managed.createdAt ?? this.now(),
        }
        const missionId = managed.labels['dsh-lab.mission']
        if (missionId !== undefined) info.missionId = missionId
        const runId = managed.labels['dsh-lab.run']
        if (runId !== undefined) info.runId = runId
        this.units.set(managed.id, info)
      }
    }
  }

  private async locate(unitId: string): Promise<{ unit: UnitInfo; provider: UnitProvider }> {
    await this.reconcile()
    const unit = this.units.get(unitId)
    if (unit === undefined) throw new Error(`lab: unknown unit ${JSON.stringify(unitId)}`)
    const provider = this.options.providers[unit.provider]
    if (provider === undefined) throw new Error(`lab: no provider for kind ${JSON.stringify(unit.provider)}`)
    return { unit, provider }
  }
}

/** exactOptionalPropertyTypes-safe runId option. */
function runIdOption(unit: UnitInfo): { runId: string } | undefined {
  return unit.runId === undefined ? undefined : { runId: unit.runId }
}

/** One manifest entry per file (sha256 + size) or symlink (target), sorted by path. */
function hashTree(root: string): { path: string; sha256?: string; bytes?: number; symlink?: string }[] {
  const entries: { path: string; sha256?: string; bytes?: number; symlink?: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: relative(root, full), symlink: readlinkSync(full) })
      } else if (entry.isFile()) {
        const content = readFileSync(full)
        entries.push({ path: relative(root, full), sha256: createHash('sha256').update(content).digest('hex'), bytes: content.byteLength })
      }
    }
  }
  walk(root)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}
