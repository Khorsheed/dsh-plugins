/**
 * The narrow write into ONE experiment's `analysis/` (I5·T39 · G16; T73).
 *
 * The gap was never that the agent could not write; it was the SIZE of the
 * grant it took — a sandbox escalated to `danger-full-access` so a model could
 * save one markdown file. The door was then a whitelist inside the bound
 * dataset repository; since T73 the dataset repository is read-only input and
 * the door is one prefix of the experiment directory, `analysis/<path>`. What
 * the tests below pin is that door: analysis/ is writable at any depth,
 * nothing else is, at any spelling, and every refusal names the path and the
 * door.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANALYSIS_WRITE_PREFIX, resolveAnalysisWrite } from '../src/analysis-write.ts'
import { createExperiment } from '../src/experiment-store.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree, useDshHome } from './helpers.ts'

afterEach(cleanupTmp)

/** A deployment with one experiment in it. */
async function experiment(): Promise<{ id: string; dir: string; service: EvalService }> {
  const { stateRoot } = useDshHome()
  const record = await createExperiment(stateRoot, {
    name: 'harness-comparison',
    dataset: { registry: 'reg', set: 'ds', commit: 'c'.repeat(40) },
    plan: '{"schema":"dataseek.plan/1"}\n',
  })
  return { id: record.id, dir: record.dir, service: new EvalService({ get: () => undefined }) }
}

describe('the write door', () => {
  it('takes analysis/ at any depth, normalized to one spelling', async () => {
    const { dir } = await experiment()
    for (const [asked, normalized] of [
      ['analysis/draft.md', 'analysis/draft.md'],
      ['analysis/runs/run-1/notes.md', 'analysis/runs/run-1/notes.md'],
      ['./analysis//draft.md', 'analysis/draft.md'],
    ] as const) {
      await expect(resolveAnalysisWrite(dir, asked)).resolves.toMatchObject({ relativePath: normalized })
    }
  })

  it('never takes anything else in the experiment — the plan, the meta, exports/', async () => {
    const { dir } = await experiment()
    for (const path of ['plan.json', 'meta.json', 'exports/bundle.md', 'analysisx/draft.md', 'analysis', 'analysis/']) {
      await expect(resolveAnalysisWrite(dir, path)).rejects.toThrow(/is not a path this verb may write/)
    }
  })

  it('refuses escapes before it touches the disk, and quotes the door back', async () => {
    const { dir } = await experiment()
    for (const path of ['analysis/../plan.json', '../other/analysis/x.md', '/etc/passwd', '~/x.md', '']) {
      const refusal = resolveAnalysisWrite(dir, path)
      await expect(refusal).rejects.toThrow(/is not a path this verb may write/)
      await expect(resolveAnalysisWrite(dir, path)).rejects.toThrow(ANALYSIS_WRITE_PREFIX)
    }
  })

  it('refuses a directory that leaves analysis/ through a symlink', async () => {
    const { dir } = await experiment()
    const outside = tmpTree()
    symlinkSync(outside, join(dir, 'analysis', 'escape'))
    await expect(resolveAnalysisWrite(dir, 'analysis/escape/x.md')).rejects.toThrow(/symlinked directory/)
  })
})

describe('the service verb', () => {
  it('writes into the experiment and says where to see it', async () => {
    const { id, dir, service } = await experiment()
    const result = await service.writeAnalysis({ experimentId: id, path: 'analysis/notes/draft.md', content: '# 初稿\n' })

    expect(result).toMatchObject({
      experimentId: id,
      relativePath: 'analysis/notes/draft.md',
      created: true,
      bytes: Buffer.byteLength('# 初稿\n'),
    })
    expect(readFileSync(join(dir, 'analysis', 'notes', 'draft.md'), 'utf8')).toBe('# 初稿\n')
    expect(result.confirmation).toContain(id)
    expect(result.confirmation).toContain('在结果对比页可看')
  })

  it('never silently replaces a file — a revision is said out loud', async () => {
    const { id, dir, service } = await experiment()
    await service.writeAnalysis({ experimentId: id, path: 'analysis/draft.md', content: 'one' })

    await expect(service.writeAnalysis({ experimentId: id, path: 'analysis/draft.md', content: 'two' }))
      .rejects.toThrow(/already exists .* pass overwrite/)
    expect(readFileSync(join(dir, 'analysis', 'draft.md'), 'utf8')).toBe('one')

    const revised = await service.writeAnalysis({ experimentId: id, path: 'analysis/draft.md', content: 'two', overwrite: true })
    expect(revised.created).toBe(false)
    expect(readFileSync(join(dir, 'analysis', 'draft.md'), 'utf8')).toBe('two')
  })

  it('refuses an empty body rather than creating a file nobody notices', async () => {
    const { id, dir, service } = await experiment()
    await expect(service.writeAnalysis({ experimentId: id, path: 'analysis/empty.md', content: '' }))
      .rejects.toThrow(/refusing to write an empty file/)
    expect(existsSync(join(dir, 'analysis', 'empty.md'))).toBe(false)
  })

  it('refuses an experiment that is not there, and an id that is a path', async () => {
    const { service } = await experiment()
    await expect(service.writeAnalysis({ experimentId: 'nope-20260920-0000', path: 'analysis/x.md', content: 'x' }))
      .rejects.toThrow(/no experiment "nope-20260920-0000"/)
    await expect(service.writeAnalysis({ experimentId: '../x', path: 'analysis/x.md', content: 'x' }))
      .rejects.toThrow(/is not an experiment id/)
  })

  it('writes nothing when it refuses', async () => {
    const { id, dir, service } = await experiment()
    mkdirSync(join(dir, 'exports'), { recursive: true })
    writeFileSync(join(dir, 'exports', 'keep.md'), 'kept')
    const before = readFileSync(join(dir, 'plan.json'), 'utf8')

    for (const path of ['plan.json', 'exports/keep.md', 'analysis/../meta.json']) {
      await expect(service.writeAnalysis({ experimentId: id, path, content: 'overwritten', overwrite: true })).rejects.toThrow()
    }
    expect(readFileSync(join(dir, 'plan.json'), 'utf8')).toBe(before)
    expect(readFileSync(join(dir, 'exports', 'keep.md'), 'utf8')).toBe('kept')
    expect(readdirSync(join(dir, 'analysis'))).toEqual([])
  })
})
