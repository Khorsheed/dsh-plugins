import { describe, expect, it } from 'vitest'
import { LabService } from '../src/service.ts'
import type {
  AcquireSpec, EnvironmentFingerprint, ManagedResource, PopulateOptions, UnitProvider, VerifyOptions, VerifyResult,
} from '../src/types.ts'

/**
 * In-memory provider: records verbs, keeps a managed-resource list for
 * reconcile, and stamps the acquiring instance's scope into the unit labels
 * exactly as the docker provider does — the daemon is the registry of record,
 * so the scope rides the same label path in the fake.
 */
class FakeProvider implements UnitProvider {
  readonly kind = 'docker'
  managed: ManagedResource[] = []
  terminated: string[] = []
  populated: (PopulateOptions & { target: string })[] = []
  verifies: VerifyOptions[] = []
  checkpoints: { workspace: string; name: string }[] = []

  fingerprint(_spec: AcquireSpec): Promise<EnvironmentFingerprint> {
    return Promise.resolve({
      fingerprint: 'lab-env:test',
      components: {
        version: 1,
        image: 'lab-env:test',
        resources: { cpus: null, memory: null },
        mounts: [],
        envKeys: [],
        network: null,
        user: null,
      },
    })
  }

  acquire(id: string, spec: AcquireSpec, fingerprint: EnvironmentFingerprint, scope?: string): Promise<string> {
    const resource = `dsh-lab-${id}`
    const labels: Record<string, string> = {
      'dsh-lab.unit': id,
      'dsh-lab.fingerprint': fingerprint.fingerprint,
      'dsh-lab.workdir': spec.workdir ?? '/workspace',
    }
    if (scope !== undefined) labels['dsh-lab.scope'] = scope
    this.managed.push({ id, resource, labels, running: true })
    return Promise.resolve(resource)
  }

  populate(_resource: string, options: PopulateOptions & { target: string }): Promise<void> {
    this.populated.push(options)
    return Promise.resolve()
  }

  collect(): Promise<void> {
    return Promise.resolve()
  }

  checkpoint(_resource: string, workspace: string, name: string): Promise<string> {
    this.checkpoints.push({ workspace, name })
    return Promise.resolve('sha:fake')
  }

  activity(): Promise<{ mtime?: number; cpuUsageUsec?: number }> {
    return Promise.resolve({})
  }

  verify(_resource: string, _workspace: string, options: VerifyOptions): Promise<VerifyResult> {
    this.verifies.push(options)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false })
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

function makeService(overrides?: {
  maxConcurrentUnits?: number
  provider?: FakeProvider
  scope?: string
}): { service: LabService; provider: FakeProvider } {
  const provider = overrides?.provider ?? new FakeProvider()
  let counter = 0
  const service = new LabService({
    providers: { docker: provider },
    maxConcurrentUnits: overrides?.maxConcurrentUnits ?? 4,
    ...(overrides?.scope !== undefined ? { scope: overrides.scope } : {}),
    getMission: () => undefined,
    warn: () => undefined,
    idgen: () => `u${(counter += 1)}`,
  })
  return { service, provider }
}

/** A pre-existing managed unit on the daemon, scoped or (when omitted) unscoped. */
function managedUnit(id: string, scope?: string): ManagedResource {
  const labels: Record<string, string> = { 'dsh-lab.unit': id, 'dsh-lab.fingerprint': 'lab-env:pre' }
  if (scope !== undefined) labels['dsh-lab.scope'] = scope
  return { id, resource: `dsh-lab-${id}`, labels, running: true }
}

