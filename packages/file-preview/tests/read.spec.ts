import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsVersion, type FsInfo, type FsTarget, type FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'

/** A minimal fs double covering exactly the surface the service reads. */
interface FsDouble {
  resolve: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  readText: ReturnType<typeof vi.fn>
}

function makeService(fs: Partial<FileSystem>, config = {}): FilePreviewService {
  const ctx = new Context()
  Object.assign(ctx, { fs })
  return new FilePreviewService(ctx, config)
}

/** A loose session double carrying only the fields the service reads. */
function makeAgent(session: { events: readonly SessionEvent[]; header: { cwd?: string | undefined } }): Agent {
  const { events, ...rest } = session
  return { session: { ...rest, snapshotEvents: () => events } as unknown as Session } as unknown as Agent
}

const target = { displayPath: 'notes.md' } as unknown as FsTarget
const fileInfo: FsInfo = { version: FsVersion('v1'), type: 'file', size: 5 }

describe('FilePreviewService.read', () => {
  it('rejects an empty path', async () => {
    const service = makeService({})
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), '', new AbortController().signal)
    expect(result).toEqual({ path: '', kind: 'error', message: 'file preview requires a non-empty path' })
  })

  it('reports a resolution failure as error', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockRejectedValue(new Error('no such path')),
      stat: vi.fn(),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result.kind).toBe('error')
    expect(result.message).toBe('no such path')
  })

  it('stringifies non-Error failures for the read message', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockRejectedValue('no such path'),
      stat: vi.fn(),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'error', message: 'no such path' })
  })

  it('reports a missing or non-file target', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'missing' })

    fs.stat.mockResolvedValue({ version: 'v1', type: 'directory' })
    const directory = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(directory.kind).toBe('missing')
  })

  it('reports a stat failure as error', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockRejectedValue(new Error('stat denied')),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'error', message: 'stat denied' })
  })

  it('answers too-large without reading when the backend reports the size', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file', size: 1024 * 1024 }),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem, { maxReadBytes: 1024 })
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'too-large', size: 1024 * 1024 })
    expect(fs.readText).not.toHaveBeenCalled()
  })

  it('classifies binary extensions without reading', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file', size: 42 }),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'bundle.tar.gz', new AbortController().signal)
    expect(result).toEqual({ path: 'bundle.tar.gz', kind: 'binary', size: 42 })
    expect(fs.readText).not.toHaveBeenCalled()
  })

  it('classifies binary extensions without a backend size report', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file' }),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'asset.woff2', new AbortController().signal)
    expect(result).toEqual({ path: 'asset.woff2', kind: 'binary' })
  })

  it('answers image reads with a route URL when the web face is present', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file', size: 42 }),
      readText: vi.fn(),
    }
    const ctx = new Context()
    Object.assign(ctx, { fs })
    ctx.provide('agents', { get: (sessionId: string) => (sessionId === 'session-1' ? makeAgent({ events: [], header: { cwd: '/tmp' } }) : undefined) } as never)
    const webServer = { register: vi.fn() }
    ctx.provide('webServer', webServer as never)
    const service = new FilePreviewService(ctx)
    const session = { id: 'session-1', header: { cwd: '/tmp' } } as unknown as Session
    const result = await service.read({ session } as unknown as Agent, 'image.PNG', new AbortController().signal)
    expect(result).toEqual({
      path: 'image.PNG',
      kind: 'image',
      url: '/file-preview-image/session-1/image.PNG',
      size: 42,
    })
    expect(fs.readText).not.toHaveBeenCalled()
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/file-preview-image' }))
  })

  it('answers image reads without a backend size report', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file' }),
      readText: vi.fn(),
    }
    const ctx = new Context()
    Object.assign(ctx, { fs })
    ctx.provide('agents', { get: () => makeAgent({ events: [], header: { cwd: '/tmp' } }) } as never)
    ctx.provide('webServer', { register: vi.fn() } as never)
    const service = new FilePreviewService(ctx)
    const session = { id: 'session-2', header: { cwd: '/tmp' } } as unknown as Session
    const result = await service.read({ session } as unknown as Agent, 'pic.svg', new AbortController().signal)
    expect(result).toEqual({ path: 'pic.svg', kind: 'image', url: '/file-preview-image/session-2/pic.svg' })
  })

  it('treats an image path as binary when no web face is present', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file', size: 42 }),
      readText: vi.fn().mockResolvedValue('not image bytes'),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'a.png', new AbortController().signal)
    expect(result.kind).toBe('binary')

    fs.stat.mockResolvedValue({ version: 'v1', type: 'file' })
    const noSize = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'a.png', new AbortController().signal)
    expect(noSize).toEqual({ path: 'a.png', kind: 'binary' })
  })

  it('classifies compressed session-log extensions as binary', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file' }),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'session.jsonl.zstd', new AbortController().signal)
    expect(result).toEqual({ path: 'session.jsonl.zstd', kind: 'binary' })
  })

  it('serves text content and flags NUL bytes as binary', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      readText: vi.fn().mockResolvedValue('hello\nworld'),
    }
    const service = makeService(fs as unknown as FileSystem)
    const text = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(text).toEqual({ path: 'notes.md', kind: 'text', content: 'hello\nworld', truncated: false, size: 5 })

    fs.readText.mockResolvedValue('a\u0000b')
    const binary = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(binary).toEqual({ path: 'notes.md', kind: 'binary', size: 5 })

    fs.stat.mockResolvedValue({ version: 'v1', type: 'file' })
    const noSize = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(noSize).toEqual({ path: 'notes.md', kind: 'binary' })
  })

  it('truncates oversized text reads without a backend size report', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file' }),
      readText: vi.fn().mockResolvedValue('abcdef'),
    }
    const service = makeService(fs as unknown as FileSystem, { maxReadBytes: 3 })
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'text', content: 'abc', truncated: true })
  })

  it('reports a decode failure as error', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      readText: vi.fn().mockRejectedValue(new Error('invalid utf8')),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(makeAgent({ events: [], header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ path: 'notes.md', kind: 'error', message: 'invalid utf8' })
  })

  it('resolves relative paths against the session cwd', async () => {
    const resolve = vi.fn<(path: string, opts: { cwd?: string; signal?: AbortSignal }) => Promise<FsTarget>>()
    resolve.mockResolvedValue(target)
    const fs: FsDouble = {
      resolve: resolve as never,
      stat: vi.fn().mockResolvedValue(fileInfo),
      readText: vi.fn().mockResolvedValue('x'),
    }
    const service = makeService(fs as unknown as FileSystem)
    await service.read(makeAgent({ events: [], header: { cwd: '/work' } }), 'notes.md', new AbortController().signal)
    const [, opts] = resolve.mock.calls[0] ?? []
    expect(opts).toMatchObject({ cwd: '/work' })
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
  })

  it('resolves without a cwd when the session header lacks one', async () => {
    const resolve = vi.fn<(path: string, opts: { cwd?: string; signal?: AbortSignal }) => Promise<FsTarget>>()
    resolve.mockResolvedValue(target)
    const fs: FsDouble = {
      resolve: resolve as never,
      stat: vi.fn().mockResolvedValue(fileInfo),
      readText: vi.fn().mockResolvedValue('x'),
    }
    const service = makeService(fs as unknown as FileSystem)
    await service.read(makeAgent({ events: [], header: { cwd: undefined } }), 'notes.md', new AbortController().signal)
    const [, opts] = resolve.mock.calls[0] ?? []
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
    expect(opts?.cwd).toBeUndefined()
  })
})

