/**
 * The run as a background job: what `/eval run` hands back before any cell has
 * run, what a reader sees while it runs, and what `job_kill` does to it.
 *
 * The fake registry here is the real contract's shape — `start` takes a
 * producer and calls it synchronously, `kill` calls the producer's `cancel`,
 * `read` consumes — so the assertions are about this package's producer, not
 * about a mock's convenience.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EvalRunJobs } from '../src/job.ts'
import { callInstance, runOnInstance } from '../src/instance.ts'
import { EvalService } from '../src/service.ts'
import type { RunOptions, RunReport } from '../src/run.ts'

/** A minimal job registry with the semantics this producer depends on. */
function fakeJobs() {
  interface Entry {
    id: string
    kind: string
    label: string
    owner: unknown
    hooks: { cancel(reason?: string): void; done: Promise<{ status: string; detail?: string }>; readOutput?(): string }
    status: string
    detail?: string
    startedAt: number
    finishedAt?: number
  }
  const entries = new Map<string, Entry>()
  let seq = 0
  const registry = {
    entries,
    start(spec: { kind: string; label: string; owner?: unknown; run: () => Entry['hooks'] }): string {
      seq += 1
      const id = `${spec.kind}-${seq}`
      const hooks = spec.run()
      const entry: Entry = {
        id, kind: spec.kind, label: spec.label, owner: spec.owner, hooks,
        status: 'running', startedAt: Date.now(),
      }
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
    /** The registry's own consuming reader — what `job_output` drives. */
    read(id: string): string {
      return entries.get(id)?.hooks.readOutput?.() ?? ''
    },
  }
  return registry
}

/** A host accessor over a service table. */
function hosts(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] }
}

/** A report shaped like the run loop's, for the settle lines. */
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
    bundleDir: '/exports/run-x-bundle',
    ...overrides,
  } as RunReport
}

