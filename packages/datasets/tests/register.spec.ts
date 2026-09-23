/** The register explicit mapping: role re-homing, conflict safety, worktree patterns. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDescriptor } from '../src/dataset.ts'
import { createDatasetsService, type DatasetScope } from '../src/service.ts'
import { cleanup, commitAll, git, writeFiles, stateOptions } from './helpers.ts'

let dir: string | undefined
let worktreeRoot: string | undefined
let bindingsRoot: string | undefined

afterEach(() => {
  if (dir !== undefined) cleanup(dir)
  for (const root of [worktreeRoot, bindingsRoot]) {
    if (root !== undefined) cleanup(root)
  }
  dir = undefined
  worktreeRoot = undefined
  bindingsRoot = undefined
})

const service = () => createDatasetsService({
  ...stateOptions(worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-state-'))),
  bindingsRoot: bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
})

/**
 * The register fixture, mirroring the conformance sample's shape: item `p0`
 * exists ONLY through register (free-form files at the item root), item `c1`
 * follows the directory convention, and a sensitive dataset-level layer
 * (`verify/helpers/`) rides the shared path.
 */
function makeRegisterRepo(): { dir: string; commit: string } {
  dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-reg-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, {
    'datasets/gamma/dataset.json': `${JSON.stringify({
      id: 'gamma',
      layers: [
        { name: 'visible', modelFacing: true },
        { name: 'grading', modelFacing: false },
        { name: 'verify', modelFacing: false },
      ],
      register: [
        { item: 'p0', layer: 'visible', files: ['task.md', 'docs/*.md'] },
        { item: 'p0', layer: 'grading', files: ['answers/*'] },
      ],
    }, null, 2)}\n`,
    'datasets/gamma/items/p0/task.md': 'p0 task\n',
    'datasets/gamma/items/p0/docs/intro.md': 'intro\n',
    'datasets/gamma/items/p0/docs/deep/spec.md': 'too deep for docs/*\n',
    'datasets/gamma/items/p0/answers/rubric.yml': 'rubric\n',
    'datasets/gamma/items/c1/item.json': '{"difficulty":"easy"}\n',
    'datasets/gamma/items/c1/visible/task.md': 'c1 task\n',
    'datasets/gamma/verify/helpers/lib.sh': '#!/bin/sh\n',
  })
  return { dir, commit: commitAll(dir, 'register fixture') }
}

describe('register validation (shape)', () => {
  const okLayers = [{ name: 'visible', modelFacing: true }]
  it('accepts a well-formed register and rejects bad patterns', () => {
    const ok = validateDescriptor({
      id: 'g', layers: okLayers,
      register: [{ item: 'p0', layer: 'visible', files: ['task.md', 'docs/*.md'] }],
    }, 't')
    expect(ok.register).toEqual([{ item: 'p0', layer: 'visible', files: ['task.md', 'docs/*.md'] }])
    expect(validateDescriptor({ id: 'g', layers: okLayers }, 't').register).toEqual([])

    const bad = (files: string[]) => validateDescriptor({
      id: 'g', layers: okLayers, register: [{ item: 'p0', layer: 'visible', files }],
    }, 't')
    expect(() => bad(['/abs.md'])).toThrowError(/inside the item directory/)
    expect(() => bad(['../x.md'])).toThrowError(/inside the item directory/)
    expect(() => bad(['deep/**/x.md'])).toThrowError(/inside the item directory/)
    expect(() => bad(['!neg.md'])).toThrowError(/inside the item directory/)
    expect(() => bad(['item.json'])).toThrowError(/item.json/)
    expect(() => validateDescriptor({
      id: 'g', layers: okLayers, register: [{ item: 'p0', layer: 'ghost', files: ['x.md'] }],
    }, 't')).toThrowError(/undeclared layer/)
  })
})

