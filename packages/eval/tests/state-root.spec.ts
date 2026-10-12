/**
 * The instance-configurable state root and the dispose seam.
 *
 * An EvalService constructed with `stateRoot` binds its whole state tree —
 * experiments, the condition library, and every run's per-cell directories —
 * to that root instead of `$DSH_HOME/state/eval`, so two instances mounted
 * with two roots see disjoint state. A Remote/ slash `runStart` stateRoot
 * defaults to the instance root and must resolve UNDER it (real paths, so
 * neither `..` nor a symlink laid inside the root escapes). `dispose()`
 * cancels the run jobs THIS instance started through the same AbortSignal
 * `job_kill` pulls — interrupted-cell finalization, never a force-kill — and
 * every public verb refuses the coded package error afterwards; jobs other
 * instances started are untouched (the unowned-by-design registration stays).
 *
 * The fake registry here is the same contract shape job.spec.ts pins:
 * `start` calls the producer synchronously, `kill` calls its `cancel`.
 */
import { readFileSync, symlinkSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvalRunJobs } from '../src/run/job.ts'
import { EvalRunRefused } from '../src/run/run.ts'
import { EvalDisposedError, EvalService } from '../src/service.ts'
import { EvalReadRefused } from '../src/read.ts'
import { EvalRemoteService } from '../src/remote.ts'
import { createExperiment } from '../src/design/experiment-store.ts'
import type { RunOptions, RunReport } from '../src/run/run.ts'
import { cleanupTmp, tmpTree, useDshHome, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

/** A minimal job registry with the semantics this producer depends on. */
function fakeJobs() {
  interface Entry {
    id: string
    kind: string
    label: string
    hooks: { cancel(reason?: string): void; done: Promise<{ status: string; detail?: string }> }
    status: string
    detail?: string
    startedAt: number
    finishedAt?: number
  }
  const entries = new Map<string, Entry>()
  let seq = 0
  const registry = {
    entries,
    start(spec: { kind: string; label: string; run: () => Entry['hooks'] }): string {
      seq += 1
      const id = `${spec.kind}-${seq}`
      const hooks = spec.run()
      const entry: Entry = { id, kind: spec.kind, label: spec.label, hooks, status: 'running', startedAt: Date.now() }
      entries.set(id, entry)
      void hooks.done.then((outcome) => {
        entry.status = outcome.status
        entry.detail = outcome.detail
        entry.finishedAt = Date.now()
      })
      return id
    },
    get(id: string) {
      const entry = entries.get(id)
      if (entry === undefined) throw new Error(`unknown job ${id}`)
      return {
        id: entry.id, kind: entry.kind, label: entry.label, status: entry.status,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        startedAt: entry.startedAt,
        ...(entry.finishedAt === undefined ? {} : { finishedAt: entry.finishedAt }),
        reported: false,
      }
    },
    kill(id: string, _caller: unknown, reason?: string): 'requested' | 'already-finished' {
      const entry = entries.get(id)
      if (entry === undefined) throw new Error(`unknown job ${id}`)
      if (entry.status !== 'running') return 'already-finished'
      entry.hooks.cancel(reason)
      entry.status = 'stopping'
      return 'requested'
    },
    /** The controller attach apply() performs through deferred injection. */
    attachController(_kind: string): () => void {
      return () => {}
    },
  }
  return registry
}

/** A host accessor over a service table. */
function hosts(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] }
}

/** A report shaped like the run loop's, for the settle path. */
function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runId: 'run-x',
    dryRun: false,
    meta: {},
    cells: [{
      missionId: 'cell-1', task: 'P0', condition: 'c', rep: 1, attempts: 1,
      finalState: 'archived', childSessionIds: [], promptShas: {}, activeMs: 1,
    }],
    readiness: [],
    subset: { only: null, maxCells: null, totalCells: 1, selectedCells: 1 },
    template: {} as never,
    ...overrides,
  } as RunReport
}

/** An agents face whose `create` records its options and returns a tracked session. */
function fakeAgentsCreate() {
  const created: Array<{ sessionId: string; meta?: { cwd?: string } }> = []
  const disposed: string[] = []
  const create = vi.fn(async (options: { sessionId: string; meta?: { cwd?: string } }) => {
    created.push(options)
    return {
      agent: { session: { id: options.sessionId } },
      dispose: async () => { disposed.push(options.sessionId) },
    }
  })
  return { created, disposed, create }
}

const CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: [] },
} as const

const DATASET = { registry: 'reg', set: 'ds', commit: 'c'.repeat(40) }

