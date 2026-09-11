import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { validatePlan } from '../src/validate.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const FIXTURE_DATASET = join(import.meta.dirname, 'fixtures/dataset/datasets/harness-comparison')
const T1_PLAN = join(FIXTURE_DATASET, 'plans/i1-walk.json')
const T1_CONDITION = JSON.parse(
  readFileSync(join(FIXTURE_DATASET, 'conditions/dsh-exec.json'), 'utf8'),
) as Record<string, unknown>

/** A minimal valid plan body the tests mutate. */
function planBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'dataseek.plan/1',
    dataset: { repo: '~/repo', commit: null, id: 'ds', items: ['I1'] },
    conditions: ['c1'],
    reps: 1,
    stages: ['stage1'],
    order: { seed: 1, interleave: false },
    budget: { activeMinutes: 10, turns: 5 },
    expectedNs: ['script'],
    ...overrides,
  }
}

/** A dataset tree with one condition (no lock), so repo-based resolution works. */
function writeRepo(): { root: string; repoPath: string } {
  const dir = tmpTree()
  const repoPath = join(dir, 'repo')
  const dataset = join(repoPath, 'datasets', 'ds')
  writeJson(dataset, 'conditions/c1.json', { ...T1_CONDITION, notes: undefined })
  return { root: dir, repoPath }
}

function codes(list: Array<{ code: string }>): string[] {
  return list.map(d => d.code)
}

describe('validatePlan — the T1 walk examples', () => {
  it('passes with exactly the expected unresolved/not-ready warnings', async () => {
    const report = await validatePlan(T1_PLAN)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    // fixture repo path never exists → plans/-sibling fallback
    expect(report.datasetRoot).toBe(FIXTURE_DATASET)
    // Two unresolved fields since T8b filled harness.version and
    // model.declared from the live instance snapshot.
    expect(codes(report.warnings).sort()).toEqual([
      'COMMIT_UNRESOLVED',
      'LOCK_MISSING',
      'UNRESOLVED_FIELD',
      'UNRESOLVED_FIELD',
    ])
    expect(report.conditions).toEqual([{
      id: 'dsh-exec',
      sha: expect.stringMatching(/^[0-9a-f]{64}$/),
      lock: null,
      status: 'unready',
    }])
  })

  it('resolves the same condition hash as hashing the file directly', async () => {
    const report = await validatePlan(T1_PLAN)
    expect(report.conditions[0]?.sha).toBe(hashConditionDocument(T1_CONDITION))
  })
})

describe('validatePlan — resolution paths', () => {
  it('resolves the dataset root via dataset.repo when it exists', async () => {
    const { root, repoPath } = writeRepo()
    const planPath = writeJson(root, 'elsewhere/plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(report.datasetRoot).toBe(join(repoPath, 'datasets', 'ds'))
    expect(codes(report.warnings)).toContain('LOCK_MISSING')
    expect(report.conditions[0]).toMatchObject({ id: 'c1', status: 'unready', sha: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('falls back to the plans/ sibling when repo is unreachable', async () => {
    const { repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    const planPath = writeJson(dataset, 'plans/plan.json', planBody())
    const report = await validatePlan(planPath)
    expect(report.datasetRoot).toBe(dataset)
    expect(codes(report.warnings)).toContain('LOCK_MISSING')
  })

  it('reports an unresolvable root instead of guessing', async () => {
    const planPath = writeJson(tmpTree(), 'plan.json', planBody())
    const report = await validatePlan(planPath)
    expect(report.ok).toBe(true)
    expect(report.datasetRoot).toBeNull()
    expect(codes(report.warnings)).toContain('DATASET_ROOT_UNRESOLVABLE')
    expect(report.conditions[0]).toMatchObject({ id: 'c1', sha: null, status: 'unready' })
  })
})

describe('validatePlan — lock states', () => {
  it('is ready when the lock matches the fresh hash and the home is verified', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    const homeSha = 'a'.repeat(64)
    const condition = { ...T1_CONDITION, notes: undefined, home: { sha: homeSha } }
    writeJson(dataset, 'conditions/c1.json', condition)
    writeJson(dataset, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1',
      condition: 'c1',
      sha: hashConditionDocument(condition),
      home: { sha: homeSha },
    })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(report.conditions[0]).toMatchObject({ id: 'c1', status: 'ready', lock: { sha: hashConditionDocument(condition), homeSha } })
    expect(codes(report.warnings)).not.toContain('LOCK_MISSING')
  })

  it('warns LOCK_STALE when the declaration changed after locking', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    writeJson(dataset, 'conditions/c1.lock.json', { schema: 'dataseek.condition-lock/1', condition: 'c1', sha: 'b'.repeat(64) })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.warnings)).toContain('LOCK_STALE')
    expect(report.conditions[0]?.status).toBe('unready')
  })

  it('warns HOME_MISMATCH when the locked home differs from the declaration', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    const condition = { ...T1_CONDITION, notes: undefined, home: { sha: 'c'.repeat(64) } }
    writeJson(dataset, 'conditions/c1.json', condition)
    writeJson(dataset, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1',
      condition: 'c1',
      sha: hashConditionDocument(condition),
      home: { sha: 'd'.repeat(64) },
    })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.warnings)).toContain('HOME_MISMATCH')
  })

  it('warns LOCK_MALFORMED for a lock naming another condition', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    writeJson(dataset, 'conditions/c1.lock.json', { schema: 'dataseek.condition-lock/1', condition: 'other', sha: 'b'.repeat(64) })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.warnings)).toContain('LOCK_MALFORMED')
  })
})

