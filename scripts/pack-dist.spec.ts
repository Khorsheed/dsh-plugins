import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDeclaredPayloadsExist, assertNoStaleTypes, familyMemberMap, familySpecsFor, filesDeclaredExtras, formatFamilySpecs, loadWorkspaceVersions, packDist, parseFamilySpecs, rescopePackageJson, rewriteNames, verifyTarball } from './pack-dist.ts'

/**
 * Caret-range satisfaction, implementing npm's documented rule including the
 * caveat that decides the bug being fixed: a **prerelease** target matches a
 * range only when that range carries a prerelease for the same
 * `[major, minor, patch]` tuple. So `0.1.0-rc.1` does NOT satisfy `^0.1.0`,
 * and `0.2.0` does not satisfy `^0.1.0` at all.
 * @param version - the concrete version to test.
 * @param range - a caret range.
 * @returns whether npm would accept the version for that range.
 */
function satisfies(version: string, range: string): boolean {
  const caret = /^\^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(range)
  if (caret === null) throw new Error(`spec helper: unsupported range ${range}`)
  const target = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  if (target === null) throw new Error(`spec helper: unsupported version ${version}`)
  const lower = [Number(caret[1]), Number(caret[2]), Number(caret[3])]
  const actual = [Number(target[1]), Number(target[2]), Number(target[3])]
  // Caret upper bound: ^1.2.3 < 2.0.0, ^0.2.3 < 0.3.0, ^0.0.3 < 0.0.4.
  const upper = lower[0]! > 0
    ? [lower[0]! + 1, 0, 0]
    : lower[1]! > 0
      ? [0, lower[1]! + 1, 0]
      : [0, 0, lower[2]! + 1]
  const targetPre = target[4]
  if (targetPre !== undefined) {
    // A prerelease is admitted only by a range carrying a prerelease for the
    // SAME tuple, and then only at or above that prerelease.
    if (caret[4] === undefined) return false
    if (compareTuples(actual, lower) !== 0) return false
    return comparePrerelease(targetPre, caret[4]) >= 0
  }
  return compareTuples(actual, lower) >= 0 && compareTuples(actual, upper) < 0
}

/** Compare [major, minor, patch] tuples. */
function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number)
  }
  return 0
}

/** Compare two prerelease identifier chains (numeric identifiers sort first). */
function comparePrerelease(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const l = left[index]
    const r = right[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const lNum = /^\d+$/.test(l)
    const rNum = /^\d+$/.test(r)
    if (lNum && rNum) return Number(l) - Number(r)
    if (lNum !== rNum) return lNum ? -1 : 1
    return l > r ? 1 : -1
  }
  return 0
}

/** Recursively list a directory's files as relative paths. */
function walkDir(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const rel = prefix === '' ? entry : join(prefix, entry)
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walkDir(abs, rel))
    else out.push(rel)
  }
  return out
}

