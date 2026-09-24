/**
 * The five tools the companion row registers — four reads and `eval_plan_draft`
 * — through the definition factory's names and each adapter's `execute`
 * against fake service faces: a temp dataset tree for the contract tools, a
 * fake mission ledger for the two run projections. Registration, origin
 * tagging, and the `tools: 'none'` switch belong to
 * `@khorsheed/dsh-eval-tool` and are pinned in its own spec.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalService } from '../src/service.ts'
import { evalToolDefinitions } from '../src/tool.ts'
import { cleanupTmp, fakeRegistry, hostsWith, tmpTree, useDshHome, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

interface RegisteredTool {
  name: string
  parameters: { required?: string[] }
  output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
  execute: (args: Record<string, unknown>, exec: { agent?: { session: { id: string } } }) => Promise<unknown>
}

/** A condition document; `overrides` replaces whole sections. */
function condition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'dataseek.condition/1',
    harness: { name: 'dsh', version: '0.1.1-rc.2', drive: 'exec' },
    model: { declared: 'deepseek-official/deepseek-v4-flash', endpoint: null },
    reasoning: { effort: 'default' },
    permissions: 'unrestricted',
    instructions: 'none',
    preset: null,
    skills: { pack: null },
    home: { sha: 'a'.repeat(64) },
    env: { keys: ['DEEPSEEK_API_KEY'] },
    ...overrides,
  }
}

/**
 * A deployment whose condition library holds two conditions: `locked` is
 * ready (lock present, matching, home verified), `drafting` is not (no lock,
 * two null fields). Returns the library directory.
 */
function writeLibrary(): string {
  const { stateRoot } = useDshHome()
  const library = join(stateRoot, 'conditions')
  const locked = condition()
  writeJson(library, 'locked.json', locked)
  writeJson(library, 'locked.lock.json', {
    schema: 'dataseek.condition-lock/1',
    condition: 'locked',
    sha: hashConditionDocument(locked),
    home: { sha: 'a'.repeat(64) },
  })
  writeJson(library, 'drafting.json', condition({
    harness: { name: 'kimi', version: null, drive: 'exec' },
    permissions: 'auto-approve',
    model: { declared: null, endpoint: null },
  }))
  return library
}

/** A registered dataset set `reg/harness-comparison`: one item, one stage schema. */
function registeredSet(): { dataset: string; service: EvalService } {
  const dataset = join(tmpTree(), 'view', 'harness-comparison')
  writeJson(dataset, 'schemas/stage1.json', { type: 'object', properties: { done: { type: 'boolean' } } })
  writeJson(dataset, 'items/P0/item.json', { id: 'P0' })
  return { dataset, service: new EvalService(hostsWith(fakeRegistry({ sets: { 'harness-comparison': dataset } }))) }
}

/** Build the five tools over one service and index them by name. */
function toolsOver(service: EvalService): Map<string, RegisteredTool> {
  const definitions = evalToolDefinitions(service) as unknown as RegisteredTool[]
  return new Map(definitions.map(tool => [tool.name, tool]))
}

/** The exec face of a call from session `s1`. */
const BOUND = { agent: { session: { id: 's1' } } }