describe('validatePlan — retry and exports (protocol §6.4)', () => {
  it('accepts both fields, and accepts a plan that omits them', async () => {
    const withFields = await validatePlan(writeJson(tmpTree(), 'plan.json', planBody({
      retry: { infrastructure: 0 }, exports: '~/dataseek/exports',
    })))
    expect(codes(withFields.errors)).toEqual([])
    const without = await validatePlan(writeJson(tmpTree(), 'plan.json', planBody()))
    expect(codes(without.errors)).toEqual([])
  })

  it('refuses an unknown retry key (the plan schema is closed)', async () => {
    const report = await validatePlan(writeJson(tmpTree(), 'plan.json', planBody({ retry: { infrastructure: 1, submission: 2 } })))
    expect(report.ok).toBe(false)
    expect(codes(report.errors)).toContain('PLAN_SCHEMA')
  })
})

describe('validatePlan — the provisioned record (T31)', () => {
  /** A repo whose condition IS locked and provisioned, with the given effective snapshot. */
  function lockedRepo(effective: Record<string, unknown>, condition: Record<string, unknown> = {}): { repoPath: string; planPath: string } {
    const dir = tmpTree()
    const repoPath = join(dir, 'repo')
    const dataset = join(repoPath, 'datasets', 'ds')
    const document = { ...T1_CONDITION, ...condition, home: { sha: 'c'.repeat(64) } }
    writeJson(dataset, 'conditions/c1.json', document)
    writeJson(dataset, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1',
      condition: 'c1',
      sha: hashConditionDocument(document),
      home: { sha: 'c'.repeat(64) },
      provisioned: { at: 1, cliVersion: null, effective },
    })
    const planPath = writeJson(dir, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    return { repoPath, planPath }
  }

  const AGREEING = {
    model: (T1_CONDITION['model'] as { declared: string | null }).declared,
    reasoningEffort: (T1_CONDITION['reasoning'] as { effort: string }).effort,
    permissions: T1_CONDITION['permissions'],
    endpoint: (T1_CONDITION['model'] as { endpoint: string | null }).endpoint,
  }

  it('calls a condition ready when the lock, the home and the provisioned record all agree', async () => {
    const report = await validatePlan(lockedRepo(AGREEING).planPath)
    expect(report.conditions[0]?.status).toBe('ready')
    expect(report.conditions[0]?.lock?.provisioned?.effective).toEqual(AGREEING)
    expect(codes(report.warnings)).not.toContain('PROVISION_MISMATCH')
  })

  it('calls it UNREADY and names the field when the lock records other permissions', async () => {
    const report = await validatePlan(lockedRepo({ ...AGREEING, permissions: 'read-only' }).planPath)
    expect(report.conditions[0]?.status).toBe('unready')
    const mismatch = report.warnings.find(w => w.code === 'PROVISION_MISMATCH')
    expect(mismatch?.message).toContain('permissions')
    expect(mismatch?.message).toContain('conditions provision')
  })

  it('calls it UNREADY when the lock records another endpoint', async () => {
    const report = await validatePlan(lockedRepo({ ...AGREEING, endpoint: 'elsewhere.example' }, {
      model: { declared: null, endpoint: 'api.example' },
    }).planPath)
    expect(report.conditions[0]?.status).toBe('unready')
    expect(report.warnings.find(w => w.code === 'PROVISION_MISMATCH')?.message).toContain('model.endpoint')
  })

  it('leaves it ready when only a warn-grade field differs — a declared model may differ from the harness default (T30b)', async () => {
    const report = await validatePlan(lockedRepo({ ...AGREEING, model: 'some-other-default', reasoningEffort: 'high' }).planPath)
    expect(report.conditions[0]?.status).toBe('ready')
    expect(codes(report.warnings)).not.toContain('PROVISION_MISMATCH')
  })

  it('refuses a half-written provisioned block as a malformed lock, not as a partial truth', async () => {
    // The lock schema closes `provisioned.effective`: all four fields or none.
    const report = await validatePlan(lockedRepo({ permissions: 'unrestricted' } as Record<string, unknown>).planPath)
    expect(report.conditions[0]?.status).toBe('unready')
    expect(report.conditions[0]?.lock?.provisioned).toBeUndefined()
    expect(codes(report.warnings)).toContain('LOCK_MALFORMED')
  })

  it('warns that a lock without a provisioned record was never checked against a scope', async () => {
    const dir = tmpTree()
    const repoPath = join(dir, 'repo')
    const dataset = join(repoPath, 'datasets', 'ds')
    const document = { ...T1_CONDITION }
    writeJson(dataset, 'conditions/c1.json', document)
    writeJson(dataset, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1', condition: 'c1', sha: hashConditionDocument(document),
    })
    const planPath = writeJson(dir, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(report.warnings.find(w => w.code === 'PROVISION_RECORD_MISSING')?.message).toContain('conditions provision')
  })
})

