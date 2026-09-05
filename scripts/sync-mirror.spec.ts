import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mirrorFiles } from './sync-mirror.mts'

// Runs against the real tree, like the other checker specs. The invariant
// under test is a security boundary: the mirrors are PUBLIC, so only files
// git tracks may cross. A disk walk (the pre-fix behaviour) also picked up
// gitignored local state sitting in the artifact dir — build tarballs,
// *.tsbuildinfo, debug screenshots.

const root = join(import.meta.dirname, '..')

/** Every tracked path, read once. The obvious spelling — `git ls-files
 * --error-unmatch` per candidate — spawns a subprocess per file and pushed
 * this spec past vitest's 5s default at around ninety files. The set is built
 * lazily so the cost lands in the first test that needs it, not at import. */
let trackedCache: Set<string> | undefined
function tracked(): Set<string> {
  trackedCache ??= new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter((path) => path !== ''),
  )
  return trackedCache
}

describe('mirrorFiles', () => {
  it('emits only files git tracks — no gitignored local state', () => {
    for (const [kind, name] of [['package', 'ankh-guard'], ['profile', 'web-basic'], ['skill', 'self-upgrade']] as const) {
      const untracked = mirrorFiles(kind, name).filter((f: string) => !tracked().has(`${kind}s/${name}/${f}`))
      expect(untracked, `${kind}s/${name} would ship untracked files`).toEqual([])
    }
  })

  it('never ships build output or dependencies', () => {
    const files = mirrorFiles('package', 'ankh-guard')
    expect(files.filter((f: string) => f.startsWith('lib/') || f.startsWith('node_modules/') || f.endsWith('.tgz'))).toEqual([])
    expect(files).toContain('package.json')
    expect(files).toContain('src/index.ts')
  })

  it("honours the kind's skip set — the skill's tests/ rig stays home", () => {
    const files = mirrorFiles('skill', 'self-upgrade')
    expect(files.filter((f: string) => f.startsWith('tests/'))).toEqual([])
    expect(files).toContain('SKILL.md')
  })

  it('ships nested tracked files, including force-added screenshots', () => {
    const files = mirrorFiles('profile', 'web-basic')
    expect(files).toContain('package.json')
    expect(files).toContain('scripts/install.sh')
    expect(files.some((f: string) => f.startsWith('docs/screenshots/'))).toBe(true)
  })
})
