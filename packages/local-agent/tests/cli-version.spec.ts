import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  CLI_VERSION_FAILURE_TTL_MS,
  clearCliVersionCache,
  parseCliVersion,
  probeCliVersion,
} from '@khorsheed/dsh-local-agent'

/** A stub child that reports `text` on stdout and exits with `exitCode`. */
function stubChild(text: string, exitCode: number | null = 0): SubprocessHandle {
  return {
    pid: 1234,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: exitCode === null ? 'SIGTERM' as const : null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

/** A fake executable on disk, so the probe's cache key has something to stat. */
function fakeExecutable(contents = '#!/bin/sh\nexit 0\n'): string {
  const bin = join(mkdtempSync(join(tmpdir(), 'cli-version-bin-')), 'fake-cli')
  writeFileSync(bin, contents)
  chmodSync(bin, 0o755)
  return bin
}

/** A spawn seam counting its calls and answering with one canned banner. */
function seam(banner: string, exitCode: number | null = 0) {
  const calls: SubprocessSpawnSpec[] = []
  return {
    calls,
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      calls.push(spec)
      return stubChild(banner, exitCode)
    },
  }
}

beforeEach(() => { clearCliVersionCache() })

describe('parseCliVersion', () => {
  it('reads the version token out of each family CLI’s own banner shape', () => {
    expect(parseCliVersion('codex-cli 0.144.0\n')).toBe('0.144.0')
    expect(parseCliVersion('2.1.263 (Claude Code)\n')).toBe('2.1.263')
    expect(parseCliVersion('0.39.1\n')).toBe('0.39.1')
    expect(parseCliVersion('0.1.1-rc.2\n')).toBe('0.1.1-rc.2')
  })

  it('reports nothing rather than inventing one when the output carries no version', () => {
    expect(parseCliVersion('command not found')).toBeUndefined()
    expect(parseCliVersion('')).toBeUndefined()
  })
})

describe('probeCliVersion', () => {
  it('spawns the probe in the scoped home with the caller’s env layer', async () => {
    const bin = fakeExecutable()
    const probe = seam('codex-cli 0.144.0\n')
    const version = await probeCliVersion({
      argv: [bin, '--version'],
      cwd: '/scoped/home',
      spawn: probe.spawn,
      env: { CODEX_HOME: '/scoped/home' },
    })
    expect(version).toBe('0.144.0')
    expect(probe.calls[0]).toMatchObject({
      argv: [bin, '--version'],
      cwd: '/scoped/home',
      env: { CODEX_HOME: '/scoped/home' },
    })
  })

  it('spawns once per executable identity, however many callers ask', async () => {
    const bin = fakeExecutable()
    const probe = seam('0.39.1\n')
    const request = { argv: [bin, '--version'], cwd: '/home', spawn: probe.spawn }
    const [first, second, third] = await Promise.all([
      probeCliVersion(request),
      probeCliVersion(request),
      probeCliVersion(request),
    ])
    expect([first, second, third]).toEqual(['0.39.1', '0.39.1', '0.39.1'])
    expect(await probeCliVersion(request)).toBe('0.39.1')
    expect(probe.calls).toHaveLength(1)
  })

  it('re-probes after the binary changes, so an upgrade is never reported stale', async () => {
    const bin = fakeExecutable()
    const first = seam('0.39.1\n')
    expect(await probeCliVersion({ argv: [bin, '--version'], cwd: '/home', spawn: first.spawn })).toBe('0.39.1')
    // The upgrade rewrites the executable: a different size and mtime, so a
    // different cache key.
    writeFileSync(bin, '#!/bin/sh\n# a newer build\nexit 0\n')
    const second = seam('0.40.0\n')
    expect(await probeCliVersion({ argv: [bin, '--version'], cwd: '/home', spawn: second.spawn })).toBe('0.40.0')
    expect(second.calls).toHaveLength(1)
  })

  it('caches the identity of a launcher argv’s entry script too', async () => {
    // The sub-dsh's launch is `node … bin.js --version`: the node binary never
    // changes across a harness upgrade, the entry script does.
    const node = fakeExecutable()
    const entry = fakeExecutable('console.log("0.1.1-rc.2")\n')
    const first = seam('0.1.1-rc.2\n')
    expect(await probeCliVersion({ argv: [node, entry, '--version'], cwd: '/home', spawn: first.spawn }))
      .toBe('0.1.1-rc.2')
    writeFileSync(entry, 'console.log("0.1.2")\n')
    const second = seam('0.1.2\n')
    expect(await probeCliVersion({ argv: [node, entry, '--version'], cwd: '/home', spawn: second.spawn }))
      .toBe('0.1.2')
  })

  it('degrades to undefined on a non-zero exit rather than parsing the diagnostics', async () => {
    const bin = fakeExecutable()
    // A version-shaped token inside an error message must not become the
    // reported version.
    const probe = seam('error: this CLI requires node >= 22.19.0\n', 1)
    expect(await probeCliVersion({ argv: [bin, '--version'], cwd: '/home', spawn: probe.spawn })).toBeUndefined()
  })

  it('degrades to undefined when the probe is killed by its own timeout', async () => {
    const bin = fakeExecutable()
    const probe = seam('', null)
    expect(await probeCliVersion({ argv: [bin, '--version'], cwd: '/home', spawn: probe.spawn, timeoutMs: 10 }))
      .toBeUndefined()
    expect(probe.calls[0]?.signal).toBeDefined()
  })

  it('degrades to undefined when the spawn seam itself throws', async () => {
    const bin = fakeExecutable()
    expect(await probeCliVersion({
      argv: [bin, '--version'],
      cwd: '/home',
      spawn: () => { throw new Error('no subprocess service') },
    })).toBeUndefined()
  })

  it('retries a failed probe once its short TTL expires, but not before', async () => {
    const bin = fakeExecutable()
    const failing = seam('', 1)
    const request = { argv: [bin, '--version'], cwd: '/home', spawn: failing.spawn }
    expect(await probeCliVersion(request)).toBeUndefined()
    expect(await probeCliVersion(request)).toBeUndefined()
    // Still one spawn: a missing CLI must not cost a process per status read.
    expect(failing.calls).toHaveLength(1)

    // Past the TTL the probe runs again, so a transient miss recovers without
    // waiting for the next CLI upgrade.
    const realNow = Date.now
    Date.now = () => realNow() + CLI_VERSION_FAILURE_TTL_MS + 1
    try {
      const recovered = seam('0.39.1\n')
      expect(await probeCliVersion({ ...request, spawn: recovered.spawn })).toBe('0.39.1')
      expect(recovered.calls).toHaveLength(1)
    } finally {
      Date.now = realNow
    }
  })

  it('keys an uninstalled CLI on its argv, so it is not probed once per call', async () => {
    const probe = seam('', 1)
    const request = { argv: ['definitely-not-installed-cli', '--version'], cwd: '/home', spawn: probe.spawn }
    expect(await probeCliVersion(request)).toBeUndefined()
    expect(await probeCliVersion(request)).toBeUndefined()
    expect(probe.calls).toHaveLength(1)
  })
})
