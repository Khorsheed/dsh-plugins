import { join } from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  checkCollections, compareVersions, installCommand, intersectRanges, loadCollections, packBlock, rootBlock,
} from './check-collections.ts'

const repoRoot = join(import.meta.dirname, '..')

describe('compareVersions', () => {
  it('orders cores, then a prerelease before its release, then prerelease fields', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.3.0-0', '0.2.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.1.7-rc.1', '0.1.7-rc.1')).toBe(0)
  })
})

describe('intersectRanges', () => {
  it('keeps the highest floor and the lowest ceiling', () => {
    expect(intersectRanges(['>=0.1.5-rc.1 <0.3.0-0', '>=0.2.0-rc.2 <0.3.0-0'])).toEqual({ lo: '0.2.0-rc.2', hi: '0.3.0-0' })
  })

  it('is empty when a floor reaches another range’s ceiling', () => {
    expect(intersectRanges(['>=0.3.0 <0.4.0-0', '>=0.1.5-rc.1 <0.3.0-0'])).toBeUndefined()
  })

  it('leaves an absent bound open', () => {
    expect(intersectRanges([])).toEqual({ lo: undefined, hi: undefined })
  })
})

describe('generated text', () => {
  it('one command lists every bundle of the collection, in order', () => {
    expect(installCommand({ id: 'x', title: { zh: 'x', en: 'x' }, bundles: ['@a/b', '@a/c'] }))
      .toBe('dsh plugin --profile web add @a/b @a/c')
  })

  it('the root block skips an unpublished collection', () => {
    const block = rootBlock([
      { id: 'dev', title: { zh: '开发', en: 'Dev' }, bundles: ['@a/basic', '@a/d'] },
      { id: 'writing', title: { zh: '写作', en: 'Writing' }, bundles: ['@a/basic', '@a/w'], unpublished: true },
    ], 'zh')
    expect(block).toContain('@a/d')
    expect(block).not.toContain('@a/w')
  })

  it('the mode suite block names its scene collection', () => {
    const block = packBlock({ id: 'writing', title: { zh: '写作', en: 'Writing' }, bundles: ['@a/basic', '@a/w'] }, 'zh')
    expect(block).toContain('「写作」集合')
    expect(block).toContain('dsh plugin --profile web add @a/basic @a/w')
  })
})

describe('real tree', () => {
  it('every scene collection is basic plus exactly one mode suite', () => {
    for (const c of loadCollections(repoRoot).filter(c => c.id !== 'basic' && c.id !== 'full')) {
      expect(c.bundles[0], c.id).toBe('@khorsheed/dsh-basic')
      expect(c.bundles, c.id).toHaveLength(2)
    }
  })

  it('no published collection lists a held-back suite', () => {
    const collections = loadCollections(repoRoot)
    const held = collections.filter(c => c.unpublished).flatMap(c => c.bundles.slice(1))
    for (const c of collections.filter(c => !c.unpublished)) {
      for (const name of held) expect(c.bundles).not.toContain(name)
    }
  })

  it('has no findings (names resolve, host ranges intersect, READMEs current)', () => {
    expect(checkCollections(repoRoot)).toEqual([])
  })
})

describe('optional mode-suite guide blocks', () => {
  it('allows their absence without recreating them, while keeping the root collection required', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-collections-'))
    try {
      const collections = [{ id: 'mode', title: { zh: '模式', en: 'Mode' }, bundles: ['@a/basic', '@a/mode'] }]
      await mkdir(join(root, 'packages/basic'), { recursive: true })
      await mkdir(join(root, 'packages/mode'), { recursive: true })
      await writeFile(join(root, 'collections.json'), JSON.stringify({ collections }))
      await writeFile(join(root, 'README.md'), rootBlock(collections, 'zh'))
      await writeFile(join(root, 'README.en.md'), rootBlock(collections, 'en'))
      for (const [dir, name, kind] of [['basic', '@a/basic', 'family'], ['mode', '@a/mode', 'mode']] as const) {
        await writeFile(join(root, `packages/${dir}/package.json`), JSON.stringify({ name, engines: { dsh: '>=0.1.0 <0.3.0-0' }, dsh: { bundle: { kind } } }))
        await writeFile(join(root, `packages/${dir}/README.md`), '')
        await writeFile(join(root, `packages/${dir}/README.en.md`), '')
      }
      expect(checkCollections(root, { write: true })).toEqual([])
      expect(await readFile(join(root, 'packages/mode/README.md'), 'utf8')).toBe('')
      expect(await readFile(join(root, 'packages/mode/README.en.md'), 'utf8')).toBe('')

      await writeFile(join(root, 'README.md'), '')
      expect(checkCollections(root)).toEqual([expect.objectContaining({ path: 'README.md', kind: 'generated' })])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
