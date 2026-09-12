import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPANION_PAIRS, RELEASE_GROUPS, checkReleaseGroups, satisfiesCaret } from './check-release-groups.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

describe('satisfiesCaret', () => {
  it('accepts a prerelease only when the range carries one for the same tuple', () => {
    // The bug this freezes: `^0.1.0` excludes `0.1.0-rc.1`, so a stable
    // companion ranged on the packer's version could not resolve its core.
    expect(satisfiesCaret('0.1.0-rc.1', '^0.1.0-rc.1')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.1', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.0', '^0.1.0-rc.1')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.6', '^0.1.0-rc.5')).toBe(true)
  })

  it('compares numeric prerelease identifiers numerically, not lexically', () => {
    // `rc.10` is newer than `rc.6`; a locale string compare says the opposite,
    // which would reject a perfectly resolvable companion edge at rc.10+.
    expect(satisfiesCaret('0.1.0-rc.10', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.6', '^0.1.0-rc.10')).toBe(false)
    // Numeric identifiers sort below alphanumeric ones (semver §11.4.3).
    expect(satisfiesCaret('0.1.0-1', '^0.1.0-alpha')).toBe(false)
    expect(satisfiesCaret('0.1.0-beta', '^0.1.0-alpha')).toBe(true)
    expect(satisfiesCaret('0.1.0-alpha', '^0.1.0-beta')).toBe(false)
  })

  it('applies the caret upper bound, including the 0.x rules', () => {
    expect(satisfiesCaret('0.2.0', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('0.2.0', '^0.2.0')).toBe(true)
    expect(satisfiesCaret('0.3.0', '^0.2.0')).toBe(false)
    expect(satisfiesCaret('1.0.0', '^0.9.0')).toBe(false)
    expect(satisfiesCaret('1.4.0', '^1.2.3')).toBe(true)
    expect(satisfiesCaret('2.0.0', '^1.2.3')).toBe(false)
  })

  it('rejects anything that is not a caret range', () => {
    expect(satisfiesCaret('0.1.0', '~0.1.0')).toBe(false)
    expect(satisfiesCaret('0.1.0', 'workspace:*')).toBe(false)
  })
})

describe('release group declaration', () => {
  it('names packages that exist in this repo', () => {
    for (const group of RELEASE_GROUPS) {
      for (const dir of group.dirs) {
        expect(existsSync(join(repoRoot, 'packages', dir, 'package.json')), `${dir} is missing`).toBe(true)
      }
    }
    for (const { core, companion } of COMPANION_PAIRS) {
      for (const dir of [core, companion]) {
        expect(existsSync(join(repoRoot, 'packages', dir, 'package.json')), `${dir} is missing`).toBe(true)
      }
    }
  })

  it('covers the seven local-agent packages', () => {
    expect(RELEASE_GROUPS.find(g => g.name === 'local-agent')?.dirs).toHaveLength(7)
  })

  it('covers the five core/companion pairs', () => {
    expect(COMPANION_PAIRS).toHaveLength(5)
  })
})

describe('checkReleaseGroups', () => {
  it('passes the real tree: every companion edge resolves, and no version-line error', () => {
    // The companion rules are always hard: a packed edge that cannot resolve
    // is a defect the moment it exists.
    const findings = checkReleaseGroups(repoRoot)
    expect(findings.filter(f => f.severity !== 'warn' && f.kind === 'companion pair')).toEqual([])
    expect(findings.filter(f => f.severity !== 'warn')).toEqual([])
  })

  it('reports the known family skew as a warning, and as fatal under --release', () => {
    // local-agent-claude-code sits at rc.5 while the rest of the family is at
    // rc.6. docs/publishing.md forbids a worktree from moving a version, so the
    // gate warns; the pre-publish run must refuse.
    const warned = checkReleaseGroups(repoRoot)
    expect(warned.some(f => f.kind === 'release group' && f.severity === 'warn')).toBe(true)
    const strict = checkReleaseGroups(repoRoot, { release: true })
    expect(strict.some(f => f.kind === 'release group' && f.severity !== 'warn')).toBe(true)
  })

  it('flags a family package that drifted off the line', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-groups-'))
    try {
      const family = RELEASE_GROUPS[0]!
      for (const dir of family.dirs) {
        const dirPath = join(root, 'packages', dir)
        mkdirSync(dirPath, { recursive: true })
        // One package behind the line — the rc.5/rc.6 skew that motivated this.
        const version = dir === 'local-agent-codex' ? '0.1.0-rc.5' : '0.1.0-rc.6'
        writeFileSync(join(dirPath, 'package.json'), JSON.stringify({
          name: `@khorsheed/dsh-${dir}`,
          version,
          dsh: { bundle: { patch: 'cordis.patch.yml' } },
        }))
      }
      const findings = checkReleaseGroups(root)
      expect(findings.some(f => f.kind === 'release group' && f.path.includes('local-agent-codex'))).toBe(true)
      // The family exists in the fixture, so nothing is reported as missing.
      expect(findings.some(f => f.detail.includes('do not exist'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
