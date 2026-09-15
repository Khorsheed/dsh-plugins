/**
 * DRAFTING an experiment (I5·T34) — the service verb the 新建实验 form, the
 * `eval_plan_draft` tool and the `eval-planning` skill all reach.
 *
 * Four things are pinned here, and each is a promise one of the three faces
 * makes to a person:
 *
 * 1. WHERE the files land — `plans/<name>.json` and `conditions/<id>.json` in
 *    the bound repository's working copy, and nowhere else.
 * 2. That a minted condition is a COPY that changes ONLY the named fields.
 *    That discipline is what makes a comparison answerable; a drafting verb
 *    that quietly rewrote a seventh field would break the experiment without
 *    breaking anything a reader could see.
 * 3. That validate's verdict comes back VERBATIM — the same projection the
 *    plan-review page renders, not a softened summary. A draft with errors is
 *    still a draft, and it still lands.
 * 4. That drafting never starts anything: no path from this verb reaches
 *    `runStart`, and the refusals are only the cases where there would be no
 *    draft to look at.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalDraftRefused } from '../src/draft.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

/** A real 64-hex sha — `home.sha` is format-checked, and 'h' is not hex. */
const HOME_SHA = 'ab'.repeat(32)

const DSH_EXEC = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.5', drive: 'exec' },
  model: { declared: 'deepseek-v4-flash', endpoint: null },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: HOME_SHA },
  env: { keys: ['DEEPSEEK_API_KEY'] },
  notes: 'the original, whose commentary is about the original',
} as const

const STAGE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['done'],
  properties: { done: { type: 'boolean' } },
}

/** A dataset repository with one set, two items, one condition and one stage. */
function fixtureRepo(): { repo: string; dataset: string } {
  const repo = join(tmpTree(), 'repo')
  const dataset = join(repo, 'datasets', 'ds')
  writeJson(dataset, 'conditions/dsh-exec.json', DSH_EXEC)
  writeJson(dataset, 'conditions/dsh-exec.lock.json', {
    schema: 'dataseek.condition-lock/1',
    condition: 'dsh-exec',
    sha: hashConditionDocument(DSH_EXEC),
    home: { sha: HOME_SHA },
  })
  writeJson(dataset, 'schemas/stage1.json', STAGE_SCHEMA)
  writeJson(dataset, 'items/P0/item.json', { id: 'P0' })
  writeJson(dataset, 'items/P1/item.json', { id: 'P1' })
  return { repo, dataset }
}

/** The request every test starts from; each overrides what it is about. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    name: 'i5-walk',
    dataset: 'ds',
    items: ['P0'],
    conditions: ['dsh-exec'],
    reps: 1,
    stages: ['stage1'],
    seed: 20260916,
    activeMinutes: 60,
    turns: 10,
    ...overrides,
  } as Parameters<EvalService['draftExperiment']>[0]
}

/** Read one JSON document the draft wrote. */
function read(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('draftExperiment — where the files land', () => {
  it('writes the plan into the set\'s plans/ directory and answers with the path', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({ repo }))

    expect(result.planPath).toBe(join(repo, 'datasets', 'ds', 'plans', 'i5-walk.json'))
    expect(result.conditionPaths).toEqual([])
    expect(result.conditions).toEqual(['dsh-exec'])
    const plan = read(result.planPath)
    expect(plan['schema']).toBe('dataseek.plan/1')
    expect(plan['dataset']).toEqual({ repo: expect.any(String), commit: null, id: 'ds', items: ['P0'] })
    expect(plan['order']).toEqual({ seed: 20260916, interleave: true })
    expect(plan['budget']).toEqual({ activeMinutes: 60, turns: 10 })
    // NOT all three: this plan has no judge, so it cannot produce llm-draft
    // verdicts and does not claim it will. `human-final` stays — a person can
    // always grade at the judge bench.
    expect(plan['expectedNs']).toEqual(['script', 'human-final'])
  })

  it('writes no judge block when no judge is named, and does not claim a source nothing can produce', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({ repo }))

    // Both halves of the same honesty. An EMPTY judge block — which every
    // hand-written plan in the repository carries — would count as a judge to
    // validate and switch the check off; declaring llm-draft without one is an
    // ERROR, so the draft declares what this run can actually produce and the
    // plan passes.
    expect(read(result.planPath)).not.toHaveProperty('judge')
    expect(result.review.checks.map(check => check.code)).not.toContain('JUDGE_REQUIRED_FOR_LLM_DRAFT')
    expect(result.review.ok).toBe(true)
  })

  it('declares llm-draft once a judge is named', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({ repo, judgeConditions: ['judge-x'] }))

    expect(read(result.planPath)['expectedNs']).toEqual(['script', 'llm-draft', 'human-final'])
  })

  it('writes the judge block, the unit and the retry budget when they are asked for', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({
      repo,
      judgeConditions: ['judge-x'],
      judgeSamples: 2,
      retryInfrastructure: 0,
      unit: { image: 'bench:1', network: 'sealed', egressCommand: ['curl', '-sf', 'https://proxy/'] },
      notes: 'what this cannot settle',
    }))

    const plan = read(result.planPath)
    expect(plan['judge']).toEqual({ conditions: ['judge-x'], samples: 2 })
    expect(plan['retry']).toEqual({ infrastructure: 0 })
    expect(plan['unit']).toEqual({ image: 'bench:1', network: 'sealed', egressCheck: { command: ['curl', '-sf', 'https://proxy/'] } })
    expect(plan['notes']).toBe('what this cannot settle')
    expect(result.judges).toEqual(['judge-x'])
  })

  it('nothing is committed — the repository is a working copy and the draft only writes files', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()
    await service.draftExperiment(request({ repo }))
    // There is no git in this fixture at all: a draft that needed one would
    // have thrown rather than landed.
    expect(read(join(repo, 'datasets', 'ds', 'plans', 'i5-walk.json'))['schema']).toBe('dataseek.plan/1')
  })
})

