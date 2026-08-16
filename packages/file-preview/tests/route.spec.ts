import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsVersion, type FsInfo, type FsTarget, type FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'

/** A minimal fs double covering the image-route surface (bytes, not text). */
interface RouteFsDouble {
  resolve: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  readBytes: ReturnType<typeof vi.fn>
}

/** A mock ServerResponse collecting the writeHead call and the body. */
function makeRes(): { res: ServerResponse; head: ReturnType<typeof vi.fn>; bytes: () => Uint8Array } {
  const chunks: Uint8Array[] = []
  const head = vi.fn(function (this: unknown) { return this })
  const res = {
    writeHead: head,
    end: vi.fn((chunk?: unknown) => {
      if (typeof chunk === 'string') chunks.push(new TextEncoder().encode(chunk))
      else if (chunk instanceof Uint8Array) chunks.push(chunk)
      return res
    }),
  } as unknown as ServerResponse
  return { res, head, bytes: () => {
    const total = chunks.reduce((sum, c) => sum + c.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { out.set(c, offset); offset += c.length }
    return out
  } }
}

/** Build a route-capable service: webServer + agents provided, fs doubled. */
function makeRouteService(fs: Partial<FileSystem>, agent: Agent): FilePreviewService {
  const ctx = new Context()
  Object.assign(ctx, { fs })
  ctx.provide('agents', { get: () => agent } as never)
  ctx.provide('webServer', { register: vi.fn() } as never)
  return new FilePreviewService(ctx)
}

const target = { displayPath: 'pic.png' } as unknown as FsTarget
const fileInfo: FsInfo = { version: FsVersion('v1'), type: 'file', size: 6 }

function session(id: string): Session {
  return { id, header: { cwd: '/tmp' } } as unknown as Session
}

function reqFor(url: string): IncomingMessage {
  return { url } as unknown as IncomingMessage
}

describe('FilePreviewService image route', () => {
  it('serves image bytes with the matching content type', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      readBytes: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
    }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head, bytes } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'image/png' }))
    expect(bytes()).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(fs.resolve).toHaveBeenCalledWith('pic.png', { cwd: '/tmp' })
  })

  it('answers 400 for a malformed URL', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image'), res)
    expect(head).toHaveBeenCalledWith(400)
    expect(head.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('answers 400 for an undecodable path', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/%zz'), res)
    expect(head).toHaveBeenCalledWith(400)
  })

  it('answers 404 for a missing session', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const ctx = new Context()
    Object.assign(ctx, { fs })
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('webServer', { register: vi.fn() } as never)
    const service = new FilePreviewService(ctx)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/ghost/pic.png'), res)
    expect(head).toHaveBeenCalledWith(404)
  })

  it('answers 400 for a non-image path', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/notes.md'), res)
    expect(head).toHaveBeenCalledWith(400)
  })

  it('answers 404 when resolution or stat fails or the target is not a file', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockRejectedValue(new Error('gone')),
      stat: vi.fn(),
      readBytes: vi.fn(),
    }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(404)
  })

  it('answers 404 when stat fails', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockRejectedValue(new Error('stat gone')),
      readBytes: vi.fn(),
    }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(404)
  })

  it('answers 404 when the target is not a regular file', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'directory' }),
      readBytes: vi.fn(),
    }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(404)
  })

  it('resolves relative to the session cwd and tolerates its absence', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      readBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }
    const withCwd = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    await (withCwd as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), makeRes().res)
    expect(fs.resolve).toHaveBeenCalledWith('pic.png', { cwd: '/tmp' })

    const noCwd = makeRouteService(fs as unknown as FileSystem, {
      session: { id: 's2', header: {} } as unknown as Session,
    } as unknown as Agent)
    await (noCwd as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s2/pic.png'), makeRes().res)
    expect(fs.resolve).toHaveBeenCalledWith('pic.png', {})
  })

  it('handles a request whose url is undefined', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage({} as IncomingMessage, res)
    expect(head).toHaveBeenCalledWith(400)
  })

  it('handles a query-string-only url', async () => {
    const fs: RouteFsDouble = { resolve: vi.fn(), stat: vi.fn(), readBytes: vi.fn() }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('?x=1'), res)
    expect(head).toHaveBeenCalledWith(400)
  })

  it('answers 413 when the image exceeds the read cap', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue({ version: 'v1', type: 'file', size: 900 }),
      readBytes: vi.fn(),
    }
    const ctx = new Context()
    Object.assign(ctx, { fs })
    ctx.provide('agents', { get: () => ({ session: session('s1') }) } as never)
    ctx.provide('webServer', { register: vi.fn() } as never)
    const service = new FilePreviewService(ctx, { maxReadBytes: 100 })
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(413)
  })

  it('answers 404 when reading the bytes fails', async () => {
    const fs: RouteFsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      readBytes: vi.fn().mockRejectedValue(new Error('io')),
    }
    const service = makeRouteService(fs as unknown as FileSystem, { session: session('s1') } as unknown as Agent)
    const { res, head } = makeRes()
    await (service as unknown as { serveImage: (req: IncomingMessage, res: ServerResponse) => Promise<void> })
      .serveImage(reqFor('/file-preview-image/s1/pic.png'), res)
    expect(head).toHaveBeenCalledWith(404)
  })
})
