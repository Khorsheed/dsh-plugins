/**
 * The three READ tools: registration discipline (names, origin tag, the
 * `tools: 'none'` off switch) and each adapter's `execute` against fake
 * service faces — a temp dataset tree for the two contract tools, a fake
 * mission ledger for the run projection.
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { apply } from '../src/index.ts'
import { EvalService } from '../src/service.ts'
import { registerEvalTools, EVAL_TOOL_NAMES } from '../src/tools.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const ORIGIN = Symbol.for('dsh.tool.origin')

interface RegisteredTool {
  name: string
  parameters: { required?: string[] }
  output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
  execute: (args: Record<string, unknown>, exec: { agent?: { session: { id: string } } }) => Promise<unknown>
  [ORIGIN]?: unknown
}

/** A tool registry spy plus the deferred-injection doors `apply` goes through. */
function toolsCtx(registered: RegisteredTool[], services: Record<string, unknown> = {}) {
  const provided = new Map<string, unknown>()
  const tools = {
    register: (definition: RegisteredTool) => {
      registered.push(definition)
      return () => {}
    },
  }
  const get = (name: string): unknown => (name === 'tools' ? tools : services[name])
  const ctx = {
    provided,
    provide: (name: string, value: unknown) => { provided.set(name, value) },
    commands: { register: () => {} },
    tools,
    get,
    // Deferred injection, as cordis does it: the callback fires only when
    // every named service exists, and never otherwise.
    inject: (_deps: string[], _callback: (injected: unknown) => void): void => {},
  }
  ctx.inject = (deps, callback) => {
    if (deps.every(dep => get(dep) !== undefined)) callback(ctx)
  }
  return ctx
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
 * A dataset repository with two conditions: `locked` is ready (lock present,
 * matching, home verified), `drafting` is not (no lock, two null fields).
 */
function writeRepo(): string {
  const repo = join(tmpTree(), 'dataseek')
  const dataset = join(repo, 'datasets', 'harness-comparison')
  const locked = condition()
  writeJson(dataset, 'conditions/locked.json', locked)
  writeJson(dataset, 'conditions/locked.lock.json', {
    schema: 'dataseek.condition-lock/1',
    condition: 'locked',
    sha: hashConditionDocument(locked),
    home: { sha: 'a'.repeat(64) },
  })
  writeJson(dataset, 'conditions/drafting.json', condition({
    harness: { name: 'kimi', version: null, drive: 'exec' },
    permissions: 'auto-approve',
    model: { declared: null, endpoint: null },
  }))
  return repo
}

describe('registration', () => {
  it('registers exactly the three read tools, each tagged with this package', () => {
    const registered: RegisteredTool[] = []
    apply(toolsCtx(registered) as never, {})
    expect(registered.map(tool => tool.name)).toEqual(EVAL_TOOL_NAMES)
    for (const tool of registered) {
      expect(tool[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-eval' })
    }
  })

  it('renders the whole document — the rendering is what the model reads', () => {
    const registered: RegisteredTool[] = []
    apply(toolsCtx(registered) as never, {})
    const value = { ok: true, conditions: [{ id: 'c', sha: 'a'.repeat(64) }] }
    for (const tool of registered) {
      // A one-line summary here would answer the question a second time, and
      // more poorly: the shas, diagnostics, and per-cell rows ARE the answer.
      expect(tool.output.render({}, value)).toEqual([{ type: 'text', text: JSON.stringify(value, null, 2) }])
    }
  })

  it('registers no tool at all under tools: none', () => {
    const registered: RegisteredTool[] = []
    apply(toolsCtx(registered) as never, { tools: 'none' })
    expect(registered).toEqual([])
  })

  it('adds the tool:eval prompt section only where a systemPrompt registry exists', () => {
    const sections: Array<{ name: string; order: number; text: string }> = []
    apply(toolsCtx([], { systemPrompt: { section: (s: { name: string; order: number; text: string }) => { sections.push(s) } } }) as never, {})
    expect(sections.map(section => section.name)).toEqual(['tool:eval'])
    expect(sections[0]?.text).toMatch(/READ ONLY/)
    // No systemPrompt service: the tools still register, nothing throws.
    const registered: RegisteredTool[] = []
    apply(toolsCtx(registered) as never, {})
    expect(registered).toHaveLength(3)
  })
})

/** Register the three tools over one service and index them by name. */
function toolsOver(service: EvalService): Map<string, RegisteredTool> {
  const registered: RegisteredTool[] = []
  registerEvalTools(toolsCtx(registered) as never, service)
  return new Map(registered.map(tool => [tool.name, tool]))
}

describe('eval_conditions', () => {
  it('lists each condition with its hash, readiness, and unresolved fields', async () => {
    const repo = writeRepo()
    const tool = toolsOver(new EvalService()).get('eval_conditions') as RegisteredTool
    const report = await tool.execute({ repo }, {}) as {
      repo: string
      datasets: string[]
      conditions: Array<{ id: string; dataset: string; status: string; sha: string; harness: { name: string }; model: { declared: string | null }; lock: { present: boolean; matches: boolean }; unresolved: string[]; warnings: Array<{ code: string }> }>
    }
    expect(report.repo).toBe(repo)
    expect(report.datasets).toEqual(['harness-comparison'])
    const [drafting, locked] = report.conditions
    expect(locked).toMatchObject({
      id: 'locked',
      dataset: 'harness-comparison',
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
  })

  it('falls back to the session binding and honours its dataset whitelist', async () => {
    const repo = writeRepo()
    const datasets = { binding: (session: { id: string }) => (session.id === 's1' ? { repoPath: repo, datasets: ['harness-comparison'] } : undefined) }
    const tool = toolsOver(new EvalService({ get: (name) => (name === 'datasets' ? datasets : undefined) })).get('eval_conditions') as RegisteredTool

    const bound = await tool.execute({}, { agent: { session: { id: 's1' } } }) as { repo: string; conditions: unknown[] }
    expect(bound.repo).toBe(repo)
    expect(bound.conditions).toHaveLength(2)

    // A dataset the human did not admit is refused, not quietly read.
    await expect(tool.execute({ dataset: 'other' }, { agent: { session: { id: 's1' } } }))
      .rejects.toThrow(/outside this session's binding/)
    // No binding, no repo argument: the answer says who fixes it.
    await expect(tool.execute({}, { agent: { session: { id: 's2' } } }))
      .rejects.toThrow(/\/datasets bind/)
  })
})

describe('eval_plan_validate', () => {
  it('reports ok, diagnostics, and the resolved condition shas', async () => {
    const repo = writeRepo()
    const dataset = join(repo, 'datasets', 'harness-comparison')
    writeJson(dataset, 'schemas/stage1.json', { type: 'object', properties: { done: { type: 'boolean' } } })
    const planPath = writeJson(dataset, 'plans/p.json', {
      schema: 'dataseek.plan/1',
      dataset: { repo, commit: null, id: 'harness-comparison', items: ['P0'] },
      conditions: ['locked'],
      reps: 1,
      stages: ['stage1'],
      order: { seed: 42, interleave: true },
      budget: { activeMinutes: 60, turns: 10 },
      expectedNs: ['script'],
    })
    const tool = toolsOver(new EvalService()).get('eval_plan_validate') as RegisteredTool
    const report = await tool.execute({ plan: planPath }, {}) as {
      ok: boolean
      errors: unknown[]
      warnings: Array<{ code: string }>
      conditions: Array<{ id: string; sha: string; status: string }>
    }
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.map(w => w.code)).toContain('COMMIT_UNRESOLVED')
    expect(report.conditions).toEqual([
      { id: 'locked', sha: expect.stringMatching(/^[0-9a-f]{64}$/), lock: expect.anything(), status: 'ready' },
    ])
  })

  it('requires a plan path and reports an unreadable one as an error, not a throw', async () => {
    const tool = toolsOver(new EvalService()).get('eval_plan_validate') as RegisteredTool
    expect(tool.parameters.required).toEqual(['plan'])
    await expect(tool.execute({}, {})).rejects.toThrow(/plan/)
    const report = await tool.execute({ plan: join(tmpTree(), 'nope.json') }, {}) as { ok: boolean; errors: Array<{ code: string }> }
    expect(report.ok).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual(['PLAN_UNREADABLE'])
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
  return {
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
          { id: 'p0-dsh-exec-rep1', labels: { task: 'P0', condition: 'dsh-exec', rep: '1' }, state: 'stage-2', bucket: 'active', currentAttempt: 2 },
          { id: 'p0-dsh-exec-rep2', labels: { task: 'P0', condition: 'dsh-exec', rep: '2' }, state: 'pending', bucket: 'ready', currentAttempt: 1 },
        ],
        buckets: { ready: ['p0-dsh-exec-rep2'], scheduled: [], blocked: [], active: ['p0-dsh-exec-rep1'], done: [] },
        unreleased: ['p0-dsh-exec-rep1'],
      }
    },
    get: (missionId: string) => ({ mission: { annotations: annotations[missionId] ?? [] } }),
  }
}

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
