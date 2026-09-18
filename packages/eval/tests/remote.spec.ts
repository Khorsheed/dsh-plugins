/**
 * The eval Remote's LAB verbs: the plan review, the condition registry and its
 * diff, and the two writes — `newExperiment` (I5·T34, the 新建实验 form) and
 * `approve` (I5·T36).
 *
 * The approval gate is the case worth pinning. `approve` is the button on the
 * plan-review page and the only door a human's click has to `runStart`; a plan
 * validate rejects must not get through it, because a run started over
 * conditions that do not resolve burns real delegations to discover what an
 * offline check already knew. So: validate refuses, `runStart` is never
 * reached, and the refusal comes back as data beside the same check list the
 * page was already showing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalRemoteService } from '../src/remote.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

/** A real 64-hex sha — `home.sha` is format-checked, and 'h' is not hex. */
const HOME_SHA = 'ab'.repeat(32)

const CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.5', drive: 'exec' },
  model: { declared: 'deepseek-v4', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: 'bench',
  skills: { pack: null },
  home: { sha: HOME_SHA },
  env: { keys: ['DEEPSEEK_API_KEY'] },
} as const

/** The same subject on another account and another CLI — a two-factor pair. */
const OTHER = {
  ...CONDITION,
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  permissions: 'workspace-write',
  preset: null,
  scope: 'eval-b',
  notes: 'the second subject',
} as const

const STAGE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['done'],
  properties: { done: { type: 'boolean' } },
}

/** A dataset repository with two conditions, one locked, and a plan over them. */
function fixtureRepo(options: { planConditions?: string[]; broken?: boolean } = {}): { repo: string; plan: string } {
  const repo = join(tmpTree(), 'repo')
  const dataset = join(repo, 'datasets', 'ds')
  // A declaration that violates dataseek.condition/1 — the drive enum is
  // `exec` and nothing else (frozen decision 2). This is an ERROR, which is
  // what makes it the approval gate's test case.
  if (options.broken === true) writeJson(dataset, 'conditions/broken.json', { ...CONDITION, harness: { ...CONDITION.harness, drive: 'live' } })
  writeJson(dataset, 'conditions/dsh-exec.json', CONDITION)
  writeJson(dataset, 'conditions/dsh-exec.lock.json', {
    schema: 'dataseek.condition-lock/1',
    condition: 'dsh-exec',
    sha: hashConditionDocument(CONDITION),
    home: { sha: HOME_SHA },
    provisioned: {
      at: 1_757_500_000_000,
      cliVersion: '0.1.5',
      effective: { model: 'deepseek-v4', reasoningEffort: 'default', permissions: 'unrestricted', endpoint: 'default' },
    },
  })
  writeJson(dataset, 'conditions/codex-exec.json', OTHER)
  writeJson(dataset, 'schemas/stage-1.json', STAGE_SCHEMA)
  const plan = writeJson(dataset, 'plans/p.json', {
    schema: 'dataseek.plan/1',
    dataset: { repo, commit: null, id: 'ds', items: ['p0-001'] },
    conditions: options.planConditions ?? ['dsh-exec'],
    reps: 2,
    stages: ['stage-1'],
    order: { seed: 7, interleave: true },
    budget: { activeMinutes: 30, turns: 40 },
    judge: { conditions: [], samples: 0 },
    expectedNs: ['script'],
  })
  return { repo, plan }
}

/** A live agent as far as these verbs care: a session id and a workspace. */
function agentOf(cwd?: string): Agent {
  return { session: { id: 's1', header: cwd === undefined ? {} : { cwd } } } as unknown as Agent
}

/** Mount the Remote over a real service core in a bare context. */
async function bench() {
  const ctx = new Context()
  const service = new EvalService()
  ctx.provide('dshEval', service as never)
  const fiber = ctx.plugin(EvalRemoteService)
  await fiber.await()
  return { ctx, fiber, service, remote: ctx.get('dshEvalRemote') as EvalRemoteService }
}

