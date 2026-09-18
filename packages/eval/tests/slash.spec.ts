/**
 * The `/eval` slash face: a thin wrapper over the service verb. `run
 * --dry-run` works anywhere (the offline kernel needs no host); a live run
 * outside a host context is refused, honestly.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleEvalCommand } from '../src/slash.ts'
import { EvalService } from '../src/service.ts'

const FIXTURE_DATASET = join(import.meta.dirname, 'fixtures/dataset/datasets/harness-comparison')
const T1_PLAN = join(FIXTURE_DATASET, 'plans/i1-walk.json')

import { join } from 'node:path'

function invocation(rawInput: string): Parameters<typeof handleEvalCommand>[1] {
  return { rawInput, agent: { session: { id: 'sess-eval-slash' } } } as Parameters<typeof handleEvalCommand>[1]
}

describe('/eval', () => {
  it('run --dry-run prints the rehearsal from the invoking session', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run`))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('dry-run')
    expect(result.text).toContain('p0-placeholder-dsh-exec-rep1')
  })

  it('run without arguments, unknown verbs, and bad flags answer with usage or errors', async () => {
    const bare = await handleEvalCommand(new EvalService(), invocation('run'))
    expect(bare.kind).toBe('error')
    expect(bare.text).toContain('exactly one plan path')

    const unknown = await handleEvalCommand(new EvalService(), invocation('deploy something'))
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('unknown /eval verb')

    const badConcurrency = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --concurrency zero`))
    expect(badConcurrency.kind).toBe('error')
    expect(badConcurrency.text).toContain('--concurrency')
  })

  it('a live run outside a host context is refused (decision 1: the session is the origin)', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN}`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no host context')
  })
})

describe('/eval conditions provision — the write-back and the way back (I5·T58 · G7)', () => {
  /** A service whose provision only records what it was asked for. */
  function recordingService(): { service: EvalService; calls: Array<Record<string, unknown>> } {
    const calls: Array<Record<string, unknown>> = []
    const service = new EvalService()
    vi.spyOn(service, 'provision').mockImplementation((conditionPath, options) => {
      calls.push({ conditionPath, ...options })
      return Promise.resolve({
        condition: 'c1',
        conditionPath,
        lockPath: `${conditionPath.replace(/\.json$/, '')}.lock.json`,
        repo: options.repo,
        harness: 'dsh',
        scope: null,
        homeDir: '/homes/dsh',
        credentialState: 'present-unverified',
        sha: 'a'.repeat(64),
        home: { sha: 'b'.repeat(64), files: 3, denied: 0 },
        homeShaWritten: options.writeBack !== false,
        shaBeforeWriteBack: options.writeBack === false ? null : 'c'.repeat(64),
        checks: [],
        written: true,
        lock: null,
        errors: [],
        warnings: [],
      })
    })
    return { service, calls }
  }

  it('corrects the declaration by default and says so in the reply', async () => {
    const { service, calls } = recordingService()
    const result = await handleEvalCommand(service, invocation('conditions provision /repo/datasets/ds/conditions/c1.json --repo /repo'))

    expect(result.kind).toBe('success')
    expect(calls[0]).not.toHaveProperty('writeBack')
    expect(result.text).toContain('declaration corrected')
  })

  it('--no-write-back asks for the old two-step shape', async () => {
    const { service, calls } = recordingService()
    const result = await handleEvalCommand(
      service,
      invocation('conditions provision /repo/datasets/ds/conditions/c1.json --repo /repo --no-write-back'),
    )

    expect(result.kind).toBe('success')
    expect(calls[0]).toMatchObject({ writeBack: false })
    expect(result.text).not.toContain('declaration corrected')
  })

  it('refuses --no-write-back on a verb that writes nothing, and still refuses an unknown switch', async () => {
    const { service } = recordingService()
    const misplaced = await handleEvalCommand(service, invocation('conditions list --no-write-back'))
    expect(misplaced.kind).toBe('error')
    expect(misplaced.text).toContain('--no-write-back is a provision option')

    const unknown = await handleEvalCommand(service, invocation('conditions provision c1.json --repo /repo --rewrite-everything'))
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('unknown option(s)')
  })
})

