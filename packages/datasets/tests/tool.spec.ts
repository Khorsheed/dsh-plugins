/**
 * The model-facing tools over the registry (T73): `datasets_list` returns
 * references, never paths; every `dataset` argument is a `<id>/<set>`
 * reference, and the three ways it can be wrong each answer with a sentence
 * the agent can act on; the readable layers come from the registration, while
 * the operator view (tab, CLI) stays unfiltered; `put_item` writes only into
 * a registration's authoring checkout.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatasetsService, type DatasetsService } from '../src/service.ts'
import { datasetToolDefinitions } from '../src/tool.ts'
import { cleanup, makeFixtureRepo, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo
let state: string
let service: DatasetsService

/** Run one tool by name with the given arguments. */
async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const definition = datasetToolDefinitions(service, { group: 'all' }).find(tool => tool.name === name)
  if (definition === undefined) throw new Error(`no tool ${name}`)
  return await (definition as unknown as { execute: (args: unknown, ctx: unknown) => Promise<unknown> })
    .execute(args, {})
}

/** Every string anywhere inside a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

beforeEach(async () => {
  repo = makeFixtureRepo()
  state = mkdtempSync(join(tmpdir(), 'dsh-tools-'))
  service = createDatasetsService({
    materializedRoot: join(state, 'materialized'),
    registryPath: join(state, 'registry.json'),
    bindingsRoot: join(state, 'bindings'),
  })
})

afterEach(() => {
  cleanup(repo.dir)
  cleanup(state)
})

describe('datasets_list', () => {
  it('returns one row per registered set, with references and no path anywhere', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    const answer = await call('datasets_list', {}) as { datasets: Array<Record<string, unknown>> }
    expect(answer.datasets.map(row => row.ref)).toEqual(['lib/alpha', 'lib/beta'])
    expect(answer.datasets[0]).toEqual({
      ref: 'lib/alpha',
      title: 'Alpha dataset',
      trackedRef: 'main',
      latest: { commit: repo.commit, date: expect.any(String) },
      layers: ['visible'],
    })
    // No experiments field, and no string that is a path.
    expect(answer.datasets[0]).not.toHaveProperty('experiments')
    for (const text of strings(answer)) {
      expect(text.startsWith('/')).toBe(false)
      expect(text.startsWith('~/')).toBe(false)
    }
  })

  it('narrows by query, and an empty registry lists nothing', async () => {
    expect(await call('datasets_list', {})).toEqual({ datasets: [] })
    await service.registry.register({ path: repo.dir, id: 'lib' })
    const answer = await call('datasets_list', { query: 'ALPHA' }) as { datasets: Array<{ ref: string }> }
    expect(answer.datasets.map(row => row.ref)).toEqual(['lib/alpha'])
  })

  it('skips a registration whose tracked branch is gone instead of failing the list', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib' })
    const other = makeFixtureRepo()
    try {
      await service.registry.register({ path: other.dir, id: 'other' })
      // Point `other` at a branch that is then deleted.
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['branch', '-q', 'walk'], { cwd: other.dir })
      await service.registry.update({ id: 'other', trackedRef: 'walk' })
      execFileSync('git', ['branch', '-q', '-D', 'walk'], { cwd: other.dir })
      const answer = await call('datasets_list', {}) as { datasets: Array<{ ref: string }> }
      expect(answer.datasets.map(row => row.ref)).toEqual(['lib/alpha', 'lib/beta'])
    } finally {
      cleanup(other.dir)
    }
  })
})

describe('the dataset argument — three refusals', () => {
  beforeEach(async () => {
    await service.registry.register({ path: repo.dir, id: 'lib' })
  })

  it('a path is refused and the refusal names the id to use', async () => {
    await expect(call('datasets_show', { dataset: repo.dir }))
      .rejects.toThrow(/not a path: .* is registered as "lib" — pass "lib\/<set>" \(lib\/alpha, lib\/beta\) \[PATH_NOT_REF\]/)
  })

  it('an ambiguous name lists the candidates and says to use ask_user_question', async () => {
    const error = await call('datasets_show', { dataset: 'a' }).catch((caught: unknown) => caught as Error)
    expect(error.message).toContain('lib/alpha')
    expect(error.message).toContain('lib/beta')
    expect(error.message).toContain('use ask_user_question to let the person choose')
    expect(error.message).toContain('[AMBIGUOUS_DATASET]')
  })

  it('an unregistered repository is refused without being read', async () => {
    const elsewhere = makeFixtureRepo()
    try {
      const error = await call('datasets_read', {
        dataset: elsewhere.dir, item: 'i1', layer: 'visible', path: 'task.md',
      }).catch((caught: unknown) => caught as Error)
      expect(error.message).toContain('is not registered in this deployment')
      expect(error.message).toContain('Ask the person to register it on the Datasets tab')
      expect(error.message).toContain('Do not read that directory yourself')
      expect(error.message).toContain('[NOT_REGISTERED]')
    } finally {
      cleanup(elsewhere.dir)
    }
  })
})

describe('layers come from the registration', () => {
  it('the modelFacing floor by default: a sensitive layer is refused to the agent, open to the operator', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib' })
    await expect(call('datasets_read', { dataset: 'lib/alpha', item: 'i1', layer: 'hidden', path: 'answer.md' }))
      .rejects.toThrow()
    // The descriptor passes through verbatim (it names every layer); what is
    // filtered is what the agent can reach — the layers and their files.
    type Shown = { dataset: { layers: string[] }; datasetLayers: Record<string, string[]>; items: Array<{ layers: Record<string, string[]> }> }
    const shown = await call('datasets_show', { dataset: 'lib/alpha', item: 'i1' }) as Shown
    expect(shown.dataset.layers).toEqual(['visible'])
    expect(Object.keys(shown.datasetLayers)).toEqual(['visible'])
    expect(Object.keys(shown.items[0]!.layers)).toEqual(['visible'])

    // The operator view (the tab, the CLI) is the human's and is unfiltered.
    const entry = service.registry.get('lib')!
    const operator = await service.show({ repo: entry.commonDir, ref: 'main', operator: true }, 'alpha', 'i1') as unknown as Shown
    expect(Object.keys(operator.items[0]!.layers).sort()).toEqual(['hidden', 'visible'])
  })

  it('a layer the person granted in the registration is readable', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib', sets: { alpha: { layers: ['hidden', 'visible'] } } })
    const listed = await call('datasets_list', { query: 'lib/alpha' }) as { datasets: Array<{ layers: string[] }> }
    expect(listed.datasets[0]?.layers).toEqual(['hidden', 'visible'])
    const shown = await call('datasets_show', { dataset: 'lib/alpha', item: 'i1' }) as {
      items: Array<{ layers: Record<string, string[]> }>
    }
    expect(Object.keys(shown.items[0]!.layers).sort()).toEqual(['hidden', 'visible'])
  })

  it('worktree_path materializes only the registered layers, read-only, outside the repository', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib' })
    const view = await call('datasets_worktree_path', { dataset: 'lib/alpha' }) as {
      path: string; commit: string; layers: string[]; reused: boolean
    }
    expect(view.commit).toBe(repo.commit)
    expect(view.layers).toEqual(['visible'])
    expect(view.path.startsWith(join(state, 'materialized'))).toBe(true)
    expect(existsSync(join(view.path, 'datasets/alpha/items/i1/visible'))).toBe(true)
    expect(existsSync(join(view.path, 'datasets/alpha/items/i1/hidden'))).toBe(false)
  })
})

describe('datasets_put_item', () => {
  it('is refused on a registration with no authoring checkout', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib', authoringCheckout: null })
    await expect(call('datasets_put_item', {
      dataset: 'lib/beta', item: 'b9', files: [{ layer: 'visible', path: 'task.md', content: 'x\n' }],
    })).rejects.toThrow(/"lib" has no authoring checkout.*\[NO_AUTHORING_CHECKOUT\]/)
    expect(existsSync(join(repo.dir, 'datasets/beta/items/b9'))).toBe(false)
  })

  it('writes into the authoring checkout when the registration names one', async () => {
    await service.registry.register({ path: repo.dir, id: 'lib', authoringCheckout: repo.dir })
    await call('datasets_put_item', {
      dataset: 'lib/beta', item: 'b9', files: [{ layer: 'visible', path: 'task.md', content: 'drafted\n' }],
    })
    expect(readFileSync(join(repo.dir, 'datasets/beta/items/b9/visible/task.md'), 'utf8')).toBe('drafted\n')
  })
})
