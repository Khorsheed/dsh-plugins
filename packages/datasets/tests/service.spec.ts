/** Service core: whitelist enforcement on every read path, put_item discipline, fail-loud scoping. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import type { BindingSession } from '../src/binding.ts'
import { createDatasetsService, resolveScope, type DatasetScope } from '../src/service.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let worktreeRoot: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (worktreeRoot !== undefined) rmSync(worktreeRoot, { recursive: true, force: true })
  repo = undefined
  worktreeRoot = undefined
})

const service = () => createDatasetsService({
  worktreeRoot: worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
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

describe('whitelist enforcement', () => {
  it('list filters item layers to the whitelist', async () => {
    repo = makeFixtureRepo()
    const result = await service().list(boundScope(), 'alpha')
    if (result.kind !== 'items') throw new Error('expected items result')
    const i1 = result.items.find(item => item.id === 'i1')
    expect(Object.keys(i1?.layers ?? {})).toEqual(['visible'])
    expect(result.dataset.layers).toEqual(['visible'])
    expect(result.dataset.nonModelFacingLayers).toEqual([])
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
    await expect(service().putItem({ repo: repo.dir }, {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'undeclared', path: 'x.md', content: 'x' }],
    })).rejects.toMatchObject({ code: 'LAYER_UNDECLARED' })
    expect(existsSync(join(repo.dir, 'datasets/alpha/items/i3'))).toBe(false)
  })
})

describe('live-session binding through the service', () => {
  it('bind/fold/unbind against a structural session', () => {
    const events: SessionEvent[] = []
    const session: BindingSession = {
      events,
      append(type, data) {
        events.push({ type, seq: events.length, time: Date.now(), data } as SessionEvent)
      },
    }
    const s = service()
    s.bind(session, { repoPath: '/repo', layers: ['visible'] })
    expect(s.binding(session)).toEqual({ repoPath: '/repo', layers: ['visible'] })
    s.unbind(session)
    expect(s.binding(session)).toBeUndefined()
  })
})
