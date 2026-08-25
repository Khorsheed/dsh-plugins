/** Service core: whitelist enforcement on every read path, put_item discipline, fail-loud scoping. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BindingSession } from '../src/binding.ts'
import { DatasetsError } from '../src/dataset.ts'
import { createDatasetsService, resolveScope, type DatasetScope } from '../src/service.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let worktreeRoot: string | undefined
let bindingsRoot: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (worktreeRoot !== undefined) rmSync(worktreeRoot, { recursive: true, force: true })
  if (bindingsRoot !== undefined) rmSync(bindingsRoot, { recursive: true, force: true })
  repo = undefined
  worktreeRoot = undefined
  bindingsRoot = undefined
})

const service = () => createDatasetsService({
  worktreeRoot: worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
  bindingsRoot: bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
})

/** Scope over the fixture repo with a `visible`-only layer whitelist. */
const boundScope = (): DatasetScope => ({ repo: repo?.dir ?? '', layers: ['visible'] })

describe('resolveScope', () => {
  it('prefers the explicit repo, then the binding, then the default; fails loud with none', () => {
    expect(resolveScope({ repo: '/explicit' }, { repoPath: '/bound' }, '/default').repo).toBe('/explicit')
    expect(resolveScope({}, { repoPath: '/bound' }, '/default').repo).toBe('/bound')
    expect(resolveScope({}, undefined, '/default').repo).toBe('/default')
    expect(() => resolveScope({}, undefined, undefined)).toThrowError(/bind one first/)
    expect(() => resolveScope({}, undefined, '')).toThrowError(/bind one first/)
  })

  it('carries the binding whitelists even alongside an explicit repo', () => {
    const scope = resolveScope({ repo: '/explicit' }, { repoPath: '/bound', layers: ['visible'], datasets: ['alpha'] }, undefined)
    expect(scope.layers).toEqual(['visible'])
    expect(scope.datasets).toEqual(['alpha'])
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

  it('a dataset with no sensitive declaration behaves exactly as before (all layers, undeclared included)', async () => {
    repo = makeFixtureRepo()
    // beta declares a single visible layer — nothing is sensitive.
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

describe('live-session binding through the service', () => {
  it('bind/read/unbind against a structural session — and NEVER touches the session log', () => {
    // Regression guard for the resume-poisoning bug: the persistence read
    // path refuses to rebuild a session whose log holds an event type outside
    // the harness's generated known-types set unless the envelope carries
    // `ignorable: true`, and `Session.append()` offers no way to set that
    // marker (the downstream registration surface is deferred upstream) — so
    // this package must persist NO session events at all. A fake session
    // whose append throws proves the binding paths never call it.
    const session: BindingSession & { append: () => never } = {
      id: 's1',
      append: () => { throw new Error('session.append must never be called') },
    }
    const s = service()
    s.bind(session, { repoPath: '/repo', layers: ['visible'] })
    expect(s.binding(session)).toEqual({ repoPath: '/repo', layers: ['visible'] })
    s.unbind(session)
    expect(s.binding(session)).toBeUndefined()
  })

  it('the binding survives a service re-create (a restart)', () => {
    const root = bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-'))
    const session: BindingSession = { id: 's1' }
    service().bind(session, { repoPath: '/repo', datasets: ['alpha'] })
    const restarted = createDatasetsService({
      worktreeRoot: worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
      bindingsRoot: root,
    })
    expect(restarted.binding(session)).toEqual({ repoPath: '/repo', datasets: ['alpha'] })
  })
})
