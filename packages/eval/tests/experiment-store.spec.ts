/**
 * The experiment directory (T73): the id rule, the atomic create with its
 * read-back, and a lister that one broken directory cannot empty.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXPERIMENT_ID_RE,
  createExperiment,
  experimentIdOfPlanPath,
  experimentSlug,
  experimentsRoot,
  listExperimentRecords,
  mintExperimentId,
  readExperiment,
} from '../src/experiment-store.ts'
import { cleanupTmp, useDshHome } from './helpers.ts'

afterEach(cleanupTmp)

const DATASET = { registry: 'reg', set: 'ds', commit: 'c'.repeat(40) }

describe('the id rule — <slug>-<yyyymmdd>-<4hex>', () => {
  it('slugs to [a-z0-9-], at most 40 characters, with no dangling dash', () => {
    expect(experimentSlug('Harness Comparison: effort/high')).toBe('harness-comparison-effort-high')
    expect(experimentSlug('评测')).toBe('experiment')
    const long = experimentSlug(`${'a'.repeat(39)} b${'c'.repeat(20)}`)
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long).toMatch(/^[a-z0-9-]+$/)
    expect(long.endsWith('-')).toBe(false)
  })

  it('dates in UTC, so one instant is one date on every machine', () => {
    // 2026-09-24T23:30 UTC is already the 25th east of Greenwich.
    const id = mintExperimentId('pilot-d', Date.UTC(2026, 8, 24, 23, 30))
    expect(id).toMatch(/^pilot-d-20260924-[0-9a-f]{4}$/)
    expect(EXPERIMENT_ID_RE.test(id)).toBe(true)
  })
})

describe('createExperiment', () => {
  it('writes plan.json verbatim, meta.json with the pin, and empty analysis/ and exports/', async () => {
    const { stateRoot } = useDshHome()
    const plan = Buffer.from('{ "schema": "dataseek.plan/1",\n  "odd":   "spacing" }')
    const record = await createExperiment(stateRoot, {
      name: 'pilot-d', originSession: 'sess-1', dataset: DATASET, plan, now: Date.UTC(2026, 8, 24),
    })

    expect(record.dir).toBe(join(experimentsRoot(stateRoot), record.id))
    expect(readFileSync(record.planPath).equals(plan)).toBe(true)
    const meta = JSON.parse(readFileSync(join(record.dir, 'meta.json'), 'utf8')) as Record<string, unknown>
    expect(meta).toMatchObject({
      experimentId: record.id, name: 'pilot-d', originSession: 'sess-1',
      createdAt: '2026-09-24T00:00:00.000Z', dataset: DATASET,
    })
    expect(readdirSync(join(record.dir, 'analysis'))).toEqual([])
    expect(readdirSync(join(record.dir, 'exports'))).toEqual([])
  })

  it('leaves no temp directory behind, and two creates of one name are two experiments', async () => {
    const { stateRoot } = useDshHome()
    const now = Date.UTC(2026, 8, 24)
    const a = await createExperiment(stateRoot, { name: 'same', dataset: DATASET, plan: '{}', now })
    const b = await createExperiment(stateRoot, { name: 'same', dataset: DATASET, plan: '{}', now })
    expect(a.id).not.toBe(b.id)
    expect(readdirSync(experimentsRoot(stateRoot)).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('reading experiments back', () => {
  it('refuses an id that is a path, and names an experiment that is not there', async () => {
    const { stateRoot } = useDshHome()
    await expect(readExperiment(stateRoot, '../conditions')).rejects.toThrow(/is not an experiment id/)
    await expect(readExperiment(stateRoot, 'nope-20260924-0000')).rejects.toThrow(/no experiment "nope-20260924-0000"/)
  })

  it('lists newest first, skips a broken directory and a half-written dot-directory, and names the broken one', async () => {
    const { stateRoot } = useDshHome()
    const older = await createExperiment(stateRoot, { name: 'older', dataset: DATASET, plan: '{}', now: Date.UTC(2026, 8, 20) })
    const newer = await createExperiment(stateRoot, { name: 'newer', dataset: DATASET, plan: '{}', now: Date.UTC(2026, 8, 24) })
    const root = experimentsRoot(stateRoot)
    mkdirSync(join(root, 'broken-20260921-0000'))
    writeFileSync(join(root, 'broken-20260921-0000', 'meta.json'), '{not json')
    mkdirSync(join(root, '.tmp-1-abcd'))

    const { records, problems } = await listExperimentRecords(stateRoot)
    expect(records.map(record => record.id)).toEqual([newer.id, older.id])
    expect(problems).toEqual(['experiment broken-20260921-0000: meta.json is not valid JSON'])
  })

  it('an absent experiments root lists nothing rather than failing', async () => {
    const { stateRoot } = useDshHome()
    await expect(listExperimentRecords(stateRoot)).resolves.toEqual({ records: [], problems: [] })
  })

  it('maps a plan path back to its experiment, and only an experiment\'s own plan.json', async () => {
    const { stateRoot } = useDshHome()
    const record = await createExperiment(stateRoot, { name: 'x', dataset: DATASET, plan: '{}' })
    expect(experimentIdOfPlanPath(stateRoot, record.planPath)).toBe(record.id)
    expect(experimentIdOfPlanPath(stateRoot, join(record.dir, 'analysis', 'plan.json'))).toBeUndefined()
    expect(experimentIdOfPlanPath(stateRoot, '/home/user/repo/datasets/ds/plans/x.json')).toBeUndefined()
  })
})
