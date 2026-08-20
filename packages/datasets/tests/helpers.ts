/**
 * Shared test fixtures: throwaway git repositories under the runtime temp
 * directory (never a hardcoded path — the repo is public and the hygiene gate
 * rejects machine-specific absolute paths).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Run git synchronously in the fixture (setup-only; the code under test uses async git). */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' })
}

/** A throwaway git repository with a standard two-dataset fixture committed. */
export interface FixtureRepo {
  dir: string
  commit: string
}

/** The standard fixture descriptor of dataset `alpha` (layers: visible + hidden). */
export const ALPHA_DESCRIPTOR = {
  id: 'alpha',
  name: 'Alpha dataset',
  layers: [
    { name: 'visible' },
    { name: 'hidden', modelFacing: false },
  ],
  itemMetaSchema: { type: 'object', properties: { difficulty: { type: 'string' } } },
  extra: { passthrough: true },
}

/** Write files (repo-relative path → content) into a directory. */
export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

/** Commit every change in the fixture repository; returns the new HEAD. */
export function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', message])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

/**
 * Create a fixture repository:
 * - dataset `alpha`: layers `visible`/`hidden` (hidden is modelFacing:false),
 *   items `i1` (metadata + one file per layer) and `i2` (visible only), plus
 *   a passthrough descriptor file.
 * - dataset `beta`: one `visible` layer, one item.
 */
export function makeFixtureRepo(): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-test-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, {
    'datasets/alpha/dataset.json': `${JSON.stringify(ALPHA_DESCRIPTOR, null, 2)}\n`,
    'datasets/alpha/handbook.md': '# handbook passthrough\n',
    'datasets/alpha/items/i1/item.json': '{"difficulty":"hard"}\n',
    'datasets/alpha/items/i1/visible/task.md': 'task one v1\n',
    'datasets/alpha/items/i1/hidden/notes.md': 'hidden notes v1\n',
    'datasets/alpha/items/i2/visible/task.md': 'task two v1\n',
    'datasets/beta/dataset.json': '{"id":"beta","layers":[{"name":"visible"}]}\n',
    'datasets/beta/items/b1/visible/data.txt': 'beta data\n',
  })
  return { dir, commit: commitAll(dir, 'fixture') }
}

/** Remove a fixture directory tree. */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
