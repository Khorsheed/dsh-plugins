import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsVersion, type FsInfo, type FsTarget, type FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'
import { macAppName, openExternalNative } from '../src/open-external.ts'

/** A minimal fs double covering exactly the surface the service reads. */
interface FsDouble {
  resolve: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  processPath: ReturnType<typeof vi.fn>
}

function makeService(
  fs: Partial<FileSystem>,
  deps: { openExternalNative?: (path: string, app: string, signal: AbortSignal) => Promise<void> } = {},
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

function okFs(): FsDouble {
  return {
    resolve: vi.fn().mockResolvedValue(target),
    stat: vi.fn().mockResolvedValue(fileInfo),
    processPath: vi.fn().mockReturnValue('/work/notes.md'),
  }
}

describe('macAppName', () => {
  it('maps the official catalog ids to macOS application names', () => {
    expect(macAppName('cursor')).toBe('Cursor')
    expect(macAppName('vscode')).toBe('Visual Studio Code')
    expect(macAppName('unknown')).toBeUndefined()
  })
})

describe('openExternalNative', () => {
  it('launches `open -a <App> <path>` on macOS', async () => {
    const run = vi.fn(async () => ({ stdout: '' }))
    const signal = new AbortController().signal
    await openExternalNative('/work/notes.md', 'cursor', signal, { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', ['-a', 'Cursor', '/work/notes.md'], signal)
  })

  it('rejects non-macOS platforms and unknown app ids', async () => {
    const run = vi.fn(async () => ({ stdout: '' }))
    const signal = new AbortController().signal
    await expect(openExternalNative('/work/notes.md', 'cursor', signal, { platform: 'linux', run }))
      .rejects.toThrow('unsupported on linux')
    await expect(openExternalNative('/work/notes.md', 'emacs', signal, { platform: 'darwin', run }))
      .rejects.toThrow('unknown application id')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('FilePreviewService.openExternal', () => {
  it('rejects an empty path or app as missing', async () => {
    const service = makeService(okFs() as unknown as FileSystem)
    const agent = makeAgent({ header: { cwd: '/tmp' } })
    expect(await service.openExternal(agent, '', 'cursor', new AbortController().signal))
      .toEqual({ opened: false, reason: 'missing' })
    expect(await service.openExternal(agent, 'notes.md', '', new AbortController().signal))
      .toEqual({ opened: false, reason: 'missing' })
  })

  it('rejects an unmapped catalog id as unknown-app without touching the fs', async () => {
    const fs = okFs()
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.openExternal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', 'emacs', new AbortController().signal)
    expect(result).toEqual({ opened: false, reason: 'unknown-app' })
    expect(fs.resolve).not.toHaveBeenCalled()
  })

  it('reports an unresolvable or missing target as missing', async () => {
    const fs = okFs()
    fs.resolve.mockRejectedValue(new Error('no such path'))
    const service = makeService(fs as unknown as FileSystem)
    const result = await service.openExternal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', new AbortController().signal)
    expect(result).toEqual({ opened: false, reason: 'missing' })
    expect(fs.processPath).not.toHaveBeenCalled()
  })

  it('opens the file through the native runner with the process path', async () => {
    const openExternalNativeDep = vi.fn(async () => {})
    const fs = okFs()
    const service = makeService(fs as unknown as FileSystem, { openExternalNative: openExternalNativeDep })
    const signal = new AbortController().signal
    const result = await service.openExternal(makeAgent({ header: { cwd: '/tmp' } }), 'notes.md', 'vscode', signal)
    expect(result).toEqual({ opened: true })
    expect(fs.processPath).toHaveBeenCalledWith(target)
    expect(openExternalNativeDep).toHaveBeenCalledWith('/work/notes.md', 'vscode', signal)
  })

  it('maps a non-macOS rejection to unsupported-platform and a launch failure to launch-failed', async () => {
    const fs = okFs()
    const unsupported = makeService(fs as unknown as FileSystem, {
      openExternalNative: vi.fn(async () => { throw new Error('open-in-app is unsupported on linux') }),
    })
    const agent = makeAgent({ header: { cwd: '/tmp' } })
    expect(await unsupported.openExternal(agent, 'notes.md', 'cursor', new AbortController().signal))
      .toEqual({ opened: false, reason: 'unsupported-platform' })
    const failing = makeService(fs as unknown as FileSystem, {
      openExternalNative: vi.fn(async () => { throw new Error('spawn ENOENT') }),
    })
    expect(await failing.openExternal(agent, 'notes.md', 'cursor', new AbortController().signal))
      .toEqual({ opened: false, reason: 'launch-failed' })
  })
})