describe('rescopePackageJson', () => {
  it('rescopes name/version, carets workspace ranges, drops repo-only fields', () => {
    const out = rescopePackageJson({
      name: '@deepseek-ai/dsh-client-message-tools',
      version: '0.1.0-rc.5',
      publishConfig: { access: 'public' },
      repository: { type: 'git', url: 'x' },
      dependencies: { zod: '^4.4.3' },
      peerDependencies: { '@deepseek-ai/cordis': 'workspace:^', react: '^18.2.0' },
      devDependencies: { '@deepseek-ai/dsh-llm': 'workspace:^' },
    }, '@khorsheed/dsh-client-message-tools', '0.4.4')
    expect(out.name).toBe('@khorsheed/dsh-client-message-tools')
    expect(out.version).toBe('0.4.4')
    expect(out.peerDependencies).toEqual({ '@deepseek-ai/cordis': '^0.1.0-rc.5', react: '^18.2.0' })
    expect(out.devDependencies).toEqual({ '@deepseek-ai/dsh-llm': '^0.1.0-rc.5' })
    expect(out.dependencies).toBeUndefined()
    expect(out['publishConfig']).toBeUndefined()
    expect(out['repository']).toBeUndefined()
  })

  it('strips lifecycle scripts — they reference the repo toolchain, absent in staging and on consumers', () => {
    const out = rescopePackageJson({
      name: '@deepseek-ai/dsh-x',
      version: '0.1.0-rc.5',
      scripts: { prepare: 'npm run build', build: 'tsc && tsdown', test: 'vitest run' },
    }, '@khorsheed/dsh-x', '0.1.0')
    expect(out.scripts).toBeUndefined()
  })

  it('renames family peers to the dist scope and ranges them on the TARGET version', () => {
    // The packed package is 0.1.0; its family peer is 0.3.0. The edge must
    // follow the target, not the packer — this is the datasets-tool/worktrees-tool
    // bug: the old code emitted `^<packer version>`, which could not resolve.
    const family = new Map([
      ['@deepseek-ai/dsh-file-preview', {
        sourceName: '@deepseek-ai/dsh-file-preview',
        distName: '@khorsheed/dsh-file-preview',
        targetVersion: '0.3.0',
      }],
    ])
    const out = rescopePackageJson({
      name: '@deepseek-ai/dsh-client-ui-file-preview',
      version: '0.1.0-rc.5',
      peerDependencies: {
        '@deepseek-ai/dsh-file-preview': 'workspace:^',
        '@deepseek-ai/dsh-client-runtime': 'workspace:^',
      },
      devDependencies: { '@deepseek-ai/dsh-file-preview': 'workspace:^' },
    }, '@khorsheed/dsh-client-ui-file-preview', '0.1.0', family)
    expect(out.peerDependencies).toEqual({
      '@khorsheed/dsh-file-preview': '^0.3.0',
      '@deepseek-ai/dsh-client-runtime': '^0.1.0-rc.5',
    })
    // A devDependency edge is ranged on the target too — the same section rule.
    expect(out.devDependencies).toEqual({ '@khorsheed/dsh-file-preview': '^0.3.0' })
  })

  it('rescopes peerDependenciesMeta keys alongside their peers', () => {
    const family = new Map([
      ['@deepseek-ai/dsh-file-preview', {
        sourceName: '@deepseek-ai/dsh-file-preview',
        distName: '@khorsheed/dsh-file-preview',
        targetVersion: '0.3.0',
      }],
    ])
    const out = rescopePackageJson({
      name: '@deepseek-ai/dsh-client-ui-file-preview',
      version: '0.1.0',
      peerDependencies: { '@deepseek-ai/dsh-file-preview': 'workspace:*' },
      peerDependenciesMeta: {
        '@deepseek-ai/dsh-file-preview': { optional: true },
        '@deepseek-ai/cordis': { optional: true },
      },
    }, '@khorsheed/dsh-client-ui-file-preview', '0.1.0', family)
    // A stale meta key would silently drop `optional` from the renamed peer.
    expect(out.peerDependenciesMeta).toEqual({
      '@khorsheed/dsh-file-preview': { optional: true },
      '@deepseek-ai/cordis': { optional: true },
    })
  })

  it('keeps family edges in dependencies for module resolution, drops bundled/host-provided deps', () => {
    const family = new Map([
      ['@khorsheed/dsh-local-agent', {
        sourceName: '@khorsheed/dsh-local-agent',
        distName: '@khorsheed/dsh-local-agent',
        targetVersion: '0.1.0-rc.6',
      }],
      ['@khorsheed/dsh-local-agent-tool-subagent', {
        sourceName: '@khorsheed/dsh-local-agent-tool-subagent',
        distName: '@khorsheed/dsh-local-agent-tool-subagent',
        targetVersion: '0.1.0-rc.6',
      }],
    ])
    const out = rescopePackageJson({
      name: '@khorsheed/dsh-local-agent-kimi',
      version: '0.1.0-rc.6',
      dependencies: {
        '@deepseek-ai/schemastery': '^3.18.1',
        '@khorsheed/dsh-local-agent': 'workspace:*',
        '@khorsheed/dsh-local-agent-tool-subagent': 'workspace:*',
      },
    }, '@khorsheed/dsh-local-agent-kimi', '0.1.0-rc.6', family)
    expect(out.dependencies).toEqual({
      '@khorsheed/dsh-local-agent': '^0.1.0-rc.6',
      '@khorsheed/dsh-local-agent-tool-subagent': '^0.1.0-rc.6',
    })
  })

  it('fails loud when a manifest edge names a rewrite-only family member', () => {
    // A bare `--family name` cannot honestly range an edge; guessing the
    // packer's own version is exactly the bug being fixed.
    const family = new Map([
      ['@khorsheed/dsh-datasets', {
        sourceName: '@khorsheed/dsh-datasets',
        distName: '@khorsheed/dsh-datasets',
      }],
    ])
    expect(() => rescopePackageJson({
      name: '@khorsheed/dsh-datasets-tool',
      version: '0.1.0',
      peerDependencies: { '@khorsheed/dsh-datasets': 'workspace:*' },
    }, '@khorsheed/dsh-datasets-tool', '0.1.0', family)).toThrow(/no version was given/)
  })
})

