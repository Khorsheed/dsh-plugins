/**
 * The pad service core against an in-memory filesystem: creation and the
 * name-collision rule, the version-guarded write (a stale token must never
 * overwrite), the archive set moving an item without touching its file, the
 * traversal guard, the per-session fence every mutation carries, and every
 * degradation path (missing pad, corrupt index).
 *
 * The fake implements only the `ctx.fs` surface the service uses, and it
 * mirrors the real backend's two guarded-write failures exactly — dsh-fs
 * reports an existing target to `createIfAbsent` as `FS_NOT_OBSERVED`.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The fence one write carried, as the service passed it. */
type SeenPolicy = { mode: string; workspaceRoot: string } | undefined

/**
 * The root a confining backend falls back to when a call carries no policy:
 * the host process's own cwd — deliberately outside every workspace here, so a
 * missing stamp is a denial rather than a silent success.
 */
const HOST_CWD = '/host-cwd'

/** The minimal `ctx.fs` the service touches, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([[ '/', { kind: 'dir' } ]])
  private seq = 0

  /** Present only when this fake stands in for a confining backend (dsh-fs-sandbox). */
  sandboxMode: 'workspace-write' | 'read-only' | 'danger-full-access' | undefined

  /** The fence each write carried, in call order (the fifth `writeText` argument). */
  readonly policies: SeenPolicy[] = []

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
    _signal?: unknown,
    policy?: SeenPolicy,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    this.policies.push(policy)
    // Mirrors dsh-fs-sandbox's fence: a confining backend reads a per-call
    // policy and, without one, falls back to the deployment's own root — which
    // is where the pad's workspace almost never is, so the write is denied.
    if (this.sandboxMode !== undefined) {
      const root = policy?.workspaceRoot
        ?? (this.sandboxMode === 'danger-full-access' ? undefined : HOST_CWD)
      if (root !== undefined && target !== root && !target.startsWith(`${root}/`)) {
        throw new FsError(`denied: ${target}`, 'FS_SANDBOX_DENIED')
      }
    }
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

/** The calling session every mutation is fenced by; only its cwd is read. */
const SESSION = { id: 's1', header: { cwd: WS } } as unknown as Session

/** One service over a fresh fake filesystem — a backend that does not confine. */
function harness(): { fs: FakeFs; canvas: CanvasService } {
  const fs = new FakeFs()
  const canvas = new CanvasService({ fs } as unknown as Context)
  return { fs, canvas }
}

/**
 * One service over a fake that reports itself as confining, plus the policy
 * home such a composition carries: the caller's own session resolves the
 * workspace boundary, and a call with no session falls back to the host's cwd.
 * This is the shape `dsh-fs-sandbox` + `dsh-sandbox-policy` present to a
 * plugin, and the one the pad's writes have to survive.
 */
function confiningHarness(): { fs: FakeFs; canvas: CanvasService } {
  const fs = new FakeFs()
  fs.sandboxMode = 'workspace-write'
  const sandboxPolicy = {
    resolve: (request?: { session?: { header: { cwd: string } } }) => ({
      mode: 'workspace-write',
      workspaceRoot: request?.session?.header.cwd ?? HOST_CWD,
    }),
  }
  const ctx = { fs, get: (key: string) => key === 'sandboxPolicy' ? sandboxPolicy : undefined }
  return { fs, canvas: new CanvasService(ctx as unknown as Context) }
}

describe('CanvasService.list', () => {
  it('reports an empty pad rather than failing when nothing was written yet', async () => {
    const { canvas } = harness()
    expect(await canvas.list(WS)).toEqual({ items: [], archived: [] })
  })

  it('lists both kinds and names their absolute and relative spellings', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' }, SESSION)
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
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    fs.seed(`${PAD}/.index.json`, '{ this is not json')
    const listed = await canvas.list(WS)
    expect(listed.items.map(item => item.name)).toEqual([ARTICLE])
    expect(listed.archived).toEqual([])
  })
})