describe('eval_conditions', () => {
  it('lists each library condition with its hash, readiness, and unresolved fields', async () => {
    const library = writeLibrary()
    const tool = toolsOver(new EvalService()).get('eval_conditions') as RegisteredTool
    const report = await tool.execute({}, BOUND) as {
      repo: string
      conditions: Array<{ id: string; status: string; sha: string; harness: { name: string }; model: { declared: string | null }; lock: { present: boolean; matches: boolean }; unresolved: string[]; warnings: Array<{ code: string }> }>
    }
    expect(report.repo).toBe(library)
    const [drafting, locked] = report.conditions
    expect(locked).toMatchObject({
      id: 'locked',
      status: 'ready',
      harness: { name: 'dsh' },
      model: { declared: 'deepseek-official/deepseek-v4-flash' },
      lock: { present: true, matches: true },
      unresolved: ['model.endpoint'],
    })
    expect(locked?.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(drafting).toMatchObject({
      id: 'drafting',
      status: 'unready',
      harness: { name: 'kimi' },
      lock: { present: false, matches: false },
    })
    expect(drafting?.unresolved).toEqual(['harness.version', 'model.declared', 'model.endpoint'])
    expect(drafting?.warnings.map(w => w.code)).toContain('LOCK_MISSING')
    // model.endpoint rides along in the listing: the readiness gate refuses a
    // null one, so it is the field a condition most often stalls on and the
    // conditions page puts it in a column (I5·T58 · G6).
    expect(locked?.model).toEqual({ declared: 'deepseek-official/deepseek-v4-flash', endpoint: null })
  })

  it('takes no repository argument — the library is the deployment\'s, whoever asks', async () => {
    writeLibrary()
    const tool = toolsOver(new EvalService()).get('eval_conditions') as RegisteredTool
    expect(Object.keys((tool as unknown as { parameters: Record<string, unknown> }).parameters)).not.toContain('repo')
    const report = await tool.execute({}, { agent: { session: { id: 's2' } } }) as { conditions: unknown[] }
    expect(report.conditions).toHaveLength(2)
  })

  it('diffs two library conditions field by field', async () => {
    writeLibrary()
    const tool = toolsOver(new EvalService()).get('eval_conditions') as RegisteredTool
    const diff = await tool.execute({ diff: ['locked', 'drafting'] }, BOUND) as { differences: Array<{ path: string }> }
    expect(diff.differences.map(d => d.path)).toContain('harness.name')
    await expect(tool.execute({ diff: ['locked'] }, BOUND)).rejects.toThrow(/exactly two/)
  })
})

describe('eval_plan_validate', () => {
  it('validates an experiment against its pinned dataset view and the condition library', async () => {
    writeLibrary()
    const { service } = registeredSet()
    const draft = await service.draftExperiment({
      name: 'p', dataset: 'reg/harness-comparison', items: ['P0'], conditions: ['locked'], reps: 1,
      stages: ['stage1'], seed: 42, activeMinutes: 60, turns: 10, expectedNs: ['script'],
    })
    const tool = toolsOver(service).get('eval_plan_validate') as RegisteredTool
    const report = await tool.execute({ experiment: draft.experimentId }, {}) as {
      ok: boolean
      errors: unknown[]
      warnings: Array<{ code: string }>
      conditions: Array<{ id: string; sha: string; status: string }>
    }
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    // The draft pinned a commit, so there is nothing left unresolved about it.
    expect(report.warnings.map(w => w.code)).not.toContain('COMMIT_UNRESOLVED')
    expect(report.conditions).toEqual([
      { id: 'locked', sha: expect.stringMatching(/^[0-9a-f]{64}$/), lock: expect.anything(), status: 'ready' },
    ])
  })

  it('wants an experiment id, and reports an unreadable legacy plan as an error, not a throw', async () => {
    const tool = toolsOver(new EvalService()).get('eval_plan_validate') as RegisteredTool
    await expect(tool.execute({}, {})).rejects.toThrow(/pass experiment/)
    const report = await tool.execute({ plan: join(tmpTree(), 'nope.json') }, {}) as { ok: boolean; errors: Array<{ code: string }> }
    expect(report.ok).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual(['PLAN_UNREADABLE'])
  })

  it('refuses an experiment id this deployment does not hold', async () => {
    useDshHome()
    const tool = toolsOver(new EvalService()).get('eval_plan_validate') as RegisteredTool
    await expect(tool.execute({ experiment: 'nope-20260101-abcd' }, {})).rejects.toThrow(/no experiment "nope-20260101-abcd"/)
  })
})

/** A mission ledger holding one run of two cells, as the run loop leaves it. */
function missionFace(): {
  runStatus: (runId: string) => unknown
  get: (missionId: string, runId?: string) => unknown
} {
  const annotations: Record<string, Array<{ ns: string; attempt: number; payload: unknown; createdAt: number }>> = {
    'p0-dsh-exec-rep1': [
      { ns: 'orchestrator', attempt: 1, createdAt: 10, payload: { kind: 'cell', task: 'P0', condition: 'dsh-exec', rep: 1 } },
      { ns: 'orchestrator', attempt: 1, createdAt: 20, payload: { kind: 'delegation', stage: 'stage1', promptSha: 'f'.repeat(64) } },
      { ns: 'llm-draft', attempt: 1, createdAt: 25, payload: { sample: 1 } },
      { ns: 'orchestrator', attempt: 1, createdAt: 30, payload: { kind: 'submission-rejected', stage: 'stage2', violations: ['/done: required'] } },
      { ns: 'orchestrator', attempt: 2, createdAt: 40, payload: { kind: 'submission-rejected', stage: 'stage2', violations: ['/done: required'] } },
    ],
    'p0-dsh-exec-rep2': [],
  }
  // The attempt records `eval_cells` reads: the unit each attempt held, where
  // it got to, and when it entered each state.
  const attempts: Record<string, Array<Record<string, unknown>>> = {
    'p0-dsh-exec-rep1': [
      {
        attempt: 1,
        state: 'halted',
        refs: { resource: 'eval-run-1-rep1-a', fingerprint: 'lab-env:aaa', sessions: ['child-a'] },
        enteredAt: { pending: 6, 'stage-1': 8, halted: 30 },
        checkpoints: [{ name: 'stage1', at: 12 }],
      },
      {
        attempt: 2,
        state: 'stage-2',
        refs: { resource: 'eval-run-1-rep1-b', fingerprint: 'lab-env:bbb', sessions: ['child-b', 'child-c'] },
        enteredAt: { pending: 32, 'stage-1': 35, 'stage-2': 40 },
        checkpoints: [{ name: 'stage1', at: 38 }],
      },
    ],
    // No refs and no checkpoints yet — a cell nothing has touched.
    'p0-dsh-exec-rep2': [{ attempt: 1, state: 'pending', refs: {}, enteredAt: { pending: 6 }, checkpoints: [] }],
  }
  return {
    // The ledger's run index — what the experiment LISTING walks before it
    // picks out the runs eval's own meta claims.
    runList: () => [{ id: 'run-1' }],
    runStatus: (runId: string) => {
      if (runId !== 'run-1') throw new Error(`unknown run: ${runId}`)
      return {
        run: {
          id: 'run-1',
          state: 'active',
          createdAt: 5,
          templateName: 'harness-comparison-v1',
          meta: {
            datasetId: 'harness-comparison',
            commit: 'c'.repeat(40),
            planSha: 'p'.repeat(64),
            planPath: '/repo/plans/p.json',
            evalVersion: '0.1.0-rc.1+abc1234',
            conditions: [{ id: 'dsh-exec', sha: 'd'.repeat(64), condition: { harness: { name: 'dsh' }, model: { declared: 'v4-flash' } } }],
            order: { seed: 42, sequence: ['p0-dsh-exec-rep1', 'p0-dsh-exec-rep2'] },
            budget: { activeMinutes: 60, turns: 10 },
            expectedNs: ['script', 'llm-draft'],
            startedAt: 5,
            warnings: [{ code: 'LOCK_MISSING', message: 'condition dsh-exec has no lock' }],
          },
        },
        rows: [
          // rep1 carries the projection's own duration column; rep2 leaves it
          // out, so the cell projection falls back to `enteredAt[state]`.
          { id: 'p0-dsh-exec-rep1', labels: { task: 'P0', condition: 'dsh-exec', rep: '1' }, state: 'stage-2', bucket: 'active', currentAttempt: 2, enteredCurrentAt: 40 },
          { id: 'p0-dsh-exec-rep2', labels: { task: 'P0', condition: 'dsh-exec', rep: '2' }, state: 'pending', bucket: 'ready', currentAttempt: 1 },
        ],
        buckets: { ready: ['p0-dsh-exec-rep2'], scheduled: [], blocked: [], active: ['p0-dsh-exec-rep1'], done: [] },
        unreleased: ['p0-dsh-exec-rep1'],
      }
    },
    get: (missionId: string) => ({
      mission: {
        currentAttempt: attempts[missionId]?.length ?? 1,
        attempts: attempts[missionId] ?? [],
        annotations: annotations[missionId] ?? [],
      },
    }),
  }
}

describe('eval_plan_draft — the row\'s one write, and the form\'s own verb', () => {
  /** A deployment the draft can land in: a registered set and a library. */
  function draftable(): { service: EvalService; stateRoot: string } {
    const library = writeLibrary()
    return { service: registeredSet().service, stateRoot: join(library, '..') }
  }

  const DRAFT_ARGS = {
    name: 'i5-walk',
    dataset: 'reg/harness-comparison',
    items: ['P0'],
    conditions: ['locked'],
    reps: 1,
    stages: ['stage1'],
    seed: 20260916,
    active_minutes: 60,
    turns: 10,
  }

  it('writes the experiment, validates it, and answers with both', async () => {
    const { service } = draftable()
    const tool = toolsOver(service).get('eval_plan_draft') as RegisteredTool

    const result = await tool.execute({ ...DRAFT_ARGS }, BOUND) as {
      experimentId: string
      planPath: string
      conditionPaths: string[]
      conditions: string[]
      review: { ok: boolean; errors: number }
    }

    expect(result.planPath).toMatch(new RegExp(`/experiments/${result.experimentId}/plan\\.json$`))
    expect(result.conditions).toEqual(['locked'])
    expect(result.review.ok).toBe(true)
    expect(result.review.errors).toBe(0)
  })

  it('reaches the SAME service verb the 新建实验 form\'s Remote reaches', async () => {
    const { service } = draftable()
    const draft = vi.spyOn(service, 'draftExperiment')
    const tool = toolsOver(service).get('eval_plan_draft') as RegisteredTool

    await tool.execute({ ...DRAFT_ARGS }, BOUND)

    // One verb, three faces (form, tool, skill). A second implementation of
    // "write the plan and validate it" is a second place for the two to
    // disagree about what a draft IS — and the lab list would then be able to
    // tell a person's draft from an agent's.
    expect(draft).toHaveBeenCalledTimes(1)
    expect(draft.mock.calls[0]?.[0]).toMatchObject({ name: 'i5-walk', dataset: 'reg/harness-comparison' })
    // The session rides along as the experiment's origin — the lab list's
    // 本会话发起 split reads it.
    expect(draft.mock.calls[0]?.[1]).toEqual({ session: { id: 's1' } })
  })

  it('mints a condition as a copy, and refuses one with no source to copy', async () => {
    const { service } = draftable()
    const tool = toolsOver(service).get('eval_plan_draft') as RegisteredTool

    const result = await tool.execute({
      ...DRAFT_ARGS,
      conditions: ['locked'],
      new_conditions: [{ id: 'locked-pro', from: 'locked', model: 'deepseek-official/deepseek-v4-pro' }],
    }, BOUND) as { conditionPaths: string[]; conditions: string[] }

    expect(result.conditions).toEqual(['locked', 'locked-pro'])
    expect(result.conditionPaths).toHaveLength(1)

    await expect(tool.execute({
      ...DRAFT_ARGS, name: 'other', new_conditions: [{ id: 'orphan' }],
    }, BOUND)).rejects.toThrow(/always a COPY/)
  })

  it('carries model.endpoint through as a seventh editable field', async () => {
    const { service } = draftable()
    const tool = toolsOver(service).get('eval_plan_draft') as RegisteredTool

    const result = await tool.execute({
      ...DRAFT_ARGS,
      new_conditions: [{
        id: 'locked-pro',
        from: 'locked',
        model: 'deepseek-official/deepseek-v4-pro',
        endpoint: 'default',
      }],
    }, BOUND) as { conditionPaths: string[] }

    const minted = JSON.parse(readFileSync(result.conditionPaths[0] as string, 'utf8')) as {
      model: { declared: string; endpoint: string }
      notes: string
    }
    // Both halves of decision 5 in one call. Before this the endpoint was the
    // one readiness-gate field no face could set, so a drafted plan always
    // needed a text editor before it could run (I5·T39 · G6).
    expect(minted.model).toEqual({ declared: 'deepseek-official/deepseek-v4-pro', endpoint: 'default' })
    expect(minted.notes).toContain('model.endpoint')
  })

  it('never starts anything — the row has no run verb and this one reaches none', async () => {
    const { service } = draftable()
    const runStart = vi.spyOn(service, 'runStart')
    const tool = toolsOver(service).get('eval_plan_draft') as RegisteredTool

    await tool.execute({ ...DRAFT_ARGS }, BOUND)

    expect(runStart).not.toHaveBeenCalled()
    // And it says so where the model reads it, rather than only in a comment.
    expect((tool as unknown as { description: string }).description).toContain('DRAFTING IS NOT STARTING')
  })
})

describe('eval_run_status', () => {
  it('digests run.meta and projects every cell through the orchestrator ns', async () => {
    const mission = missionFace()
    const tool = toolsOver(new EvalService({ get: (name) => (name === 'mission' ? mission : undefined) })).get('eval_run_status') as RegisteredTool
    const report = await tool.execute({ run_id: 'run-1' }, {}) as {
      runId: string; state: string; templateName: string
      meta: { planSha: string; conditions: unknown[]; order: { seed: number; sequence: string[] }; startedAt: number; warnings: Array<{ code: string }> }
      buckets: Record<string, string[]>
      unreleased: string[]
      cells: Array<Record<string, unknown>>
    }
    expect(report).toMatchObject({ runId: 'run-1', state: 'active', templateName: 'harness-comparison-v1' })
    expect(report.meta.planSha).toBe('p'.repeat(64))
    expect(report.meta.order).toEqual({ seed: 42, sequence: ['p0-dsh-exec-rep1', 'p0-dsh-exec-rep2'] })
    expect(report.meta.startedAt).toBe(5)
    expect(report.meta.warnings.map(w => w.code)).toEqual(['LOCK_MISSING'])
    // The full condition document T8b records is digested, never echoed whole.
    expect(report.meta.conditions).toEqual([
      { id: 'dsh-exec', sha: 'd'.repeat(64), harness: 'dsh', model: 'v4-flash' },
    ])
    expect(report.unreleased).toEqual(['p0-dsh-exec-rep1'])
    expect(report.cells).toEqual([
      {
        missionId: 'p0-dsh-exec-rep1', task: 'P0', condition: 'dsh-exec', rep: 1,
        attempt: 2, state: 'stage-2', bucket: 'active',
        // latest orchestrator entry only, and llm-draft is another ns
        lastOrchestrator: { kind: 'submission-rejected', at: 40, attempt: 2 },
        submissionRejected: 2,
      },
      {
        missionId: 'p0-dsh-exec-rep2', task: 'P0', condition: 'dsh-exec', rep: 2,
        attempt: 1, state: 'pending', bucket: 'ready',
        lastOrchestrator: null,
        submissionRejected: 0,
      },
    ])
  })

  it('answers the lab list\'s status word for the same run (T72 §2)', async () => {
    const mission = missionFace()
    const tool = toolsOver(new EvalService({ get: (name) => (name === 'mission' ? mission : undefined) })).get('eval_run_status') as RegisteredTool
    const report = await tool.execute({ run_id: 'run-1' }, {}) as { status: string; stalledMinutes: number | null; closure: unknown; archived: boolean }
    // No live job and a ledger that last moved at t=40ms: long past the threshold.
    expect(report.status).toBe('stalled')
    expect(report.stalledMinutes).toBeGreaterThan(10)
    expect(report.closure).toBeNull()
    expect(report.archived).toBe(false)
  })

  it('says so in words when the composition mounts no mission service', async () => {
    const tool = toolsOver(new EvalService({ get: () => undefined })).get('eval_run_status') as RegisteredTool
    await expect(tool.execute({ run_id: 'run-1' }, {})).rejects.toThrow(/no mission service/)
  })

  it('passes an unknown run id through as the ledger\'s own error', async () => {
    const mission = missionFace()
    const tool = toolsOver(new EvalService({ get: (name) => (name === 'mission' ? mission : undefined) })).get('eval_run_status') as RegisteredTool
    await expect(tool.execute({ run_id: 'run-9' }, {})).rejects.toThrow(/unknown run/)
  })
})

describe('eval_cells', () => {
  /** The service behind the tool, over the two-cell ledger above. */
  function service(): EvalService {
    const mission = missionFace()
    return new EvalService({ get: (name) => (name === 'mission' ? mission : undefined) })
  }

  it('projects every cell with its unit, checkpoints, annotation counts, and child session', async () => {
    const tool = toolsOver(service()).get('eval_cells') as RegisteredTool
    const report = await tool.execute({ run_id: 'run-1' }, {}) as {
      runId: string; state: string; filter: Record<string, string>; total: number; matched: number
      buckets: Record<string, number>
      cells: Array<Record<string, unknown>>
    }
    expect(report).toMatchObject({ runId: 'run-1', state: 'active', total: 2, matched: 2, filter: {} })
    expect(report.buckets).toEqual({ active: 1, ready: 1 })
    expect(report.cells[0]).toMatchObject({
      missionId: 'p0-dsh-exec-rep1',
      task: 'P0', condition: 'dsh-exec', rep: 1,
      labels: { task: 'P0', condition: 'dsh-exec', rep: '1' },
      state: 'stage-2', bucket: 'active', attempt: 2,
      // The CURRENT attempt's unit and checkpoints, not attempt 1's.
      refs: { resource: 'eval-run-1-rep1-b', fingerprint: 'lab-env:bbb' },
      checkpoints: ['stage1'],
      // Counted per namespace, across attempts — llm-draft is not orchestrator.
      annotations: { orchestrator: 4, 'llm-draft': 1 },
      // The latest session of the current attempt's refs.
      childSessionId: 'child-c',
      enteredCurrentAt: 40,
    })
    expect(report.cells[1]).toMatchObject({
      missionId: 'p0-dsh-exec-rep2',
      state: 'pending', bucket: 'ready', attempt: 1,
      refs: { resource: null, fingerprint: null },
      checkpoints: [],
      annotations: {},
      childSessionId: null,
      // No `enteredCurrentAt` on the row: the attempt's own map answered.
      enteredCurrentAt: 6,
    })
    expect(report.cells[0]?.['inStateMs']).toBeTypeOf('number')
  })

  it('measures the current stage against the clock it is given', () => {
    const report = service().cells('run-1', { now: 1_000 })
    expect(report.cells.map(cell => cell.inStateMs)).toEqual([960, 994])
    // A clock that ran backwards is zero, never a negative duration.
    expect(service().cells('run-1', { now: 5 }).cells.map(cell => cell.inStateMs)).toEqual([0, 0])
  })

  it('narrows by bucket, task, and condition, and echoes the filter it applied', async () => {
    const tool = toolsOver(service()).get('eval_cells') as RegisteredTool
    const active = await tool.execute({ run_id: 'run-1', bucket: 'active' }, {}) as {
      filter: Record<string, string>; total: number; matched: number; buckets: Record<string, number>
      cells: Array<{ missionId: string }>
    }
    expect(active.filter).toEqual({ bucket: 'active' })
    expect(active.cells.map(cell => cell.missionId)).toEqual(['p0-dsh-exec-rep1'])
    // `total` and `buckets` stay the whole run's — the filter narrows the list,
    // not the reader's sense of how big the run is.
    expect(active).toMatchObject({ total: 2, matched: 1, buckets: { active: 1, ready: 1 } })

    const byTask = await tool.execute({ run_id: 'run-1', task: 'P0', condition: 'dsh-exec' }, {}) as { matched: number }
    expect(byTask.matched).toBe(2)
    const missing = await tool.execute({ run_id: 'run-1', condition: 'kimi-exec' }, {}) as { matched: number; cells: unknown[] }
    expect(missing).toMatchObject({ matched: 0, cells: [] })
  })

  it('falls back to the orchestrator annotation for the child session, and degrades on an unreadable cell', () => {
    const mission = {
      runStatus: () => ({
        run: { id: 'run-2', state: 'active', createdAt: 1, meta: {} },
        rows: [
          { id: 'a', labels: { task: 'P0', condition: 'c', rep: '1' }, state: 'stage-1', bucket: 'active', currentAttempt: 1, enteredCurrentAt: 9 },
          { id: 'b', labels: { task: 'P0', condition: 'c', rep: '2' }, state: 'pending', bucket: 'ready', currentAttempt: 1 },
        ],
        buckets: {},
        unreleased: [],
      }),
      get: (missionId: string) => {
        // A cell the ledger cannot resolve must not fail the whole listing.
        if (missionId === 'b') throw new Error('no such mission')
        return {
          mission: {
            currentAttempt: 1,
            // refs never got written (the round failed to start), so the
            // orchestrator's own annotation is the only witness.
            attempts: [{ attempt: 1, state: 'stage-1', refs: {}, enteredAt: {}, checkpoints: [] }],
            annotations: [
              { ns: 'orchestrator', attempt: 1, createdAt: 2, payload: { kind: 'delegation', childSessionId: 'child-x' } },
              { ns: 'orchestrator', attempt: 1, createdAt: 3, payload: { kind: 'delegation-failed', childSessionId: 'child-y' } },
            ],
          },
        }
      },
    }
    const report = new EvalService({ get: (name) => (name === 'mission' ? mission : undefined) }).cells('run-2', { now: 9 })
    expect(report.cells[0]).toMatchObject({ missionId: 'a', childSessionId: 'child-y', annotations: { orchestrator: 2 }, inStateMs: 0 })
    expect(report.cells[1]).toMatchObject({
      missionId: 'b', childSessionId: null, annotations: {}, checkpoints: [],
      refs: { resource: null, fingerprint: null }, enteredCurrentAt: null, inStateMs: null,
    })
  })

  it('says so in words when the composition mounts no mission service', async () => {
    const tool = toolsOver(new EvalService({ get: () => undefined })).get('eval_cells') as RegisteredTool
    await expect(tool.execute({ run_id: 'run-1' }, {})).rejects.toThrow(/no mission service/)
  })

  it('passes an unknown run id through as the ledger\'s own error', async () => {
    const tool = toolsOver(service()).get('eval_cells') as RegisteredTool
    await expect(tool.execute({ run_id: 'run-9' }, {})).rejects.toThrow(/unknown run/)
  })

  it('tells the model the mission read tools are not there to look for', () => {
    const tool = toolsOver(service()).get('eval_cells') as RegisteredTool
    expect((tool as unknown as { description: string }).description).toMatch(/no mission_run_list/)
  })

  /**
   * I5·T35a — the listing mode. Without `run_id` the tool answers WHICH
   * experiments exist, from the same projection the 实验室 tab's `runs` Remote
   * verb reads, so the model and the tab can never disagree. This is the gap
   * T46 left open when the evaluation preset dropped `mission_run_list`.
   */
  it('without a run id it lists the evaluation runs instead of one run\'s cells', async () => {
    const tool = toolsOver(service()).get('eval_cells') as RegisteredTool
    // `run_id` is no longer required — the two modes share one tool.
    expect(tool.parameters.required ?? []).not.toContain('run_id')
    useDshHome()
    const listing = await tool.execute({}, {}) as {
      rows: Array<Record<string, unknown>>
      notes: string[]
    }
    // The fake ledger holds exactly one eval run; its row carries the list
    // columns the tab shows, sourced from run.meta and the cells.
    expect(listing.rows).toHaveLength(1)
    expect(listing.rows[0]).toMatchObject({
      id: 'run-1',
      runId: 'run-1',
      name: 'p',
      // The fake run started at t=5 and no job of this instance is running
      // it, so by T72's stall rule the listing calls it 停滞, not 运行中.
      status: 'stalled',
      conditions: ['dsh-exec'],
      items: 1,
      reps: 2,
      progress: { done: 0, total: 2 },
      startedAt: 5,
    })
    expect(listing.rows[0]?.['snapshot']).toEqual({ registry: null, datasetId: 'harness-comparison', commit: 'c'.repeat(40) })
    // No experiment claims it: an old run, shown as one.
    expect(listing.rows[0]).toMatchObject({ experimentId: null, legacy: true })
  })
})