describe('the plan-review verb', () => {
  it('answers the plan digest and validate line by line, ok lines included', async () => {
    const { fiber, remote } = await bench()
    const { plan } = fixtureRepo()

    const review = await remote.plan(agentOf(), { planPath: plan })

    expect(review.ok).toBe(true)
    expect(review.errors).toBe(0)
    expect(review.digest?.order).toEqual({ seed: 7, interleave: true })
    expect(review.digest?.items).toEqual(['p0-001'])
    expect(review.digest?.reps).toBe(2)
    // A clean plan is not an empty page: the resolved condition is an ok line.
    expect(review.checks.filter(check => check.severity === 'ok').map(check => check.code)).toEqual(['CONDITION_READY'])
    expect(review.checks.some(check => check.severity === 'error')).toBe(false)
    expect(review.conditions).toEqual([
      { id: 'dsh-exec', role: 'player', sha: hashConditionDocument(CONDITION), status: 'ready', lock: { present: true, matches: true, homeSha: HOME_SHA } },
    ])
    await fiber.dispose()
  })

  it('a condition whose declaration violates the contract is an error, and the plan is not ok', async () => {
    const { fiber, remote } = await bench()
    const { plan } = fixtureRepo({ planConditions: ['dsh-exec', 'broken'], broken: true })

    const review = await remote.plan(agentOf(), { planPath: plan })

    expect(review.ok).toBe(false)
    expect(review.errors).toBeGreaterThan(0)
    expect(review.checks.some(check => check.severity === 'error')).toBe(true)
    expect(review.conditions.map(condition => condition.status)).toEqual(['ready', 'missing'])
    await fiber.dispose()
  })

  it('a condition the repository simply does not hold is a WARNING — the page reports validate\'s calibration, not its own', async () => {
    const { fiber, remote } = await bench()
    const { plan } = fixtureRepo({ planConditions: ['dsh-exec', 'nobody'] })

    const review = await remote.plan(agentOf(), { planPath: plan })

    // Deliberately pinned: the review page must never be stricter than
    // `dsh-eval validate`, because then a plan the CLI approves would be
    // unapprovable in the interface and nobody could tell which was right.
    expect(review.ok).toBe(true)
    expect(review.checks.filter(check => check.severity === 'warn').map(check => check.code))
      .toContain('CONDITION_FILE_MISSING')
    expect(review.conditions.map(condition => condition.status)).toEqual(['ready', 'missing'])
    await fiber.dispose()
  })
})

