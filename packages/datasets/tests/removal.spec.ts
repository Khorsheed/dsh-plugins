/**
 * T99 · deleting a dataset repository (the registration's 「删除」) and
 * discarding an organizing result (the banner's 「放弃」). Every directory
 * here is a fresh runtime-temp directory: the datasets home, the state root
 * and every repository live under mkdtemp roots, never a real deployment.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatasetsRemoteService } from '../src/remote.ts'
import { isStrictlyInside, planRepoRemoval, repositoryDirOf } from '../src/removal.ts'
import { createDatasetsService, type DatasetsService } from '../src/service.ts'
import type { ProposalInput } from '../src/proposal.ts'
import { cleanup, git, makeFixtureRepo, writeFiles } from './helpers.ts'

let home: string
let state: string
let outside: string
let service: DatasetsService

/** A fixture repository moved into the datasets home under `name`. */
function repoInHome(name = 'lib'): string {
  const fixture = makeFixtureRepo()
  const dir = join(home, name)
  renameSync(fixture.dir, dir)
  return dir
}

/** A fixture repository left outside the datasets home. */
function repoOutside(): string {
  const fixture = makeFixtureRepo()
  const dir = join(outside, 'mine')
  renameSync(fixture.dir, dir)
  return dir
}

/** A proposal input that passes the mapping check for the fixture (and the source directory). */
function proposalInput(repo: string, source: string): ProposalInput {
  return {
    repo,
    registryId: 'fixture',
    purpose: 'unit test',
    source: { kind: 'local', label: 'fixture source', path: source },
    layers: [
      { set: 'alpha', layer: 'visible', visible: true, reason: 'the task' },
      { set: 'alpha', layer: 'hidden', visible: false, reason: 'the answers' },
    ],
    mapping: {
      sources: [
        {
          path: 'qa.jsonl', disposition: 'split', target: 'datasets/alpha/items/', count: 2, key: 'id',
          fields: [{ name: 'id', to: 'item id' }, { name: 'q', to: 'visible/task.md' }, { name: 'a', to: 'hidden/notes.md' }],
        },
        { path: 'README.md', disposition: 'copy', target: 'datasets/alpha/visible/guide.md' },
      ],
      outputs: [
        { path: 'datasets/*/dataset.json', origin: 'new', count: 2 },
        { path: 'datasets/alpha/handbook.md', origin: 'new' },
        { path: 'datasets/alpha/drafts/', origin: 'new' },
        { path: 'datasets/alpha/visible/guide.md', origin: 'copy', from: 'README.md' },
        { path: 'datasets/alpha/hidden/answers.md', origin: 'new' },
        { path: 'datasets/alpha/items/*/item.json', origin: 'new' },
        { path: 'datasets/alpha/items/*/visible/task.md', origin: 'split', from: 'qa.jsonl', field: 'q', count: 2 },
        { path: 'datasets/alpha/items/*/hidden/notes.md', origin: 'split', from: 'qa.jsonl', field: 'a' },
        { path: 'datasets/beta/', origin: 'new' },
      ],
    },
    samples: [{ set: 'alpha', item: 'i1', from: { file: 'qa.jsonl', line: 1 } }],
  }
}

/** A source directory for proposals. */
function sourceDir(): string {
  const dir = join(outside, `source-${readdirSync(outside).length}`)
  mkdirSync(dir)
  writeFiles(dir, {
    'qa.jsonl': '{"id":"i1","q":"task one","a":"hidden notes"}\n{"id":"i2","q":"task two","a":"none"}\n',
    'README.md': 'shared guide\n',
  })
  return dir
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-removal-home-')))
  state = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-removal-state-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-removal-outside-')))
  service = createDatasetsService({
    materializedRoot: join(state, 'materialized'),
    registryPath: join(state, 'registry.json'),
    bindingsRoot: join(state, 'bindings'),
    organizing: { preset: '', datasetsHome: home },
  })
})

afterEach(() => {
  cleanup(home)
  cleanup(state)
  cleanup(outside)
})

