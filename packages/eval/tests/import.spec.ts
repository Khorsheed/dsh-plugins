/**
 * `eval import --from <id>@<ref>` (T73): old in-repo plans become experiments
 * without changing a byte, their conditions join the library, and a condition
 * id that already means something else refuses the whole import before
 * anything is written.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { conditionLibraryDir, experimentsRoot, readExperiment } from '../src/experiment-store.ts'
import { EvalImportRefused, importExperiments, parseImportSource } from '../src/import.ts'
import { cleanupTmp, fakeRegistry, useDshHome } from './helpers.ts'

afterEach(cleanupTmp)

const REF = 'fd04079'.padEnd(40, 'a')
const OWN = 'e0e0e0e'.padEnd(40, 'b')

/** Deliberately odd formatting: the bytes, not the JSON, must survive. */
const PLAN_D = '{\n    "schema": "dataseek.plan/1",   "name": "pilot-d-preset",\n "conditions": ["dsh-exec"],\n "judge": {"conditions": ["judge-a"]}\n}\n'
const PLAN_E = `{"schema":"dataseek.plan/1","name":"pilot-e","dataset":{"commit":"${OWN.slice(0, 7)}"},"conditions":["dsh-exec"]}`
const DSH_EXEC = '{"id":"dsh-exec","harness":{"cli":"dsh"},"model":{"id":"m1"}}\n'
const JUDGE_A = '{"id":"judge-a","harness":{"cli":"dsh"},"model":{"id":"j1"}}\n'

function registry(files: Record<string, string> = {}): ReturnType<typeof fakeRegistry> {
  return fakeRegistry({
    id: 'dataseek-eval',
    sets: { ds: '/home/user/view' },
    commits: [OWN],
    refs: { 'i4-pilot-d': REF },
    files: {
      [REF]: {
        'datasets/ds/plans/pilot-d-preset.json': PLAN_D,
        'datasets/ds/plans/pilot-e.json': PLAN_E,
        'datasets/ds/plans/plan.template.json': '{}',
        'datasets/ds/plans/broken.json': '{nope',
        'datasets/ds/conditions/dsh-exec.json': DSH_EXEC,
        'datasets/ds/conditions/dsh-exec.lock.json': '{"lock":1}\n',
        'datasets/ds/conditions/judge-a.json': JUDGE_A,
        ...files,
      },
    },
  })
}

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