describe('parseFamilySpecs', () => {
  it('parses bare names and name=version pairs', () => {
    expect(parseFamilySpecs('@khorsheed/dsh-a,@khorsheed/dsh-b=0.2.0'))
      .toEqual([
        { sourceName: '@khorsheed/dsh-a' },
        { sourceName: '@khorsheed/dsh-b', targetVersion: '0.2.0' },
      ])
    expect(parseFamilySpecs(undefined)).toEqual([])
    expect(parseFamilySpecs('')).toEqual([])
  })

  it('rejects a missing, empty, malformed, or non-semver version', () => {
    expect(() => parseFamilySpecs('@khorsheed/dsh-a=')).toThrow(/missing a version/)
    expect(() => parseFamilySpecs('@khorsheed/dsh-a=')).toThrow(/@khorsheed\/dsh-a/)
    expect(() => parseFamilySpecs('@khorsheed/dsh-a=^0.1.0')).toThrow(/not a valid semver/)
    expect(() => parseFamilySpecs('@khorsheed/dsh-a=0.1')).toThrow(/not a valid semver/)
  })

  it('rejects the same family member twice with conflicting versions', () => {
    expect(() => parseFamilySpecs('@khorsheed/dsh-a=0.1.0,@khorsheed/dsh-a=0.2.0'))
      .toThrow(/conflicting versions/)
    // A repeated identical entry is harmless.
    expect(parseFamilySpecs('@khorsheed/dsh-a=0.1.0,@khorsheed/dsh-a=0.1.0'))
      .toEqual([{ sourceName: '@khorsheed/dsh-a', targetVersion: '0.1.0' }])
  })

  it('round-trips through formatFamilySpecs', () => {
    const specs = parseFamilySpecs('@khorsheed/dsh-a,@khorsheed/dsh-b=0.2.0')
    expect(formatFamilySpecs(specs)).toBe('@khorsheed/dsh-a,@khorsheed/dsh-b=0.2.0')
  })
})

describe('familyEdgeRange satisfiability', () => {
  // The four companion/core tuples that shipped with an unsatisfiable range.
  // `^0.1.0` excludes `0.1.0-rc.1` (npm only admits a prerelease when the
  // range carries one for the same tuple) and excludes `0.2.0` outright.
  const cases: readonly (readonly [string, string, string, boolean])[] = [
    ['@khorsheed/dsh-datasets-tool', '0.1.0', '0.1.0-rc.1', false],
    ['@khorsheed/dsh-eval-tool', '0.1.0', '0.1.0-rc.1', false],
    ['@khorsheed/dsh-mission-tool', '0.1.0', '0.1.0-rc.1', false],
    ['@khorsheed/dsh-worktrees-tool', '0.1.0', '0.2.0', false],
    ['@khorsheed/dsh-room-tool', '0.1.0', '0.1.0', true],
    ['@khorsheed/dsh-local-agent-tool-subagent', '0.1.0-rc.6', '0.1.0-rc.6', true],
  ]

  for (const [tool, toolVersion, coreVersion, previousWorked] of cases) {
    it(`${tool}@${toolVersion} ranges on the core's ${coreVersion}`, () => {
      const family = familyMemberMap('@khorsheed', [{ sourceName: '@khorsheed/dsh-core', targetVersion: coreVersion }])
      const out = rescopePackageJson({
        name: tool,
        version: toolVersion,
        peerDependencies: { '@khorsheed/dsh-core': 'workspace:*' },
      }, tool, toolVersion, family)
      // The emitted range must be the target's caret, and the target must
      // satisfy it.
      expect(out.peerDependencies).toEqual({ '@khorsheed/dsh-core': `^${coreVersion}` })
      expect(satisfies(coreVersion, `^${coreVersion}`)).toBe(true)
      // …whereas the old rule (the packer's own version) did not.
      const oldRange = `^${toolVersion}`
      expect(satisfies(coreVersion, oldRange)).toBe(previousWorked)
    })
  }
})