describe('FilePreviewService.list', () => {
  it('folds the agent session log (empty log → no entries)', async () => {
    const session = { events: [] } as unknown as Session
    const service = makeService({})
    await expect(service.list(makeAgent(session))).resolves.toEqual({ entries: [], asOfSeq: -1, truncated: false })
  })
})

describe('FilePreviewService.read — HTML render-channel cap and scripted hint', () => {
  const htmlInfo = (size: number): FsInfo => ({ version: FsVersion('v1'), type: 'file', size })
  const htmlTarget = { displayPath: 'page.html' } as unknown as FsTarget
  const agent = makeAgent({ events: [], header: { cwd: '/work' } })

  it('reads HTML up to htmlMaxReadBytes (default 4 MiB) — wider than the base cap', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(2 * 1024 * 1024)),
      readText: vi.fn().mockResolvedValue('<h1>big page</h1>'),
    }
    const service = makeService(fs as unknown as FileSystem, { maxReadBytes: 512 * 1024 })
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result.kind).toBe('text')
    expect(result.content).toBe('<h1>big page</h1>')
    expect(result.truncated).toBe(false)
    // 2 MiB > base cap, but the html cap allowed the read — the base cap must
    // not have been applied.
    expect(fs.readText).toHaveBeenCalled()
  })

  it('answers too-large for HTML beyond htmlMaxReadBytes without reading', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(5 * 1024 * 1024)),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result).toEqual({ path: 'page.html', kind: 'too-large', size: 5 * 1024 * 1024 })
    expect(fs.readText).not.toHaveBeenCalled()
  })

  it('answers too-large for HTML beyond a custom htmlMaxReadBytes', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(64 * 1024)),
      readText: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem, { htmlMaxReadBytes: 32 * 1024 })
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result).toEqual({ path: 'page.html', kind: 'too-large', size: 64 * 1024 })
    expect(fs.readText).not.toHaveBeenCalled()
  })

  it('truncates at the custom htmlMaxReadBytes when the backend reports no size', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      // No size: the read proceeds and the content cap applies.
      stat: vi.fn().mockResolvedValue({ version: FsVersion('v1'), type: 'file' } as FsInfo),
      readText: vi.fn().mockResolvedValue('x'.repeat(64 * 1024 + 10)),
    }
    const service = makeService(fs as unknown as FileSystem, { htmlMaxReadBytes: 32 * 1024 })
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result.kind).toBe('text')
    expect(result.truncated).toBe(true)
    expect(result.content?.length).toBe(32 * 1024)
  })

  it('marks HTML with a <script> tag as scripted', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(50)),
      readText: vi.fn().mockResolvedValue('<script>alert(1)</script><p>hi</p>'),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result.htmlScripted).toBe(true)
  })

  it('marks HTML with an inline event handler as scripted', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(50)),
      readText: vi.fn().mockResolvedValue('<button onclick="go()">x</button>'),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.read(agent, 'page.html', new AbortController().signal)
    expect(result.htmlScripted).toBe(true)
  })

  it('leaves htmlScripted absent for plain HTML and for non-HTML text', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(htmlTarget),
      stat: vi.fn().mockResolvedValue(htmlInfo(50)),
      readText: vi.fn().mockResolvedValue('<p>static only</p>'),
    }
    const service = makeService(fs as unknown as FileSystem)
    const html = await service.read(agent, 'page.html', new AbortController().signal)
    expect(html.htmlScripted).toBeUndefined()
    const md = await service.read(makeAgent({ events: [], header: { cwd: '/work' } }), 'notes.md', new AbortController().signal)
    expect(md.htmlScripted).toBeUndefined()
  })
})