describe('EvalRunJobs', () => {
  it('answers with ids before the run has done anything, and keeps its log readable', async () => {
    const jobs = fakeJobs()
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => ({ session: { id: 'parent-1' } }) } }))
    let release!: (value: RunReport) => void
    const finished = new Promise<RunReport>((resolve) => { release = resolve })
    let seen: RunOptions | undefined
    const handle = await runner.start(async (options) => {
      seen = options
      options.log?.('readiness c: ready')
      return await finished
    }, { parentSessionId: 'parent-1' })

    // The handle exists while the run is still going.
    expect(handle.jobId).toBe('eval-run-1')
    expect(handle.runId).toMatch(/^run-\d{14}-[a-z0-9]{4}$/)
    expect(handle.parentSessionId).toBe('parent-1')
    expect(handle.ownParentSession).toBeUndefined()
    // The run got the id it was told to use and a live cancellation signal.
    expect(seen?.runId).toBe(handle.runId)
    expect(seen?.signal?.aborted).toBe(false)

    const first = runner.output(handle.jobId)
    expect(first?.lines).toEqual(['readiness c: ready'])
    expect(first?.done).toBe(false)
    // The cursor read is NON-consuming for the registry's own reader: the
    // `job_output` tool still gets every line.
    expect(jobs.read(handle.jobId)).toBe('readiness c: ready')

    release(report())
    await new Promise(resolve => setTimeout(resolve, 5))
    const after = runner.output(handle.jobId, first?.cursor)
    expect(after?.done).toBe(true)
    expect(after?.status).toBe('completed')
    expect(after?.lines).toEqual([
      'bundle: /exports/run-x-bundle',
      'run run-x finished — 1 cell(s): cell-1=archived',
    ])
    expect(runner.status(handle.jobId)?.detail).toBe('1/1 cell(s) archived · run-x')
  })

  it('runs inside the parent agent initiator boundary — a job has no turn to inherit one from', async () => {
    const jobs = fakeJobs()
    const agent = { session: { id: 'parent-1' } }
    const inside: Array<unknown> = []
    let current: unknown
    const agents = {
      get: () => agent,
      withInitiator: <T>(initiator: unknown, operation: () => T): T => {
        current = initiator
        try {
          return operation()
        } finally {
          // The boundary is established for the operation's own frame; the
          // run's promise continues under it because the host's storage is
          // async-context based (this fake only records that it was entered).
          inside.push(current)
        }
      },
    }
    const runner = new EvalRunJobs(hosts({ jobs, agents }))
    await runner.start(async () => report(), { parentSessionId: 'parent-1' })
    expect(inside).toEqual([agent])
  })

  it('registers the job WITHOUT an owner — it has to outlive the session that started it', async () => {
    const jobs = fakeJobs()
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => ({ session: { id: 'parent-1' } }) } }))
    await runner.start(async () => report(), { parentSessionId: 'parent-1' })
    expect(jobs.entries.get('eval-run-1')?.owner).toBeUndefined()
  })

  it('cancels through the run signal — the same lever the budget timer pulls', async () => {
    const jobs = fakeJobs()
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => ({ session: { id: 'parent-1' } }) } }))
    let aborted = false
    let settle!: (value: RunReport) => void
    const handle = await runner.start(async (options) => {
      options.signal?.addEventListener('abort', () => { aborted = true })
      return await new Promise<RunReport>((resolve) => { settle = resolve })
    }, { parentSessionId: 'parent-1' })

    expect(runner.cancel(handle.jobId)).toBe('requested')
    expect(aborted).toBe(true)
    // The run answers the cancel by returning a report that says so; the job
    // settles `killed`, not `failed` — it was stopped, it did not break.
    settle(report({ meta: { cancelled: true } }))
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(runner.status(handle.jobId)?.status).toBe('killed')
  })

  it('opens its own parent session when the caller has no live agent, and closes it at settle', async () => {
    const jobs = fakeJobs()
    const dispose = vi.fn(async () => {})
    const create = vi.fn(async (options: { sessionId: string }) => ({
      agent: { session: { id: options.sessionId } },
      dispose,
    }))
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => undefined, create } }))
    let seen: RunOptions | undefined
    const handle = await runner.start(async (options) => {
      seen = options
      return report()
    }, { parentSessionId: 'gone-1', cwd: '/work' })

    expect(handle.ownParentSession).toBe(true)
    expect(handle.parentSessionId).not.toBe('gone-1')
    expect(seen?.parentSessionId).toBe(handle.parentSessionId)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd: '/work' } }))
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('gives the session it opens the run\'s own cell root, so a container round has a cwd (T29d)', async () => {
    const jobs = fakeJobs()
    const stateRoot = mkdtempSync(join(tmpdir(), 'eval-job-cwd-'))
    const create = vi.fn(async (options: { sessionId: string }) => ({
      agent: { session: { id: options.sessionId } },
      dispose: async () => {},
    }))
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => undefined, create } }))
    const handle = await runner.start(async () => report(), { stateRoot, runId: 'run-t29d' })

    // The container path passes no per-round cwd (inside a unit a host path
    // means nothing), so the provider falls back to the parent session's —
    // and a session opened without one made every container condition refuse
    // with «the parent session has no working directory to run the CLI in».
    const expected = join(stateRoot, 'cells', 'run-t29d')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd: expected } }))
    // And it exists: a CLI spawned into a missing directory fails in the
    // shell, before the harness that would have explained it.
    expect(existsSync(expected)).toBe(true)
    expect(handle.ownParentSession).toBe(true)
    rmSync(stateRoot, { recursive: true, force: true })
  })

  it('leaves the caller\'s own working directory alone when it has one', async () => {
    const jobs = fakeJobs()
    const create = vi.fn(async (options: { sessionId: string }) => ({
      agent: { session: { id: options.sessionId } },
      dispose: async () => {},
    }))
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => undefined, create } }))
    // `/eval run` passes the calling session\'s cwd. That directory is an
    // existing workspace — taken as given, never created here.
    await runner.start(async () => report(), { cwd: '/work', stateRoot: '/nowhere' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd: '/work' } }))
    expect(existsSync('/nowhere')).toBe(false)
  })

  it('refuses to start when the composition mounts no job registry', async () => {
    const runner = new EvalRunJobs(hosts({}))
    expect(runner.available()).toBe(false)
    await expect(runner.start(async () => report(), {})).rejects.toThrow(/no jobs service/)
  })

  it('records a refusal as a failed job, with the diagnostics in the log', async () => {
    const jobs = fakeJobs()
    const runner = new EvalRunJobs(hosts({ jobs, agents: { get: () => ({ session: { id: 'p' } }) } }))
    const refusal = Object.assign(new Error('2 condition(s) failed the readiness check'), {
      diagnostics: [{ code: 'READINESS_FAILED', message: 'codex-a: 401' }],
    })
    const handle = await runner.start(async () => { throw refusal }, { parentSessionId: 'p' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const output = runner.output(handle.jobId)
    expect(output?.status).toBe('failed')
    expect(output?.lines).toEqual([
      'run ' + handle.runId + ' refused: 2 condition(s) failed the readiness check',
      '  [READINESS_FAILED] codex-a: 401',
    ])
  })
})

describe('EvalService run-job verbs', () => {
  it('exposes availability, and the four verbs answer for an unknown job', () => {
    const service = new EvalService(hosts({}))
    expect(service.runJobsAvailable()).toBe(false)
    expect(service.runJobStatus('eval-run-9')).toBeUndefined()
    expect(service.runJobOutput('eval-run-9')).toBeUndefined()
    expect(service.runJobCancel('eval-run-9')).toBe('unknown-job')
    expect(service.runJobList()).toEqual([])
  })
})