describe('path rules', () => {
  it('isStrictlyInside: a child, never the parent itself nor a sibling with a shared prefix', () => {
    expect(isStrictlyInside('/r/h', '/r/h/lib')).toBe(true)
    expect(isStrictlyInside('/r/h', '/r/h')).toBe(false)
    expect(isStrictlyInside('/r/h', '/r/h-2/lib')).toBe(false)
    expect(isStrictlyInside('/r/h', '/r/other')).toBe(false)
  })

  it('repositoryDirOf: a work tree common dir maps to its root; a bare repository is itself', () => {
    expect(repositoryDirOf('/x/lib/.git')).toBe('/x/lib')
    expect(repositoryDirOf('/x/lib.git')).toBe('/x/lib.git')
  })

  it('a repository inside the home is deletable, with its materialized views as state', async () => {
    const dir = repoInHome()
    const entry = await service.registry.register({ path: dir, id: 'lib' })
    await service.datasetView('lib', 'alpha', git(dir, ['rev-parse', 'HEAD']).trim())
    const plan = await service.planDelete('lib')
    expect(plan).toMatchObject({ id: 'lib', path: dir, files: 'delete', sets: ['alpha', 'beta'] })
    expect(plan.state).toHaveLength(1)
    expect(plan.state[0]).toContain(join(state, 'materialized'))
    expect(entry.commonDir).toBe(join(dir, '.git'))
  })

  it('a repository outside the home keeps its files: unregister only', async () => {
    const dir = repoOutside()
    await service.registry.register({ path: dir, id: 'mine' })
    expect(await service.planDelete('mine')).toMatchObject({ path: dir, files: 'keep', keepReason: 'outside-home' })
    await expect(service.deleteRegistration('mine')).rejects.toMatchObject({ code: 'NOT_REMOVABLE' })
    expect(existsSync(join(dir, '.git'))).toBe(true)
    expect(service.registry.get('mine')).toBeDefined()
  })

  it('a link into the home is not followed: a repository reached through a symlink stays', async () => {
    const real = repoOutside()
    symlinkSync(real, join(home, 'linked'))
    // Registered through the link: identity canonicalizes to the real (outside) path.
    await service.registry.register({ path: join(home, 'linked'), id: 'linked' })
    expect(await service.planDelete('linked')).toMatchObject({ path: real, files: 'keep', keepReason: 'outside-home' })
    await expect(service.deleteRegistration('linked')).rejects.toMatchObject({ code: 'NOT_REMOVABLE' })
    expect(existsSync(join(real, '.git'))).toBe(true)
  })

  it('a symlinked directory on the way to the recorded path refuses (the record went stale)', async () => {
    const dir = repoInHome('lib')
    await service.registry.register({ path: dir, id: 'lib' })
    // Swap the directory for a link to a repository elsewhere: same recorded path, different target.
    renameSync(dir, join(outside, 'moved'))
    symlinkSync(join(outside, 'moved'), dir)
    expect(await planRepoRemoval(join(dir, '.git'), {
      datasetsHome: home, materializedRoot: join(state, 'materialized'), stateRoot: state,
    })).toMatchObject({ files: 'keep', keepReason: 'symlink' })
    await expect(service.deleteRegistration('lib')).rejects.toMatchObject({ code: 'NOT_REMOVABLE' })
    expect(existsSync(join(outside, 'moved', '.git'))).toBe(true)
  })

  it('the home itself, or a path that is not the repository root, refuses', async () => {
    const roots = { datasetsHome: home, materializedRoot: join(state, 'materialized'), stateRoot: state }
    // The home as a "repository": never strictly inside itself.
    expect(await planRepoRemoval(join(home, '.git'), roots)).toMatchObject({ files: 'keep', keepReason: 'outside-home' })
    // A directory inside the home whose `.git` belongs to nothing: git disagrees.
    mkdirSync(join(home, 'plain', '.git'), { recursive: true })
    expect(await planRepoRemoval(join(home, 'plain', '.git'), roots)).toMatchObject({ files: 'keep', keepReason: 'not-repo-root' })
    // A gone directory: nothing to delete.
    expect(await planRepoRemoval(join(home, 'gone', '.git'), roots)).toMatchObject({ files: 'keep', keepReason: 'missing' })
  })

  it('a repository with a checkout outside its directory keeps its files', async () => {
    const dir = repoInHome()
    await service.registry.register({ path: dir, id: 'lib' })
    git(dir, ['worktree', 'add', '-q', join(outside, 'wt'), '-b', 'side'])
    expect(await service.planDelete('lib')).toMatchObject({
      files: 'keep', keepReason: 'other-checkouts', otherCheckouts: [join(outside, 'wt')],
    })
  })
})