describe('filesDeclaredExtras', () => {
  it('keeps plain file/dir payloads, skips lib, staged root docs, and globs without a dir', () => {
    expect(filesDeclaredExtras([
      'lib/*.js',
      'lib/types/**/*.d.ts',
      'scripts/dsh-watchdog.sh',
      'scripts',
      'cordis.patch.yml',
      'README.md',
      'assets',
    ])).toEqual(['scripts/dsh-watchdog.sh', 'scripts', 'assets'])
    expect(filesDeclaredExtras(undefined)).toEqual([])
  })

  it('expands dir/**/*.ext globs against the package dir (skills ship)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-glob-'))
    try {
      mkdirSync(join(dir, 'skills', '3d-artifact'), { recursive: true })
      mkdirSync(join(dir, 'skills', 'nested'), { recursive: true })
      writeFileSync(join(dir, 'skills', '3d-artifact', 'SKILL.md'), 'x')
      writeFileSync(join(dir, 'skills', 'nested', 'other.md'), 'y')
      writeFileSync(join(dir, 'skills', 'ignore.txt'), 'z')
      expect(filesDeclaredExtras(['skills/**/*.md'], dir).sort())
        .toEqual(['skills/3d-artifact/SKILL.md', 'skills/nested/other.md'])
      // `<dir>/**/*` matches every file recursively.
      expect(filesDeclaredExtras(['skills/**/*'], dir).sort())
        .toEqual(['skills/3d-artifact/SKILL.md', 'skills/ignore.txt', 'skills/nested/other.md'])
      // Unknown glob shapes expand to nothing.
      expect(filesDeclaredExtras(['assets/*.png'], dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('rewriteNames', () => {
  it('rewrites self and family names, leaving other package names alone', () => {
    const text = "import '@deepseek-ai/dsh-client-message-tools/remote'; import '@deepseek-ai/dsh-file-preview/types'; import '@deepseek-ai/dsh-llm'"
    expect(rewriteNames(text, [
      ['@deepseek-ai/dsh-client-message-tools', '@khorsheed/dsh-client-message-tools'],
      ['@deepseek-ai/dsh-file-preview', '@khorsheed/dsh-file-preview'],
    ])).toBe(
      "import '@khorsheed/dsh-client-message-tools/remote'; import '@khorsheed/dsh-file-preview/types'; import '@deepseek-ai/dsh-llm'",
    )
  })
})

describe('assertNoStaleTypes', () => {
  it('passes a clean tree and fails on an emit with no backing src module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-spec-'))
    try {
      mkdirSync(join(dir, 'src/client'), { recursive: true })
      mkdirSync(join(dir, 'lib/types/client'), { recursive: true })
      writeFileSync(join(dir, 'src/marker.ts'), '')
      writeFileSync(join(dir, 'src/client/view.tsx'), '')
      writeFileSync(join(dir, 'lib/types/marker.js'), '')
      writeFileSync(join(dir, 'lib/types/client/view.js'), '')
      expect(() => assertNoStaleTypes(dir)).not.toThrow()
      writeFileSync(join(dir, 'lib/types/client/gone.js'), '')
      expect(() => assertNoStaleTypes(dir)).toThrow(/gone/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when the package has no lib/types at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-spec-'))
    try {
      expect(() => assertNoStaleTypes(dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('assertDeclaredPayloadsExist', () => {
  it('passes when every files entry resolves, and fails on empty glob expansions and missing paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-decl-'))
    try {
      mkdirSync(join(dir, 'skills/s'), { recursive: true })
      writeFileSync(join(dir, 'skills/s/SKILL.md'), '# s')
      // lib/ and staged root docs are exempt from the existence requirement.
      expect(() => assertDeclaredPayloadsExist(['lib', 'cordis.patch.yml', 'skills/**/*.md'], dir)).not.toThrow()
      expect(() => assertDeclaredPayloadsExist(['skills/**/*.md', 'assets/**/*.png'], dir))
        .toThrow(/assets\/\*\*\/\*\.png.*glob expands to nothing/)
      expect(() => assertDeclaredPayloadsExist(['scripts/missing.sh'], dir))
        .toThrow(/scripts\/missing\.sh.*no such path/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verifyTarball', () => {
  function stage(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-verify-'))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return dir
  }
  function pack(dir: string): string {
    // bsdtar has no --transform: build the package/ prefix in a scratch dir so
    // the staging tree itself stays untouched.
    const scratch = mkdtempSync(join(tmpdir(), 'pack-dist-pack-'))
    const pkgDir = join(scratch, 'package')
    for (const rel of walkDir(dir)) {
      mkdirSync(join(pkgDir, rel, '..'), { recursive: true })
      copyFileSync(join(dir, rel), join(pkgDir, rel))
    }
    const tgz = join(scratch, 'out.tgz')
    execFileSync('tar', ['-czf', tgz, '-C', scratch, 'package'])
    return tgz
  }

  it('passes a complete, well-declared tarball', () => {
    const dir = stage({
      'package.json': JSON.stringify({ name: '@khorsheed/dsh-x', dependencies: { '@khorsheed/dsh-core': '^0.1.0' } }),
      'lib/index.js': "import '@khorsheed/dsh-core'; import '@khorsheed/dsh-x/types';",
    })
    try {
      expect(() => verifyTarball(pack(dir), dir, '@khorsheed/dsh-x')).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when a staged file is missing from the tarball', () => {
    const dir = stage({ 'package.json': '{}', 'lib/index.js': '' })
    const tgz = pack(dir)
    try {
      // A file that reaches staging after packing is by definition missing
      // from the tarball (the files-field gap this check exists for).
      mkdirSync(join(dir, 'skills/s'), { recursive: true })
      writeFileSync(join(dir, 'skills/s/SKILL.md'), '# s')
      expect(() => verifyTarball(tgz, dir, '@khorsheed/dsh-x')).toThrow(/missing from the tarball.*SKILL\.md/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails on a family reference with no manifest edge', () => {
    const dir = stage({
      'package.json': JSON.stringify({ name: '@khorsheed/dsh-x' }),
      'lib/index.js': "import '@khorsheed/dsh-core';",
    })
    try {
      expect(() => verifyTarball(pack(dir), dir, '@khorsheed/dsh-x')).toThrow(/without manifest edges.*dsh-core/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes a family name declared as a data reference (dsh.references)', () => {
    // A core mentions its companion row by name as DATA (a preset-visibility
    // probe) — declared in `dsh.references`, never as a dependency edge.
    const dir = stage({
      'package.json': JSON.stringify({ name: '@khorsheed/dsh-x', dsh: { references: ['@khorsheed/dsh-x-tool'] } }),
      'lib/index.js': "const TOOL_ROW = '@khorsheed/dsh-x-tool';",
    })
    try {
      expect(() => verifyTarball(pack(dir), dir, '@khorsheed/dsh-x')).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('packDist end-to-end (independent of the self-checks)', () => {
  // The artifact-level regression line: even if every self-check were deleted
  // or broken by a later change, this test still proves a glob-declared payload
  // physically reaches the tarball.
  it('a real pack ships a glob-declared skill in the tarball', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-e2e-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(join(dir, 'lib/types'), { recursive: true })
      mkdirSync(join(dir, 'skills/demo'), { recursive: true })
      writeFileSync(join(dir, 'src/index.ts'), 'export {}\n')
      writeFileSync(join(dir, 'lib/index.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/types/index.d.ts'), 'export {}\n')
      writeFileSync(join(dir, 'lib/types/index.js'), 'export {}\n')
      writeFileSync(join(dir, 'skills/demo/SKILL.md'), '# demo skill\n')
      writeFileSync(join(dir, 'cordis.patch.yml'), "- insert:\n    - id: demo\n      name: '@khorsheed/dsh-e2e-demo'\n")
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@khorsheed/dsh-e2e-demo',
        version: '0.1.0-rc.1',
        files: ['lib', 'skills/**/*.md', 'cordis.patch.yml'],
      }))
      const tarball = packDist({ packageDir: dir, scope: '@khorsheed', version: '0.1.0-rc.1', outDir: dir })
      const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      expect(listing).toContain('package/skills/demo/SKILL.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('pack-dist CLI wiring', () => {
  it('is importable without running main (no tarball side effect)', () => {
    expect(typeof rescopePackageJson).toBe('function')
    expect(readFileSync(join(__dirname, 'pack-dist.ts'), 'utf8')).toContain('process.argv')
  })
})
