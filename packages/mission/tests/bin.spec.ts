/**
 * Bin smoke test: exercises the BUILT artifact (`node lib/cli.js`), the exact
 * shape the `dsh-mission` bin runs. Unit tests import `runCli` from the source
 * plane and can never catch a dead bin entry (tsdown chunks shared modules —
 * an entry guard stranded in a chunk never fires, and the bin silently exits
 * 0 doing nothing). Skipped on a fresh checkout where lib/ does not exist;
 * the green gate (`pnpm build && pnpm test`) always builds first.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const PKG = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB_CLI = join(PKG, 'lib', 'cli.js')
const hasLib = existsSync(LIB_CLI)

async function bin(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [LIB_CLI, ...args], { timeout: 30_000 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe.skipIf(!hasLib)('bin smoke (built artifact)', () => {
  it('no arguments: usage on stderr, exit 2', async () => {
    const result = await bin([])
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/usage: dsh-mission/)
  })

  it('is-releasable on a missing mission: exit 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-bin-'))
    try {
      const result = await bin(['is-releasable', 'ghost', '--data-dir', dir])
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(/does not exist/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a full round trip through the bin: create → annotate → get', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-bin-'))
    try {
      const create = await bin(['create', '--id', 'm', '--title', 'bin smoke', '--data-dir', dir])
      expect(create.code, create.stderr).toBe(0)
      expect(create.stdout).toMatch(/mission m in run default/)
      const annotate = await bin(['annotate', 'm', '--ns', 'script', '--payload', '{"ok":true}', '--data-dir', dir])
      expect(annotate.code, annotate.stderr).toBe(0)
      const get = await bin(['get', 'm', '--data-dir', dir])
      expect(get.code, get.stderr).toBe(0)
      expect(get.stdout).toMatch(/"ns": "script"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

if (!hasLib) {
  // Visible in the test output so the skip is never silent.
  it('bin smoke skipped: lib/cli.js not built (run `pnpm --filter @khorsheed/dsh-mission build` first)', () => {
    expect(hasLib).toBe(false)
  })
}