describe('importExperiments', () => {
  it('keeps the plan bytes verbatim — the planSha old runs recorded still matches', async () => {
    const { stateRoot } = useDshHome()
    const report = await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })

    expect(report.refCommit).toBe(REF)
    expect(report.experiments).toHaveLength(1)
    const [imported] = report.experiments
    const record = await readExperiment(stateRoot, imported!.experimentId)
    expect(sha(readFileSync(record.planPath))).toBe(sha(PLAN_D))
    expect(record.meta).toMatchObject({
      name: 'pilot-d-preset',
      dataset: { registry: 'dataseek-eval', set: 'ds', commit: REF },
      source: { from: 'dataseek-eval@i4-pilot-d', path: 'datasets/ds/plans/pilot-d-preset.json' },
    })
    expect(imported!.conditions).toEqual(['dsh-exec', 'judge-a'])
    expect(report.conditionsAdded.sort()).toEqual(['dsh-exec', 'judge-a'])
  })

  it('pins the plan\'s own dataset.commit when it has one, else the ref\'s commit', async () => {
    const { stateRoot } = useDshHome()
    const report = await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d' })
    const byName = Object.fromEntries(report.experiments.map(entry => [entry.name, entry.commit]))
    expect(byName).toEqual({ 'pilot-d-preset': REF, 'pilot-e': OWN })
    expect(report.skipped).toEqual([{ path: 'datasets/ds/plans/broken.json', reason: 'not valid JSON' }])
  })

  it('brings the conditions and their locks into the library byte for byte', async () => {
    const { stateRoot } = useDshHome()
    await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })
    const library = conditionLibraryDir(stateRoot)
    expect(readdirSync(library).sort()).toEqual(['dsh-exec.json', 'dsh-exec.lock.json', 'judge-a.json'])
    expect(readFileSync(join(library, 'dsh-exec.json'), 'utf8')).toBe(DSH_EXEC)
    expect(readFileSync(join(library, 'dsh-exec.lock.json'), 'utf8')).toBe('{"lock":1}\n')
  })

  it('re-importing the same plan at the same commit is a no-op the report names', async () => {
    const { stateRoot } = useDshHome()
    const first = await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })
    const second = await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })
    expect(second.experiments).toEqual([{ ...first.experiments[0], created: false }])
    expect(second.conditionsAdded).toEqual([])
    expect(second.conditionsSame.sort()).toEqual(['dsh-exec', 'judge-a'])
    expect(readdirSync(experimentsRoot(stateRoot))).toHaveLength(1)
  })

  it('treats an identical hash as the same condition even when the bytes are formatted differently', async () => {
    const { stateRoot } = useDshHome()
    const library = conditionLibraryDir(stateRoot)
    mkdirSync(library, { recursive: true })
    const reformatted = JSON.stringify(JSON.parse(DSH_EXEC), null, 4)
    writeFileSync(join(library, 'dsh-exec.json'), reformatted)
    const report = await importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })
    expect(report.conditionsSame).toEqual(['dsh-exec'])
    expect(readFileSync(join(library, 'dsh-exec.json'), 'utf8')).toBe(reformatted)
  })

  it('refuses a same-id, different-content condition with the differences listed, and writes nothing', async () => {
    const { stateRoot } = useDshHome()
    const library = conditionLibraryDir(stateRoot)
    mkdirSync(library, { recursive: true })
    writeFileSync(join(library, 'dsh-exec.json'), '{"id":"dsh-exec","harness":{"cli":"dsh"},"model":{"id":"m2"}}\n')

    const attempt = importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' })
    await expect(attempt).rejects.toBeInstanceOf(EvalImportRefused)
    await expect(importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' }))
      .rejects.toThrow(/condition id conflict[\s\S]*Nothing was imported\.\n {2}- dsh-exec [\s\S]*model\.id: library "m2" ≠ imported "m1"/)
    expect(readdirSync(library)).toEqual(['dsh-exec.json'])
    expect(existsSync(experimentsRoot(stateRoot))).toBe(false)
  })

  it('refuses a plan naming a condition the ref does not hold, before writing anything', async () => {
    const { stateRoot } = useDshHome()
    const face = registry({ 'datasets/ds/plans/orphan.json': '{"schema":"dataseek.plan/1","conditions":["ghost"]}' })
    await expect(importExperiments(face, stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'orphan' }))
      .rejects.toThrow(/names condition ghost, but datasets\/ds\/conditions\/ghost\.json is not at dataseek-eval@i4-pilot-d/)
    expect(existsSync(conditionLibraryDir(stateRoot))).toBe(false)
  })

  it('refuses a plan name the ref does not hold, listing the plans there', async () => {
    const { stateRoot } = useDshHome()
    await expect(importExperiments(registry(), stateRoot, { from: 'dataseek-eval@i4-pilot-d', plan: 'nope' }))
      .rejects.toThrow(/holds no plan named "nope"; plans there:\n {2}- datasets\/ds\/plans\/broken\.json/)
  })

  it('refuses a ref the registration cannot resolve, and a --from without both halves', async () => {
    const { stateRoot } = useDshHome()
    await expect(importExperiments(registry(), stateRoot, { from: 'dataseek-eval@no-such-ref' }))
      .rejects.toThrow(/cannot resolve dataseek-eval@no-such-ref/)
    expect(() => parseImportSource('dataseek-eval')).toThrow(/<registration id>@<ref>/)
    expect(() => parseImportSource('@main')).toThrow(/<registration id>@<ref>/)
    expect(parseImportSource('dataseek-eval@i4-pilot-d')).toEqual({ registry: 'dataseek-eval', ref: 'i4-pilot-d' })
  })
})