describe('register read model', () => {
  it('re-homes registered files into their role layers and lists register-only items', async () => {
    const repo = makeRegisterRepo()
    const result = await service().list({ repo: repo.dir, operator: true }, 'gamma')
    if (result.kind !== 'items') throw new Error('expected items result')
    const p0 = result.items.find(item => item.id === 'p0')
    expect(p0?.layers['visible']).toEqual(['docs/intro.md', 'task.md']) // docs/* is single-level: deep/spec.md stays out
    expect(p0?.layers['grading']).toEqual(['answers/rubric.yml'])
    const c1 = result.items.find(item => item.id === 'c1')
    expect(c1?.layers['visible']).toEqual(['task.md'])
    // A register-claimed file must not ALSO surface under its physical
    // directory as a pseudo-layer (P0's answers/ is fully claimed). The
    // partially-claimed docs/ keeps only its unclaimed leftover
    // (docs/deep/spec.md — the single-level glob never reaches it).
    expect(Object.keys(p0?.layers ?? {}).sort()).toEqual(['docs', 'grading', 'visible'])
    expect(p0?.layers['docs']).toEqual(['deep/spec.md'])
    // The dataset-level shared layer rides along; the too-deep glob leftover is passthrough.
    expect(result.datasetLayers['verify']).toEqual(['helpers/lib.sh'])
    expect(result.passthrough).toEqual(['items/p0/docs/deep/spec.md'])
  })

  it('read resolves a registered display path to its git object', async () => {
    const repo = makeRegisterRepo()
    const ok = await service().read({ repo: repo.dir, operator: true }, {
      dataset: 'gamma', item: 'p0', layer: 'grading', path: 'answers/rubric.yml',
    })
    expect(ok.content).toBe('rubric\n')
    // The convention fallback still works for convention files.
    const convention = await service().read({ repo: repo.dir, operator: true }, {
      dataset: 'gamma', item: 'c1', layer: 'visible', path: 'task.md',
    })
    expect(convention.content).toBe('c1 task\n')
  })

  it('the modelFacing floor filters registered layers exactly like directory layers', async () => {
    const repo = makeRegisterRepo()
    const floored = await service().list({ repo: repo.dir }, 'gamma')
    if (floored.kind !== 'items') throw new Error('expected items result')
    expect(Object.keys(floored.items.find(item => item.id === 'p0')?.layers ?? {})).toEqual(['visible'])
    await expect(service().read({ repo: repo.dir }, {
      dataset: 'gamma', item: 'p0', layer: 'grading', path: 'answers/rubric.yml',
    })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    // An explicit whitelist listing the sensitive layer is a deliberate act.
    const deliberate = await service().read({ repo: repo.dir, layers: ['visible', 'grading'] }, {
      dataset: 'gamma', item: 'p0', layer: 'grading', path: 'answers/rubric.yml',
    })
    expect(deliberate.content).toBe('rubric\n')
  })

  it('a worktree of the default floor physically contains the registered visible paths only', async () => {
    const repo = makeRegisterRepo()
    const wt = await service().worktreePath({ repo: repo.dir }, 'gamma')
    expect(wt.layers).toEqual(['visible'])
    expect(existsSync(join(wt.path, 'datasets/gamma/items/p0/task.md'))).toBe(true)
    expect(existsSync(join(wt.path, 'datasets/gamma/items/p0/docs/intro.md'))).toBe(true)
    expect(existsSync(join(wt.path, 'datasets/gamma/items/p0/answers'))).toBe(false)
    expect(existsSync(join(wt.path, 'datasets/gamma/verify'))).toBe(false)
    expect(readFileSync(join(wt.path, 'datasets/gamma/items/p0/task.md'), 'utf8')).toBe('p0 task\n')
  })

  it('fails loud on a layout conflict and on a dangling exact path', async () => {
    const repo = makeRegisterRepo()
    writeFiles(repo.dir, {
      'datasets/gamma/items/p0/visible/task.md': 'convention copy\n',
    })
    commitAll(repo.dir, 'conflict')
    await expect(service().list({ repo: repo.dir, operator: true }, 'gamma'))
      .rejects.toMatchObject({ code: 'SHAPE_INVALID' })

    writeFiles(repo.dir, {
      'datasets/gamma/dataset.json': `${JSON.stringify({
        id: 'gamma',
        layers: [{ name: 'visible', modelFacing: true }],
        register: [{ item: 'p0', layer: 'visible', files: ['missing.md'] }],
      }, null, 2)}\n`,
    })
    commitAll(repo.dir, 'dangling')
    await expect(service().list({ repo: repo.dir, operator: true }, 'gamma'))
      .rejects.toMatchObject({ code: 'SHAPE_INVALID' })
  })
})
