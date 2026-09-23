/** Service core: whitelist enforcement on every read path, put_item discipline, fail-loud scoping. */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatasetsError } from '../src/dataset.ts'
import { createDatasetsService, FULL_VIEW_KEY, resolveOperatorScope, type DatasetScope } from '../src/service.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let worktreeRoot: string | undefined
let bindingsRoot: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (worktreeRoot !== undefined) cleanup(worktreeRoot)
  if (bindingsRoot !== undefined) rmSync(bindingsRoot, { recursive: true, force: true })
  repo = undefined
  worktreeRoot = undefined
  bindingsRoot = undefined
})

const service = () => createDatasetsService({
  materializedRoot: join(worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-state-')), 'materialized'),
  registryPath: join(worktreeRoot, 'registry.json'),
  bindingsRoot: bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
})

/** Scope over the fixture repo with a `visible`-only layer whitelist. */
const boundScope = (): DatasetScope => ({ repo: repo?.dir ?? '', layers: ['visible'] })

describe('resolveOperatorScope (the CLI\'s read verbs; T73 branch 2)', () => {
  it('takes a registry id or a path; with none, the only registration — else one of two refusals', async () => {
    repo = makeFixtureRepo()
    const s = service()
    // Nothing registered: no fallback of any kind (no binding, no config default).
    await expect(resolveOperatorScope(s.registry, undefined)).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
    await expect(resolveOperatorScope(s.registry, undefined)).rejects.toThrowError(/no dataset repository is registered/)
    // An explicit path is the operator's own pick at their own machine.
    expect((await resolveOperatorScope(s.registry, `${repo.dir}/`)).repo).toBe(repo.dir)
    const entry = await s.registry.register({ path: repo.dir, id: 'lib' })
    // One registration: used without naming it, read at the tracked tip through the common dir.
    expect(await resolveOperatorScope(s.registry, undefined)).toEqual({ repo: entry.commonDir, ref: repo.commit })
    expect(await resolveOperatorScope(s.registry, 'lib')).toEqual({ repo: entry.commonDir, ref: repo.commit })
    const second = makeFixtureRepo()
    try {
      await s.registry.register({ path: second.dir, id: 'other' })
      await expect(resolveOperatorScope(s.registry, undefined)).rejects.toMatchObject({ code: 'NOT_UNIQUE' })
      await expect(resolveOperatorScope(s.registry, undefined)).rejects.toThrowError(/lib, other/)
      expect((await resolveOperatorScope(s.registry, 'other')).ref).toBe(second.commit)
    } finally {
      cleanup(second.dir)
    }
  })
})

describe('modelFacing default floor (no explicit binding whitelist)', () => {
  const bare = (): DatasetScope => ({ repo: repo?.dir ?? '' })
  const operatorScope = (): DatasetScope => ({ repo: repo?.dir ?? '', operator: true })

  it('a mixed dataset reads only its modelFacing:true layers by default; the operator sees all', async () => {
    repo = makeFixtureRepo()
    const floored = await service().list(bare(), 'alpha')
    if (floored.kind !== 'items') throw new Error('expected items result')
    expect(Object.keys(floored.items.find(item => item.id === 'i1')?.layers ?? {})).toEqual(['visible'])
    expect(floored.datasetLayers).toEqual({ visible: ['guide.md'] })
    await expect(service().read(bare(), {
      dataset: 'alpha', item: 'i1', layer: 'hidden', path: 'notes.md',
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    // An explicit layers ask intersects the floor silently (M1 semantics:
    // an empty intersection is the only error), so the worktree holds
    // 'visible' only — 'hidden' never materializes.
    const wt = await service().worktreePath(bare(), 'alpha', { layers: ['visible', 'hidden'] })
    expect(wt.layers).toEqual(['visible'])
    // The operator (the human's tab/CLI read) is never narrowed.
    const everything = await service().list(operatorScope(), 'alpha')
    if (everything.kind !== 'items') throw new Error('expected items result')
    expect(Object.keys(everything.items.find(item => item.id === 'i1')?.layers ?? {}).sort()).toEqual(['hidden', 'visible'])
  })

  it('an explicit whitelist may include sensitive layers (a deliberate act)', async () => {
    repo = makeFixtureRepo()
    const wide: DatasetScope = { repo: repo.dir, layers: ['visible', 'hidden'] }
    const ok = await service().read(wide, { dataset: 'alpha', item: 'i1', layer: 'hidden', path: 'notes.md' })
    expect(ok.content).toBe('hidden notes v1\n')
  })

  it('a dataset that declares nothing sensitive is still floored at its modelFacing layers', async () => {
    repo = makeFixtureRepo()
    // beta declares a single visible layer and nothing sensitive. The floor
    // used to switch OFF for such a dataset and answer "unfiltered", which
    // made "no whitelist" mean two different things depending on a descriptor
    // the binder never read (I5·T58 · G3). It now means one thing.
    const result = await service().list(bare(), 'beta')
    if (result.kind !== 'items') throw new Error('expected items result')
    expect(Object.keys(result.items[0]?.layers ?? {})).toEqual(['visible'])
    const wt = await service().worktreePath(bare(), 'beta')
    expect(wt.layers).toEqual(['visible'])
  })

  it('the write path follows the same floor', async () => {
    repo = makeFixtureRepo()
    await expect(service().putItem(bare(), {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'hidden', path: 'x.md', content: 'x' }],
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    const ok = await service().putItem(bare(), {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'visible', path: 'x.md', content: 'x' }],
    })
    expect(ok.written).toEqual(['datasets/alpha/items/i3/visible/x.md'])
  })
})

describe('whitelist enforcement', () => {
  it('list filters item layers to the whitelist', async () => {
    repo = makeFixtureRepo()
    const result = await service().list(boundScope(), 'alpha')
    if (result.kind !== 'items') throw new Error('expected items result')
    const i1 = result.items.find(item => item.id === 'i1')
    expect(Object.keys(i1?.layers ?? {})).toEqual(['visible'])
    expect(result.dataset.layers).toEqual(['visible'])
    expect(result.dataset.nonModelFacingLayers).toEqual([])
    // The alpha fixture is mixed (hidden is modelFacing:false, visible is
    // undeclared): the summary warns about the undeclared layer, and the
    // warning blocks nothing.
    expect(result.dataset.warnings.map(warning => warning.layer)).toEqual(['visible'])
  })

  it('list reports dataset-level layers, whitelist-filtered, declared-only', async () => {
    repo = makeFixtureRepo()
    const bound = await service().list(boundScope(), 'alpha')
    if (bound.kind !== 'items') throw new Error('expected items result')
    // The hidden dataset-level layer is whitelisted out; `drafts/` is not a
    // declared layer, so it stays descriptor passthrough and never lists.
    expect(bound.datasetLayers).toEqual({ visible: ['guide.md'] })
    const everything = await service().list({ repo: repo.dir, operator: true }, 'alpha')
    if (everything.kind !== 'items') throw new Error('expected items result')
    expect(everything.datasetLayers).toEqual({ visible: ['guide.md'], hidden: ['answers.md'] })
  })

  it('read resolves a dataset-level file when item is omitted and enforces the whitelist on it', async () => {
    repo = makeFixtureRepo()
    const ok = await service().read(boundScope(), { dataset: 'alpha', layer: 'visible', path: 'guide.md' })
    expect(ok.content).toBe('shared guide v1\n')
    // Same layer name at both levels: the item-level read is unaffected.
    const itemLevel = await service().read(boundScope(), {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(itemLevel.content).toBe('task one v1\n')
    await expect(service().read(boundScope(), {
      dataset: 'alpha', layer: 'hidden', path: 'answers.md',
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    // The passthrough directory is not a declared layer: no read path reaches it.
    // (Operator scope, so the floor does not fire first and mask the guard.)
    await expect(service().read({ repo: repo.dir, operator: true }, {
      dataset: 'alpha', layer: 'drafts', path: 'notes.md',
    })).rejects.toMatchObject({ code: 'LAYER_UNDECLARED' })
  })

  it('read outside the whitelist is rejected; inside it reads from the git object', async () => {
    repo = makeFixtureRepo()
    await expect(service().read(boundScope(), {
      dataset: 'alpha', item: 'i1', layer: 'hidden', path: 'notes.md',
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    const ok = await service().read(boundScope(), {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(ok.content).toBe('task one v1\n')
    // No copy outside the repository: the read produced no new file anywhere.
    expect(existsSync(join(repo.dir, '.dsh-datasets'))).toBe(false)
  })

  it('read honors a pinned commit after the repo evolves', async () => {
    repo = makeFixtureRepo()
    const pin = await service().snapshot({ repo: repo.dir }, 'alpha')
    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'task one v2\n' })
    commitAll(repo.dir, 'evolve')
    const stale = await service().read({ repo: repo.dir }, {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md', commit: pin.commit,
    })
    expect(stale.content).toBe('task one v1\n')
    const fresh = await service().read({ repo: repo.dir }, {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(fresh.content).toBe('task one v2\n')
  })

  it('worktree_path intersects with the whitelist and rejects an empty intersection', async () => {
    repo = makeFixtureRepo()
    await expect(service().worktreePath({ repo: repo.dir, layers: ['visible'] }, 'alpha', { layers: ['hidden'] }))
      .rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    await expect(service().worktreePath({ repo: repo.dir }, 'alpha', { layers: ['undeclared'] }))
      .rejects.toMatchObject({ code: 'LAYER_UNDECLARED' })
  })

  it('dataset and layer ids cannot escape the repository layout', async () => {
    repo = makeFixtureRepo()
    await expect(service().read({ repo: repo.dir }, {
      dataset: '..', item: 'i1', layer: 'visible', path: 'task.md',
    })).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(service().read({ repo: repo.dir }, {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: '../../secret',
    })).rejects.toMatchObject({ code: 'INVALID_NAME' })
  })
})

describe('readPassthrough (operator channel)', () => {
  it('reads passthrough-zone files and item.json straight from the git object', async () => {
    repo = makeFixtureRepo()
    const scope = { repo: repo.dir, operator: true as const }
    const handbook = await service().readPassthrough(scope, 'alpha', 'handbook.md')
    expect(handbook.content).toBe('# handbook passthrough\n')
    const meta = await service().readPassthrough(scope, 'alpha', 'items/i1/item.json')
    expect(meta.content).toBe('{"difficulty":"hard"}\n')
    await expect(service().readPassthrough(scope, 'alpha', 'missing.md'))
      .rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(service().readPassthrough(scope, 'alpha', '../beta/dataset.json'))
      .rejects.toThrowError(DatasetsError)
  })
})

describe('put_item', () => {
  it('writes the working tree only — never commits', async () => {
    repo = makeFixtureRepo()
    const headBefore = git(repo.dir, ['rev-parse', 'HEAD']).trim()
    const result = await service().putItem(boundScope(), {
      dataset: 'alpha',
      item: 'i3',
      metadata: { difficulty: 'easy' },
      files: [{ layer: 'visible', path: 'task.md', content: 'draft task\n' }],
    })
    expect(result.written).toEqual([
      'datasets/alpha/items/i3/item.json',
      'datasets/alpha/items/i3/visible/task.md',
    ])
    expect(git(repo.dir, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
    expect(readFileSync(join(repo.dir, 'datasets/alpha/items/i3/visible/task.md'), 'utf8')).toBe('draft task\n')
    expect(JSON.parse(readFileSync(join(repo.dir, 'datasets/alpha/items/i3/item.json'), 'utf8'))).toEqual({ difficulty: 'easy' })
    expect(git(repo.dir, ['status', '--porcelain'])).toContain('datasets/alpha/items/i3/')
  })

  it('rejects undeclared layers and layers outside the whitelist', async () => {
    repo = makeFixtureRepo()
    await expect(service().putItem(boundScope(), {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'hidden', path: 'x.md', content: 'x' }],
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    await expect(service().putItem({ repo: repo.dir, operator: true }, {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'undeclared', path: 'x.md', content: 'x' }],
    })).rejects.toMatchObject({ code: 'LAYER_UNDECLARED' })
    expect(existsSync(join(repo.dir, 'datasets/alpha/items/i3'))).toBe(false)
  })
})

describe('operator registry reads (eval\'s experiment layer; T73 branch 2)', () => {
  it('registration / resolveRegistryCommit / registryObjectId / registryListFiles / registryShowFile', async () => {
    repo = makeFixtureRepo()
    const s = service()
    await expect(s.registration('lib')).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
    const entry = await s.registry.register({ path: repo.dir, id: 'lib' })
    const reg = await s.registration('lib')
    expect(reg).toMatchObject({ id: 'lib', commonDir: entry.commonDir, trackedRef: 'main', latest: { commit: repo.commit } })

    expect(await s.resolveRegistryCommit('lib', 'main')).toBe(repo.commit)
    expect(await s.resolveRegistryCommit('lib', repo.commit.slice(0, 7))).toBe(repo.commit)
    await expect(s.resolveRegistryCommit('lib', 'no-such-ref')).rejects.toMatchObject({ code: 'GIT_ERROR' })

    const items = await s.registryObjectId('lib', repo.commit, 'datasets/alpha/items')
    expect(items).toMatch(/^[0-9a-f]{40}$/)
    expect(await s.registryObjectId('lib', repo.commit, 'datasets/alpha/schemas')).toBeNull()
    // A commit that changes something else keeps the tree oid; one that touches it changes it.
    writeFiles(repo.dir, { 'datasets/beta/items/b1/visible/data.txt': 'beta data v2\n' })
    const beta = commitAll(repo.dir, 'beta only')
    expect(await s.registryObjectId('lib', beta, 'datasets/alpha/items')).toBe(items)
    writeFiles(repo.dir, { 'datasets/alpha/items/i2/visible/task.md': 'task two v2\n' })
    const alpha = commitAll(repo.dir, 'alpha item')
    expect(await s.registryObjectId('lib', alpha, 'datasets/alpha/items')).not.toBe(items)

    expect(await s.registryListFiles('lib', repo.commit, 'datasets/beta'))
      .toEqual(['datasets/beta/dataset.json', 'datasets/beta/items/b1/visible/data.txt'])
    expect(await s.registryListFiles('lib', repo.commit, 'datasets/none')).toEqual([])
    const bytes = await s.registryShowFile('lib', repo.commit, 'datasets/beta/items/b1/visible/data.txt')
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(bytes?.toString('utf8')).toBe('beta data\n')
    expect(await s.registryShowFile('lib', repo.commit, 'datasets/beta/nope.txt')).toBeUndefined()
    await expect(s.registryShowFile('lib', repo.commit, '../escape')).rejects.toBeInstanceOf(DatasetsError)
  })

  it('datasetView materializes the whole set at one commit, read-only, under the reserved key', async () => {
    repo = makeFixtureRepo()
    const s = service()
    await s.registry.register({ path: repo.dir, id: 'lib' })
    const view = await s.datasetView('lib', 'alpha', repo.commit)
    expect(view.commit).toBe(repo.commit)
    expect(view.path.endsWith(join(repo.commit, 'alpha', FULL_VIEW_KEY, 'datasets', 'alpha'))).toBe(true)
    // Everything under datasets/alpha — every layer, the passthrough zone too.
    expect(readFileSync(join(view.path, 'dataset.json'), 'utf8')).toContain('"alpha"')
    expect(readFileSync(join(view.path, 'items/i1/hidden/notes.md'), 'utf8')).toBe('hidden notes v1\n')
    expect(readFileSync(join(view.path, 'drafts/notes.md'), 'utf8')).toBe('drafts passthrough\n')
    expect(existsSync(join(view.path, '..', 'beta'))).toBe(false)
    expect(statSync(join(view.path, 'dataset.json')).mode & 0o222).toBe(0)
    // Content-addressed: the same commit answers with the same directory.
    expect((await s.datasetView('lib', 'alpha', repo.commit)).path).toBe(view.path)
    await expect(s.datasetView('lib', 'nope', repo.commit)).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' })
    await expect(s.datasetView('lib', 'alpha', 'main')).rejects.toMatchObject({ code: 'GIT_ERROR' })
  })
})
