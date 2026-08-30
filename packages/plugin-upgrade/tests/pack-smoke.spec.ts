// Pack smoke: the published tarball must be self-contained. The apply-time
// code reads the skill bundle from <pkg>/skills/plugin-upgrade/ and degrades
// to a bare warning when it is missing — so this test owns the bundle's
// presence in the tarball (SKILL.md + reference/ + assets/), plus the lib
// invariant every relative import inside the bundled entries resolves within
// the artifact (publint cannot see deep relative imports).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const tmps: string[] = []

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmps) rmSync(dir, { recursive: true, force: true })
})

describe('pack smoke', () => {
  it('the tarball contains the skill bundle and every relative import of the lib entries', () => {
    const libDir = join(pkgDir, 'lib')
    for (const entry of ['index.js', 'invariant.js']) {
      expect(existsSync(join(libDir, entry)), `lib/${entry} missing — run the host build first`).toBe(true)
    }
    const tmp = tmpDir('plugin-upgrade-pack-')
    execFileSync('pnpm', ['pack', '--pack-destination', tmp], { cwd: pkgDir, stdio: 'pipe' })
    const tgz = readdirSync(tmp).find(name => name.endsWith('.tgz'))
    expect(tgz, 'pnpm pack produced a tarball').toBeDefined()
    const unpack = join(tmp, 'unpack')
    mkdirSync(unpack)
    execFileSync('tar', ['-xzf', join(tmp, tgz!), '-C', unpack], { stdio: 'pipe' })
    const artifactLib = join(unpack, 'package', 'lib')
    const jsFiles = readdirSync(artifactLib).filter(name => name.endsWith('.js'))
    expect(jsFiles.length, 'artifact lib contains the bundled js').toBeGreaterThanOrEqual(2)
    for (const name of jsFiles) {
      const source = readFileSync(join(artifactLib, name), 'utf8')
      for (const match of source.matchAll(/from "(\.[^"]+)"/g)) {
        const target = resolve(artifactLib, match[1] ?? '')
        expect(existsSync(target), `${name} imports ${match[1]} which is missing from the artifact`).toBe(true)
      }
    }
    // The skill bundle ships with the package — apply() reads it from
    // <pkg>/skills/plugin-upgrade/ and the supervisor template beside it.
    const skillDir = join(unpack, 'package', 'skills', 'plugin-upgrade')
    expect(existsSync(join(skillDir, 'SKILL.md')), 'SKILL.md missing from the tarball').toBe(true)
    expect(existsSync(join(skillDir, 'reference', 'breakage-checklist.md')), 'reference/breakage-checklist.md missing').toBe(true)
    expect(existsSync(join(skillDir, 'reference', 'dual-host-fix-patterns.md')), 'reference/dual-host-fix-patterns.md missing').toBe(true)
    expect(existsSync(join(skillDir, 'assets', 'restart-resume.sh')), 'assets/restart-resume.sh missing').toBe(true)
    // Self-mounting: the bundle patch rides the tarball.
    expect(existsSync(join(unpack, 'package', 'cordis.patch.yml')), 'cordis.patch.yml missing from the tarball').toBe(true)
  })
})
