/**
 * The write boundary (safe-write.ts), the dispose guard, and the capabilities
 * descriptor.
 *
 * The probe scenario this pins: a registration's authoring checkout whose
 * `datasets/` is a SYMLINK to another directory — every write verb
 * (scaffoldDataset / scaffoldItem / importItem / putItem) must refuse coded
 * and leave NOTHING outside the root, including no partial mkdir tree.
 * Containment is decided on real paths: the root realpathed once per
 * operation, every component lstat-verified before a single-level mkdir ever
 * creates it, the write a temp file + rename with the parent re-verified
 * across it (a swap between check and write fails the write and removes the
 * escaped artifact), and importItem's source reads re-verified at open time
 * (O_NOFOLLOW) rather than at enumeration.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply, createDatasetsService, DatasetsDisposedError, DatasetsRemoteService,
  type DatasetsCapabilities, type DatasetsService, type DatasetsServiceOptions,
} from '@khorsheed/dsh-datasets'
import { readFileWithinRoot, writeFileWithinRoot } from '../src/safe-write.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let dirs: string[] = []
let repos: FixtureRepo[] = []

afterEach(() => {
  for (const repo of repos) cleanup(repo.dir)
  for (const dir of dirs) cleanup(dir)
  repos = []
  dirs = []
})

/** A throwaway real directory, tracked for cleanup. */
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

/** An instance over its own throwaway roots, from the public factory. */
function instance(overrides: Partial<DatasetsServiceOptions> = {}): { options: DatasetsServiceOptions; service: DatasetsService } {
  const root = tempDir('dsh-datasets-instance-')
  const options: DatasetsServiceOptions = {
    materializedRoot: join(root, 'materialized'),
    registryPath: join(root, 'registry.json'),
    bindingsRoot: join(root, 'bindings'),
    proposalsRoot: join(root, 'proposals'),
    ...overrides,
  }
  return { options, service: createDatasetsService(options) }
}

/** The Remote face over one instance's service, on a bare Context (the remote.spec.ts bench). */
async function bench(service: DatasetsService) {
  const ctx = new Context()
  ctx.provide('datasets', service)
  const fiber = ctx.plugin(DatasetsRemoteService, {})
  await fiber.await()
  const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
  return { ctx, fiber, remote }
}

/**
 * The probe's repository shape: a registered git repo whose `datasets/`
 * directory is a symlink to an outside tree.
 */
function makeSymlinkedRepo(): { repo: FixtureRepo; outside: string } {
  const outside = tempDir('dsh-datasets-outside-')
  const dir = tempDir('dsh-datasets-test-')
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, { 'README.md': 'probe repo\n' })
  symlinkSync(outside, join(dir, 'datasets'))
  const repo = { dir, commit: commitAll(dir, 'fixture') }
  repos.push(repo)
  return { repo, outside }
}

const ALL_AVAILABLE: DatasetsCapabilities = {
  protocolVersion: 1,
  registration: { available: true },
  fileWrite: { available: true },
  agentOrganize: { available: true },
  bindingImport: { available: true },
  proposalReview: { available: true },
  delete: { available: true },
}