describe('instance scope — the per-instance mounting seam', () => {
  it('stamps the scope label on every unit the scoped instance acquires', async () => {
    const { service, provider } = makeService({ scope: 'alpha' })
    await service.acquire({ image: 'app:latest' })
    await service.acquire({ image: 'app:latest' })
    expect(provider.managed.map((m) => m.labels['dsh-lab.scope'])).toEqual(['alpha', 'alpha'])
  })

  it('stamps nothing extra when the instance is unscoped — the label set is byte-identical to before', async () => {
    const { service, provider } = makeService()
    await service.acquire({ image: 'app:latest' })
    expect(provider.managed[0]?.labels).toEqual({
      'dsh-lab.unit': 'u1',
      'dsh-lab.fingerprint': 'lab-env:test',
      'dsh-lab.workdir': '/workspace',
    })
  })

  it('adopts only its own scope’s units on reconcile — not other scopes, not unscoped units (pinned)', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('a1', 'alpha'), managedUnit('b1', 'beta'), managedUnit('legacy')]
    const { service } = makeService({ provider, scope: 'alpha' })
    const rows = await service.status()
    expect(rows.map((row) => row.id)).toEqual(['a1'])
  })

  it('counts only in-scope units against the maxConcurrentUnits ceiling', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('b1', 'beta'), managedUnit('b2', 'beta'), managedUnit('legacy')]
    const { service } = makeService({ provider, scope: 'alpha', maxConcurrentUnits: 1 })
    // Three managed units on the daemon, none of them this instance's: the
    // budget is untouched.
    await service.acquire({ image: 'app:latest' })
    await expect(service.acquire({ image: 'app:latest' })).rejects.toThrow(/maxConcurrentUnits \(1\)/)
  })

  it('an unscoped instance adopts everything, scoped units included — the legacy full view', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('a1', 'alpha'), managedUnit('legacy')]
    const { service } = makeService({ provider })
    const rows = await service.status()
    expect(rows.map((row) => row.id).sort()).toEqual(['a1', 'legacy'])
    // The full view can also act on a scoped unit (the operator's reach).
    await service.release('a1', { force: true })
    expect(provider.terminated).toEqual(['dsh-lab-a1'])
  })

  it('refuses release of foreign-scope and unscoped units — distinguishably, and never silently adopting', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('b1', 'beta'), managedUnit('legacy')]
    const { service } = makeService({ provider, scope: 'alpha' })
    await expect(service.release('b1', { force: true })).rejects.toThrow(/belongs to scope "beta"/)
    await expect(service.release('legacy', { force: true })).rejects.toThrow(/carries no scope label/)
    await expect(service.release('ghost', { force: true })).rejects.toThrow(/unknown unit/)
    expect(provider.terminated).toEqual([])
    // A refusal must not adopt: the daemon still lists both units.
    expect(provider.managed).toHaveLength(2)
  })

  it('refuses verify / populate / checkpoint of out-of-scope units through the same fence', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('b1', 'beta')]
    const { service } = makeService({ provider, scope: 'alpha' })
    await expect(service.verify('b1', { command: ['t'] })).rejects.toThrow(/belongs to scope "beta"/)
    await expect(service.populate('b1', { source: '/no/such/dir' })).rejects.toThrow(/belongs to scope "beta"/)
    await expect(service.checkpoint('b1', { name: 'c' })).rejects.toThrow(/belongs to scope "beta"/)
    expect(provider.verifies).toEqual([])
    expect(provider.populated).toEqual([])
    expect(provider.checkpoints).toEqual([])
  })

  it('status lists only its own scope, and a foreign unit id gets the scope refusal rather than a row', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('a1', 'alpha'), managedUnit('b1', 'beta')]
    const { service } = makeService({ provider, scope: 'alpha' })
    const rows = await service.status()
    expect(rows.map((row) => row.id)).toEqual(['a1'])
    await expect(service.status('b1')).rejects.toThrow(/belongs to scope "beta"/)
  })

  it('round-trips the scope label through a restart: a new instance with the same scope re-adopts and releases', async () => {
    const provider = new FakeProvider()
    const first = makeService({ provider, scope: 'alpha' })
    const info = await first.service.acquire({ image: 'app:latest' })
    // A differently-scoped instance never touches the survivor.
    const outsider = makeService({ provider, scope: 'gamma' })
    await expect(outsider.service.release(info.id, { force: true })).rejects.toThrow(/belongs to scope "alpha"/)
    // The process restarts: a fresh instance over the same daemon adopts the
    // unit from its labels alone and can act on it.
    const restarted = makeService({ provider, scope: 'alpha' })
    const [row] = await restarted.service.status(info.id)
    expect(row).toMatchObject({ id: info.id, resource: 'dsh-lab-u1', running: true })
    await restarted.service.release(info.id, { force: true })
    expect(provider.terminated).toEqual(['dsh-lab-u1'])
  })

  it('normalizes an empty-string scope to unscoped', async () => {
    const provider = new FakeProvider()
    provider.managed = [managedUnit('b1', 'beta')]
    const { service } = makeService({ provider, scope: '' })
    const rows = await service.status()
    expect(rows.map((row) => row.id)).toEqual(['b1'])
    await service.acquire({ image: 'app:latest' })
    expect(provider.managed.find((m) => m.id === 'u1')?.labels).not.toHaveProperty('dsh-lab.scope')
  })
})