describe('validatePlan — the judge is resolved too (T31)', () => {
  function repoWithJudge(judge: Record<string, unknown>): string {
    const dir = tmpTree()
    const repoPath = join(dir, 'repo')
    const dataset = join(repoPath, 'datasets', 'ds')
    writeJson(dataset, 'conditions/c1.json', { ...T1_CONDITION })
    writeJson(dataset, 'conditions/j1.json', judge)
    return writeJson(dir, 'plan.json', planBody({
      dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] },
      judge: { conditions: ['j1'], samples: 2 },
      expectedNs: ['script', 'llm-draft'],
    }))
  }

  it('errors when the judge pins no model — self-judgement would be undecidable', async () => {
    const report = await validatePlan(repoWithJudge({ ...T1_CONDITION, model: { declared: null, endpoint: null } }))
    expect(report.ok).toBe(false)
    expect(codes(report.errors)).toContain('JUDGE_MODEL_UNDECLARED')
  })

  it('accepts a judge that pins a model, and reports it OFF the players list', async () => {
    const report = await validatePlan(repoWithJudge({ ...T1_CONDITION, model: { declared: 'judge-model', endpoint: null } }))
    expect(codes(report.errors)).toEqual([])
    expect(report.conditions.map(c => c.id)).toEqual(['c1'])
    expect(report.judges.map(c => c.id)).toEqual(['j1'])
  })

  it('accepts a judge declaring the SAME model as a player — decision 9, relaxed', async () => {
    const declared = (T1_CONDITION['model'] as { declared: string | null }).declared
    const report = await validatePlan(repoWithJudge({ ...T1_CONDITION, model: { declared, endpoint: null } }))
    expect(codes(report.errors)).toEqual([])
  })
})

