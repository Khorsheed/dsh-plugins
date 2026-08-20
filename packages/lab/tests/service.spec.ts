import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LabService } from '../src/service.ts'
import type {
  AcquireSpec, CollectOptions, ManagedResource, MissionFace, PopulateOptions, UnitProvider,
  VerifyOptions, VerifyResult,
} from '../src/types.ts'

/** In-memory provider: records verbs, keeps a managed-resource list for reconcile. */
class FakeProvider implements UnitProvider {
  readonly kind = 'docker'
  managed: ManagedResource[] = []
  terminated: string[] = []
  populated: (PopulateOptions & { target: string })[] = []
  collected: CollectOptions[] = []
  checkpoints: { workspace: string; name: string }[] = []
  verifies: VerifyOptions[] = []
  checkpointRef = 'sha:fake'
  verifyResult: VerifyResult = { exitCode: 0, stdout: '', stderr: '', durationMs: 5, timedOut: false }
  /** Files the fake collect/archive materializes into the target. */
  collectFiles: Record<string, string> = {}

  fingerprint(_spec: AcquireSpec): Promise<string> {
    return Promise.resolve(this.fingerprintValue)
  }

  fingerprintValue = 'fp:test'

  acquire(id: string, spec: AcquireSpec, fingerprint: string): Promise<string> {
    const resource = `dsh-lab-${id}`
    const labels: Record<string, string> = {
      'dsh-lab.unit': id,
      'dsh-lab.fingerprint': fingerprint,
      'dsh-lab.workdir': spec.workdir ?? '/workspace',
    }
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
    mkdirSync(options.target, { recursive: true })
    for (const [name, content] of Object.entries(this.collectFiles)) {
      const full = join(options.target, name)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    return Promise.resolve()
  }

  checkpoint(_resource: string, workspace: string, name: string): Promise<string> {
    this.checkpoints.push({ workspace, name })
    return Promise.resolve(this.checkpointRef)
  }

  verify(_resource: string, _workspace: string, options: VerifyOptions): Promise<VerifyResult> {
    this.verifies.push(options)
    return Promise.resolve(this.verifyResult)
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
  checkpoints: { missionId: string; name: string; ref?: string }[]
  annotations: { missionId: string; ns: string; payload: unknown }[]
} {
  const refs: { missionId: string; refs: { resource?: string; fingerprint?: string } }[] = []
  const artifacts: { missionId: string; path: string; kind: string }[] = []
  const checkpoints: { missionId: string; name: string; ref?: string }[] = []
  const annotations: { missionId: string; ns: string; payload: unknown }[] = []
  return {
    refs,
    artifacts,
    checkpoints,
    annotations,
    setRefs(missionId, r) {
      refs.push({ missionId, refs: r })
      return Promise.resolve()
    },
    addArtifact(missionId, artifact) {
      artifacts.push({ missionId, path: artifact.path, kind: artifact.kind })
      return Promise.resolve({ added: true })
    },
    addCheckpoint(missionId, checkpoint) {
      const entry: { missionId: string; name: string; ref?: string } = { missionId, name: checkpoint.name }
      if (checkpoint.ref !== undefined) entry.ref = checkpoint.ref
      checkpoints.push(entry)
      return Promise.resolve({ added: true })
    },
    annotate(missionId, ns, payload) {
      annotations.push({ missionId, ns, payload })
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

describe('checkpoint', () => {
  it('tags the workspace and registers the ref with mission', async () => {
    const mission = fakeMission(true)
    const { service, provider } = makeService({ mission })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    const { ref } = await service.checkpoint(info.id, { name: 'iter-1' })
    expect(ref).toBe('sha:fake')
    expect(provider.checkpoints).toEqual([{ workspace: '/workspace', name: 'iter-1' }])
    expect(mission.checkpoints).toEqual([{ missionId: 'm-1', name: 'iter-1', ref: 'sha:fake' }])
  })

  it('honors a custom workdir as the checkpoint workspace', async () => {
    const { service, provider } = makeService()
    const info = await service.acquire({ image: 'app:latest', workdir: '/repo' })
    await service.checkpoint(info.id, { name: 'c' })
    expect(provider.checkpoints[0]?.workspace).toBe('/repo')
  })

  it('warns instead of registering when mission is absent', async () => {
    const { service, warnings } = makeService({ mission: undefined })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await service.checkpoint(info.id, { name: 'iter-1' })
    expect(warnings.some((w) => w.includes('no checkpoint was registered'))).toBe(true)
  })

  it('rejects an empty checkpoint name', async () => {
    const { service } = makeService()
    const info = await service.acquire({ image: 'app:latest' })
    await expect(service.checkpoint(info.id, { name: '' })).rejects.toThrow(/non-empty/)
  })
})

describe('verify — records verbatim, never judges', () => {
  async function verifyWith(verifyResult: VerifyResult): Promise<{
    annotations: { missionId: string; ns: string; payload: unknown }[]
  }> {
    const mission = fakeMission(true)
    const provider = new FakeProvider()
    provider.verifyResult = verifyResult
    const { service } = makeService({ mission, provider })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    await service.verify(info.id, { command: ['npm', 'test'] })
    return { annotations: mission.annotations }
  }

  it('a failing command is recorded as-is (exit code + streams), with no verdict', async () => {
    const { annotations } = await verifyWith({ exitCode: 1, stdout: 'tests failed: 2', stderr: 'boom', durationMs: 9, timedOut: false })
    expect(annotations).toHaveLength(1)
    expect(annotations[0]?.ns).toBe('lab')
    expect(annotations[0]?.payload).toMatchObject({ kind: 'verify', command: ['npm', 'test'], exitCode: 1, stdout: 'tests failed: 2', stderr: 'boom', timedOut: false })
  })

  it('a timeout is recorded as a fact, not a failure verdict', async () => {
    const { annotations } = await verifyWith({ exitCode: -1, stdout: 'partial', stderr: '', durationMs: 100, timedOut: true })
    expect(annotations[0]?.payload).toMatchObject({ exitCode: -1, timedOut: true, stdout: 'partial' })
  })

  it('a silent success is recorded with empty streams verbatim', async () => {
    const { annotations } = await verifyWith({ exitCode: 0, stdout: '', stderr: '', durationMs: 3, timedOut: false })
    expect(annotations[0]?.payload).toMatchObject({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('returns the outcome even when mission is absent, and warns about the missed record', async () => {
    const provider = new FakeProvider()
    provider.verifyResult = { exitCode: 3, stdout: 'x', stderr: '', durationMs: 1, timedOut: false }
    const { service, warnings } = makeService({ mission: undefined, provider })
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1' })
    const result = await service.verify(info.id, { command: ['t'] })
    expect(result.exitCode).toBe(3)
    expect(warnings.some((w) => w.includes('not recorded'))).toBe(true)
  })

  it('rejects an empty command', async () => {
    const { service } = makeService()
    const info = await service.acquire({ image: 'app:latest' })
    await expect(service.verify(info.id, { command: [] })).rejects.toThrow(/non-empty/)
  })
})

describe('archive', () => {
  it('exports the workspace and writes a sha256 integrity manifest, registered as an artifact', async () => {
    const mission = fakeMission(true)
    const provider = new FakeProvider()
    provider.collectFiles = { 'out.txt': 'hello', '.git/HEAD': 'ref: refs/heads/main\n' }
    const { service } = makeService({ mission, provider })
    const target = mkdtempSync(join(tmpdir(), 'lab-archive-'))
    tmpDirs.push(target)
    const info = await service.acquire({ image: 'app:latest', missionId: 'm-1', workdir: '/repo' })
    await service.archive(info.id, { target })
    expect(provider.collected).toEqual([{ source: '/repo', target: join(target, 'workspace') }])
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as {
      unit: { id: string; fingerprint: string; workspace: string; missionId: string }
      files: { path: string; sha256?: string; bytes?: number }[]
    }
    expect(manifest.unit).toMatchObject({ id: 'u1', fingerprint: 'fp:test', workspace: '/repo', missionId: 'm-1' })
    const out = manifest.files.find((f) => f.path === 'out.txt')
    expect(out?.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(out?.bytes).toBe(5)
    expect(mission.artifacts).toEqual([{ missionId: 'm-1', path: target, kind: 'archive' }])
  })
})