describe('approve — the human act of ui-spec step 5', () => {
  it('refuses a plan validate rejects and never reaches runStart', async () => {
    const { fiber, service, remote } = await bench()
    const { plan } = fixtureRepo({ planConditions: ['broken'], broken: true })
    const runStart = vi.spyOn(service, 'runStart')

    const result = await remote.approve(agentOf('/workspace'), { planPath: plan })

    expect(result.started).toBe(false)
    expect(runStart).not.toHaveBeenCalled()
    expect(result.jobId).toBeNull()
    expect(result.runId).toBeNull()
    // The refusal names what validate found, and the page keeps the same list.
    expect(result.refusal).toContain('validate refuses this plan')
    expect(result.checks.some(check => check.severity === 'error')).toBe(true)
    await fiber.dispose()
  })

  it('starts an approvable plan with the approving session as the parent and its workspace as the cwd', async () => {
    const { fiber, service, remote } = await bench()
    const { plan } = fixtureRepo()
    const runStart = vi.spyOn(service, 'runStart').mockResolvedValue({
      jobId: 'eval-run-1',
      runId: 'run-20260914-aa',
      parentSessionId: 's1',
    })

    const result = await remote.approve(agentOf('/workspace'), { planPath: plan })

    expect(result).toMatchObject({
      started: true,
      refusal: null,
      jobId: 'eval-run-1',
      runId: 'run-20260914-aa',
      parentSessionId: 's1',
    })
    expect(runStart).toHaveBeenCalledTimes(1)
    expect(runStart.mock.calls[0]?.[1]).toMatchObject({ parentSessionId: 's1', cwd: '/workspace' })
    // The approval that ticks nothing walks the release gate: `keepUnits` is
    // absent, and absent is the default (T57).
    expect(runStart.mock.calls[0]?.[1]).not.toHaveProperty('keepUnits')
    await fiber.dispose()
  })

  it('carries the 保留单元 box through to the run when the approver ticked it', async () => {
    const { fiber, service, remote } = await bench()
    const { plan } = fixtureRepo()
    const runStart = vi.spyOn(service, 'runStart').mockResolvedValue({
      jobId: 'eval-run-1', runId: 'run-1', parentSessionId: 's1',
    })

    await remote.approve(agentOf('/workspace'), { planPath: plan, keepUnits: true })

    expect(runStart.mock.calls[0]?.[1]).toMatchObject({ keepUnits: true })
    await fiber.dispose()
  })

  it('a session with no workspace passes no cwd rather than inventing one', async () => {
    const { fiber, service, remote } = await bench()
    const { plan } = fixtureRepo()
    const runStart = vi.spyOn(service, 'runStart').mockResolvedValue({
      jobId: 'eval-run-1', runId: 'run-1', parentSessionId: 's1',
    })

    await remote.approve(agentOf(), { planPath: plan })

    expect(runStart.mock.calls[0]?.[1]).not.toHaveProperty('cwd')
    await fiber.dispose()
  })

  it('a wiring failure comes back verbatim as a refusal, not as a thrown RPC error', async () => {
    const { fiber, service, remote } = await bench()
    const { plan } = fixtureRepo()
    vi.spyOn(service, 'runStart').mockRejectedValue(new Error('no jobs service in this composition'))

    const result = await remote.approve(agentOf(), { planPath: plan })

    expect(result.started).toBe(false)
    expect(result.refusal).toBe('the run could not start: no jobs service in this composition')
    // The check list survives the refusal — the page shows both together.
    expect(result.checks.length).toBeGreaterThan(0)
    await fiber.dispose()
  })
})

