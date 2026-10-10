/**
 * The instance-mounting seam: the package root's public exports
 * (`createDatasetsService` / `DatasetsRemoteService` and their option types)
 * let a consumer run independent instances on isolated Contexts, each over its
 * own registry/bindings/materialized/proposals roots. Two instances share
 * nothing, and no Remote verb performs an Agent lookup — the one probed host
 * surface is the `agentPresets` registry slice behind `organizingSetup`
 * (fail-open), never an agent instance.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDatasetsService, DatasetsRemoteService,
  type DatasetsRemoteConfig, type DatasetsService, type DatasetsServiceOptions, type DatasetScope, type OrganizingSetup,
} from '@khorsheed/dsh-datasets'
import {
  cleanup, makeFixtureRepo, makeJudgingRepo, writeLegacyBinding, type FixtureRepo,
} from './helpers.ts'

let roots: string[] = []
let repos: FixtureRepo[] = []

afterEach(() => {
  for (const repo of repos) cleanup(repo.dir)
  for (const root of roots) cleanup(root)
  repos = []
  roots = []
})

/** An independent instance over its own throwaway roots, built from the public factory. */
function instance(organizing?: OrganizingSetup): { root: string; options: DatasetsServiceOptions; service: DatasetsService } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-datasets-instance-'))
  roots.push(root)
  const options: DatasetsServiceOptions = {
    materializedRoot: join(root, 'materialized'),
    registryPath: join(root, 'registry.json'),
    bindingsRoot: join(root, 'bindings'),
    proposalsRoot: join(root, 'proposals'),
    ...(organizing === undefined ? {} : { organizing }),
  }
  return { root, options, service: createDatasetsService(options) }
}

/** The operator read scope of one registration, resolved the way the Remote face resolves it. */
async function readScopeOf(service: DatasetsService, id: string): Promise<DatasetScope> {
  const entry = service.registry.get(id)
  if (entry === undefined) throw new Error(`not registered: ${id}`)
  return { repo: entry.commonDir, ref: (await service.registry.latest(entry)).commit, operator: true }
}

