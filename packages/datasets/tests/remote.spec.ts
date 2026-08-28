/**
 * The datasets Remote service: session binding resolution through the agent
 * parameter, whitelist enforcement on the Remote read paths (the SAME service
 * core as the tools), and bind/unbind writes landing in the plugin-owned
 * binding store.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import type { BindingSession } from '../src/binding.ts'
import { DatasetsRemoteService } from '../src/remote.ts'
import { createDatasetsService, resolveScope, type DatasetsService } from '../src/service.ts'
import { cleanup, makeFixtureRepo, type FixtureRepo } from './helpers.ts'

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

/** A minimal live-session fake: the binding store keys on the id alone. */
function fakeSession(): BindingSession {
  return { id: 's1' }
}

function agentOf(session: BindingSession): Agent {
  return { session } as unknown as Agent
}

/** Mount the Remote service over a real service core in a bare context. */
async function bench(defaultRepo = '') {
  const ctx = new Context()
  ctx.provide('datasets', createDatasetsService({
    worktreeRoot: worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
    bindingsRoot: bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
  }))
  const fiber = ctx.plugin(DatasetsRemoteService, { defaultRepo })
  await fiber.await()
  const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
  return { ctx, fiber, remote }
}

describe('DatasetsRemoteService', () => {
  it('bind records the binding, binding reads it, unbind clears it', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    expect(remote.binding(agent)).toBeNull()

    const recorded = await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    expect(recorded).toEqual({ repoPath: repo.dir, layers: ['visible'] })
    expect(remote.binding(agent)).toEqual({ repoPath: repo.dir, layers: ['visible'] })

    expect(remote.unbind(agent)).toBeNull()
    expect(remote.binding(agent)).toBeNull()
    await fiber.dispose()
  })

  it('previewRepo resolves the canonical toplevel and ignores the session binding', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    // A bound session must not narrow the preview (the binder is choosing the whitelist).
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    const result = await remote.previewRepo(agent, { path: `${repo.dir}/` })
    expect(result.repo).toBe(realpathSync(repo.dir))
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    // Declared layers arrive unfiltered — neither the binding's whitelist nor
    // the modelFacing floor narrows what the binder previews.
    expect(result.datasets[0]?.layers).toEqual(['visible', 'hidden'])
    await expect(remote.previewRepo(agent, { path: join(repo.dir, 'no-such-dir') }))
      .rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await fiber.dispose()
  })

  it('bind rejects a non-repository path loud and records nothing', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await expect(remote.bind(agent, { repoPath: join(repo.dir, 'no-such-dir') }))
      .rejects.toMatchObject({ code: 'NOT_A_REPO' })
    expect(remote.binding(agent)).toBeNull()
    await fiber.dispose()
  })

  it('list is the operator view: neither the binding whitelist nor the floor narrows it', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    const datasets = await remote.list(agent, {})
    if (datasets.kind !== 'datasets') throw new Error('expected datasets result')
    expect(datasets.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    // The binding whitelists ['visible'], yet the human sees every layer.
    expect([...datasets.datasets[0]?.layers ?? []].sort()).toEqual(['hidden', 'visible'])

    const items = await remote.list(agent, { dataset: 'alpha' })
    if (items.kind !== 'items') throw new Error('expected items result')
    const i1 = items.items.find(item => item.id === 'i1')
    expect(Object.keys(i1?.layers ?? {}).sort()).toEqual(['hidden', 'visible'])
    await fiber.dispose()
  })

  it('read is the operator view: a whitelisted-out (sensitive) layer still reads for the human', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    // The binding's whitelist constrains the agent's tools, never the tab.
    const sensitive = await remote.read(agent, {
      dataset: 'alpha', item: 'i1', layer: 'hidden', path: 'notes.md',
    })
    expect(sensitive.content).toBe('hidden notes v1\n')

    const ok = await remote.read(agent, {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(ok.content).toBe('task one v1\n')
    expect(ok.commit).toBe(repo.commit)
    await fiber.dispose()
  })

  it('show returns the descriptor passthrough and every layer (operator view)', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    const result = await remote.show(agent, { dataset: 'alpha', item: 'i1' })
    expect(result.commit).toBe(repo.commit)
    expect([...result.dataset.layers].sort()).toEqual(['hidden', 'visible'])
    expect(result.dataset.warnings.map(warning => warning.layer)).toEqual(['visible'])
    expect(result.datasetLayers).toEqual({ visible: ['guide.md'], hidden: ['answers.md'] })
    expect((result.descriptor['extra'] as Record<string, unknown>)['passthrough']).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(Object.keys(result.items[0]?.layers ?? {}).sort()).toEqual(['hidden', 'visible'])
    await fiber.dispose()
  })

  it('readPassthrough serves the passthrough zone to the operator (and stays off the agent tool surface)', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    // The human reads passthrough content regardless of the agent whitelist.
    const handbook = await remote.readPassthrough(agent, { dataset: 'alpha', path: 'handbook.md' })
    expect(handbook.content).toBe('# handbook passthrough\n')
    const meta = await remote.readPassthrough(agent, { dataset: 'alpha', path: 'items/i1/item.json' })
    expect(meta.content).toBe('{"difficulty":"hard"}\n')
    await expect(remote.readPassthrough(agent, { dataset: 'alpha', path: 'missing.md' }))
      .rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await fiber.dispose()
  })

  it('fails loud with no binding and no default, and falls back to the configured default repo', async () => {
    repo = makeFixtureRepo()
    const unbound = await bench()
    await expect(unbound.remote.list(agentOf(fakeSession()), {})).rejects.toMatchObject({ code: 'NO_REPO' })
    await unbound.fiber.dispose()

    const withDefault = await bench(repo.dir)
    const result = await withDefault.remote.list(agentOf(fakeSession()), {})
    if (result.kind !== 'datasets') throw new Error('expected datasets result')
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    await withDefault.fiber.dispose()
  })

  it('the datasets whitelist narrows the agent boundary but never the operator view', async () => {
    repo = makeFixtureRepo()
    const { ctx, fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, datasets: ['beta'] })

    // The tab (operator) still lists every dataset in the repo…
    const result = await remote.list(agent, {})
    if (result.kind !== 'datasets') throw new Error('expected datasets result')
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    const shown = await remote.show(agent, { dataset: 'alpha' })
    expect(shown.dataset.id).toBe('alpha')
    // …while the same session through the TOOL boundary keeps the whitelist.
    const service = ctx.get('datasets') as DatasetsService
    const binding = service.binding({ id: 's1' })
    const scope = resolveScope({}, binding, '')
    const toolView = await service.list(scope)
    if (toolView.kind !== 'datasets') throw new Error('expected datasets result')
    expect(toolView.datasets.map(summary => summary.id)).toEqual(['beta'])
    await fiber.dispose()
  })
})