describe('deleteRegistration', () => {
  it('drops the registration, the directory and its state; sets used by experiments go too', async () => {
    const dir = repoInHome()
    await service.registry.register({ path: dir, id: 'lib' })
    await service.datasetView('lib', 'alpha', git(dir, ['rev-parse', 'HEAD']).trim())
    const plan = await service.planDelete('lib')
    // The plan names the sets: the browser matches them to its experiment rows.
    expect(plan.sets).toEqual(['alpha', 'beta'])
    expect(await service.deleteRegistration('lib')).toEqual({ path: dir, deleted: true })
    expect(service.registry.get('lib')).toBeUndefined()
    expect(existsSync(dir)).toBe(false)
    for (const path of plan.state) expect(existsSync(path)).toBe(false)
    // No hidden leftover in the home.
    expect(readdirSync(home)).toEqual([])
    // A pinned reference to the deleted set no longer resolves.
    await expect(service.registry.resolveRef('lib/alpha')).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
  })

  it('an unknown registration refuses', async () => {
    await expect(service.planDelete('nope')).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
    await expect(service.deleteRegistration('nope')).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
  })

  it('the Remote verb takes only an id: the path is derived on the host', async () => {
    const dir = repoInHome()
    const ctx = new Context()
    ctx.provide('datasets', service)
    const fiber = ctx.plugin(DatasetsRemoteService, {})
    await fiber.await()
    const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
    await remote.register({ path: dir, id: 'lib' })
    expect(await remote.deletePlan({ id: 'lib' })).toMatchObject({ path: dir, files: 'delete' })
    // A path smuggled into the request is ignored, not trusted.
    const smuggled = { id: 'lib', path: outside } as { id: string }
    expect(await remote.deleteRegistration(smuggled)).toEqual({ path: dir, deleted: true })
    expect(existsSync(outside)).toBe(true)
    await fiber.dispose()
  })
})

describe('discardProposal', () => {
  it('a new, unregistered repository inside the home goes with the record', async () => {
    const dir = repoInHome('organized')
    const { proposal } = await service.proposals.propose({ ...proposalInput(dir, sourceDir()), sessionId: 's-1' })
    expect(await service.planDiscard(proposal.id)).toMatchObject({ id: proposal.id, path: dir, files: 'delete', registryId: 'fixture' })
    expect(await service.discardProposal(proposal.id)).toEqual({ path: dir, deleted: true })
    expect(existsSync(dir)).toBe(false)
    expect(service.proposals.list()).toEqual([])
  })

  it('a repository outside the home: only the record goes', async () => {
    const dir = repoOutside()
    const { proposal } = await service.proposals.propose(proposalInput(dir, sourceDir()))
    expect(await service.discardProposal(proposal.id)).toEqual({ path: dir, deleted: false, keepReason: 'outside-home' })
    expect(existsSync(join(dir, '.git'))).toBe(true)
    expect(service.proposals.list()).toEqual([])
  })

  it('a registered repository is never deleted by a discard', async () => {
    const dir = repoInHome()
    await service.registry.register({ path: dir, id: 'fixture' })
    const { proposal } = await service.proposals.propose(proposalInput(dir, sourceDir()))
    expect(await service.planDiscard(proposal.id)).toMatchObject({ files: 'keep', keepReason: 'registered' })
    expect(await service.discardProposal(proposal.id)).toMatchObject({ deleted: false, keepReason: 'registered' })
    expect(existsSync(join(dir, '.git'))).toBe(true)
    expect(service.registry.get('fixture')).toBeDefined()
  })

  it('a confirmed proposal refuses', async () => {
    const dir = repoInHome()
    const { proposal } = await service.proposals.propose(proposalInput(dir, sourceDir()))
    await service.proposals.confirm(proposal.id, 'fixture', {})
    await expect(service.discardProposal(proposal.id)).rejects.toThrowError(/confirmed/)
    expect(existsSync(join(dir, '.git'))).toBe(true)
  })
})