describe('two instances over disjoint roots share nothing', () => {
  it('registrations, reads, writes, bindings, materialized views and proposals stay per-instance', async () => {
    const [repoA, repoB] = [makeFixtureRepo(), makeJudgingRepo()]
    repos.push(repoA, repoB)
    const a = instance()
    const bHome = mkdtempSync(join(tmpdir(), 'dsh-datasets-home-'))
    roots.push(bHome)
    const b = instance({ preset: 'b-preset', datasetsHome: bHome })

    // The same registration id in both instances, over two repositories.
    const entryA = await a.service.registry.register({ path: repoA.dir, id: 'lib', authoringCheckout: repoA.dir })
    const entryB = await b.service.registry.register({ path: repoB.dir, id: 'lib', authoringCheckout: repoB.dir })
    expect(entryA.commonDir).not.toBe(entryB.commonDir)
    // Each registry file names only its own repository.
    expect(readFileSync(a.options.registryPath, 'utf8')).not.toBe(readFileSync(b.options.registryPath, 'utf8'))
    expect(a.service.registry.entries().map(entry => entry.commonDir)).toEqual([entryA.commonDir])
    expect(b.service.registry.entries().map(entry => entry.commonDir)).toEqual([entryB.commonDir])
    // The organizing config rides the options, not any shared state.
    expect(a.service.organizing.preset).toBe('')
    expect(b.service.organizing.preset).toBe('b-preset')

    // Reads resolve only the instance's own repository.
    const listA = await a.service.list(await readScopeOf(a.service, 'lib'))
    if (listA.kind !== 'datasets') throw new Error('expected datasets result')
    expect(listA.datasets.map(dataset => dataset.id).sort()).toEqual(['alpha', 'beta'])
    const listB = await b.service.list(await readScopeOf(b.service, 'lib'))
    if (listB.kind !== 'datasets') throw new Error('expected datasets result')
    expect(listB.datasets.map(dataset => dataset.id)).toEqual(['bench'])
    // The other instance's dataset ids are unknown on this side.
    await expect(a.service.show(await readScopeOf(a.service, 'lib'), 'bench'))
      .rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' })
    await expect(b.service.show(await readScopeOf(b.service, 'lib'), 'alpha'))
      .rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' })
    const read = await a.service.read(await readScopeOf(a.service, 'lib'), {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(read.content).toBe('task one v1\n')

    // A write lands only in the instance's own authoring checkout.
    const registryBBefore = readFileSync(b.options.registryPath, 'utf8')
    const written = await a.service.putItem({ repo: repoA.dir, operator: true }, {
      dataset: 'alpha', item: 'i1', files: [{ layer: 'visible', path: 'instance-a.md', content: 'written by instance A\n' }],
    })
    expect(written.written).toEqual(['datasets/alpha/items/i1/visible/instance-a.md'])
    expect(existsSync(join(repoA.dir, 'datasets/alpha/items/i1/visible/instance-a.md'))).toBe(true)
    expect(existsSync(join(repoB.dir, 'datasets/alpha'))).toBe(false)
    // …and touches nothing of the other instance, registry included.
    expect(readFileSync(b.options.registryPath, 'utf8')).toBe(registryBBefore)

    // The legacy-bindings import reads only the instance's own bindings root.
    const repoC = makeFixtureRepo()
    repos.push(repoC)
    writeLegacyBinding(a.options.bindingsRoot, 'session-1', { repoPath: repoC.dir })
    const imported = await a.service.registry.importBindings(a.service.bindingsRoot)
    expect(imported.imported).toMatchObject([{ created: true }])
    expect(a.service.registry.entries()).toHaveLength(2)
    const importedB = await b.service.registry.importBindings(b.service.bindingsRoot)
    expect(importedB).toEqual({ imported: [], dangling: [] })
    expect(b.service.registry.entries()).toHaveLength(1)

    // A materialized view lands only under the instance's own materialized root.
    const view = await a.service.worktreePath(await readScopeOf(a.service, 'lib'), 'beta')
    expect(view.path.startsWith(`${a.options.materializedRoot}/`)).toBe(true)
    expect(existsSync(b.options.materializedRoot)).toBe(false)

    // The proposal stores are rooted per instance.
    expect(a.service.proposals.root).toBe(a.options.proposalsRoot)
    expect(b.service.proposals.root).toBe(b.options.proposalsRoot)
    expect(a.service.proposals.list()).toEqual([])
    expect(b.service.proposals.list()).toEqual([])
  })

  it('the Remote class mounts the native face on an isolated Context over the instance service', async () => {
    const [repoA, repoB] = [makeFixtureRepo(), makeJudgingRepo()]
    repos.push(repoA, repoB)
    const a = instance()
    const b = instance()
    await a.service.registry.register({ path: repoA.dir, id: 'lib', authoringCheckout: repoA.dir })
    await b.service.registry.register({ path: repoB.dir, id: 'lib', authoringCheckout: repoB.dir })

    const ctx = new Context()
    ctx.provide('datasets', a.service)
    const config: DatasetsRemoteConfig = {}
    const fiber = ctx.plugin(DatasetsRemoteService, config)
    await fiber.await()
    const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
    try {
      // The face answers out of THIS instance's registry: the other instance's
      // repository — registered under the same id over there — never appears.
      const rows = await remote.registry()
      expect(rows).toHaveLength(1)
      const listed = await remote.list({ repo: 'lib' })
      if (listed.kind !== 'datasets') throw new Error('expected datasets result')
      expect(listed.datasets.map(dataset => dataset.id).sort()).toEqual(['alpha', 'beta'])
      const read = await remote.read({ repo: 'lib', dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' })
      expect(read.content).toBe('task one v1\n')
      // A write verb writes the instance's authoring checkout and nothing else.
      const scaffolded = await remote.scaffoldDataset({ repo: 'lib', id: 'fresh' })
      expect(scaffolded.written).toContain('datasets/fresh/dataset.json')
      expect(existsSync(join(repoA.dir, 'datasets/fresh/dataset.json'))).toBe(true)
      expect(existsSync(join(repoB.dir, 'datasets/fresh'))).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })
})

describe('no Remote verb performs an Agent lookup', () => {
  /**
   * Mount the class's real prototype over a recording `ctx.get`: any verb
   * reaching an agent-shaped host surface trips the poison, and the recorded
   * probes say exactly which host surfaces were consulted.
   */
  function remoteOver(service: DatasetsService, agentPresets?: unknown) {
    const probes: string[] = []
    const remote = Object.create(DatasetsRemoteService.prototype) as DatasetsRemoteService
    ;(remote as unknown as { ctx: unknown }).ctx = {
      datasets: service,
      get: (name: string) => {
        probes.push(name)
        if (/agent/i.test(name) && name !== 'agentPresets') throw new Error(`poisoned agent lookup: ${name}`)
        return name === 'agentPresets' ? agentPresets : undefined
      },
    }
    return { remote, probes }
  }

  it('the browsing and registry verbs probe nothing at all', async () => {
    const repo = makeFixtureRepo()
    repos.push(repo)
    const { service } = instance()
    const { remote, probes } = remoteOver(service)

    const preview = await remote.previewRepo({ path: repo.dir })
    expect(preview.sets.map(set => set.set).sort()).toEqual(['alpha', 'beta'])
    await remote.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    expect(await remote.registry()).toHaveLength(1)
    const listed = await remote.list({ repo: 'lib' })
    if (listed.kind !== 'datasets') throw new Error('expected datasets result')
    expect(listed.datasets).toHaveLength(2)
    await remote.list({ repo: 'lib', dataset: 'alpha' })
    await remote.show({ repo: 'lib', dataset: 'alpha', item: 'i1' })
    await remote.read({ repo: 'lib', dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' })
    await remote.readPassthrough({ repo: 'lib', dataset: 'alpha', path: 'handbook.md' })
    await remote.overview({ repo: 'lib' })
    await remote.itemBrief({ repo: 'lib', dataset: 'alpha', item: 'i1' })
    await remote.validate({ repo: 'lib' })
    await remote.importBindings()
    expect(remote.proposals()).toEqual([])
    await remote.pendingReview({ repo: 'lib' })
    await remote.deletePlan({ id: 'lib' })
    await remote.scaffoldDataset({ repo: 'lib', id: 'fresh' })
    expect(remote.unregister({ id: 'lib' })).toBe(true)
    // Every verb ran against plain request objects (none carries an agent) and
    // not one host surface was probed.
    expect(probes).toEqual([])
  })

  it("organizingSetup's one probe is the agentPresets registry slice, fail-open, never an agent instance", async () => {
    const { service } = instance()
    const { remote, probes } = remoteOver(service)
    // No slice on this host: the preset stays '' (the session keeps its default).
    await expect(remote.organizingSetup()).resolves.toMatchObject({ preset: '' })
    expect(probes).toEqual(['agentPresets'])
    // A poisoned slice — a stand-in for an agent lookup that must never happen —
    // degrades the same way rather than failing the verb.
    const throwing = remoteOver(service, { list: async () => { throw new Error('poisoned agent lookup') } })
    await expect(throwing.remote.organizingSetup()).resolves.toMatchObject({ preset: '' })
    expect(throwing.probes).toEqual(['agentPresets'])
    // A configured preset answers as-is without probing anything.
    const configured = remoteOver(createDatasetsService({
      ...instance().options,
      organizing: { preset: 'chosen', datasetsHome: '/home/user/datasets' },
    }))
    await expect(configured.remote.organizingSetup())
      .resolves.toEqual({ preset: 'chosen', datasetsHome: '/home/user/datasets' })
    expect(configured.probes).toEqual([])
  })
})
