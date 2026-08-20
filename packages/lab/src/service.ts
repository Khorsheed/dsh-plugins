/**
 * The lab service kernel: verb semantics, the mission releasable gate, the
 * concurrency ceiling, and the restart-surviving registry (reconciled from
 * provider labels). Provider mechanics live in {@link UnitProvider}; mission
 * integration is a probed, optional {@link MissionFace}.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import type {
  AcquireSpec, CollectOptions, Lab, MissionFace, PopulateOptions, ReleaseOptions,
  UnitInfo, UnitProvider, UnitStatus,
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

/** Default in-unit target of {@link LabService.populate}. */
export const DEFAULT_POPULATE_TARGET = '/workspace'

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
    const info: UnitInfo = { id, provider: kind, resource, fingerprint, createdAt: this.now() }
    if (spec.missionId !== undefined) info.missionId = spec.missionId
    if (spec.runId !== undefined) info.runId = spec.runId
    this.units.set(id, info)
    this.runningUnits.add(id)
    if (info.missionId !== undefined) await this.registerRefs(info)
    return info
  }

  async populate(unitId: string, options: PopulateOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    await provider.populate(unit.resource, { source: options.source, target: options.target ?? DEFAULT_POPULATE_TARGET })
  }

  async collect(unitId: string, options: CollectOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    mkdirSync(options.target, { recursive: true })
    await provider.collect(unit.resource, options)
    if (unit.missionId === undefined) return
    const mission = this.options.getMission()
    if (mission === undefined) {
      this.options.warn(`lab: collected ${unit.id} but the mission plugin is absent — no artifact was registered`)
      return
    }
    try {
      await mission.addArtifact(
        unit.missionId,
        { path: options.target, kind: options.kind ?? 'collection' },
        runIdOption(unit),
      )
    } catch (error) {
      this.options.warn(`lab: artifact registration for mission ${unit.missionId} failed: ${String(error)}`)
    }
  }

  async release(unitId: string, options?: ReleaseOptions): Promise<void> {
    const { unit, provider } = await this.locate(unitId)
    this.checkReleaseGate(unit, options)
    await provider.terminate(unit.resource)
    this.units.delete(unitId)
    this.runningUnits.delete(unitId)
  }

  /**
   * The gate's enforcement point. With a mission binding AND the plugin
   * present, `isReleasable` decides — a failed query fails closed and no
   * option bypasses the check. Without a gate, `force: true` plus a warning
   * is the only way through.
   */
  private checkReleaseGate(unit: UnitInfo, options: ReleaseOptions | undefined): void {
    const mission = unit.missionId !== undefined ? this.options.getMission() : undefined
    if (unit.missionId !== undefined && mission !== undefined) {
      let releasable: boolean
      try {
        releasable = mission.isReleasable(unit.missionId, unit.runId)
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
    const toStatus = (unit: UnitInfo): UnitStatus => ({ ...unit, running: this.runningUnits.has(unit.id) })
    if (unitId === undefined) return [...this.units.values()].map(toStatus)
    const unit = this.units.get(unitId)
    if (unit === undefined) throw new Error(`lab: unknown unit ${JSON.stringify(unitId)}`)
    return [toStatus(unit)]
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
