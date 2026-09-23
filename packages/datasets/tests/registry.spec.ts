/**
 * The deployment's dataset registry (T73): one JSON file of human-written
 * registrations, identity = the repository's git common dir, «latest» = the
 * tracked branch's tip (never a checkout's HEAD), and the three refusals an
 * agent's `dataset` argument can meet — a path, an ambiguous name, an
 * unregistered repository.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeBinding } from '../src/binding.ts'
import { looksLikePath, openRegistry, readRegistry, type RepoRegistry } from '../src/registry.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo
let state: string
let registry: RepoRegistry

beforeEach(() => {
  repo = makeFixtureRepo()
  state = mkdtempSync(join(tmpdir(), 'dsh-registry-'))
  registry = openRegistry(join(state, 'registry.json'))
})

afterEach(() => {
  cleanup(repo.dir)
  cleanup(state)
})

describe('the registry file', () => {
  it('an absent file is an empty registry, and nothing is written by reading it', () => {
    expect(readRegistry(join(state, 'registry.json'))).toEqual([])
    expect(registry.entries()).toEqual([])
    expect(existsSync(join(state, 'registry.json'))).toBe(false)
  })

  it('round-trips a registration with every field the brief names', async () => {
    const entry = await registry.register({ path: repo.dir, id: 'lib', trackedRef: 'main' })
    expect(entry).toMatchObject({
      id: 'lib',
      commonDir: realpathSync(join(repo.dir, '.git')),
      trackedRef: 'main',
      registeredCommit: repo.commit,
      authoringCheckout: null,
    })
    expect(typeof entry.registeredAt).toBe('string')
    // A set left out is not written down: it gets the modelFacing floor at
    // read time, so a set added to the branch later is covered too.
    expect(entry.sets).toEqual({})
    expect((await registry.sets(entry)).map(set => [set.ref, set.layers]))
      .toEqual([['lib/alpha', ['visible']], ['lib/beta', ['visible']]])
    const onDisk = readRegistry(join(state, 'registry.json'))
    expect(onDisk).toEqual([entry])
    // A second handle on the same file sees the same registration.
    expect(openRegistry(join(state, 'registry.json')).get('lib')).toEqual(entry)
  })

  it('dedups by common dir: a checkout, its .git and a linked worktree are one repository', async () => {
    await registry.register({ path: repo.dir, id: 'lib' })
    const linked = mkdtempSync(join(tmpdir(), 'dsh-registry-linked-'))
    cleanup(linked)
    git(repo.dir, ['worktree', 'add', '-q', '--detach', linked])
    try {
      await expect(registry.register({ path: join(repo.dir, '.git'), id: 'other' }))
        .rejects.toMatchObject({ code: 'ALREADY_REGISTERED' })
      await expect(registry.register({ path: linked, id: 'other' }))
        .rejects.toMatchObject({ code: 'ALREADY_REGISTERED' })
      expect((await registry.lookupPath(linked))?.id).toBe('lib')
      expect(registry.entries()).toHaveLength(1)
    } finally {
      git(repo.dir, ['worktree', 'remove', '--force', linked])
    }
  })

  it('a taken id is refused even for another repository', async () => {
    await registry.register({ path: repo.dir, id: 'lib' })
    const second = makeFixtureRepo()
    try {
      await expect(registry.register({ path: second.dir, id: 'lib' }))
        .rejects.toMatchObject({ code: 'ALREADY_REGISTERED' })
    } finally {
      cleanup(second.dir)
    }
  })

  it('a layer the set does not declare is refused at registration', async () => {
    await expect(registry.register({ path: repo.dir, id: 'lib', sets: { beta: { layers: ['hidden'] } } }))
      .rejects.toMatchObject({ code: 'LAYER_UNDECLARED' })
  })

  it('remove drops the registration and leaves the repository alone', async () => {
    await registry.register({ path: repo.dir, id: 'lib' })
    expect(registry.remove('lib')).toBe(true)
    expect(registry.remove('lib')).toBe(false)
    expect(registry.entries()).toEqual([])
    expect(git(repo.dir, ['rev-parse', 'HEAD']).trim()).toBe(repo.commit)
  })
})

describe('latest = the tracked branch', () => {
  it('follows the tracked branch, never the checkout\'s HEAD', async () => {
    const entry = await registry.register({ path: repo.dir, id: 'lib', trackedRef: 'main' })
    git(repo.dir, ['checkout', '-q', '-b', 'side'])
    writeFiles(repo.dir, { 'datasets/alpha/items/i3/visible/task.md': 'side only\n' })
    const side = commitAll(repo.dir, 'side')
    expect(git(repo.dir, ['rev-parse', 'HEAD']).trim()).toBe(side)
    expect((await registry.latest(entry)).commit).toBe(repo.commit)

    // Moving the tracked branch moves «latest» with no re-registration.
    git(repo.dir, ['checkout', '-q', 'main'])
    git(repo.dir, ['merge', '-q', '--ff-only', 'side'])
    expect((await registry.latest(entry)).commit).toBe(side)
  })

  it('a missing tracked branch is refused, at registration and afterwards', async () => {
    await expect(registry.register({ path: repo.dir, id: 'lib', trackedRef: 'nope' }))
      .rejects.toThrow(/tracked branch "nope" of .* does not exist/)
    const entry = await registry.register({ path: repo.dir, id: 'lib', trackedRef: 'main' })
    git(repo.dir, ['branch', '-q', 'walk'])
    const walking = await registry.update({ id: 'lib', trackedRef: 'walk' })
    git(repo.dir, ['branch', '-q', '-D', 'walk'])
    await expect(registry.latest(walking)).rejects.toMatchObject({ code: 'REF_NOT_FOUND' })
    // The row keeps the registration visible with the sentence.
    const [row] = await registry.rows()
    expect(row?.entry.id).toBe(entry.id)
    expect(row?.problem).toMatch(/tracked branch "walk" of "lib" .*does not exist/)
    expect(row?.sets).toEqual([])
  })
})

describe('resolveRef — the three refusals', () => {
  beforeEach(async () => {
    await registry.register({ path: repo.dir, id: 'lib', sets: { alpha: { layers: ['hidden', 'visible'] } } })
  })

  it('a full reference resolves to the registration, the set, latest and the registered layers', async () => {
    const resolved = await registry.resolveRef('lib/alpha')
    expect(resolved.entry.id).toBe('lib')
    expect(resolved.set).toBe('alpha')
    expect(resolved.latest.commit).toBe(repo.commit)
    expect(resolved.layers).toEqual(['hidden', 'visible'])
    // beta was left out at registration: the modelFacing floor.
    expect((await registry.resolveRef('lib/beta')).layers).toEqual(['visible'])
  })

  it('a path is refused and the refusal names the registered id', async () => {
    await expect(registry.resolveRef(repo.dir)).rejects.toMatchObject({ code: 'PATH_NOT_REF' })
    await expect(registry.resolveRef(repo.dir))
      .rejects.toThrow(/takes a registry reference, not a path: .* is registered as "lib" — pass "lib\/<set>"/)
  })

  it('an ambiguous name lists the candidates and hands the choice to ask_user_question', async () => {
    const error = await registry.resolveRef('a').catch((caught: unknown) => caught as Error)
    expect(error).toMatchObject({ code: 'AMBIGUOUS_DATASET' })
    expect(error.message).toContain('lib/alpha')
    expect(error.message).toContain('lib/beta')
    expect(error.message).toContain('use ask_user_question')
  })

  it('an unregistered repository or name is not the agent\'s to read', async () => {
    const elsewhere = makeFixtureRepo()
    try {
      for (const ref of [elsewhere.dir, 'nowhere', 'ghost/alpha']) {
        const error = await registry.resolveRef(ref).catch((caught: unknown) => caught as Error)
        expect(error).toMatchObject({ code: 'NOT_REGISTERED' })
        expect(error.message).toContain('is not registered in this deployment')
        expect(error.message).toContain('Ask the person to register it')
        expect(error.message).toContain('Do not read that directory yourself')
      }
    } finally {
      cleanup(elsewhere.dir)
    }
  })

  it('a registered id with an unknown set names the sets it has', async () => {
    await expect(registry.resolveRef('lib/gamma')).rejects.toThrow(/"lib" has no set "gamma" on main \(sets: lib\/alpha, lib\/beta\)/)
  })

  it('looksLikePath tells a path from a reference', () => {
    for (const path of ['/abs', '~/x', './x', '../x', 'C:\\x', 'a/b/c']) expect(looksLikePath(path)).toBe(true)
    for (const ref of ['lib/alpha', 'alpha', 'harness-comparison']) expect(looksLikePath(ref)).toBe(false)
  })
})

describe('importBindings — the one-click «从旧绑定登记»', () => {
  it('folds bindings of one repository into one registration, skips dangling ones, deletes nothing', async () => {
    const bindings = join(state, 'bindings')
    writeBinding(bindings, 's1', { repoPath: repo.dir, layers: ['visible'] })
    writeBinding(bindings, 's2', { repoPath: repo.dir, layers: ['visible', 'hidden'] })
    const gone = mkdtempSync(join(tmpdir(), 'dsh-registry-gone-'))
    writeBinding(bindings, 's3', { repoPath: gone, layers: ['visible'] })
    cleanup(gone)
    const before = ['s1', 's2', 's3'].map(sid => readFileSync(join(bindings, `${sid}.json`), 'utf8'))

    const result = await registry.importBindings(bindings)
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({ created: true, sessions: 2 })
    expect(result.dangling).toEqual([expect.objectContaining({ sessions: 1, reason: 'the path no longer exists' })])
    expect(registry.entries()).toHaveLength(1)
    // The legacy files stay byte-identical: eval still reads them (branch 2).
    expect(['s1', 's2', 's3'].map(sid => readFileSync(join(bindings, `${sid}.json`), 'utf8'))).toEqual(before)

    // Idempotent: a second import finds the registration already there.
    const again = await registry.importBindings(bindings)
    expect(again.imported[0]).toMatchObject({ created: false })
    expect(registry.entries()).toHaveLength(1)
  })
})
