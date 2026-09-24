/**
 * T74 — the plan's question block (v1-rev14) and its in-place numbers.
 *
 * Two promises are pinned. The question a person asked travels from the draft
 * into the plan and back out to every page that reads it, and a plan without
 * one (every plan before rev14) reads as having none — no block, no warning.
 * And the design page's number edit changes the value tokens it names and
 * NOT ONE other byte of plan.json: the plan is kept byte for byte (an imported
 * plan's hash is how an old run finds it), so the test compares the whole file
 * text, not the parsed document.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { planQuestionOf } from '../src/plan-question.ts'
import { EvalPlanEditRefused, writePlanNumbers } from '../src/plan-numbers.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, fakeRegistry, hostsWith, tmpTree, useDshHome, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const HOME_SHA = 'ab'.repeat(32)
const LATEST = 'c'.repeat(40)
const DSH_EXEC = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.5', drive: 'exec' },
  model: { declared: 'deepseek-v4-flash', endpoint: 'https://api.example.invalid' },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: HOME_SHA },
  env: { keys: ['DEEPSEEK_API_KEY'] },
}

/** A deployment with one registered set and one condition, as draft.spec builds it. */
function fixture(extraHosts: Record<string, unknown> = {}) {
  const { stateRoot } = useDshHome()
  const dataset = join(tmpTree(), 'view', 'ds')
  const library = join(stateRoot, 'conditions')
  writeJson(library, 'dsh-exec.json', DSH_EXEC)
  writeJson(library, 'dsh-exec.lock.json', {
    schema: 'dataseek.condition-lock/1',
    condition: 'dsh-exec',
    sha: hashConditionDocument(DSH_EXEC),
    home: { sha: HOME_SHA },
  })
  writeJson(dataset, 'schemas/stage1.json', { type: 'object', properties: { done: { type: 'boolean' } } })
  writeJson(dataset, 'items/P0/item.json', { id: 'P0' })
  const face = fakeRegistry({ latest: LATEST, sets: { ds: dataset } })
  return { stateRoot, service: new EvalService(hostsWith(face, extraHosts)) }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    name: 'q-walk',
    dataset: 'reg/ds',
    items: ['P0'],
    conditions: ['dsh-exec'],
    reps: 3,
    stages: ['stage1'],
    seed: 7,
    activeMinutes: 60,
    turns: 10,
    judge: { conditions: ['dsh-exec'], samples: 1 },
    ...overrides,
  } as Parameters<EvalService['draftExperiment']>[0]
}

describe('planQuestionOf', () => {
  it('reads the three fields, trimmed; a blank one is absent', () => {
    expect(planQuestionOf({ question: '  谁更完整？ ', expectation: '', answeredWhen: 'x' }))
      .toEqual({ question: '谁更完整？', expectation: null, answeredWhen: 'x' })
  })

  it('a plan that says none of the three has no block', () => {
    expect(planQuestionOf({ schema: 'dataseek.plan/1', name: 'old' })).toBeNull()
    expect(planQuestionOf({ question: '   ' })).toBeNull()
    expect(planQuestionOf(null)).toBeNull()
    expect(planQuestionOf([])).toBeNull()
  })
})