describe('the instance client (the CI door)', () => {
  it('posts args by name to the Remote endpoint, carries the token, and follows the log', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const cookies: string[] = []
    let poll = 0
    const fakeFetch = (async (url: URL | string, init?: { body?: string; headers?: Record<string, string> }) => {
      // The token door: `GET /?token=…` mints the cookie every later call carries.
      if (new URL(String(url)).pathname === '/') {
        return new Response(null, { status: 303, headers: { 'set-cookie': 'dsh-abc=cookie-value; Path=/; HttpOnly' } })
      }
      calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') })
      cookies.push((init as { headers?: Record<string, string> } | undefined)?.headers?.['cookie'] ?? '(none)')
      const method = String(url).split('?')[0]?.split('/').pop()
      if (method === 'runStart') {
        return new Response(JSON.stringify({ type: 'server-response', rpcId: 'r', result: { ok: true, value: { jobId: 'eval-run-3', runId: 'run-y', parentSessionId: 'own-1', ownParentSession: true } } }))
      }
      poll += 1
      const value = poll === 1
        ? { runId: 'run-y', lines: ['readiness a: ready'], cursor: 1, status: 'running', done: false }
        : { runId: 'run-y', lines: ['run run-y finished — 1 cell(s): c=archived'], cursor: 2, status: 'completed', detail: '1/1', done: true }
      return new Response(JSON.stringify({ type: 'server-response', rpcId: 'r', result: { ok: true, value } }))
    }) as unknown as typeof fetch

    const lines: string[] = []
    const outcome = await runOnInstance(
      { baseUrl: 'http://127.0.0.1:3171/', token: 'tok-1', fetch: fakeFetch },
      { plan: '~/plans/p.json', dryRun: true },
      { write: line => { lines.push(line) } },
      { pollMs: 0 },
    )

    expect(calls[0]?.url).toBe('http://127.0.0.1:3171/api/dshEval/runStart?token=tok-1')
    expect(cookies).toEqual(['dsh-abc=cookie-value', 'dsh-abc=cookie-value', 'dsh-abc=cookie-value'])
    // The connection's envelope, with args by NAME inside the payload — the
    // wire's own shape, not a positional array and not a bare payload.
    expect(calls[0]?.body).toMatchObject({
      type: 'client-request',
      method: 'dshEval/runStart',
      payload: { args: { request: { plan: '~/plans/p.json', dryRun: true } } },
    })
    expect(calls[1]?.body).toMatchObject({ method: 'dshEval/runOutput', payload: { args: { jobId: 'eval-run-3', cursor: 0 } } })
    expect(calls[2]?.body).toMatchObject({ method: 'dshEval/runOutput', payload: { args: { jobId: 'eval-run-3', cursor: 1 } } })
    expect(outcome).toEqual({ jobId: 'eval-run-3', runId: 'run-y', status: 'completed', detail: '1/1' })
    expect(lines).toEqual([
      'eval run started — job eval-run-3 · run run-y',
      'parent session: own-1 (opened for this run)',
      'readiness a: ready',
      'run run-y finished — 1 cell(s): c=archived',
    ])
  })

  it('names the likely cause on 401 and 404 rather than printing a bare status', async () => {
    const unauthorized = (async () => new Response('no', { status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch
    await expect(callInstance({ baseUrl: 'http://x', fetch: unauthorized }, 'runStatus', {}))
      .rejects.toThrow(/--token/)
    const notFound = (async () => new Response('no', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch
    await expect(callInstance({ baseUrl: 'http://x', fetch: notFound }, 'runStatus', {}))
      .rejects.toThrow(/dsh-eval/)
  })

  it('surfaces the instance own refusal message', async () => {
    const refused = (async () => new Response(JSON.stringify({ type: 'server-response', rpcId: 'r', result: { ok: false, error: { message: 'no run job "eval-run-9"' } } }))) as unknown as typeof fetch
    await expect(callInstance({ baseUrl: 'http://x', fetch: refused }, 'runOutput', { jobId: 'eval-run-9' }))
      .rejects.toThrow(/no run job/)
  })
})

describe('path expansion at the service boundary', () => {
  it('expands ~ in the plan path, in --out, and in the report bundle path', async () => {
    const home = homedir()
    const seen: Array<{ plan?: string; out?: string; bundle?: string }> = []
    // The service's three path doors, each with a stub behind it. What is
    // asserted is the ARGUMENT the door passed on: a `~` that reaches the
    // filesystem is a path nobody has.
    const service = new EvalService()
    const withStub = service as unknown as {
      run(plan: string, options: { dryRun?: boolean; exportsDir?: string }): Promise<unknown>
      report(bundleDir: string, options: { out?: string }): Promise<unknown>
    }
    await withStub.run('~/plans/p.json', { dryRun: true }).catch((error: unknown) => {
      seen.push({ plan: String(error) })
    })
    // The dry run fails on the missing file — with the EXPANDED path, which
    // is the assertion (a `~` would have reached the reader verbatim).
    expect(seen[0]?.plan).toContain(join(home, 'plans/p.json'))
    expect(seen[0]?.plan).not.toContain('~/plans')

    await withStub.report('~/exports/bundle', { out: '~/out' }).catch((error: unknown) => {
      seen.push({ bundle: String(error) })
    })
    expect(seen[1]?.bundle).toContain(join(home, 'exports/bundle'))
    expect(seen[1]?.bundle).not.toContain('~/exports')
  })
})
