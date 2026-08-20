import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LabService } from '../src/service.ts'
import type {
  AcquireSpec, CollectOptions, ManagedResource, MissionFace, PopulateOptions, UnitProvider,
} from '../src/types.ts'

/** In-memory provider: records verbs, keeps a managed-resource list for reconcile. */
class FakeProvider implements UnitProvider {
  readonly kind = 'docker'
  managed: ManagedResource[] = []
  terminated: string[] = []
  populated: (PopulateOptions & { target: string })[] = []
  collected: CollectOptions[] = []
  fingerprintValue = 'fp:test'

  fingerprint(_spec: AcquireSpec): Promise<string> {
    return Promise.resolve(this.fingerprintValue)
  }

  acquire(id: string, spec: AcquireSpec, fingerprint: string): Promise<string> {
    const resource = `dsh-lab-${id}`
    const labels: Record<string, string> = { 'dsh-lab.unit': id, 'dsh-lab.fingerprint': fingerprint }
    if (spec.missionId !== undefined) labels['dsh-lab.mission'] = spec.missionId
    if (spec.runId !== undefined) labels['dsh-lab.run'] = spec.runId
    this.managed.push({ id, resource, labels, running: true })
    return Promise.resolve(resource)
  }

  populate(_resource: string, options: PopulateOptions & { target: string }): Promise<void> {
    this.populated.push(options)
    return Promise.resolve()
  }

  collect(_resource: string, options: CollectOptions): Promise<void> {
    this.collected.push(options)
    return Promise.resolve()
  }

  listManaged(): Promise<ManagedResource[]> {
    return Promise.resolve(this.managed)
  }

  terminate(resource: string): Promise<void> {
    this.terminated.push(resource)
    this.managed = this.managed.filter((m) => m.resource !== resource)
    return Promise.resolve()
  }
}

/** Scripted mission face recording registrations. */
function fakeMission(releasable: boolean): MissionFace & {
  refs: { missionId: string; refs: { resource?: string; fingerprint?: string } }[]
  artifacts: { missionId: string; path: string; kind: string }[]
} {
  const refs: { missionId: string; refs: { resource?: string; fingerprint?: string } }[] = []
  const artifacts: { missionId: string; path: string; kind: string }[] = []
  return {
    refs,
    artifacts,
    setRefs(missionId, r) {
      refs.push({ missionId, refs: r })
      return Promise.resolve()
    },
    addArtifact(missionId, artifact) {
      artifacts.push({ missionId, path: artifact.path, kind: artifact.kind })
      return Promise.resolve({ added: true })
    },
    isReleasable: () => releasable,
  }
}