describe('/eval run as a background job', () => {
  /** A job registry that records the producer and settles when told. */
  function jobsHost(settleWith?: () => Promise<unknown>) {
    const started: Array<{ kind: string; label: string; owner?: unknown }> = []
    const jobs = {
      started,
      start(spec: { kind: string; label: string; owner?: unknown; run: () => { done: Promise<unknown>; cancel(): void; readOutput?(): string } }) {
        started.push({ kind: spec.kind, label: spec.label, owner: spec.owner })
        spec.run()
        return `${spec.kind}-1`
      },
      get: () => ({ status: 'running', startedAt: 0, reported: false }),
      kill: () => 'requested' as const,
    }
    void settleWith
    const agents = { get: () => ({ session: { id: 'sess-eval-slash' } }) }
    return { jobs, agents, host: { get: (name: string) => (name === 'jobs' ? jobs : name === 'agents' ? agents : undefined) } }
  }

  it('starts a job and answers with the ids — without waiting for the run', async () => {
    const { jobs, host } = jobsHost()
    const result = await handleEvalCommand(new EvalService(host), invocation(`run ${T1_PLAN}`))
    expect(result.kind).toBe('success')
    expect(result.text).toMatch(/eval run started — job eval-run-1 · run run-\d{14}-[a-z0-9]{4}/)
    // The reply names the one cancel path and nothing else that stops a run.
    expect(result.text).toContain('job_kill eval-run-1')
    expect(result.text).toContain('the run keeps going if you close this tab')
    // Unowned: the job must outlive the session that started it.
    expect(jobs.started).toEqual([{ kind: 'eval-run', label: `eval run ${T1_PLAN}`, owner: undefined }])
  })

  it('--wait keeps the synchronous shape (and a dry run is always synchronous)', async () => {
    const { jobs, host } = jobsHost()
    const waited = await handleEvalCommand(new EvalService(host), invocation(`run ${T1_PLAN} --dry-run`))
    expect(waited.kind).toBe('success')
    expect(waited.text).toContain('dry-run')
    // A dry run finishes in the turn, so it never becomes a job.
    expect(jobs.started).toEqual([])

    const wait = await handleEvalCommand(new EvalService(host), invocation(`run ${T1_PLAN} --wait`))
    // No host services in this fake, so the run refuses — the point is that
    // it went down the synchronous path instead of registering a job.
    expect(wait.kind).toBe('error')
    expect(jobs.started).toEqual([])
  })

  it('falls back to waiting when the composition mounts no jobs service, and says so', async () => {
    const result = await handleEvalCommand(new EvalService({ get: () => undefined }), invocation(`run ${T1_PLAN}`))
    expect(result.kind).toBe('error')
    // The refusal below is the missing host services; the FIRST line is the
    // fallback notice, which is what a reader needs to understand the wait.
    expect(result.text).toContain('mounts no jobs service')
    expect(result.text).toContain('closing this surface stops it')
  })
})

describe('/eval finalize', () => {
  /** A host whose `mission` service is the finalize face the verb needs. */
  const hostWith = (rows: Array<{ id: string; state: string }>): { get(name: string): unknown } => {
    const states = new Map(rows.map(row => [row.id, row.state]))
    const mission = {
      runStatus: () => ({ rows: [...states].map(([id, state]) => ({ id, state })) }),
      transition: async (id: string, to: string) => {
        const declared: Record<string, string> = { archived: 'releasable', releasable: 'released' }
        if (declared[states.get(id) ?? ''] !== to) throw new Error(`transition to ${to} is not declared`)
        states.set(id, to)
        return { changed: true }
      },
      annotate: async () => ({ added: true }),
    }
    return { get: (name: string) => (name === 'mission' ? mission : undefined) }
  }

  it('walks the archived cells and prints why every other cell was skipped', async () => {
    const service = new EvalService(hostWith([
      { id: 'cell-a', state: 'archived' },
      { id: 'cell-b', state: 'released' },
      { id: 'cell-c', state: 'stage-2' },
      { id: 'cell-d', state: 'pending' },
    ]))
    const result = await handleEvalCommand(service, invocation('finalize run-1'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('1 released, 0 gate-refused, 3 skipped')
    expect(result.text).toContain('1 released（已终结）跳过、1 中断（未走到 archived）跳过、1 pending（未开跑）跳过')
    expect(result.text).toContain('cell-a: archived → released')
    expect(result.text).toContain('cell-c: skipped (stage-2)')
    // The container half is said even here, where there is no lab to ask:
    // silence would read as "and the containers are gone" (T39 · G18).
    expect(result.text).toContain('单元: 未知')
  })

  it('refuses honestly when the composition has no mission service', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation('finalize run-1'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no mission service')
  })

  it('wants exactly one run id', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation('finalize'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('exactly one run id')
  })
})

describe('/eval run — the subset flags', () => {
  it('--only and --max-cells reach the kernel and are echoed as the subset', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --max-cells 1`))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('subset: --max-cells 1 — 1 of 1 cell(s)')
  })

  it('a full-matrix run prints no subset line', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run`))
    expect(result.text).not.toContain('subset:')
  })

  it('rejects a --max-cells that is not a positive integer', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --max-cells 0`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('--max-cells must be a positive integer')
  })

  it('--only takes a comma-separated list and refuses an id the matrix lacks', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --only nope-1,nope-2`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('2 cell(s) the plan')
  })
})

