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

/** The canary fixture's token: the recommended shape is `<dataset id>` + a uuid. */
const CANARY = 'dsh-canary:canary-demo:8f0b1c2d-4e5a-4b6c-9d7e-0a1b2c3d4e5f'

/** Body of a file that carries the canary. */
const withCanary = (text: string): string => `${text}\n\n<!-- canary: ${CANARY} -->\n`

/**
 * A dataset declaring a canary, with one file of every case the check has to
 * separate: dataset-level and item-level visible layers, a register-mapped
 * visible file living at the item root, an extensionless text file, a hidden
 * layer, item.json, and two non-text files. Everything the check covers
 * carries the canary; nothing else does.
 */
function makeCanaryRepo(): string {
  return scratchRepo({
    'datasets/canary-demo/dataset.json': `${JSON.stringify({
      id: 'canary-demo',
      canary: CANARY,
      layers: [{ name: 'visible', modelFacing: true }, { name: 'grading', modelFacing: false }],
      register: [{ item: 'p0', layer: 'visible', files: ['task.md'] }],
    }, null, 2)}\n`,
    'datasets/canary-demo/visible/guide.md': withCanary('# shared guide'),
    'datasets/canary-demo/grading/rubric.md': 'the rubric carries no canary — a hidden layer never leaves\n',
    'datasets/canary-demo/items/i1/item.json': '{"difficulty":"easy"}\n',
    'datasets/canary-demo/items/i1/visible/task.md': withCanary('# task one'),
    'datasets/canary-demo/items/i1/visible/data.yml': withCanary('key: value'),
    'datasets/canary-demo/items/i1/visible/NOTES': withCanary('extensionless files count as text'),
    'datasets/canary-demo/items/i1/visible/logo.png': 'PNG-ish bytes, no canary\n',
    'datasets/canary-demo/items/i1/visible/archive.tar.gz': 'gz-ish bytes, no canary\n',
    'datasets/canary-demo/items/p0/task.md': withCanary('# p0 task (register-mapped into visible)'),
  })
}

/** The CANARY_MISSING files of one validate run, in report order. */
async function canaryMisses(repoPath: string, datasetId: string): Promise<(string | undefined)[]> {
  const result = await service().validate({ repo: repoPath, operator: true }, datasetId)
  return result.datasets[0]?.warnings.filter(warning => warning.code === 'CANARY_MISSING').map(warning => warning.file) ?? []
}

describe('service.validate: the canary', () => {
  it('a dataset that declares no canary is never checked', async () => {
    repo = makeFixtureRepo() // alpha/beta carry no canary and no canary string anywhere
    const result = await service().validate({ repo: repo.dir, operator: true })
    const codes = result.datasets.flatMap(dataset => dataset.warnings.map(warning => warning.code))
    expect(codes).not.toContain('CANARY_MISSING')
  })

  it('stays silent when every covered file carries the string', async () => {
    expect(await canaryMisses(makeCanaryRepo(), 'canary-demo')).toEqual([])
  })

  it('reports one warning per file that lacks it — layer files and register-mapped files alike', async () => {
    const path = makeCanaryRepo()
    writeFiles(path, {
      'datasets/canary-demo/items/i1/visible/data.yml': 'key: value\n', // the canary dropped in an edit
      'datasets/canary-demo/items/p0/task.md': '# p0 task\n', // …and in the register-mapped file
    })
    commitAll(path, 'drop the canary from two files')
    expect(await canaryMisses(path, 'canary-demo')).toEqual([
      'items/i1/visible/data.yml',
      'items/p0/task.md',
    ])
    // The warning names the layer that made the file visible.
    const result = await service().validate({ repo: path, operator: true }, 'canary-demo')
    const first = result.datasets[0]?.warnings.find(warning => warning.code === 'CANARY_MISSING')
    expect(first?.layer).toBe('visible')
  })

  it('skips non-text files, hidden layers and item.json', async () => {
    const path = makeCanaryRepo()
    // Strip the canary from a hidden-layer file and from item.json too: only
    // the extension whitelist inside a modelFacing layer is in scope.
    writeFiles(path, {
      'datasets/canary-demo/grading/rubric.md': 'still no canary\n',
      'datasets/canary-demo/items/i1/item.json': '{"difficulty":"hard"}\n',
    })
    commitAll(path, 'hidden layer and item.json stay outside the check')
    expect(await canaryMisses(path, 'canary-demo')).toEqual([]) // logo.png and archive.tar.gz never entered
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
