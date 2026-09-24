/**
 * DRAFTING an experiment (I5·T34) — the service verb the 新建实验 form, the
 * `eval_plan_draft` tool and the `eval-planning` skill all reach.
 *
 * Four things are pinned here, and each is a promise one of the three faces
 * makes to a person:
 *
 * 1. WHERE the files land — `experiments/<expId>/{plan,meta}.json` and
 *    `conditions/<id>.json` under the deployment's eval state root, and
 *    nowhere else; the dataset repository is read-only input (T73).
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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalDraftRefused } from '../src/draft.ts'
import { DatasetVersionRefused } from '../src/dataset-version.ts'
import { createExperiment } from '../src/experiment-store.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, fakeRegistry, hostsWith, tmpTree, useDshHome, writeJson } from './helpers.ts'

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

const LATEST = 'c'.repeat(40)

/**
 * A deployment with one registered dataset set (two items, one stage) and a
 * condition library holding one condition, drafting through a fake registry.
 */
function fixture(registry: Partial<Parameters<typeof fakeRegistry>[0]> = {}) {
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
  writeJson(dataset, 'schemas/stage1.json', STAGE_SCHEMA)
  writeJson(dataset, 'items/P0/item.json', { id: 'P0' })
  writeJson(dataset, 'items/P1/item.json', { id: 'P1' })
  const face = fakeRegistry({ latest: LATEST, ...registry, sets: { ds: dataset, ...registry.sets } })
  return { stateRoot, dataset, library, face, service: new EvalService(hostsWith(face)) }
}