describe('draftExperiment — a new condition is a copy', () => {
  it('changes ONLY the named field, carrying everything else over byte for byte', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({
      repo,
      conditions: ['dsh-exec', 'dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    expect(result.conditionPaths).toEqual([join(repo, 'datasets', 'ds', 'conditions', 'dsh-exec-pro.json')])
    const minted = read(result.conditionPaths[0] as string)
    expect(minted['model']).toEqual({ declared: 'deepseek-v4-pro', endpoint: null })
    // Everything the edit did not name is the original's, unchanged.
    expect(minted['harness']).toEqual(DSH_EXEC.harness)
    expect(minted['reasoning']).toEqual(DSH_EXEC.reasoning)
    expect(minted['permissions']).toBe('unrestricted')
    expect(minted['instructions']).toBe('none')
    expect(minted['preset']).toBeNull()
    expect(minted['skills']).toEqual({ pack: null })
    expect(minted['env']).toEqual({ keys: ['DEEPSEEK_API_KEY'] })
    // The two that MUST move: the copied home hash would claim a provision
    // that never happened, and the copied notes are about the original.
    expect(minted['home']).toEqual({ sha: null })
    expect(minted['notes']).toContain('copied from condition "dsh-exec"')
    expect(minted['notes']).toContain('model.declared')
    // And the copy is a DIFFERENT subject — which is the whole point.
    expect(hashConditionDocument(minted)).not.toBe(hashConditionDocument(DSH_EXEC))
  })

  it('nulls harness.version when the harness changes — that version was the other CLI\'s', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({
      repo,
      conditions: ['codex-exec'],
      newConditions: [{ id: 'codex-exec', from: 'dsh-exec', harness: 'codex', permissions: 'workspace-write' }],
    }))

    const minted = read(result.conditionPaths[0] as string)
    expect(minted['harness']).toEqual({ name: 'codex', version: null, drive: 'exec' })
    expect(minted['permissions']).toBe('workspace-write')
  })

  it('clearing scope REMOVES the key rather than writing a null the contract has no slot for', async () => {
    const { repo } = fixtureRepo()
    writeJson(join(repo, 'datasets', 'ds'), 'conditions/scoped.json', { ...DSH_EXEC, scope: 'eval-b' })
    const service = new EvalService()

    const result = await service.draftExperiment(request({
      repo,
      conditions: ['unscoped'],
      newConditions: [{ id: 'unscoped', from: 'scoped', scope: null }],
    }))

    expect(read(result.conditionPaths[0] as string)).not.toHaveProperty('scope')
  })

  it('appends a minted condition the caller forgot to name in `conditions`', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({
      repo,
      conditions: ['dsh-exec'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    expect(result.conditions).toEqual(['dsh-exec', 'dsh-exec-pro'])
    expect(read(result.planPath)['conditions']).toEqual(['dsh-exec', 'dsh-exec-pro'])
  })

  it('refuses a copy that changes nothing — the same subject under a second name', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({
      repo,
      conditions: ['twin'],
      newConditions: [{ id: 'twin', from: 'dsh-exec' }],
    }))).rejects.toThrow(EvalDraftRefused)
    // And nothing landed: the plan is not written before its conditions are.
    await expect(service.draftExperiment(request({ repo }))).resolves.toBeDefined()
  })

  it('refuses a copy of a condition that does not exist, naming the file it looked for', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({
      repo,
      conditions: ['x'],
      newConditions: [{ id: 'x', from: 'nobody', model: 'm' }],
    }))).rejects.toThrow(/nobody\.json cannot be read/)
  })
})