describe('newExperiment — the 新建实验 form\'s write (ui-spec step 2)', () => {
  /** The T36 fixture plus the item tree a draft needs to land in. */
  function draftable(): string {
    const { repo } = fixtureRepo()
    writeJson(join(repo, 'datasets', 'ds'), 'items/p0-001/item.json', { id: 'p0-001' })
    return repo
  }

  const FORM = {
    name: 'i5-walk',
    dataset: 'ds',
    items: ['p0-001'],
    conditions: ['dsh-exec'],
    reps: 1,
    stages: ['stage-1'],
    seed: 20260916,
    activeMinutes: 60,
    turns: 10,
  }

  it('drafts the plan into the session\'s repository and answers with the review page\'s own payload', async () => {
    const { fiber, remote } = await bench()
    const repo = draftable()

    const result = await remote.newExperiment(agentOf(), { ...FORM, repo })

    expect(result.planPath).toBe(join(repo, 'datasets', 'ds', 'plans', 'i5-walk.json'))
    expect(result.review.ok).toBe(true)
    expect(result.review.digest?.items).toEqual(['p0-001'])
    // The file is really there — the form's next stop is the plan-review page,
    // which re-reads it by path.
    expect(JSON.parse(readFileSync(result.planPath, 'utf8'))['schema']).toBe('dataseek.plan/1')
    await fiber.dispose()
  })

  it('is a write, not a start: nothing reaches runStart', async () => {
    const { fiber, service, remote } = await bench()
    const repo = draftable()
    const runStart = vi.spyOn(service, 'runStart')

    await remote.newExperiment(agentOf('/workspace'), { ...FORM, repo })

    // 启动不在这张表单上 (ui-spec §五). The starting verb is `approve`, one page
    // further on, and this one has no path to it.
    expect(runStart).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('reaches the SAME service verb the eval_plan_draft tool reaches, with the calling session', async () => {
    const { fiber, service, remote } = await bench()
    const repo = draftable()
    const draft = vi.spyOn(service, 'draftExperiment')

    await remote.newExperiment(agentOf(), { ...FORM, repo })

    expect(draft).toHaveBeenCalledTimes(1)
    expect(draft.mock.calls[0]?.[1]).toEqual({ session: { id: 's1' } })
    await fiber.dispose()
  })

  it('mints a new condition beside the plan, copying one that exists', async () => {
    const { fiber, remote } = await bench()
    const repo = draftable()

    const result = await remote.newExperiment(agentOf(), {
      ...FORM,
      repo,
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    })

    expect(result.conditionPaths).toEqual([join(repo, 'datasets', 'ds', 'conditions', 'dsh-exec-pro.json')])
    expect(result.conditions).toEqual(['dsh-exec', 'dsh-exec-pro'])
    await fiber.dispose()
  })
})

describe('draftOptions — what the form\'s pickers may offer', () => {
  it('answers the sets with their items and stage schemas', async () => {
    const { fiber, remote } = await bench()
    const { repo } = fixtureRepo()
    writeJson(join(repo, 'datasets', 'ds'), 'items/p0-001/item.json', { id: 'p0-001' })

    const view = await remote.draftOptions(agentOf(), { repo })

    expect(view.datasets).toEqual([{ id: 'ds', items: ['p0-001'], stages: ['stage-1'] }])
    await fiber.dispose()
  })
})

describe('the conditions verbs', () => {
  it('lists every condition with its scope, preset and lock', async () => {
    const { fiber, remote } = await bench()
    const { repo } = fixtureRepo()

    const view = await remote.conditions(agentOf(), { repo })

    expect(view.rows.map(row => row.id)).toEqual(['codex-exec', 'dsh-exec'])
    expect(view.rows.find(row => row.id === 'codex-exec')).toMatchObject({
      harness: 'codex', drive: 'exec', model: 'gpt-5.6-sol', scope: 'eval-b', preset: null, status: 'unready',
    })
    expect(view.rows.find(row => row.id === 'dsh-exec')).toMatchObject({
      scope: null, preset: 'bench', status: 'ready',
    })
    expect(view.rows.find(row => row.id === 'dsh-exec')?.lock).toMatchObject({
      present: true, matches: true, cliVersion: '0.1.5',
    })
    await fiber.dispose()
  })

  it('the diff reports ONLY the differing keys, each side as canonical JSON text', async () => {
    const { fiber, remote } = await bench()
    const { repo } = fixtureRepo()

    const diff = await remote.conditionDiff(agentOf(), { repo, a: 'dsh-exec', b: 'codex-exec' })

    expect(diff.identical).toBe(false)
    const paths = diff.differences.map(difference => difference.path)
    expect(paths).toEqual([
      'harness.name', 'harness.version', 'model.declared', 'notes', 'permissions', 'preset', 'scope',
    ])
    // Everything the two agree on is absent, not present-and-equal.
    for (const same of ['schema', 'harness.drive', 'reasoning.effort', 'instructions', 'skills.pack', 'home.sha', 'env.keys']) {
      expect(paths).not.toContain(same)
    }
    expect(diff.differences.find(difference => difference.path === 'model.declared')).toEqual({
      path: 'model.declared', a: '"deepseek-v4"', b: '"gpt-5.6-sol"',
    })
    // Absent on one side is a difference like any other, and says so with null.
    expect(diff.differences.find(difference => difference.path === 'scope')).toEqual({
      path: 'scope', a: null, b: '"eval-b"',
    })
    await fiber.dispose()
  })

  it('two conditions that differ only in notes are identical, and the diff says which comment moved', async () => {
    const { fiber, remote } = await bench()
    const repo = join(tmpTree(), 'repo')
    writeJson(join(repo, 'datasets', 'ds'), 'conditions/a.json', { ...CONDITION, notes: 'first' })
    writeJson(join(repo, 'datasets', 'ds'), 'conditions/b.json', { ...CONDITION, notes: 'second' })

    const diff = await remote.conditionDiff(agentOf(), { repo, a: 'a', b: 'b' })

    expect(diff.identical).toBe(true)
    expect(diff.notesOnly).toBe(true)
    expect(diff.differences).toEqual([{ path: 'notes', a: '"first"', b: '"second"' }])
    await fiber.dispose()
  })
})