/** The request every test starts from; each overrides what it is about. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    name: 'i5-walk',
    dataset: 'reg/ds',
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
  it('writes the experiment directory under the state root and answers with its id and paths', async () => {
    const { service, stateRoot } = fixture()

    const result = await service.draftExperiment(request())

    expect(result.experimentId).toMatch(/^i5-walk-\d{8}-[0-9a-f]{4}$/)
    expect(result.planPath).toBe(join(stateRoot, 'experiments', result.experimentId, 'plan.json'))
    expect(result.dataset).toEqual({ registry: 'reg', set: 'ds', commit: LATEST })
    expect(result.conditionPaths).toEqual([])
    expect(result.conditions).toEqual(['dsh-exec'])
    const plan = read(result.planPath)
    expect(plan['schema']).toBe('dataseek.plan/1')
    expect(plan['dataset']).toEqual({ registry: 'reg', set: 'ds', commit: LATEST, items: ['P0'] })
    expect(plan['order']).toEqual({ seed: 20260916, interleave: true })
    expect(plan['budget']).toEqual({ activeMinutes: 60, turns: 10 })
    // NOT all three: this plan has no judge, so it cannot produce llm-draft
    // verdicts and does not claim it will. `human-final` stays — a person can
    // always grade at the judge bench.
    expect(plan['expectedNs']).toEqual(['script', 'human-final'])
  })

  it('writes no judge block when no judge is named, and does not claim a source nothing can produce', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request())

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
    const { service } = fixture()

    const result = await service.draftExperiment(request({ judgeConditions: ['judge-x'] }))

    expect(read(result.planPath)['expectedNs']).toEqual(['script', 'llm-draft', 'human-final'])
  })

  it('writes the judge block, the unit and the retry budget when they are asked for', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
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

  it('writes meta.json with the pin and the origin session, plus empty analysis/ and exports/', async () => {
    const { service, stateRoot } = fixture()

    const result = await service.draftExperiment(request(), { session: { id: 's1' } })

    const dir = join(stateRoot, 'experiments', result.experimentId)
    expect(read(join(dir, 'meta.json'))).toMatchObject({
      experimentId: result.experimentId,
      name: 'i5-walk',
      originSession: 's1',
      dataset: { registry: 'reg', set: 'ds', commit: LATEST },
    })
    expect(readdirSync(join(dir, 'analysis'))).toEqual([])
    expect(readdirSync(join(dir, 'exports'))).toEqual([])
  })

  it('writes nothing into the dataset view — it is read-only input', async () => {
    const { service, dataset } = fixture()
    const before = readdirSync(dataset).sort()

    await service.draftExperiment(request({
      conditions: ['dsh-exec', 'dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    expect(readdirSync(dataset).sort()).toEqual(before)
  })
})

describe('draftExperiment — a new condition is a copy', () => {
  it('changes ONLY the named field, carrying everything else over byte for byte', async () => {
    const { service, library } = fixture()

    const result = await service.draftExperiment(request({
      conditions: ['dsh-exec', 'dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    expect(result.conditionPaths).toEqual([join(library, 'dsh-exec-pro.json')])
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
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      conditions: ['codex-exec'],
      newConditions: [{ id: 'codex-exec', from: 'dsh-exec', harness: 'codex', permissions: 'workspace-write' }],
    }))

    const minted = read(result.conditionPaths[0] as string)
    expect(minted['harness']).toEqual({ name: 'codex', version: null, drive: 'exec' })
    expect(minted['permissions']).toBe('workspace-write')
  })

  it('clearing scope REMOVES the key rather than writing a null the contract has no slot for', async () => {
    const { service, library } = fixture()
    writeJson(library, 'scoped.json', { ...DSH_EXEC, scope: 'eval-b' })

    const result = await service.draftExperiment(request({
      conditions: ['unscoped'],
      newConditions: [{ id: 'unscoped', from: 'scoped', scope: null }],
    }))

    expect(read(result.conditionPaths[0] as string)).not.toHaveProperty('scope')
  })

  it('appends a minted condition the caller forgot to name in `conditions`', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      conditions: ['dsh-exec'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    expect(result.conditions).toEqual(['dsh-exec', 'dsh-exec-pro'])
    expect(read(result.planPath)['conditions']).toEqual(['dsh-exec', 'dsh-exec-pro'])
  })

  it('refuses a copy that changes nothing — the same subject under a second name', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({
      conditions: ['twin'],
      newConditions: [{ id: 'twin', from: 'dsh-exec' }],
    }))).rejects.toThrow(EvalDraftRefused)
    // And nothing landed: the plan is not written before its conditions are.
    await expect(service.draftExperiment(request())).resolves.toBeDefined()
  })

  it('refuses a copy of a condition that does not exist, naming the file it looked for', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({
      conditions: ['x'],
      newConditions: [{ id: 'x', from: 'nobody', model: 'm' }],
    }))).rejects.toThrow(/nobody\.json cannot be read/)
  })
})

describe('draftExperiment — the container completion (I5·T58 · G4)', () => {
  const UNIT = { image: 'eval-env:pinned', network: 'eval-net', user: '1000' }

  it('fills unit.scopedHome and env.keys from the harness default when the plan runs in a container', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      unit: UNIT,
      conditions: ['dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))

    const minted = read(result.conditionPaths[0] as string)
    // The source predates the container path and has no `unit` segment to
    // copy; the six editable fields cannot express one, so a drafted container
    // condition was unusable until someone hand-edited the JSON.
    expect(minted['unit']).toEqual({ scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } })
    // The variable must also be one the declaration admits to injecting, or
    // the run refuses the pair with UNIT_SCOPED_HOME_VAR_UNDECLARED.
    expect(minted['env']).toEqual({ keys: ['DEEPSEEK_API_KEY', 'DSH_HOME'] })
    // And the copy says what was filled in and why, in the notes a reviewer reads.
    expect(minted['notes']).toContain('/creds/dsh')
  })

  it('completes each harness from its own line of the table', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      unit: UNIT,
      conditions: ['codex-unit'],
      newConditions: [{ id: 'codex-unit', from: 'dsh-exec', harness: 'codex', permissions: 'workspace-write' }],
    }))

    expect(read(result.conditionPaths[0] as string)['unit'])
      .toEqual({ scopedHome: { container: '/creds/codex', var: 'CODEX_HOME' } })
  })

  it('leaves a source that already declares one alone', async () => {
    const { service, library } = fixture()
    writeJson(library, 'dsh-unit.json', {
      ...DSH_EXEC,
      env: { keys: ['DEEPSEEK_API_KEY', 'DSH_HOME'] },
      unit: { scopedHome: { container: '/mnt/creds', var: 'DSH_HOME' } },
    })

    const result = await service.draftExperiment(request({
      unit: UNIT,
      conditions: ['dsh-unit-pro'],
      newConditions: [{ id: 'dsh-unit-pro', from: 'dsh-unit', model: 'deepseek-v4-pro' }],
    }))

    // A copy carries the original's mount point over, default or not — the
    // completion fills a HOLE, it does not normalize anybody's choice.
    expect(read(result.conditionPaths[0] as string)['unit'])
      .toEqual({ scopedHome: { container: '/mnt/creds', var: 'DSH_HOME' } })
  })

  it('fills nothing on the host path, and nothing for a harness the table has no line for', async () => {
    const { service } = fixture()

    const host = await service.draftExperiment(request({
      conditions: ['dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    }))
    expect(read(host.conditionPaths[0] as string)['unit']).toBeUndefined()

    const unknown = await service.draftExperiment(request({
      name: 'other',
      unit: UNIT,
      conditions: ['mystery'],
      newConditions: [{ id: 'mystery', from: 'dsh-exec', harness: 'some-other-cli' }],
    }))
    // Silence rather than a guessed mount point: validate then refuses the
    // pair by name (UNIT_SCOPED_HOME_MISSING), which is a better answer than a
    // credential directory nobody chose.
    expect(read(unknown.conditionPaths[0] as string)['unit']).toBeUndefined()
    expect(unknown.review.checks.find(check => check.code === 'UNIT_SCOPED_HOME_MISSING')?.condition).toBe('mystery')
  })

  it('a copy whose only change is the completion is still refused as changing nothing', async () => {
    const { service } = fixture()

    // The completion is the copy being made runnable where the plan puts it,
    // not a factor its author chose — so it must not satisfy the discipline
    // that a new condition differs from its source.
    await expect(service.draftExperiment(request({
      unit: UNIT,
      conditions: ['twin'],
      newConditions: [{ id: 'twin', from: 'dsh-exec' }],
    }))).rejects.toThrow(EvalDraftRefused)
  })
})

describe('draftExperiment — model.endpoint, the seventh field (I5·T58 · G6)', () => {
  it('sets the endpoint the readiness gate refuses a condition for leaving null', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      conditions: ['dsh-exec-pro'],
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro', endpoint: 'default' }],
    }))

    const minted = read(result.conditionPaths[0] as string)
    expect(minted['model']).toEqual({ declared: 'deepseek-v4-pro', endpoint: 'default' })
    expect(minted['notes']).toContain('model.endpoint')
  })

  it('counts as the one changed field on its own', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request({
      conditions: ['dsh-exec-routed'],
      newConditions: [{ id: 'dsh-exec-routed', from: 'dsh-exec', endpoint: 'https://proxy.internal/v1' }],
    }))

    const minted = read(result.conditionPaths[0] as string)
    expect(minted['model']).toEqual({ declared: 'deepseek-v4-flash', endpoint: 'https://proxy.internal/v1' })
    // Two conditions differing only in where they route ARE two subjects.
    expect(hashConditionDocument(minted)).not.toBe(hashConditionDocument(DSH_EXEC))
  })
})

describe('draftExperiment — validate comes back verbatim', () => {
  it('answers with exactly the plan-review page\'s own projection', async () => {
    const { service } = fixture()

    const result = await service.draftExperiment(request())

    // Not a summary of validate, and not a second validate with different
    // calibration: the same function, so the sentence an agent reports and the
    // list the person then reads on the page cannot disagree.
    expect(result.review).toEqual(await service.planReview({ experimentId: result.experimentId }))
  })

  it('a plan validate REJECTS still lands on disk, as a draft with its errors named', async () => {
    const { service, library } = fixture()
    // A declaration that violates the contract: `drive` is `exec` and nothing
    // else (frozen decision 2).
    writeJson(library, 'broken.json', {
      ...DSH_EXEC, harness: { ...DSH_EXEC.harness, drive: 'live' },
    })

    const result = await service.draftExperiment(request({ conditions: ['broken'] }))

    expect(result.review.ok).toBe(false)
    expect(result.review.errors).toBeGreaterThan(0)
    // Written anyway. Refusing to save would leave the person with nothing to
    // look at and nothing to fix.
    expect(read(result.planPath)['conditions']).toEqual(['broken'])
  })
})

describe('draftExperiment — the refusals, and the one thing it never does', () => {
  it('never reaches runStart', async () => {
    const { service } = fixture()
    const runStart = vi.spyOn(service, 'runStart')

    await service.draftExperiment(request())

    expect(runStart).not.toHaveBeenCalled()
  })

  it('two drafts of one name are two experiments — neither overwrites the other', async () => {
    const { service } = fixture()
    const first = await service.draftExperiment(request())
    const second = await service.draftExperiment(request())

    expect(second.experimentId).not.toBe(first.experimentId)
    expect(read(first.planPath)['name']).toBe('i5-walk')
  })

  it('refuses to overwrite a condition that already exists — it may be locked', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({
      name: 'other',
      conditions: ['dsh-exec'],
      newConditions: [{ id: 'dsh-exec', from: 'dsh-exec', model: 'something-else' }],
    }))).rejects.toThrow(/already exists/)
  })

  it('refuses an item the set does not declare, and says what it does hold', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({ items: ['P0', 'P9'] })))
      .rejects.toThrow(/"P9".*P0, P1/s)
  })

  it('refuses a dataset set the registration does not hold', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({ dataset: 'reg/nope' })))
      .rejects.toThrow(/no dataset set "nope"/)
  })

  it('refuses a registration that is not there', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({ dataset: 'other/ds' })))
      .rejects.toThrow(/no registration "other"/)
  })

  it('refuses a dataset that is not "<registration>/<set>"', async () => {
    const { service } = fixture()

    await expect(service.draftExperiment(request({ dataset: 'ds' })))
      .rejects.toThrow(/<registration id>\/<set>/)
  })

  it('refuses when the composition mounts no registry', async () => {
    useDshHome()
    const service = new EvalService()
    await expect(service.draftExperiment(request())).rejects.toThrow(/no datasets registry/)
  })

  it('refuses when DSH_HOME is unset — there is no state root to write into', async () => {
    const { face } = fixture()
    delete process.env['DSH_HOME']
    await expect(new EvalService(hostsWith(face)).draftExperiment(request())).rejects.toThrow(/set DSH_HOME/)
  })
})

describe('draftOptions — what the form may offer', () => {
  it('lists each registered set at the latest commit with its items and stage schemas, and never calls run-meta a stage', async () => {
    const { service, dataset } = fixture()
    writeJson(dataset, 'schemas/run-meta.json', STAGE_SCHEMA)
    writeJson(dataset, 'schemas/stage2.json', STAGE_SCHEMA)

    const view = await service.draftOptions()

    expect(view.datasets).toEqual([{ id: 'reg/ds', commit: LATEST, items: ['P0', 'P1'], stages: ['stage1', 'stage2'] }])
  })

  it('degrades with a sentence rather than refusing when a set cannot be read', async () => {
    const { face } = fixture()
    const service = new EvalService(hostsWith({
      ...face,
      datasetView: async () => { throw new Error('the object store is gone') },
    }))

    const view = await service.draftOptions()

    expect(view.datasets).toEqual([])
    expect(view.notes.join(' ')).toContain('reg/ds: the object store is gone')
  })
})

describe('draftExperiment — which commit it pins (T73)', () => {
  const OLD = 'f'.repeat(40)

  /** An experiment already pinning `commit` and running `conditions`. */
  async function pinned(stateRoot: string, commit: string, conditions: string[], set = 'ds') {
    return createExperiment(stateRoot, {
      name: 'earlier',
      dataset: { registry: 'reg', set, commit },
      plan: JSON.stringify({ schema: 'dataseek.plan/1', name: 'earlier', conditions }),
    })
  }

  it('pins the latest commit when it is the only candidate', async () => {
    const { service } = fixture()
    const result = await service.draftExperiment(request())
    expect(result.dataset.commit).toBe(LATEST)
  })

  it('pins the latest silently when every candidate holds identical items/ and schemas/', async () => {
    const { service, stateRoot } = fixture({ sets: {}, commits: [OLD] })
    await pinned(stateRoot, OLD, ['dsh-exec'])

    const result = await service.draftExperiment(request())

    expect(result.dataset.commit).toBe(LATEST)
  })

  it('refuses an ambiguous version, lists the candidates, and tells the agent to ask and to stop on a skip', async () => {
    const trees = { [OLD]: { 'datasets/ds/items': 'tree-old' } }
    const { service, stateRoot } = fixture({ sets: {}, commits: [OLD], trees })
    const earlier = await pinned(stateRoot, OLD, ['dsh-exec'])

    const refusal = await service.draftExperiment(request()).then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(DatasetVersionRefused)
    const message = (refusal as Error).message
    expect(message).toMatch(/^version is ambiguous for reg\/ds: /)
    expect(message).toContain(`  - ${LATEST.slice(0, 7)} (latest on the tracked branch, 2026-09-20)`)
    expect(message).toContain(`  - ${OLD.slice(0, 7)} (pinned by ${earlier.id})`)
    expect(message).toContain('ask_user_question')
    expect(message).toContain('If they skip the question, stop — do not pick one yourself.')
    // Nothing landed but the earlier experiment.
    expect(readdirSync(join(stateRoot, 'experiments'))).toEqual([earlier.id])
  })

  it('ignores experiments on another set or sharing no condition', async () => {
    const trees = { [OLD]: { 'datasets/ds/items': 'tree-old' } }
    const { service, stateRoot } = fixture({ sets: {}, commits: [OLD], trees })
    await pinned(stateRoot, OLD, ['someone-else'])
    await pinned(stateRoot, OLD, ['dsh-exec'], 'other-set')

    const result = await service.draftExperiment(request())

    expect(result.dataset.commit).toBe(LATEST)
  })

  it('accepts an explicit commit that is a candidate, short or full', async () => {
    const trees = { [OLD]: { 'datasets/ds/items': 'tree-old' } }
    const { service, stateRoot } = fixture({ sets: {}, commits: [OLD], trees })
    await pinned(stateRoot, OLD, ['dsh-exec'])

    const result = await service.draftExperiment(request({ commit: OLD.slice(0, 7) }))

    expect(result.dataset.commit).toBe(OLD)
    expect(read(result.planPath)['dataset']).toMatchObject({ commit: OLD })
  })

  it('refuses an explicit commit that is no candidate, with the list', async () => {
    const stray = 'e'.repeat(40)
    const { service } = fixture({ sets: {}, commits: [stray] })

    await expect(service.draftExperiment(request({ commit: stray })))
      .rejects.toThrow(new RegExp(`commit "${stray}" is not a candidate version for reg/ds[\\s\\S]*${LATEST.slice(0, 7)}`))
  })
})