describe('the instance-configurable state root', () => {
  it('two instances with different roots see disjoint experiments, conditions and list rows', async () => {
    const rootA = join(tmpTree(), 'eval-a')
    const rootB = join(tmpTree(), 'eval-b')
    const experimentA = await createExperiment(rootA, { name: 'alpha', dataset: DATASET, plan: '{}' })
    const experimentB = await createExperiment(rootB, { name: 'beta', dataset: DATASET, plan: '{}' })
    writeJson(rootA, 'conditions/cond-a.json', CONDITION)
    writeJson(rootB, 'conditions/cond-b.json', CONDITION)
    const serviceA = new EvalService(hosts({}), { stateRoot: rootA })
    const serviceB = new EvalService(hosts({}), { stateRoot: rootB })

    expect(serviceA.stateRoot()).toBe(rootA)
    expect(serviceB.stateRoot()).toBe(rootB)

    // Experiments are read from the instance root: each id exists for exactly
    // one instance, and the other refuses it as unknown.
    await expect(serviceA.experimentRecord(experimentA.id)).resolves.toMatchObject({ id: experimentA.id })
    await expect(serviceA.experimentRecord(experimentB.id)).rejects.toBeInstanceOf(EvalReadRefused)
    await expect(serviceB.experimentRecord(experimentB.id)).resolves.toMatchObject({ id: experimentB.id })
    await expect(serviceB.experimentRecord(experimentA.id)).rejects.toBeInstanceOf(EvalReadRefused)

    // The condition library likewise: one library per root.
    expect((await serviceA.conditions()).conditions.map(c => c.id)).toEqual(['cond-a'])
    expect((await serviceB.conditions()).conditions.map(c => c.id)).toEqual(['cond-b'])

    // The lab list (no mission mounted: drafts only, the degrade note carried).
    const listA = await serviceA.experiments()
    const listB = await serviceB.experiments()
    expect(listA.rows.map(row => row.experimentId)).toEqual([experimentA.id])
    expect(listB.rows.map(row => row.experimentId)).toEqual([experimentB.id])
    expect(listA.notes.some(note => note.includes('no mission service'))).toBe(true)
  })

  it('an unset root keeps the legacy DSH_HOME behavior — including the throw when it is unset', async () => {
    const { stateRoot } = useDshHome()
    const service = new EvalService(hosts({}))
    expect(service.stateRoot()).toBe(stateRoot)

    delete process.env['DSH_HOME']
    expect(() => service.stateRoot()).toThrow(EvalReadRefused)
    expect(() => service.stateRoot()).toThrow(/set DSH_HOME/)
  })
})