describe('/eval run — the 保留单元 switch (T57)', () => {
  /** Drive the run verb and report what options it was handed. */
  async function optionsOf(input: string): Promise<Record<string, unknown>> {
    const service = new EvalService()
    // Rejecting is enough: the switch is parsed before the run is reached, so
    // the call's arguments are the whole fact under test.
    const run = vi.spyOn(service, 'run').mockRejectedValue(new Error('not run here'))
    await handleEvalCommand(service, invocation(input))
    return (run.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>
  }

  it('is off unless asked: a plain run walks the release gate', async () => {
    expect(await optionsOf(`run ${T1_PLAN} --wait`)).toMatchObject({ keepUnits: false })
  })

  it('--keep-units reaches the kernel', async () => {
    expect(await optionsOf(`run ${T1_PLAN} --wait --keep-units`)).toMatchObject({ keepUnits: true })
  })

  it('--finalize is still accepted — it asks for what the default already does', async () => {
    // A saved command or a script that still passes it must not start failing
    // over a flag whose meaning became the default.
    const options = await optionsOf(`run ${T1_PLAN} --wait --finalize`)
    expect(options).toMatchObject({ keepUnits: false })
  })
})

describe('/eval run — --creds-root is gone (T20c)', () => {
  it('no longer takes a credentials root: the mount source is the instance\'s own scoped home', async () => {
    // It used to be a value flag. Now it is an unknown switch, and its value
    // becomes a second positional — which the verb refuses out loud rather
    // than silently ignoring a flag someone still believes in.
    const result = await handleEvalCommand(new EvalService(), invocation('run plan.json --creds-root /tmp/creds'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('exactly one plan path')
  })
})

describe('/eval grant backstop (A3)', () => {
  const ROW = '@khorsheed/dsh-eval-tool'

  /** Invoke `help` with an agent-scope ctx whose probe answers as given. */
  function helpWith(presets: unknown): Promise<CommandResult> {
    const agent = {
      session: { id: 'sess-eval-slash' },
      ctx: { get: (name: string) => (name === 'agentPresets' ? presets : undefined) },
    }
    return handleEvalCommand(new EvalService(), { rawInput: 'help', agent } as unknown as CommandInvocation)
  }

  /** A roster probe: the session joined `presetId`; the inventory answers `groups`. */
  function roster(presetId: string | undefined, groups: unknown): unknown {
    return {
      composedPreset: () => presetId,
      compositionInventory: () => Promise.resolve(groups),
    }
  }

  it('refuses when the session preset is readable and names no companion row', async () => {
    const result = await helpWith(roster('standard', [{ id: 'standard', rows: [] }]))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/eval is not granted to this session')
    expect(result.text).toContain(ROW)
    expect(result.text).toContain('standard')
  })

  it('passes when the preset composition names the companion row', async () => {
    const result = await helpWith(roster('eval', [{ id: 'eval', rows: [{ moduleName: ROW }] }]))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('usage:')
  })

  it('fails open when the session joined no preset', async () => {
    const result = await helpWith(roster(undefined, []))
    expect(result.kind).toBe('success')
  })

  it('fails open when the roster service is absent', async () => {
    const result = await helpWith(undefined)
    expect(result.kind).toBe('success')
  })

  it('fails open when the inventory throws', async () => {
    const throwing = {
      composedPreset: () => 'standard',
      compositionInventory: () => Promise.reject(new Error('unreadable')),
    }
    const result = await helpWith(throwing)
    expect(result.kind).toBe('success')
  })

  it('fails open when the preset group is missing or broken', async () => {
    expect((await helpWith(roster('ghost', [{ id: 'standard', rows: [] }]))).kind).toBe('success')
    expect((await helpWith(roster('standard', [{ id: 'standard', broken: 'unreadable', rows: [] }]))).kind).toBe('success')
  })

  it('fails open when the agent carries no scope context (the plain invocation shape)', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation('help'))
    expect(result.kind).toBe('success')
  })
})
