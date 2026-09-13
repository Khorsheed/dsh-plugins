/**
 * The pad service core against an in-memory filesystem: creation and the
 * name-collision rule, the version-guarded write (a stale token must never
 * overwrite), the archive set moving an item without touching its file, the
 * traversal guard, and every degradation path (missing pad, corrupt index).
 *
 * The fake implements only the `ctx.fs` surface the service uses, and it
 * mirrors the real backend's two guarded-write failures exactly — dsh-fs
 * reports an existing target to `createIfAbsent` as `FS_NOT_OBSERVED`.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The minimal `ctx.fs` the service touches, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([[ '/', { kind: 'dir' } ]])
  private seq = 0

  /** Plant a file directly (setup for index-corruption cases). */
  seed(path: string, content: string): void {
    this.mkdirp(dirname(path))
    this.entries.set(path, { kind: 'file', content, version: ++this.seq })
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<string> {
    return path.startsWith('/') ? normalize(path) : normalize(join(opts?.cwd ?? '/', path))
  }

  processPath(target: string): string {
    return target
  }

  contains(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`)
  }

  async stat(target: string): Promise<{ version: string; type: 'file'; size: number } | undefined> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') return undefined
    return { version: String(entry.version), type: 'file', size: entry.content.length }
  }

  async readText(target: string): Promise<string> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') {
      throw new FsError(`no file at ${target}`, 'FS_NOT_FOUND')
    }
    return entry.content
  }

  async writeText(
    target: string,
    content: string,
    expected?: { kind: string; version?: string },
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const existing = this.entries.get(target)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`already exists: ${target}`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.kind !== 'file' || String(existing.version) !== expected.version) {
        throw new FsError(`stale: ${target}`, 'FS_STALE_VERSION')
      }
    }
    this.mkdirp(dirname(target))
    const before = existing !== undefined && existing.kind === 'file' ? existing.content : null
    this.entries.set(target, { kind: 'file', content, version: ++this.seq })
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: String(this.seq),
      before,
      after: content,
    }
  }

  async listDir(target: string): Promise<Array<{ name: string; type: 'file' | 'directory'; target: string }>> {
    if (this.entries.get(target) === undefined) {
      throw new FsError(`no directory at ${target}`, 'FS_NOT_FOUND')
    }
    const prefix = target === '/' ? '/' : `${target}/`
    const out = new Map<string, { name: string; type: 'file' | 'directory'; target: string }>()
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix) || path === target) continue
      const rest = path.slice(prefix.length)
      const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
      if (out.has(name)) continue
      const childPath = `${prefix}${name}`
      const isDirectory = rest.includes('/') || entry.kind === 'dir'
      out.set(name, { name, type: isDirectory ? 'directory' : 'file', target: childPath })
    }
    return [...out.values()]
  }

  private mkdirp(dir: string): void {
    if (dir === '/' || dir === '.') return
    if (this.entries.get(dir)?.kind === 'dir') return
    this.mkdirp(dirname(dir))
    this.entries.set(dir, { kind: 'dir' })
  }
}

const WS = '/ws'
const PAD = '/ws/灵感画布'
const ARTICLE = '文章/第一章 雨夜.md'
const CARD = '卡片/雨伞的意象.md'

/** One service over a fresh fake filesystem. */
function harness(): { fs: FakeFs; canvas: CanvasService } {
  const fs = new FakeFs()
  const canvas = new CanvasService({ fs } as unknown as Context)
  return { fs, canvas }
}

describe('CanvasService.list', () => {
  it('reports an empty pad rather than failing when nothing was written yet', async () => {
    const { canvas } = harness()
    expect(await canvas.list(WS)).toEqual({ items: [], archived: [] })
  })

  it('lists both kinds and names their absolute and relative spellings', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' })
    const listed = await canvas.list(WS)
    expect(listed.items.map(item => item.name)).toEqual([CARD, ARTICLE])
    expect(listed.items[1]).toMatchObject({
      name: ARTICLE,
      title: '第一章 雨夜',
      kind: 'article',
      archived: false,
      absolutePath: `${PAD}/${ARTICLE}`,
      relativePath: `灵感画布/${ARTICLE}`,
    })
  })

  it('degrades a corrupt index to name order with nothing archived', async () => {
    const { fs, canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    fs.seed(`${PAD}/.index.json`, '{ this is not json')
    const listed = await canvas.list(WS)
    expect(listed.items.map(item => item.name)).toEqual([ARTICLE])
    expect(listed.archived).toEqual([])
  })
})

describe('CanvasService.create', () => {
  it('creates an item and puts it at the head of the display order', async () => {
    const { canvas } = harness()
    const first = await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    expect(first).toMatchObject({ ok: true, name: ARTICLE, operation: 'create' })
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' })
    expect((await canvas.list(WS)).items.map(item => item.name)).toEqual([CARD, ARTICLE])
  })

  it('refuses a duplicate title instead of overwriting it', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' })
    expect(await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'second' }))
      .toEqual({ ok: false, error: 'exists' })
    expect((await canvas.read({ dir: WS, name: ARTICLE }))).toMatchObject({ ok: true, content: 'first' })
  })

  it('treats two kinds as two namespaces — the same title coexists', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '雨', content: 'a' })
    expect(await canvas.create({ dir: WS, kind: 'card', title: '雨', content: 'b' }))
      .toMatchObject({ ok: true, operation: 'create' })
  })

  it('refuses a title with nothing usable left', async () => {
    const { canvas } = harness()
    expect(await canvas.create({ dir: WS, kind: 'article', title: '...', content: '' }))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasService.write', () => {
  it('writes under the version from the last read', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' })
    const read = await canvas.read({ dir: WS, name: ARTICLE })
    if (!read.ok) throw new Error('expected a readable item')
    expect(await canvas.write({ dir: WS, name: ARTICLE, content: 'second', version: read.version }))
      .toMatchObject({ ok: true, operation: 'update' })
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'second' })
  })

  it('refuses a stale version — the file changed elsewhere in between', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' })
    const read = await canvas.read({ dir: WS, name: ARTICLE })
    if (!read.ok) throw new Error('expected a readable item')
    const first = await canvas.write({ dir: WS, name: ARTICLE, content: 'mine', version: read.version })
    expect(first.ok).toBe(true)
    expect(await canvas.write({ dir: WS, name: ARTICLE, content: 'stale attempt', version: read.version }))
      .toEqual({ ok: false, error: 'stale' })
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'mine' })
  })

  it('refuses a traversal name', async () => {
    const { canvas } = harness()
    expect(await canvas.write({ dir: WS, name: '../文章/escape.md', content: 'x', version: '1' }))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasService.read', () => {
  it('reports a missing item', async () => {
    const { canvas } = harness()
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toEqual({ ok: false, error: 'missing' })
  })

  it('reports an unusable name', async () => {
    const { canvas } = harness()
    expect(await canvas.read({ dir: WS, name: '杂项/x.md' })).toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasService.setArchived', () => {
  it('hides an item without touching its file, and restores it to its position', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' })

    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: true })).toEqual({ ok: true })
    const afterArchive = await canvas.list(WS)
    expect(afterArchive.items.map(item => item.name)).toEqual([CARD])
    expect(afterArchive.archived.map(item => item.name)).toEqual([ARTICLE])
    // The document is untouched — this is the whole point of archiving.
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'a' })

    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: false })).toEqual({ ok: true })
    const afterRestore = await canvas.list(WS)
    expect(afterRestore.archived).toEqual([])
    expect(afterRestore.items.map(item => item.name)).toEqual([CARD, ARTICLE])
  })

  it('is a no-op when the item is already in the asked-for state', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: false })).toEqual({ ok: true })
    expect((await canvas.list(WS)).archived).toEqual([])
  })

  it('refuses an unusable name', async () => {
    const { canvas } = harness()
    expect(await canvas.setArchived({ dir: WS, name: 'x.md', archived: true }))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('the pad directory', () => {
  it('is created on first write, without a separate mkdir step', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' })
    // The fake mirrors writeFileAtomic: parents are created by the write.
    expect(await canvas.list(WS)).toMatchObject({ items: [{ name: ARTICLE }] })
  })

  it('keeps a document written outside the pad out of the list', async () => {
    const { fs, canvas } = harness()
    fs.seed(`${PAD}/文章/手写的.md`, 'written by hand')
    expect((await canvas.list(WS)).items.map(item => item.title)).toEqual(['手写的'])
  })
})