describe('draft → plan → digest: the question travels verbatim', () => {
  it('writes the three fields after name and the review digest reads them back', async () => {
    const { service } = fixture()
    const result = await service.draftExperiment(request({
      question: 'codex-exec 和 claude-exec 谁做得更完整？',
      expectation: 'claude-exec 更完整',
      answeredWhen: '两组各跑满 3 次',
    }))
    const plan = JSON.parse(readFileSync(result.planPath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(plan).slice(0, 5)).toEqual(['schema', 'name', 'question', 'expectation', 'answeredWhen'])
    expect(plan['question']).toBe('codex-exec 和 claude-exec 谁做得更完整？')
    expect(result.review.digest.question).toEqual({
      question: 'codex-exec 和 claude-exec 谁做得更完整？',
      expectation: 'claude-exec 更完整',
      answeredWhen: '两组各跑满 3 次',
    })
    // The fields are schema-declared (rev14): validate has nothing to say about them.
    expect(result.review.checks.map(check => check.message).join('\n')).not.toMatch(/question|expectation|answeredWhen/)
  })

  it('a draft without them writes no keys and reviews with no block', async () => {
    const { service } = fixture()
    const result = await service.draftExperiment(request({ question: '  ' }))
    const plan = JSON.parse(readFileSync(result.planPath, 'utf8')) as Record<string, unknown>
    expect(plan).not.toHaveProperty('question')
    expect(plan).not.toHaveProperty('expectation')
    expect(result.review.digest.question).toBeNull()
  })

  it('the list row carries the question for an unstarted experiment', async () => {
    const { service } = fixture()
    const drafted = await service.draftExperiment(request({ question: '谁更完整？' }))
    const list = await service.experiments({})
    const row = list.rows.find(entry => entry.experimentId === drafted.experimentId)
    expect(row?.question).toBe('谁更完整？')
  })
})

/** A plan with deliberately odd formatting: every byte of it must survive. */
const ODD = `{
  "schema": "dataseek.plan/1",
  "name": "odd",
    "reps":   3 ,
  "note": "reps: 3, \\"budget\\": {\\"turns\\": 10}",
  "budget": {"activeMinutes": 60, "turns": 10, "nested": {"turns": 99}},
  "judge": { "conditions": ["j"], "samples": 1 },
  "items": [{"reps": 3}]
}
`

function oddPlan(): string {
  const path = join(tmpTree(), 'plan.json')
  writeFileSync(path, ODD, 'utf8')
  return path
}

describe('writePlanNumbers — only the named value tokens change', () => {
  it('changes reps and nothing else, byte for byte', async () => {
    const path = oddPlan()
    const report = await writePlanNumbers(path, { reps: 2 })
    expect(report).toEqual({ changes: [{ field: 'reps', before: 3, after: 2 }], written: true })
    expect(readFileSync(path, 'utf8')).toBe(ODD.replace('"reps":   3 ,', '"reps":   2 ,'))
  })

  it('changes all four at once, leaving the look-alike keys in strings, deeper objects and arrays alone', async () => {
    const path = oddPlan()
    const report = await writePlanNumbers(path, { reps: 5, activeMinutes: 45.5, turns: 12, judgeSamples: 3 })
    expect(report.changes.map(change => change.field)).toEqual(['reps', 'budget.activeMinutes', 'budget.turns', 'judge.samples'])
    expect(readFileSync(path, 'utf8')).toBe(ODD
      .replace('"reps":   3 ,', '"reps":   5 ,')
      .replace('{"activeMinutes": 60, "turns": 10,', '{"activeMinutes": 45.5, "turns": 12,')
      .replace('"samples": 1 }', '"samples": 3 }'))
  })

  it('a value equal to the plan\'s is a no-op that writes nothing', async () => {
    const path = oddPlan()
    expect(await writePlanNumbers(path, { reps: 3, turns: 10 })).toEqual({ changes: [], written: false })
    expect(readFileSync(path, 'utf8')).toBe(ODD)
  })

  it('refuses a value the plan contract does not allow, and writes nothing', async () => {
    const path = oddPlan()
    await expect(writePlanNumbers(path, { reps: 0 })).rejects.toThrow(EvalPlanEditRefused)
    await expect(writePlanNumbers(path, { reps: 1.5 })).rejects.toThrow(/integer/)
    await expect(writePlanNumbers(path, { activeMinutes: 0 })).rejects.toThrow(/> 0/)
    await expect(writePlanNumbers(path, { judgeSamples: -1 })).rejects.toThrow(/≥ 0/)
    expect(readFileSync(path, 'utf8')).toBe(ODD)
  })

  it('judge samples may go to 0 — a declared judge that draws no samples', async () => {
    const path = oddPlan()
    await writePlanNumbers(path, { judgeSamples: 0 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ judge: { samples: 0 } })
  })

  it('refuses a field the plan does not declare: adding a judge is structural', async () => {
    const path = join(tmpTree(), 'plan.json')
    writeFileSync(path, '{"schema":"dataseek.plan/1","reps":1}', 'utf8')
    await expect(writePlanNumbers(path, { judgeSamples: 2 })).rejects.toThrow(/structural/)
    await expect(writePlanNumbers(path, { turns: 2 })).rejects.toThrow(/no numeric budget.turns/)
  })

  it('refuses a plan that writes a key twice — which value is meant is ambiguous', async () => {
    const path = join(tmpTree(), 'plan.json')
    writeFileSync(path, '{"reps": 1, "reps": 2}', 'utf8')
    await expect(writePlanNumbers(path, { reps: 3 })).rejects.toThrow(/twice/)
  })
})

describe('service.setPlanNumbers — before and after the start', () => {
  it('writes, reads back and answers with the review of the file as it now is', async () => {
    const { service } = fixture()
    const drafted = await service.draftExperiment(request())
    const before = readFileSync(drafted.planPath, 'utf8')

    const result = await service.setPlanNumbers({ experimentId: drafted.experimentId, reps: 2 })

    expect(result.changes).toEqual([{ field: 'reps', before: 3, after: 2 }])
    expect(result.written).toBe(true)
    expect(result.review.digest.reps).toBe(2)
    // One token changed; every other byte is the draft's.
    expect(readFileSync(drafted.planPath, 'utf8')).toBe(before.replace('"reps": 3', '"reps": 2'))
  })

  it('refuses once the ledger holds a run of the experiment, and writes nothing', async () => {
    const runs: Array<{ id: string; meta: Record<string, unknown> }> = []
    const mission = {
      runList: () => runs.map(run => ({ id: run.id })),
      runStatus: (runId: string) => {
        const run = runs.find(entry => entry.id === runId)!
        return { run: { id: run.id, state: 'active', createdAt: 1, meta: run.meta }, rows: [], buckets: {}, unreleased: [] }
      },
      get: () => ({ mission: { annotations: [] } }),
    }
    const { service } = fixture({ mission })
    const drafted = await service.draftExperiment(request())
    const before = readFileSync(drafted.planPath, 'utf8')
    runs.push({ id: 'run-1', meta: { evalVersion: '0.1.0', experimentId: drafted.experimentId } })

    await expect(service.setPlanNumbers({ experimentId: drafted.experimentId, reps: 2 }))
      .rejects.toThrow(/has started \(run run-1\).*frozen/)
    expect(readFileSync(drafted.planPath, 'utf8')).toBe(before)
  })
})