describe('the write boundary (probe scenario)', () => {
  it('a symlinked datasets dir: Remote scaffoldDataset refuses coded and writes nothing outside', async () => {
    const { repo, outside } = makeSymlinkedRepo()
    const { fiber, remote } = await bench(instance().service)
    await remote.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    await expect(remote.scaffoldDataset({ repo: 'lib', id: 'fresh' })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // Nothing outside: no partial mkdir tree, no file. Inside: no new dataset.
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(join(outside, 'fresh'))).toBe(false)
    await fiber.dispose()
  })

  it('the same refusal on the service write verbs (scaffold / putItem / importItem)', async () => {
    const { repo, outside } = makeSymlinkedRepo()
    // The working-tree descriptor read FOLLOWS the symlink (reads are not the
    // boundary); the write verbs then refuse at the boundary.
    writeFiles(outside, { 'alpha/dataset.json': '{"id":"alpha","layers":[{"name":"visible"}]}\n' })
    const source = tempDir('dsh-datasets-source-')
    writeFiles(source, { 'task.md': 'task\n' })
    const { service } = instance()
    const scope = { repo: repo.dir, operator: true as const }
    await expect(service.scaffoldDataset(scope, { id: 'fresh' })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(service.putItem(scope, { dataset: 'alpha', item: 'i1', files: [{ layer: 'visible', path: 'x.md', content: 'x' }] }))
      .rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(service.importItem(scope, { dataset: 'alpha', item: 'i1', sourceDir: source }))
      .rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // Nothing of the writes landed outside: only the descriptor we placed there.
    expect(readdirSync(outside)).toEqual(['alpha'])
    expect(existsSync(join(outside, 'alpha/items'))).toBe(false)
    expect(existsSync(join(outside, 'fresh'))).toBe(false)
  })

  it('a symlink deeper in the chain refuses (the layers dir), and nothing is created through it', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const outside = tempDir('dsh-datasets-outside-')
    rmSync(join(repo.dir, 'datasets/alpha/items/i1/visible'), { recursive: true })
    symlinkSync(outside, join(repo.dir, 'datasets/alpha/items/i1/visible'))
    const { service } = instance()
    await expect(service.putItem({ repo: repo.dir, operator: true }, {
      dataset: 'alpha', item: 'i1', files: [{ layer: 'visible', path: 'escape.md', content: 'x' }],
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(readdirSync(outside)).toEqual([])
  })

  it('a symlinked TARGET file is never written through, upsert or keepExisting', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const outside = tempDir('dsh-datasets-outside-')
    writeFiles(outside, { 'victim.md': 'keep me\n' })
    rmSync(join(repo.dir, 'datasets/alpha/items/i1/visible/task.md'))
    symlinkSync(join(outside, 'victim.md'), join(repo.dir, 'datasets/alpha/items/i1/visible/task.md'))
    const { service } = instance()
    const input = { dataset: 'alpha', item: 'i1', files: [{ layer: 'visible', path: 'task.md', content: 'overwrite\n' }] }
    await expect(service.putItem({ repo: repo.dir, operator: true }, input)).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(readFileSync(join(outside, 'victim.md'), 'utf8')).toBe('keep me\n')
    // …and the skeleton path (keepExisting) refuses the same way.
    await expect(service.scaffoldItem({ repo: repo.dir, operator: true }, { dataset: 'alpha', item: 'i1' }))
      .rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(readFileSync(join(outside, 'victim.md'), 'utf8')).toBe('keep me\n')
  })
})

describe('the write boundary module', () => {
  it('writes inside the root via temp + rename, leaving no temp behind', async () => {
    const root = tempDir('dsh-datasets-root-')
    expect(await writeFileWithinRoot(root, 'a/b/file.md', 'content\n')).toBe(true)
    expect(readFileSync(join(root, 'a/b/file.md'), 'utf8')).toBe('content\n')
    expect(readdirSync(join(root, 'a/b'))).toEqual(['file.md'])
    // keepExisting: an existing file is left alone (skeleton semantics).
    expect(await writeFileWithinRoot(root, 'a/b/file.md', 'other\n', { keepExisting: true })).toBe(false)
    expect(readFileSync(join(root, 'a/b/file.md'), 'utf8')).toBe('content\n')
    // A lexical escape refuses as before (INVALID_NAME).
    await expect(writeFileWithinRoot(root, '../file.md', 'x')).rejects.toMatchObject({ code: 'INVALID_NAME' })
  })

  it('a parent directory swapped for a symlink between the check and the write fails the write and leaves nothing outside', async () => {
    const root = tempDir('dsh-datasets-root-')
    const outside = tempDir('dsh-datasets-outside-')
    mkdirSync(join(root, 'sub'))
    await expect(writeFileWithinRoot(root, 'sub/file.md', 'x', {
      guard: (point) => {
        // The controlled substitution, at the pre-commit audit point: the
        // verified directory becomes a symlink.
        if (point !== 'beforeCommit') return
        rmSync(join(root, 'sub'), { recursive: true })
        symlinkSync(outside, join(root, 'sub'))
      },
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // The temp file that landed through the swap was removed; the target never appeared.
    expect(readdirSync(outside)).toEqual([])
    expect(lstatSync(join(root, 'sub')).isSymbolicLink()).toBe(true)
  })

  it('a source file substituted for a symlink fails closed at the open; a swapped intermediate dir fails containment', async () => {
    const root = tempDir('dsh-datasets-root-')
    const outside = tempDir('dsh-datasets-outside-')
    writeFiles(root, { 'real.md': 'real\n', 'dir/inner.md': 'inner\n' })
    writeFiles(outside, { 'secret.md': 'secret\n' })
    expect((await readFileWithinRoot(root, 'real.md')).toString()).toBe('real\n')
    // Substitution of the file itself: O_NOFOLLOW fails the open (ELOOP).
    rmSync(join(root, 'real.md'))
    symlinkSync(join(outside, 'secret.md'), join(root, 'real.md'))
    await expect(readFileWithinRoot(root, 'real.md')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // Substitution of an intermediate directory: the resolved path leaves the root.
    rmSync(join(root, 'dir'), { recursive: true })
    symlinkSync(outside, join(root, 'dir'))
    await expect(readFileWithinRoot(root, 'dir/secret.md')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // A directory at the source path: the opened fd says not-a-regular-file (fstat, not a second path lookup).
    mkdirSync(join(root, 'somedir'))
    await expect(readFileWithinRoot(root, 'somedir')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
  })
})

describe('exclusive temp writes and ownership-tracked cleanup', () => {
  it('a few pre-placed temp names are never opened: the write completes under a fresh name, the sentinel byte-identical', async () => {
    const root = tempDir('dsh-datasets-root-')
    const outside = tempDir('dsh-datasets-outside-')
    writeFiles(outside, { 'sentinel.md': 'the external original\n' })
    // The candidate namespace's first band pre-placed as symlinks: the write
    // must skip them — NEVER open one for writing — and land under a fresh name.
    for (let n = 0; n < 16; n++) {
      symlinkSync(join(outside, 'sentinel.md'), join(root, `file.md.${process.pid}.${n}.tmp`))
    }
    expect(await writeFileWithinRoot(root, 'file.md', 'payload\n')).toBe(true)
    expect(readFileSync(join(root, 'file.md'), 'utf8')).toBe('payload\n')
    // The acceptance is the external ORIGINAL's bytes: had any pre-placed name
    // been opened for writing, the sentinel would be gone.
    expect(readFileSync(join(outside, 'sentinel.md'), 'utf8')).toBe('the external original\n')
    expect(readdirSync(outside)).toEqual(['sentinel.md'])
    // …and the pre-placed links themselves are not ours to delete: all remain.
    expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toHaveLength(16)
  })

  it('a fully pre-placed temp namespace forces a coded refusal — never a write through somebody else\'s file', async () => {
    const root = tempDir('dsh-datasets-root-')
    const outside = tempDir('dsh-datasets-outside-')
    writeFiles(outside, { 'sentinel.md': 'the external original\n' })
    for (let n = 0; n < 256; n++) {
      symlinkSync(join(outside, 'sentinel.md'), join(root, `file.md.${process.pid}.${n}.tmp`))
    }
    await expect(writeFileWithinRoot(root, 'file.md', 'payload\n')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(readFileSync(join(outside, 'sentinel.md'), 'utf8')).toBe('the external original\n')
    expect(readdirSync(outside)).toEqual(['sentinel.md'])
    expect(existsSync(join(root, 'file.md'))).toBe(false)
  })

  it('the pre-placement probe, verbatim: temp-name symlinks beside the target — scaffoldDataset refuses and the sentinel is byte-identical', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const outside = tempDir('dsh-datasets-outside-')
    writeFiles(outside, { 'sentinel.md': 'the external original\n' })
    const dir = join(repo.dir, 'datasets/temporary-link')
    mkdirSync(dir, { recursive: true })
    for (let n = 0; n < 256; n++) {
      symlinkSync(join(outside, 'sentinel.md'), join(dir, `dataset.json.${process.pid}.${n}.tmp`))
    }
    const { service } = instance()
    await expect(service.scaffoldDataset({ repo: repo.dir, operator: true }, { id: 'temporary-link' }))
      .rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // 操作报错不等于未发生越界写 — the acceptance is the external ORIGINAL's
    // bytes, not the error: nothing outside was created, deleted, or written.
    expect(readFileSync(join(outside, 'sentinel.md'), 'utf8')).toBe('the external original\n')
    expect(readdirSync(outside)).toEqual(['sentinel.md'])
    expect(existsSync(join(dir, 'dataset.json'))).toBe(false)
  })

  it('a foreign real file swapped in for the temp between write and commit is left alone (identity mismatch)', async () => {
    const root = tempDir('dsh-datasets-root-')
    mkdirSync(join(root, 'sub'))
    await expect(writeFileWithinRoot(root, 'sub/file.md', 'ours\n', {
      guard: (point, path) => {
        if (point !== 'beforeCommit') return
        rmSync(path)
        writeFileSync(path, 'foreign — not ours\n')
      },
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // Cleanup deletes only what is provably ours: the foreign replacement stands.
    const leftovers = readdirSync(join(root, 'sub')).filter(name => name.endsWith('.tmp'))
    expect(leftovers).toHaveLength(1)
    expect(readFileSync(join(root, 'sub', leftovers[0]!), 'utf8')).toBe('foreign — not ours\n')
    expect(existsSync(join(root, 'sub/file.md'))).toBe(false)
  })

  it('a foreign file swapped in after the rename is left alone; the refusal is still coded', async () => {
    const root = tempDir('dsh-datasets-root-')
    mkdirSync(join(root, 'sub'))
    await expect(writeFileWithinRoot(root, 'sub/file.md', 'ours\n', {
      guard: (point, path) => {
        if (point !== 'afterRename') return
        rmSync(path)
        writeFileSync(path, 'foreign — not ours\n')
      },
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(readFileSync(join(root, 'sub/file.md'), 'utf8')).toBe('foreign — not ours\n')
  })

  it('a real-directory rename-swap between write and rename is caught by inode, where a path-string compare is blind', async () => {
    const root = tempDir('dsh-datasets-root-')
    const aside = join(root, 'sub-aside')
    mkdirSync(join(root, 'sub'))
    await expect(writeFileWithinRoot(root, 'sub/file.md', 'ours\n', {
      guard: (point) => {
        if (point !== 'beforeCommit') return
        renameSync(join(root, 'sub'), aside)
        mkdirSync(join(root, 'sub'))
      },
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    // The checked parent's inode changed: coded refusal; the fresh directory
    // gains nothing of ours, and the attacker's move — not our write — is
    // what carried the temp into the renamed-away directory (inside the root).
    expect(readdirSync(join(root, 'sub'))).toEqual([])
    expect(readdirSync(aside)).toHaveLength(1)
    expect(readFileSync(join(aside, readdirSync(aside)[0]!), 'utf8')).toBe('ours\n')
  })
})

describe('the dispose guard', () => {
  it('every sampled verb and the live store faces refuse coded after dispose; dispose is idempotent', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const { service } = instance()
    await service.registry.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    service.dispose()
    service.dispose() // idempotent
    const disposed = { name: 'DatasetsDisposedError', code: 'disposed' }
    await expect(service.list({ repo: repo.dir })).rejects.toMatchObject(disposed)
    await expect(service.read({ repo: repo.dir }, { dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' }))
      .rejects.toMatchObject(disposed)
    await expect(service.putItem({ repo: repo.dir, operator: true }, { dataset: 'alpha', item: 'i3' }))
      .rejects.toMatchObject(disposed)
    await expect(service.worktreePath({ repo: repo.dir }, 'alpha')).rejects.toMatchObject(disposed)
    expect(() => service.capabilities()).toThrowError(DatasetsDisposedError)
    expect(() => service.registry).toThrowError(DatasetsDisposedError)
    expect(() => service.organizing).toThrowError(DatasetsDisposedError)
    // The refusal names the package (the tab's error surface classifies by text).
    await expect(service.list({ repo: repo.dir })).rejects.toThrowError(/@khorsheed\/dsh-datasets: list after dispose/)
  })

  it('an in-flight write racing dispose refuses at the write boundary and writes nothing', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const { service } = instance()
    // putItem passes its entry guard, then awaits git (toplevelOf): the dispose
    // lands synchronously in that window, before the first file write.
    const pending = service.putItem({ repo: repo.dir, operator: true }, {
      dataset: 'alpha', item: 'i3', files: [{ layer: 'visible', path: 'raced.md', content: 'x' }],
    })
    service.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'disposed' })
    // Refused AT the boundary: the file was never written (the in-root mkdir
    // tree of a refused write matches the old failure shape — the boundary's
    // guarantee is that nothing lands OUTSIDE the root).
    expect(existsSync(join(repo.dir, 'datasets/alpha/items/i3/visible/raced.md'))).toBe(false)
  })

  it('a rebuild over the same roots reads what the disposed instance wrote', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const first = instance()
    await first.service.registry.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    first.service.dispose()
    const reborn = createDatasetsService(first.options)
    expect(reborn.registry.entries().map(entry => entry.id)).toEqual(['lib'])
    const listed = await reborn.list({ repo: reborn.registry.get('lib')!.commonDir, operator: true })
    if (listed.kind !== 'datasets') throw new Error('expected datasets result')
    expect(listed.datasets.map(dataset => dataset.id).sort()).toEqual(['alpha', 'beta'])
  })

  it('apply wires disposal to the borrowed Context\'s teardown', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: 'datasets-boundary-test',
      apply: (pluginCtx: Context) => {
        apply(pluginCtx, {})
      },
    })
    await fiber.await()
    const service = ctx.get('datasets') as DatasetsService
    // Alive: the service works (and the config defaults hold).
    expect(service.capabilities()).toEqual(ALL_AVAILABLE)
    await fiber.dispose()
    await expect(service.list({ repo: repo.dir })).rejects.toMatchObject({ code: 'disposed' })
  })

  it('Remote verbs refuse coded once the instance service is disposed', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const { service } = instance()
    const { fiber, remote } = await bench(service)
    await remote.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    service.dispose()
    await expect(remote.registry()).rejects.toMatchObject({ code: 'disposed' })
    await expect(remote.list({ repo: 'lib' })).rejects.toMatchObject({ code: 'disposed' })
    await expect(remote.scaffoldDataset({ repo: 'lib', id: 'fresh' })).rejects.toMatchObject({ code: 'disposed' })
    await fiber.dispose()
  })
})

describe('the capabilities descriptor', () => {
  it('defaults to all available with no reasons — today\'s local behavior', () => {
    const { service } = instance()
    expect(service.capabilities()).toEqual(ALL_AVAILABLE)
  })

  it('the factory options mark groups unavailable with a reason; empty strings and unknown keys are no-ops', () => {
    const { service } = instance({
      capabilities: {
        fileWrite: 'file writes are not admitted in this deployment',
        delete: 'deletion is not admitted in this deployment',
        registration: '',
        ...({ unknownGroup: 'ignored' } as Record<string, string>),
      },
    })
    expect(service.capabilities()).toEqual({
      ...ALL_AVAILABLE,
      fileWrite: { available: false, reason: 'file writes are not admitted in this deployment' },
      delete: { available: false, reason: 'deletion is not admitted in this deployment' },
    })
  })

  it('apply carries the plugin config through, and the Remote verb serves the descriptor', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: 'datasets-capabilities-test',
      apply: (pluginCtx: Context) => {
        apply(pluginCtx, { capabilities: { agentOrganize: 'no sessions can be opened in this deployment' } })
      },
    })
    await fiber.await()
    const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
    const service = ctx.get('datasets') as DatasetsService
    expect(remote.capabilities()).toEqual({
      ...ALL_AVAILABLE,
      agentOrganize: { available: false, reason: 'no sessions can be opened in this deployment' },
    })
    // Teardown disposes the service (the ctx.effect wiring): the held handle
    // refuses coded afterwards. The Remote face itself unregisters with its fiber.
    await fiber.dispose()
    expect(() => service.capabilities()).toThrowError(DatasetsDisposedError)
  })
})