describe('validatePlan — contract errors', () => {
  it.each([
    ['judge absent + llm-draft expected', { expectedNs: ['script', 'llm-draft'] }, 'JUDGE_REQUIRED_FOR_LLM_DRAFT'],
    ['judge id is also a player id', { judge: { conditions: ['c1'], samples: 2 } }, 'JUDGE_IS_SAME_CONDITION'],
    ['judge listed twice', { judge: { conditions: ['j1', 'j1'], samples: 2 } }, 'JUDGE_DUPLICATED'],
    ['judge with samples but no condition', { judge: { conditions: [], samples: 2 } }, 'JUDGE_INCOMPLETE'],
    ['reps below one', { reps: 0 }, 'REPS_INVALID'],
    ['budget below one', { budget: { activeMinutes: 0, turns: 5 } }, 'BUDGET_INVALID'],
    ['empty conditions', { conditions: [] }, 'CONDITIONS_EMPTY'],
    ['duplicated conditions', { conditions: ['c1', 'c1'] }, 'CONDITIONS_DUPLICATED'],
    ['empty items', { dataset: { repo: '~/repo', commit: null, id: 'ds', items: [] } }, 'ITEMS_EMPTY'],
    ['empty expectedNs', { expectedNs: [] }, 'EXPECTED_NS_EMPTY'],
    ['negative retry budget', { retry: { infrastructure: -1 } }, 'RETRY_INVALID'],
    ['fractional retry budget', { retry: { infrastructure: 1.5 } }, 'RETRY_INVALID'],
    ['blank exports path', { exports: '   ' }, 'EXPORTS_INVALID'],
  ])('errors on %s', async (_label, overrides, code) => {
    const planPath = writeJson(tmpTree(), 'plan.json', planBody(overrides))
    const report = await validatePlan(planPath)
    expect(report.ok).toBe(false)
    expect(codes(report.errors)).toContain(code)
  })

  it('errors on a referenced condition with a schema violation', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    writeJson(dataset, 'conditions/c1.json', { ...T1_CONDITION, permissions: 'yolo' })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.errors)).toContain('CONDITION_SCHEMA')
    expect(report.conditions[0]?.status).toBe('missing')
  })

  it('errors on a stage schema outside the supported subset', async () => {
    const { root, repoPath } = writeRepo()
    const dataset = join(repoPath, 'datasets', 'ds')
    writeJson(dataset, 'schemas/stage1.json', { type: 'object', minItems: 1 })
    const planPath = writeJson(root, 'plan.json', planBody({ dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.errors)).toContain('STAGE_SCHEMA_UNSUPPORTED')
  })

  it('warns on a missing stage schema', async () => {
    const { root, repoPath } = writeRepo()
    const planPath = writeJson(root, 'plan.json', planBody({ stages: ['absent-stage'], dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] } }))
    const report = await validatePlan(planPath)
    expect(codes(report.warnings)).toContain('STAGE_SCHEMA_MISSING')
  })

  it('errors on unreadable or malformed plan files', async () => {
    const missing = await validatePlan(join(tmpTree(), 'nope.json'))
    expect(missing.ok).toBe(false)
    expect(codes(missing.errors)).toEqual(['PLAN_UNREADABLE'])

    const dir = tmpTree()
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not json')
    const malformed = await validatePlan(path)
    expect(codes(malformed.errors)).toEqual(['PLAN_MALFORMED'])
  })
})

// --- expectedNs × the item's actual verdict sources (pilot A · G6) -------------

/** A repo whose item ships whatever verify/grading files the test names. */
function writeRepoWithItem(files: Record<string, string>): string {
  const dir = tmpTree()
  const repoPath = join(dir, 'repo')
  const dataset = join(repoPath, 'datasets', 'ds')
  writeJson(dataset, 'conditions/c1.json', { ...T1_CONDITION, notes: undefined })
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dataset, 'items', 'I1', rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  return repoPath
}

const RUBRIC_WITH_LEAVES = `schema: dataseek.rubric/2
items:
  - id: A1-1
    kind: llm-draft
    criterion: 设计里给出了会话事件的投影路径
    evidence: stage1.json 的 design_decisions
`
const RUBRIC_AXES_ONLY = `schema: dataseek.rubric/2
axes:
  - id: A
    title: 设计质量
items:
  - id: A1-1
    kind: objective
    criterion: 产出了 stage1.json
`

async function validateAgainst(repoPath: string, expectedNs: string[]): Promise<{ codes: string[]; messages: string[] }> {
  const planPath = writeJson(repoPath, 'datasets/ds/plans/p.json', planBody({
    dataset: { repo: repoPath, commit: null, id: 'ds', items: ['I1'] },
    expectedNs,
  }))
  const report = await validatePlan(planPath)
  return { codes: codes(report.warnings), messages: report.warnings.map(w => w.message) }
}