describe('runStart stateRoot plumbing', () => {
  it('defaults the run\'s cell root to the instance root and accepts one under it', async () => {
    const root = join(tmpTree(), 'eval')
    const jobs = fakeJobs()
    const agents = fakeAgentsCreate()
    const service = new EvalService(hosts({ jobs, agents: { get: () => undefined, create: agents.create } }), { stateRoot: root })

    // No stateRoot given: the instance root is the run's cell root, which is
    // also the working directory the run's own parent session gets (T29d).
    const first = await service.runStart('/plans/missing.json')
    expect(agents.created[0]?.meta?.cwd).toBe(join(root, 'cells', first.runId))

    // One under the instance root: accepted and honored verbatim.
    const custom = join(root, 'cells-custom')
    const second = await service.runStart('/plans/missing.json', { stateRoot: custom })
    expect(agents.created[1]?.meta?.cwd).toBe(join(custom, 'cells', second.runId))
    expect(jobs.entries.size).toBe(2)
  })

  it('refuses a stateRoot that escapes the instance root — by `..` or by symlink — and registers nothing', async () => {
    const root = join(tmpTree(), 'eval')
    const outside = join(tmpTree(), 'outside')
    mkdirSync(outside, { recursive: true })
    const jobs = fakeJobs()
    const agents = fakeAgentsCreate()
    const service = new EvalService(hosts({ jobs, agents: { get: () => undefined, create: agents.create } }), { stateRoot: root })

    await expect(service.runStart('/plans/missing.json', { stateRoot: outside })).rejects.toBeInstanceOf(EvalRunRefused)
    await expect(service.runStart('/plans/missing.json', { stateRoot: outside })).rejects.toThrow(/outside this instance's state root/)
    await expect(service.runStart('/plans/missing.json', { stateRoot: join(root, 'a', '..', '..', 'escape') }))
      .rejects.toThrow(/outside this instance's state root/)
    // A symlink laid inside the root compares by its REAL location: refused too.
    mkdirSync(root, { recursive: true })
    symlinkSync(outside, join(root, 'link-out'))
    await expect(service.runStart('/plans/missing.json', { stateRoot: join(root, 'link-out', 'cells') }))
      .rejects.toThrow(/outside this instance's state root/)
    // The refusal is coded, and it happens before anything registered.
    const refusal = await service.runStart('/plans/missing.json', { stateRoot: outside }).catch((error: unknown) => error)
    expect((refusal as EvalRunRefused).diagnostics[0]?.code).toBe('STATEROOT_OUTSIDE_INSTANCE')
    expect(jobs.entries.size).toBe(0)
    expect(agents.created).toEqual([])
  })

  it('with no instance root the option passes through and DSH_HOME stays the default (legacy semantics)', async () => {
    const { stateRoot } = useDshHome()
    const jobs = fakeJobs()
    const agents = fakeAgentsCreate()
    const service = new EvalService(hosts({ jobs, agents: { get: () => undefined, create: agents.create } }))

    // The DSH_HOME-derived default, exactly as before this seam existed.
    const first = await service.runStart('/plans/missing.json')
    expect(agents.created[0]?.meta?.cwd).toBe(join(stateRoot, 'cells', first.runId))

    // An explicit stateRoot is taken as given — anywhere, no boundary check.
    const anywhere = join(tmpTree(), 'anywhere')
    const second = await service.runStart('/plans/missing.json', { stateRoot: anywhere })
    expect(agents.created[1]?.meta?.cwd).toBe(join(anywhere, 'cells', second.runId))
  })

  it('the Remote runStart carries stateRoot across, and the containment refusal reaches the caller', async () => {
    const root = join(tmpTree(), 'eval')
    const ctx = new Context()
    const service = new EvalService(hosts({}), { stateRoot: root })
    ctx.provide('dshEval', service as never)
    const fiber = ctx.plugin(EvalRemoteService)
    await fiber.await()
    const remote = ctx.get('dshEvalRemote') as EvalRemoteService

    const runStart = vi.spyOn(service, 'runStart').mockResolvedValue({
      jobId: 'eval-run-1', runId: 'run-1', parentSessionId: 'own-1', ownParentSession: true,
    })
    await remote.runStart({ plan: '/plans/p.json', stateRoot: join(root, 'cells-x') })
    expect(runStart.mock.calls[0]?.[1]).toMatchObject({ stateRoot: join(root, 'cells-x') })
    await remote.runStart({ plan: '/plans/p.json' })
    expect(runStart.mock.calls[1]?.[1]).not.toHaveProperty('stateRoot')

    // Unstubbed, the boundary check fires before any job registry is needed.
    runStart.mockRestore()
    await expect(remote.runStart({ plan: '/plans/p.json', stateRoot: '/elsewhere' }))
      .rejects.toThrow(/outside this instance's state root/)
    await fiber.dispose()
  })
})

describe('dispose', () => {
  /** The service's own run-jobs layer (the records dispose iterates). */
  function jobsOf(service: EvalService): EvalRunJobs {
    return (service as unknown as { jobs: EvalRunJobs }).jobs
  }

  /**
   * Start a fake run that blocks until its signal aborts, then finalizes the
   * way the real run loop does: the caught cell is written `interrupted`
   * under the run's cell root and the report says the run was cancelled.
   */
  async function startBlockingRun(
    service: EvalService,
    cellRoot: string,
    markers: { aborted: string[] },
  ): Promise<{ jobId: string; runId: string }> {
    return await jobsOf(service).start(async (options: RunOptions) => {
      options.signal?.addEventListener('abort', () => { markers.aborted.push(String(options.runId)) })
      return await new Promise<RunReport>((resolve) => {
        options.signal?.addEventListener('abort', () => {
          // The interrupted-cell finalization: bytes land on disk BEFORE the
          // run settles — the cancel path, never a force-kill.
          writeJson(cellRoot, `cells/${String(options.runId)}/cell-1/state.json`, { state: 'interrupted' })
          resolve(report({ runId: String(options.runId), meta: { cancelled: true } }))
        })
      })
    }, { parentSessionId: 'parent-1' })
  }

  it('cancels this instance\'s live run through the AbortSignal and leaves the other instance\'s alone', async () => {
    const jobs = fakeJobs()
    const agents = { get: () => ({ session: { id: 'parent-1' } }) }
    const serviceA = new EvalService(hosts({ jobs, agents }), { stateRoot: join(tmpTree(), 'eval-a') })
    const serviceB = new EvalService(hosts({ jobs, agents }), { stateRoot: join(tmpTree(), 'eval-b') })
    const rootA = join(tmpTree(), 'cells-a')
    const markersA = { aborted: [] as string[] }
    const markersB = { aborted: [] as string[] }
    const handleA = await startBlockingRun(serviceA, rootA, markersA)
    const handleB = await startBlockingRun(serviceB, join(tmpTree(), 'cells-b'), markersB)

    serviceA.dispose()

    // This instance's run was cancelled through the one lever: the signal
    // fired, the interrupted cell landed on disk, and the job settled
    // `killed` — stopped through the normal path, not failed.
    expect(markersA.aborted).toEqual([handleA.runId])
    const finalized = join(rootA, 'cells', handleA.runId, 'cell-1', 'state.json')
    expect(JSON.parse(readFileSync(finalized, 'utf8'))).toEqual({ state: 'interrupted' })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(jobs.entries.get(handleA.jobId)?.status).toBe('killed')

    // The other instance's job — same registry, unowned by design — is untouched.
    expect(markersB.aborted).toEqual([])
    expect(jobs.entries.get(handleB.jobId)?.status).toBe('running')

    serviceB.dispose()
    expect(markersB.aborted).toEqual([handleB.runId])
  })

  it('is idempotent, and afterwards every public verb refuses the coded package error', async () => {
    const jobs = fakeJobs()
    const agents = { get: () => ({ session: { id: 'parent-1' } }) }
    const service = new EvalService(hosts({ jobs, agents }), { stateRoot: join(tmpTree(), 'eval') })
    const markers = { aborted: [] as string[] }
    await startBlockingRun(service, join(tmpTree(), 'cells'), markers)

    service.dispose()
    service.dispose()
    // The second dispose cancelled nothing again: one abort, total.
    expect(markers.aborted).toHaveLength(1)

    // Reads refuse too: a mounting side never keeps consuming a stale
    // instance. The non-async verbs throw synchronously; the async ones
    // reject — the coded error is the same.
    expect(() => service.stateRoot()).toThrow(EvalDisposedError)
    expect(() => service.runJobList()).toThrow(EvalDisposedError)
    expect(() => service.hashCondition({})).toThrow(EvalDisposedError)
    expect(() => service.conditions()).toThrow(EvalDisposedError)
    expect(() => service.experiments()).toThrow(EvalDisposedError)
    expect(() => service.run('/plans/p.json', { dryRun: true })).toThrow(EvalDisposedError)
    await expect(service.experimentRecord('x-20261010-0000')).rejects.toBeInstanceOf(EvalDisposedError)
    await expect(service.runStart('/plans/p.json')).rejects.toBeInstanceOf(EvalDisposedError)
    // Coded and package-named.
    let caught: unknown
    try { service.conditions() } catch (error) { caught = error }
    expect((caught as EvalDisposedError).code).toBe('disposed')
    expect((caught as EvalDisposedError).message).toContain('@khorsheed/dsh-eval')
  })

  it('a start racing dispose refuses coded, registers nothing, and releases the session it opened', async () => {
    const root = join(tmpTree(), 'eval')
    const jobs = fakeJobs()
    let open!: (value: { agent: { session: { id: string } }; dispose: () => Promise<void> }) => void
    const sessionDispose = vi.fn(async () => {})
    const create = vi.fn((options: { sessionId: string }) => new Promise<{ agent: { session: { id: string } }; dispose: () => Promise<void> }>((resolve) => {
      open = resolve
      void options
    }))
    const service = new EvalService(hosts({ jobs, agents: { get: () => undefined, create } }), { stateRoot: root })

    // The start parks inside the parent-session creation; disposal lands
    // before the registry ever sees the job.
    const started = service.runStart('/plans/p.json')
    expect(create).toHaveBeenCalledTimes(1)
    service.dispose()
    open({ agent: { session: { id: 'own-1' } }, dispose: sessionDispose })

    await expect(started).rejects.toBeInstanceOf(EvalDisposedError)
    expect(jobs.entries.size).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sessionDispose).toHaveBeenCalledTimes(1)
  })

  it('a settled run is left alone, and dispose follows the borrowed Context\'s teardown', async () => {
    const jobs = fakeJobs()
    const ctx = new Context()
    ctx.provide('jobs', jobs as never)
    const { apply } = await import('../src/index.ts')
    apply(ctx, { stateRoot: join(tmpTree(), 'eval') })
    const service = ctx.get('dshEval') as EvalService

    // A run that already finished has nothing to cancel.
    const markers = { aborted: [] as string[] }
    await jobsOf(service).start(async () => report({ runId: 'run-done' }), { parentSessionId: 'parent-1' })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(jobs.entries.size).toBe(1)

    // A live run beside it, then the Context goes away: the plugin's own
    // wiring disposes the service, cancelling only the live one.
    const handle = await startBlockingRun(service, join(tmpTree(), 'cells'), markers)
    expect(markers.aborted).toEqual([])
    await ctx.fiber.dispose()
    expect(markers.aborted).toEqual([handle.runId])
    expect(() => service.runJobList()).toThrow(EvalDisposedError)
  })
})
