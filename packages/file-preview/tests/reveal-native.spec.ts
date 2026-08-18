import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { revealNativePath, type RevealInternals } from '../src/reveal.ts'

/** A scripted runner recording every invocation; may reject per command. */
function scriptedRunner(
  plan: Record<string, Error | undefined>,
  outputs: Record<string, string> = {},
): { run: NativeCommandRunner; calls: Array<[string, readonly string[]]> } {
  const calls: Array<[string, readonly string[]]> = []
  const run: NativeCommandRunner = (command, args, signal) => {
    calls.push([command, args])
    const failure = plan[command]
    if (failure !== undefined) return Promise.reject(failure)
    return Promise.resolve({ stdout: outputs[command] ?? '', stderr: '' })
  }
  return { run, calls }
}

const signal = new AbortController().signal

describe('revealNativePath', () => {
  it('selects with Finder on macOS (open -R)', async () => {
    const { run, calls } = scriptedRunner({})
    await revealNativePath('/work/a.md', signal, { platform: 'darwin', run })
    expect(calls).toEqual([['open', ['-R', '/work/a.md']]])
  })

  it('selects with Explorer on Windows (explorer /select)', async () => {
    const { run, calls } = scriptedRunner({})
    await revealNativePath('C:\\work\\a.md', signal, { platform: 'win32', run })
    expect(calls).toEqual([['explorer.exe', ['/select,C:\\work\\a.md']]])
  })

  it('tries select-capable file managers in order on desktop Linux', async () => {
    const missing = Object.assign(new Error('spawn nautilus ENOENT'), { code: 'ENOENT' })
    const { run, calls } = scriptedRunner({ nautilus: missing, dolphin: missing })
    await revealNativePath('/work/a.md', signal, { platform: 'linux', osRelease: '6.8.0', run })
    expect(calls).toEqual([
      ['nautilus', ['--select', '/work/a.md']],
      ['dolphin', ['--select', '/work/a.md']],
      ['nemo', ['--select', '/work/a.md']],
    ])
  })

  it('rejects when no file manager can select', async () => {
    const missing = Object.assign(new Error('spawn nautilus ENOENT'), { code: 'ENOENT' })
    const { run } = scriptedRunner({ nautilus: missing, dolphin: missing, nemo: missing })
    await expect(
      revealNativePath('/work/a.md', signal, { platform: 'linux', osRelease: '6.8.0', run }),
    ).rejects.toThrow('ENOENT')
  })

  it('translates the path and selects via Explorer on WSL', async () => {
    const { run, calls } = scriptedRunner({}, { wslpath: 'C:\\work\\a.md\n' })
    await revealNativePath('/mnt/c/work/a.md', signal, {
      platform: 'linux',
      osRelease: '5.15.0-microsoft-standard-WSL2',
      run,
    })
    expect(calls).toEqual([
      ['wslpath', ['-w', '/mnt/c/work/a.md']],
      ['explorer.exe', ['/select,C:\\work\\a.md']],
    ])
  })

  it('honors the WSL environment markers without a Microsoft kernel', async () => {
    const { run, calls } = scriptedRunner({}, { wslpath: 'C:\\work\\a.md\n' })
    await revealNativePath('/mnt/c/work/a.md', signal, {
      platform: 'linux',
      osRelease: '6.8.0',
      env: { WSL_DISTRO_NAME: 'Ubuntu' } as NodeJS.ProcessEnv,
      run,
    })
    expect(calls[0]?.[0]).toBe('wslpath')
    expect(calls[1]?.[0]).toBe('explorer.exe')
  })

  it('rejects on an unsupported platform', async () => {
    const { run } = scriptedRunner({})
    await expect(
      revealNativePath('/work/a.md', signal, { platform: 'freebsd', run }),
    ).rejects.toThrow('unsupported')
  })
})