describe('CanvasService.create', () => {
  it('creates an item and puts it at the head of the display order', async () => {
    const { canvas } = harness()
    const first = await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    expect(first).toMatchObject({ ok: true, name: ARTICLE, operation: 'create' })
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' }, SESSION)
    expect((await canvas.list(WS)).items.map(item => item.name)).toEqual([CARD, ARTICLE])
  })

  it('refuses a duplicate title instead of overwriting it', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' }, SESSION)
    expect(await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'second' }, SESSION))
      .toEqual({ ok: false, error: 'exists' })
    expect((await canvas.read({ dir: WS, name: ARTICLE }))).toMatchObject({ ok: true, content: 'first' })
  })

  it('treats two kinds as two namespaces — the same title coexists', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '雨', content: 'a' }, SESSION)
    expect(await canvas.create({ dir: WS, kind: 'card', title: '雨', content: 'b' }, SESSION))
      .toMatchObject({ ok: true, operation: 'create' })
  })

  it('refuses a title with nothing usable left', async () => {
    const { canvas } = harness()
    expect(await canvas.create({ dir: WS, kind: 'article', title: '...', content: '' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasService.write', () => {
  it('writes under the version from the last read', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' }, SESSION)
    const read = await canvas.read({ dir: WS, name: ARTICLE })
    if (!read.ok) throw new Error('expected a readable item')
    expect(await canvas.write({ dir: WS, name: ARTICLE, content: 'second', version: read.version }, SESSION))
      .toMatchObject({ ok: true, operation: 'update' })
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'second' })
  })

  it('refuses a stale version — the file changed elsewhere in between', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'first' }, SESSION)
    const read = await canvas.read({ dir: WS, name: ARTICLE })
    if (!read.ok) throw new Error('expected a readable item')
    const first = await canvas.write({ dir: WS, name: ARTICLE, content: 'mine', version: read.version }, SESSION)
    expect(first.ok).toBe(true)
    expect(await canvas.write({ dir: WS, name: ARTICLE, content: 'stale attempt', version: read.version }, SESSION))
      .toEqual({ ok: false, error: 'stale' })
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'mine' })
  })

  it('refuses a traversal name', async () => {
    const { canvas } = harness()
    expect(await canvas.write({ dir: WS, name: '../文章/escape.md', content: 'x', version: '1' }, SESSION))
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
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    await canvas.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: 'b' }, SESSION)

    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: true }, SESSION)).toEqual({ ok: true })
    const afterArchive = await canvas.list(WS)
    expect(afterArchive.items.map(item => item.name)).toEqual([CARD])
    expect(afterArchive.archived.map(item => item.name)).toEqual([ARTICLE])
    // The document is untouched — this is the whole point of archiving.
    expect(await canvas.read({ dir: WS, name: ARTICLE })).toMatchObject({ ok: true, content: 'a' })

    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: false }, SESSION)).toEqual({ ok: true })
    const afterRestore = await canvas.list(WS)
    expect(afterRestore.archived).toEqual([])
    expect(afterRestore.items.map(item => item.name)).toEqual([CARD, ARTICLE])
  })

  it('is a no-op when the item is already in the asked-for state', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    expect(await canvas.setArchived({ dir: WS, name: ARTICLE, archived: false }, SESSION)).toEqual({ ok: true })
    expect((await canvas.list(WS)).archived).toEqual([])
  })

  it('refuses an unusable name', async () => {
    const { canvas } = harness()
    expect(await canvas.setArchived({ dir: WS, name: 'x.md', archived: true }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('the pad directory', () => {
  it('is created on first write, without a separate mkdir step', async () => {
    const { canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    // The fake mirrors writeFileAtomic: parents are created by the write.
    expect(await canvas.list(WS)).toMatchObject({ items: [{ name: ARTICLE }] })
  })

  it('keeps a document written outside the pad out of the list', async () => {
    const { fs, canvas } = harness()
    fs.seed(`${PAD}/文章/手写的.md`, 'written by hand')
    expect((await canvas.list(WS)).items.map(item => item.title)).toEqual(['手写的'])
  })
})

describe('CanvasService fencing', () => {
  it("stamps the calling session's policy on the body AND the index write", async () => {
    const { fs, canvas } = confiningHarness()
    expect(await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION))
      .toMatchObject({ ok: true, operation: 'create' })
    expect(fs.policies).toEqual([
      { mode: 'workspace-write', workspaceRoot: WS },
      { mode: 'workspace-write', workspaceRoot: WS },
    ])
  })

  it('fences the edit and the archive write at the session root, never the fallback', async () => {
    const { fs, canvas } = confiningHarness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    const read = await canvas.read({ dir: WS, name: ARTICLE })
    if (!read.ok) throw new Error('expected a readable item')
    await canvas.write({ dir: WS, name: ARTICLE, content: 'b', version: read.version }, SESSION)
    await canvas.setArchived({ dir: WS, name: ARTICLE, archived: true }, SESSION)
    expect(fs.policies.map(policy => policy?.workspaceRoot)).toEqual([WS, WS, WS, WS])
    expect(fs.policies.some(policy => policy?.workspaceRoot === HOST_CWD)).toBe(false)
  })

  it('stays fail-closed: a session whose own workspace does not hold the pad is denied', async () => {
    const { canvas } = confiningHarness()
    const foreign = { id: 's2', header: { cwd: '/other-ws' } } as unknown as Session
    expect(await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, foreign))
      .toEqual({ ok: false, error: 'denied' })
  })

  it('carries no policy at all when the mounted filesystem does not confine', async () => {
    const { fs, canvas } = harness()
    await canvas.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: 'a' }, SESSION)
    expect(fs.policies).toEqual([undefined, undefined])
  })
})