describe('draftExperiment — validate comes back verbatim', () => {
  it('answers with exactly the plan-review page\'s own projection', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    const result = await service.draftExperiment(request({ repo }))

    // Not a summary of validate, and not a second validate with different
    // calibration: the same function, so the sentence an agent reports and the
    // list the person then reads on the page cannot disagree.
    expect(result.review).toEqual(await service.planReview(result.planPath))
  })

  it('a plan validate REJECTS still lands on disk, as a draft with its errors named', async () => {
    const { repo } = fixtureRepo()
    // A declaration that violates the contract: `drive` is `exec` and nothing
    // else (frozen decision 2).
    writeJson(join(repo, 'datasets', 'ds'), 'conditions/broken.json', {
      ...DSH_EXEC, harness: { ...DSH_EXEC.harness, drive: 'live' },
    })
    const service = new EvalService()

    const result = await service.draftExperiment(request({ repo, conditions: ['broken'] }))

    expect(result.review.ok).toBe(false)
    expect(result.review.errors).toBeGreaterThan(0)
    // Written anyway. Refusing to save would leave the person with nothing to
    // look at and nothing to fix.
    expect(read(result.planPath)['conditions']).toEqual(['broken'])
  })
})

describe('draftExperiment — the refusals, and the one thing it never does', () => {
  it('never reaches runStart', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()
    const runStart = vi.spyOn(service, 'runStart')

    await service.draftExperiment(request({ repo }))

    expect(runStart).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a plan that already exists', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()
    await service.draftExperiment(request({ repo }))

    await expect(service.draftExperiment(request({ repo }))).rejects.toThrow(/already exists/)
  })

  it('refuses to overwrite a condition that already exists — it may be locked', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({
      repo,
      name: 'other',
      conditions: ['dsh-exec'],
      newConditions: [{ id: 'dsh-exec', from: 'dsh-exec', model: 'something-else' }],
    }))).rejects.toThrow(/already exists/)
  })

  it('refuses a name that would land as a generated template and never appear in the list', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({ repo, name: 'i5-walk.template' })))
      .rejects.toThrow(/\.template/)
  })

  it('refuses an item the set does not declare, and says what it does hold', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({ repo, items: ['P0', 'P9'] })))
      .rejects.toThrow(/"P9".*P0, P1/s)
  })

  it('refuses a dataset set the repository does not hold', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService()

    await expect(service.draftExperiment(request({ repo, dataset: 'nope' })))
      .rejects.toThrow(/no dataset set "nope"/)
  })

  it('refuses when no repository can be resolved — no repo argument and no session binding', async () => {
    const service = new EvalService()
    await expect(service.draftExperiment(request())).rejects.toThrow(/no dataset repository/)
  })

  it('honours the session binding\'s dataset whitelist', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService({
      get: (name: string) => (name === 'datasets'
        ? { binding: () => ({ repoPath: repo, datasets: ['other-set'] }) }
        : undefined),
    })

    await expect(service.draftExperiment(request(), { session: { id: 's1' } }))
      .rejects.toThrow(/outside this session's binding/)
  })

  it('drafts into the session\'s bound repository when no repo is passed', async () => {
    const { repo } = fixtureRepo()
    const service = new EvalService({
      get: (name: string) => (name === 'datasets' ? { binding: () => ({ repoPath: repo }) } : undefined),
    })

    const result = await service.draftExperiment(request(), { session: { id: 's1' } })

    expect(result.planPath).toBe(join(repo, 'datasets', 'ds', 'plans', 'i5-walk.json'))
  })
})

describe('draftOptions — what the form may offer', () => {
  it('lists each set with its items and its stage schemas, and never calls run-meta a stage', async () => {
    const { repo } = fixtureRepo()
    writeJson(join(repo, 'datasets', 'ds'), 'schemas/run-meta.json', STAGE_SCHEMA)
    writeJson(join(repo, 'datasets', 'ds'), 'schemas/stage2.json', STAGE_SCHEMA)
    const service = new EvalService()

    const view = await service.draftOptions({ repo })

    expect(view.datasets).toEqual([{ id: 'ds', items: ['P0', 'P1'], stages: ['stage1', 'stage2'] }])
  })

  it('degrades with a sentence rather than refusing when the path is not a dataset repository', async () => {
    const service = new EvalService()

    const view = await service.draftOptions({ repo: tmpTree() })

    expect(view.datasets).toEqual([])
    expect(view.notes.join(' ')).toContain('holds no datasets/ directory')
  })
})
