// Skill bundle smoke: every directory under skills/ carrying a SKILL.md is a
// distributable skill (imported into instances via capability-catalog's zip /
// GitHub import). This test owns the zip-content contract: the archive must
// contain SKILL.md with a parseable frontmatter (name + description), and
// every reference/ and assets/ entry present on disk must land in the zip —
// the skill's runbook points at those paths, so a missing file is a runtime
// failure inside the instance, not a packaging detail.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const skillsRoot = join(repoRoot, 'skills')
const tmps: string[] = []

/** Skill directories = immediate children of skills/ carrying a SKILL.md. */
function skillDirs(): string[] {
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, e.name, 'SKILL.md')))
    .map((e) => e.name)
}

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'tests') continue // test assets never ship in the skill zip
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p, base))
    else out.push(relative(base, p))
  }
  return out
}

afterAll(() => {
  for (const dir of tmps) rmSync(dir, { recursive: true, force: true })
})

describe('skill bundle smoke', () => {
  it('at least one skill directory exists', () => {
    expect(skillDirs().length).toBeGreaterThan(0)
  })

  for (const name of skillDirs()) {
    it(`skills/${name}: zip carries SKILL.md + reference/ + assets/ verbatim`, () => {
      const dir = join(skillsRoot, name)
      const tmp = mkdtempSync(join(tmpdir(), 'skill-zip-'))
      tmps.push(tmp)
      const zipPath = join(tmp, `${name}.zip`)
      const files = walkFiles(dir)
      // Zip with the wrapping folder (catalog strips it on import); tests/
      // never ships.
      execFileSync('zip', ['-q', '-r', zipPath, name, '-x', `${name}/tests/*`], { cwd: skillsRoot, stdio: 'pipe' })
      const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' })
      // Frontmatter parses and names the skill.
      const skill = `${name}/SKILL.md`
      expect(listing, 'SKILL.md missing from the zip').toContain(skill)
      const raw = execFileSync('unzip', ['-p', zipPath, skill], { encoding: 'utf8' })
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw)
      expect(match, 'SKILL.md frontmatter missing').not.toBeNull()
      expect(match![1]).toMatch(/^name: .+$/m)
      expect(match![1]).toMatch(/^description: .+$/m)
      // Every shippable file landed in the archive.
      for (const file of files) {
        expect(listing, `${file} missing from the zip`).toContain(`${name}/${file}`)
      }
    })
  }
})