describe('validatePlan — expectedNs against what the item can actually produce', () => {
  it('warns when script is expected but the item ships no executable probe', async () => {
    // Exactly pilot A's F3: a probes/ directory holding only prose.
    const repo = writeRepoWithItem({
      'verify/probes/README.md': '# 手工观察，不是探针\n',
      'verify/probes/manual-observation.md': '见 rubric.md\n',
      'grading/rubric.yml': RUBRIC_WITH_LEAVES,
    })
    const { codes: warnings, messages } = await validateAgainst(repo, ['script'])
    expect(warnings).toContain('EXPECTED_NS_NO_PROBE')
    expect(messages.join('\n')).toContain('item I1 ships no executable probe')
  })

  it('accepts an item that ships a real probe', async () => {
    const repo = writeRepoWithItem({
      'verify/probes/check.mjs': '#!/usr/bin/env node\n',
      'grading/rubric.yml': RUBRIC_WITH_LEAVES,
    })
    const { codes: warnings } = await validateAgainst(repo, ['script'])
    expect(warnings).not.toContain('EXPECTED_NS_NO_PROBE')
  })

  it('warns when llm-draft is expected but the rubric has no llm-draft leaf', async () => {
    // Exactly pilot A's F3 rubric before the fix: axes, no judgeable leaves.
    const repo = writeRepoWithItem({
      'verify/probes/check.mjs': '#!/usr/bin/env node\n',
      'grading/rubric.yml': RUBRIC_AXES_ONLY,
    })
    const { codes: warnings, messages } = await validateAgainst(repo, ['llm-draft'])
    expect(warnings).toContain('EXPECTED_NS_NO_LLM_DRAFT_CRITERIA')
    expect(messages.join('\n')).toContain('no kind: llm-draft leaf')
  })

  it('warns when llm-draft is expected but the item ships no rubric at all', async () => {
    const repo = writeRepoWithItem({ 'verify/probes/check.mjs': '#!/usr/bin/env node\n' })
    const { codes: warnings } = await validateAgainst(repo, ['llm-draft'])
    expect(warnings).toContain('EXPECTED_NS_NO_RUBRIC')
  })

  it('reports an unparseable rubric rather than pretending it has no leaves', async () => {
    const repo = writeRepoWithItem({ 'grading/rubric.yml': 'items:\n  - id: [unclosed\n' })
    const { codes: warnings } = await validateAgainst(repo, ['llm-draft'])
    expect(warnings).toContain('EXPECTED_NS_RUBRIC_UNPARSEABLE')
  })

  it('is a WARNING, never an error: the plan still validates', async () => {
    const repo = writeRepoWithItem({ 'grading/rubric.yml': RUBRIC_AXES_ONLY })
    writeJson(repo, 'datasets/ds/conditions/j1.json', { ...T1_CONDITION, notes: undefined, model: { declared: 'other-model', endpoint: null } })
    const planPath = writeJson(repo, 'datasets/ds/plans/p.json', planBody({
      dataset: { repo, commit: null, id: 'ds', items: ['I1'] },
      expectedNs: ['script', 'llm-draft'],
      judge: { conditions: ['j1'], samples: 2 },
    }))
    const report = await validatePlan(planPath)
    expect(report.ok).toBe(true)
    expect(codes(report.errors)).toEqual([])
    expect(codes(report.warnings)).toEqual(expect.arrayContaining(['EXPECTED_NS_NO_PROBE', 'EXPECTED_NS_NO_LLM_DRAFT_CRITERIA']))
  })

  it('says nothing about human-final, and nothing when the item directory is not there', async () => {
    const repo = writeRepoWithItem({})
    const { codes: warnings } = await validateAgainst(repo, ['human-final'])
    expect(warnings).not.toContain('EXPECTED_NS_NO_PROBE')
    expect(warnings).not.toContain('EXPECTED_NS_NO_RUBRIC')
    // No items/I1 tree at all: the conventional layout is absent, so the
    // check stays silent rather than guessing at a re-homed one (T26 owns
    // the dataset-side rules).
    const bare = writeRepo()
    const barePlan = writeJson(bare.repoPath, 'datasets/ds/plans/p.json', planBody({
      dataset: { repo: bare.repoPath, commit: null, id: 'ds', items: ['I1'] },
      expectedNs: ['script', 'llm-draft'],
    }))
    const report = await validatePlan(barePlan)
    expect(codes(report.warnings)).not.toContain('EXPECTED_NS_NO_PROBE')
  })
})
