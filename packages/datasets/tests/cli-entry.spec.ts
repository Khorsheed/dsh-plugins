/**
 * Entry-guard regression. The bin's guard asks "was this module run, or
 * imported?" by comparing `import.meta.url` against `process.argv[1]`. Node
 * resolves an ESM main module to its REAL path; argv[1] keeps the path as it
 * was typed. Reached through a symlink — pnpm's `.bin/<name>` shim, which
 * spells the entry as `.bin/../@khorsheed/dsh-datasets/lib/cli.js` over a linked
 * package directory — the two never match and the body silently never runs:
 * exit 0, no output, nothing to tell the caller the CLI did nothing.
 *
 * These spawn the source entry through tsx, the same guard the built
 * `lib/cli.js` carries. No arguments is the sharp probe: the body answers
 * usage + exit 2, so a dead guard (exit 0, empty) cannot pass.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const PKG = join(import.meta.dirname, '..')
const CLI = join(PKG, 'src', 'cli.ts')

let scratch: string | undefined

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

/** Spawn the entry at `entry` with no arguments. */
async function spawnEntry(entry: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx/esm', entry], { timeout: 60_000 })
    return { code: 0, output: stdout + stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

describe('dsh-datasets entry guard', { timeout: 60_000 }, () => {
  it('reached through a symlinked package directory: the body runs and owns the exit code', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'dsh-datasets-entry-'))
    const linkedPkg = join(scratch, 'pkg')
    symlinkSync(PKG, linkedPkg)
    const result = await spawnEntry(join(linkedPkg, 'src', 'cli.ts'))
    expect(result.code, `silent exit 0 means the guard never fired: ${JSON.stringify(result.output)}`).toBe(2)
    expect(result.output).toMatch(/usage: dsh-datasets/)
  })

  it('invoked directly: unchanged', async () => {
    const result = await spawnEntry(CLI)
    expect(result.code).toBe(2)
    expect(result.output).toMatch(/usage: dsh-datasets/)
  })
})
