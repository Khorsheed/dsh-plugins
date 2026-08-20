/** Layout convention + descriptor shape validation + git-object reads. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSafeRelativePath, DatasetsError, listDatasetIds, listItems, loadDescriptor, loadItem,
  summarizeDataset, validateDescriptor,
} from '../src/dataset.ts'
import { showFile } from '../src/git.ts'
import { cleanup, commitAll, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  repo = undefined
})

describe('descriptor shape validation', () => {
  it('accepts a well-formed descriptor and defaults modelFacing to true', () => {
    const descriptor = validateDescriptor({
      id: 'alpha',
      layers: [{ name: 'visible' }, { name: 'hidden', modelFacing: false }],
      itemMetaSchema: { type: 'object' },
      anything: 'else',
    }, 'test')
    expect(descriptor.layers).toEqual([
      { name: 'visible', modelFacing: true },
      { name: 'hidden', modelFacing: false },
    ])
    expect(descriptor.itemMetaSchema).toEqual({ type: 'object' })
    expect(descriptor.raw['anything']).toBe('else')
  })

  it('rejects malformed shapes', () => {
    expect(() => validateDescriptor(null, 't')).toThrowError(DatasetsError)
    expect(() => validateDescriptor({ id: 'a' }, 't')).toThrowError(/layers/)
    expect(() => validateDescriptor({ id: 'a', layers: [] }, 't')).toThrowError(/layers/)
    // 'items' is the reserved item container — it may not name a layer.
    expect(() => validateDescriptor({ id: 'a', layers: [{ name: 'items' }] }, 't')).toThrowError(/reserved/)
    expect(() => validateDescriptor({ id: 'a', layers: [{ name: 'x' }, { name: 'x' }] }, 't')).toThrowError(/duplicate/)
    expect(() => validateDescriptor({ id: 'a', layers: [{ name: 'x', modelFacing: 'no' }] }, 't')).toThrowError(/modelFacing/)
    expect(() => validateDescriptor({ id: 'a', layers: [{ name: 'x' }], itemMetaSchema: 'nope' }, 't')).toThrowError(/itemMetaSchema/)
    expect(() => validateDescriptor({ id: 'bad id', layers: [{ name: 'x' }] }, 't')).toThrowError(/id/)
  })
})

describe('path safety', () => {
  it('rejects traversal and absolute paths', () => {
    expect(() => assertSafeRelativePath('../x')).toThrowError(DatasetsError)
    expect(() => assertSafeRelativePath('a/../../b')).toThrowError(DatasetsError)
    expect(() => assertSafeRelativePath('')).toThrowError(DatasetsError)
    expect(assertSafeRelativePath('a/b/c.md')).toBe('a/b/c.md')
  })
})

describe('layout queries over git objects', () => {
  it('lists dataset ids, summaries, and items at a commit', async () => {
    repo = makeFixtureRepo()
    await expect(listDatasetIds(repo.dir, repo.commit)).resolves.toEqual(['alpha', 'beta'])
    const summary = await summarizeDataset(repo.dir, repo.commit, 'alpha')
    expect(summary).toMatchObject({
      id: 'alpha',
      name: 'Alpha dataset',
      layers: ['visible', 'hidden'],
      nonModelFacingLayers: ['hidden'],
      itemCount: 2,
    })
    const items = await listItems(repo.dir, repo.commit, 'alpha')
    expect(items.map(item => item.id)).toEqual(['i1', 'i2'])
    expect(items[0]?.metadata).toEqual({ difficulty: 'hard' })
    expect(items[0]?.layers['visible']).toEqual(['task.md'])
    expect(items[0]?.layers['hidden']).toEqual(['notes.md'])
  })

  it('passes descriptor-adjacent files through (describe reads the raw object)', async () => {
    repo = makeFixtureRepo()
    const descriptor = await loadDescriptor(repo.dir, repo.commit, 'alpha')
    expect(descriptor.raw['extra']).toEqual({ passthrough: true })
    await expect(showFile(repo.dir, repo.commit, 'datasets/alpha/handbook.md')).resolves.toBe('# handbook passthrough\n')
  })

  it('fails loud for a missing dataset or item', async () => {
    repo = makeFixtureRepo()
    await expect(loadDescriptor(repo.dir, repo.commit, 'nope')).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' })
    await expect(loadItem(repo.dir, repo.commit, 'alpha', 'nope')).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
  })

  it('reads pinned content while the working tree keeps evolving (no copy)', async () => {
    repo = makeFixtureRepo()
    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'task one v2\n' })
    const v2 = commitAll(repo.dir, 'evolve')
    // The pinned commit still serves v1 from the git object, the new HEAD v2.
    await expect(showFile(repo.dir, repo.commit, 'datasets/alpha/items/i1/visible/task.md')).resolves.toBe('task one v1\n')
    await expect(showFile(repo.dir, v2, 'datasets/alpha/items/i1/visible/task.md')).resolves.toBe('task one v2\n')
  })
})