function makeService(overrides?: {
  mission?: MissionFace | undefined
  maxConcurrentUnits?: number
  provider?: FakeProvider
}): { service: LabService; provider: FakeProvider; warnings: string[] } {
  const provider = overrides?.provider ?? new FakeProvider()
  const warnings: string[] = []
  let counter = 0
  const service = new LabService({
    providers: { docker: provider },
    maxConcurrentUnits: overrides?.maxConcurrentUnits ?? 4,
    getMission: () => overrides?.mission,
    warn: (message) => warnings.push(message),
    idgen: () => `u${(counter += 1)}`,
  })
  return { service, provider, warnings }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('acquire', () => {
  it('registers resource + environment fingerprint into mission refs', async () => {
    const mission = fakeMission(true)
    const { service } = makeService({ mission })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1', runId: 'r-1' })
    expect(info).toMatchObject({ id: 'u1', resource: 'dsh-lab-u1', fingerprint: 'fp:test', missionId: 'm-1' })
    expect(mission.refs).toEqual([{ missionId: 'm-1', refs: { resource: 'dsh-lab-u1', fingerprint: 'fp:test' } }])
  })

  it('records a different fingerprint when the image differs (comparability mechanism)', async () => {
    const mission = fakeMission(true)
    const provider = new FakeProvider()
    const { service } = makeService({ mission, provider })
    await service.acquire({ image: 'app:v1', missionId: 'm-1' })
    provider.fingerprintValue = 'fp:other'
    await service.acquire({ image: 'app:v2', missionId: 'm-2' })
    expect(mission.refs[0]?.refs.fingerprint).toBe('fp:test')
    expect(mission.refs[1]?.refs.fingerprint).toBe('fp:other')
  })

  it('refuses acquire at the maxConcurrentUnits ceiling with an explicit error', async () => {
    const { service } = makeService({ maxConcurrentUnits: 1 })
    await service.acquire({ image: 'app:latest' })
    await expect(service.acquire({ image: 'app:latest' })).rejects.toThrow(/maxConcurrentUnits \(1\)/)
  })

  it('warns and still acquires when mission is absent but a missionId is given', async () => {
    const { service, warnings } = makeService({ mission: undefined })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    expect(info.resource).toBe('dsh-lab-u1')
    expect(warnings.some((w) => w.includes('mission plugin is absent'))).toBe(true)
  })

  it('warns and still acquires when ref registration fails', async () => {
    const mission = fakeMission(true)
    mission.setRefs = () => Promise.reject(new Error('store locked'))
    const { service, warnings } = makeService({ mission })
    await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    expect(warnings.some((w) => w.includes('store locked'))).toBe(true)
  })
})

describe('populate / collect', () => {
  it('populates with the default in-unit target', async () => {
    const { service, provider } = makeService()
    const info = await service.acquire({ image: 'app:latest' })
    await service.populate(info.id, { source: '/host/layer' })
    expect(provider.populated).toEqual([{ source: '/host/layer', target: '/workspace' }])
  })

  it('collects and registers the artifact with mission', async () => {
    const mission = fakeMission(true)
    const { service, provider } = makeService({ mission })
    const target = join(mkdtempSync(join(tmpdir(), 'lab-test-')), 'out')
    tmpDirs.push(join(target, '..'))
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await service.collect(info.id, { source: '/workspace/out', target, kind: 'archive' })
    expect(provider.collected).toEqual([{ source: '/workspace/out', target, kind: 'archive' }])
    expect(mission.artifacts).toEqual([{ missionId: 'm-1', path: target, kind: 'archive' }])
  })

  it('warns instead of registering when mission is absent', async () => {
    const { service, warnings } = makeService({ mission: undefined })
    const target = mkdtempSync(join(tmpdir(), 'lab-test-'))
    tmpDirs.push(target)
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await service.collect(info.id, { source: '/workspace/out', target })
    expect(warnings.some((w) => w.includes('no artifact was registered'))).toBe(true)
  })
})

describe('release gate', () => {
  it('refuses when the mission is not releasable — force does NOT bypass the gate', async () => {
    const { service, provider } = makeService({ mission: fakeMission(false) })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await expect(service.release(info.id)).rejects.toThrow(/not in a releasable state/)
    await expect(service.release(info.id, { force: true })).rejects.toThrow(/not in a releasable state/)
    expect(provider.terminated).toEqual([])
  })

  it('releases when the mission is releasable', async () => {
    const { service, provider } = makeService({ mission: fakeMission(true) })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await service.release(info.id)
    expect(provider.terminated).toEqual(['dsh-lab-u1'])
  })

  it('fails closed when the releasable check itself errors', async () => {
    const mission = fakeMission(true)
    mission.isReleasable = () => {
      throw new Error('unknown mission')
    }
    const { service, provider } = makeService({ mission })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await expect(service.release(info.id, { force: true })).rejects.toThrow(/failed closed/)
    expect(provider.terminated).toEqual([])
  })

  it('without a mission binding, refuses without force and warns + releases with it', async () => {
    const { service, provider, warnings } = makeService()
    const info = await service.acquire({ image: 'app:latest' })
    await expect(service.release(info.id)).rejects.toThrow(/pass force/)
    expect(provider.terminated).toEqual([])
    await service.release(info.id, { force: true })
    expect(provider.terminated).toEqual(['dsh-lab-u1'])
    expect(warnings.some((w) => w.includes('without a mission releasable gate'))).toBe(true)
  })

  it('bound to a mission but the plugin is absent: force required, warning emitted', async () => {
    const { service, provider, warnings } = makeService({ mission: undefined })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await expect(service.release(info.id)).rejects.toThrow(/pass force/)
    await service.release(info.id, { force: true })
    expect(provider.terminated).toEqual(['dsh-lab-u1'])
    expect(warnings.some((w) => w.includes('without a mission releasable gate'))).toBe(true)
  })
})

describe('reconciliation (host restart)', () => {
  it('rebuilds the registry from provider labels, mission binding included', async () => {
    const provider = new FakeProvider()
    provider.managed.push({
      id: 'old1',
      resource: 'dsh-lab-old1',
      labels: { 'dsh-lab.unit': 'old1', 'dsh-lab.mission': 'm-9', 'dsh-lab.fingerprint': 'fp:old' },
      running: true,
    })
    // A fresh service (the restarted host) never saw the acquire.
    const { service } = makeService({ mission: fakeMission(false), provider })
    const statuses = await service.status()
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ id: 'old1', resource: 'dsh-lab-old1', fingerprint: 'fp:old', missionId: 'm-9', running: true })
    // The gate still protects the reconciled unit.
    await expect(service.release('old1')).rejects.toThrow(/not in a releasable state/)
  })

  it('status of an unknown unit fails loud', async () => {
    const { service } = makeService()
    await expect(service.status('ghost')).rejects.toThrow(/unknown unit/)
  })
})
