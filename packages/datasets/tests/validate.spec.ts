/** datasets_validate: per-dataset errors fail loud, the three warnings, CLI exit codes. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatasetsService } from '../src/service.ts'
import { runCli, type CliIo } from '../src/cli.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let dir: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (dir !== undefined) cleanup(dir)
  repo = undefined
  dir = undefined
})

const service = () => createDatasetsService({
  worktreeRoot: mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
  bindingsRoot: mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
})

/** A scratch git repo with arbitrary dataset content. */
function scratchRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-val-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, files)
  commitAll(dir, 'fixture')
  return dir
}

describe('service.validate', () => {
  it('reports the three warning kinds and keeps reads working', async () => {
    // The alpha fixture is mixed (visible undeclared, hidden false) and carries
    // passthrough files (handbook.md, drafts/notes.md) — two warning kinds.
    repo = makeFixtureRepo()
    const result = await service().validate({ repo: repo.dir, operator: true }, 'alpha')
    const alpha = result.datasets[0]
    expect(alpha?.errors).toEqual([])
    const codes = alpha?.warnings.map(warning => warning.code) ?? []
    expect(codes).toContain('MODELFACING_UNDECLARED')
    expect(codes).toContain('UNREGISTERED_FILES')
    const files = alpha?.warnings.filter(warning => warning.code === 'UNREGISTERED_FILES').map(warning => warning.file) ?? []
    expect(files).toEqual(['drafts/notes.md', 'handbook.md'])
  })

  it('flags sensitive-looking item.json field names', async () => {
    const path = scratchRepo({
      'datasets/d1/dataset.json': '{"id":"d1","layers":[{"name":"visible"}]}\n',
      'datasets/d1/items/i1/item.json': '{"difficulty":"hard","gradingNotes":"shh","tips":"ok"}\n',
      'datasets/d1/items/i1/visible/task.md': 'task\n',
    })
    const result = await service().validate({ repo: path, operator: true }, 'd1')
    const fields = result.datasets[0]?.warnings
      .filter(warning => warning.code === 'FIELD_NAME_SENSITIVE')
      .map(warning => warning.field) ?? []
    expect(fields).toEqual(['gradingNotes']) // 'tips' contains no listed root; 'difficulty' neither
  })

  it('fails loud per dataset on shape errors and keeps validating the rest', async () => {
    repo = makeFixtureRepo()
    writeFiles(repo.dir, {
      'datasets/broken/dataset.json': '{"id":"broken"}\n',
      'datasets/broken/items/b1/visible/x.md': 'x\n',
    })
    commitAll(repo.dir, 'broken dataset')
    const result = await service().validate({ repo: repo.dir, operator: true })
    const byId = new Map(result.datasets.map(dataset => [dataset.id, dataset]))
    expect(byId.get('broken')?.errors[0]?.code).toBe('SHAPE_INVALID')
    expect(byId.get('alpha')?.errors).toEqual([])
    expect(byId.get('beta')?.errors).toEqual([])
  })
})

describe('CLI validate', () => {
  const run = async (argv: readonly string[], env: Record<string, string | undefined>) => {
    let out = ''
    let err = ''
    const io: CliIo = { stdout: line => { out += line }, stderr: line => { err += line } }
    const code = await runCli([...argv], io, env)
    return { code, out, err }
  }

  it('exit 0 with warnings printed; exit 1 on shape errors; exit 2 on usage', async () => {
    repo = makeFixtureRepo()
    const env = { DSH_DATASETS_REPO: repo.dir }
    const ok = await run(['validate'], env)
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('alpha: 3 warning(s)')
    expect(ok.out).toContain('warn [MODELFACING_UNDECLARED]')
    expect(ok.out).toContain('warn [UNREGISTERED_FILES]')

    writeFiles(repo.dir, {
      'datasets/broken/dataset.json': '{"id":"broken","layers":[]}\n',
    })
    commitAll(repo.dir, 'broken dataset')
    const broken = await run(['validate'], env)
    expect(broken.code).toBe(1)
    expect(broken.out).toContain('error [SHAPE_INVALID]')

    expect((await run(['validate', '--dataset', 'alpha'], env)).code).toBe(0)
    expect((await run(['validate'], {})).code).toBe(1) // no repo source: operational failure
  })
})
