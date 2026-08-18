import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsVersion, type FsInfo, type FsTarget, type FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'

/** A minimal fs double covering exactly the surface the service reads. */
interface FsDouble {
  resolve: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  processPath: ReturnType<typeof vi.fn>
}

function makeService(
  fs: Partial<FileSystem>,
  deps: { revealNative?: (path: string, signal: AbortSignal) => Promise<void> } = {},
): FilePreviewService {
  const ctx = new Context()
  Object.assign(ctx, { fs })
  return new FilePreviewService(ctx, {}, deps)
}

/** A loose session double carrying only the fields the service reads. */
function makeAgent(session: { header: { cwd?: string | undefined } }): Agent {
  return { session: session as unknown as Session } as unknown as Agent
}

const target = { displayPath: 'notes.md' } as unknown as FsTarget
const fileInfo: FsInfo = { version: FsVersion('v1'), type: 'file', size: 5 }

describe('FilePreviewService.reveal', () => {
  it('rejects an empty path as missing', async () => {
    const service = makeService({})
    const result = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), '', new AbortController().signal)
    expect(result).toEqual({ revealed: false, reason: 'missing' })
  })

  it('reports an unresolvable path as missing', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockRejectedValue(new Error('no such path')),
      stat: vi.fn(),
      processPath: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ revealed: false, reason: 'missing' })
    expect(fs.processPath).not.toHaveBeenCalled()
  })

  it('reports a missing or stat-failing target as missing', async () => {
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(undefined),
      processPath: vi.fn(),
    }
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ revealed: false, reason: 'missing' })

    fs.stat.mockRejectedValue(new Error('stat denied'))
    const statFailure = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(statFailure).toEqual({ revealed: false, reason: 'missing' })
    expect(fs.processPath).not.toHaveBeenCalled()
  })

  it('reveals a file through the native runner with the process path', async () => {
    const revealNative = vi.fn(async () => {})
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      processPath: vi.fn().mockReturnValue('/work/notes.md'),
    }
    const service = makeService(fs as unknown as FileSystem, { revealNative })
    const signal = new AbortController().signal
    const result = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', signal)
    expect(result).toEqual({ revealed: true })
    expect(fs.processPath).toHaveBeenCalledWith(target)
    expect(revealNative).toHaveBeenCalledWith('/work/notes.md', signal)
  })

  it('answers select-failed when the native runner cannot select', async () => {
    const revealNative = vi.fn().mockRejectedValue(new Error('no select-capable file manager found'))
    const fs: FsDouble = {
      resolve: vi.fn().mockResolvedValue(target),
      stat: vi.fn().mockResolvedValue(fileInfo),
      processPath: vi.fn().mockReturnValue('/work/notes.md'),
    }
    const service = makeService(fs as unknown as FileSystem, { revealNative })
    const result = await service.reveal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ revealed: false, reason: 'select-failed' })
  })

  it('resolves relative paths against the session cwd', async () => {
    const resolve = vi.fn<(path: string, opts: { cwd?: string; signal?: AbortSignal }) => Promise<FsTarget>>()
    resolve.mockResolvedValue(target)
    const revealNative = vi.fn(async () => {})
    const fs: FsDouble = {
      resolve: resolve as never,
      stat: vi.fn().mockResolvedValue(fileInfo),
      processPath: vi.fn().mockReturnValue('/work/notes.md'),
    }
    const service = makeService(fs as unknown as FileSystem, { revealNative })
    await service.reveal(makeAgent({ header: { cwd: '/work' } }), 'notes.md', new AbortController().signal)
    const [, opts] = resolve.mock.calls[0] ?? []
    expect(opts).toMatchObject({ cwd: '/work' })
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
  })

  it('resolves without a cwd when the session header lacks one', async () => {
    const resolve = vi.fn<(path: string, opts: { cwd?: string; signal?: AbortSignal }) => Promise<FsTarget>>()
    resolve.mockResolvedValue(target)
    const revealNative = vi.fn(async () => {})
    const fs: FsDouble = {
      resolve: resolve as never,
      stat: vi.fn().mockResolvedValue(fileInfo),
      processPath: vi.fn().mockReturnValue('/work/notes.md'),
    }
    const service = makeService(fs as unknown as FileSystem, { revealNative })
    await service.reveal(makeAgent({ header: { cwd: undefined } }), 'notes.md', new AbortController().signal)
    const [, opts] = resolve.mock.calls[0] ?? []
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
    expect(opts?.cwd).toBeUndefined()
  })
})
