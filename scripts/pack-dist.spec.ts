import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDeclaredPayloadsExist, assertNoStaleTypes, familyMemberMap, familySpecsFor, filesDeclaredExtras, formatFamilySpecs, loadWorkspaceVersions, packDist, parseFamilySpecs, prunePublishArtifacts, rescopePackageJson, rewriteNames, verifyTarball } from './pack-dist.ts'

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
    expect(out.devDependencies).toBeUndefined()
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
    // devDependencies never ship, family member or not.
    expect(out.devDependencies).toBeUndefined()
  })

  it('drops devDependencies whole and carets workspace:* like workspace:^ (T77)', () => {
    // The e9110d52 shape: a source-plane sibling as a `workspace:*`
    // devDependency, NOT passed as a family member — left in the manifest it
    // made `pnpm pack` fail ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL.
    const family = new Map([
      ['@khorsheed/dsh-local-agent', {
        sourceName: '@khorsheed/dsh-local-agent',
        distName: '@khorsheed/dsh-local-agent',
        targetVersion: '0.4.0',
      }],
    ])
    const out = rescopePackageJson({
      name: '@khorsheed/dsh-local-files',
      version: '0.2.0',
      dependencies: {
        '@khorsheed/dsh-local-agent': 'workspace:*',
        '@khorsheed/dsh-runtime-helper': 'workspace:*',
        zod: '^4.4.3',
      },
      peerDependencies: { '@khorsheed/dsh-ui-kernel': 'workspace:*', react: '^18.2.0' },
      devDependencies: { '@khorsheed/dsh-client-ui-content-preview': 'workspace:*' },
      dsh: { runtimeDependencies: ['@khorsheed/dsh-runtime-helper'] },
    }, '@khorsheed/dsh-local-files', '0.2.0', family)
    expect(out.devDependencies).toBeUndefined()
    expect(out.dependencies).toEqual({
      '@khorsheed/dsh-local-agent': '^0.4.0',
      '@khorsheed/dsh-runtime-helper': '^0.2.0',
    })
    expect(out.peerDependencies).toEqual({ '@khorsheed/dsh-ui-kernel': '^0.2.0', react: '^18.2.0' })
    expect(JSON.stringify(out)).not.toContain('workspace:')
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

  it('keeps dsh.runtimeDependencies entries verbatim, drops the rest', () => {
    // capture's puppeteer stays unbundled by design (runtime dynamic import):
    // the dist manifest must still install it, or the deployed plugin answers
    // "Cannot find package" on first render (the 3080 incident, 2026-09-21).
    const out = rescopePackageJson({
      name: '@khorsheed/dsh-capture',
      version: '0.1.0',
      dependencies: { 'puppeteer-core': '^25.11.0', '@puppeteer/browsers': '^3.2.2', zod: '^4.4.3' },
      dsh: { runtimeDependencies: ['puppeteer-core', '@puppeteer/browsers'] },
    } as Parameters<typeof rescopePackageJson>[0], '@khorsheed/dsh-capture', '0.1.0')
    expect(out.dependencies).toEqual({ 'puppeteer-core': '^25.11.0', '@puppeteer/browsers': '^3.2.2' })
  })

  it('fails loud when dsh.runtimeDependencies names a non-dependency', () => {
    expect(() => rescopePackageJson({
      name: '@khorsheed/dsh-x',
      version: '0.1.0',
      dependencies: { zod: '^4.4.3' },
      dsh: { runtimeDependencies: ['puppeteer-core'] },
    } as Parameters<typeof rescopePackageJson>[0], '@khorsheed/dsh-x', '0.1.0')).toThrow(/not in dependencies/)
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
      // Single-level globs (the display metadata's locale/*.json): only the
      // root level, nested files stay out.
      mkdirSync(join(dir, 'locale', 'nested'), { recursive: true })
      writeFileSync(join(dir, 'locale', 'en.json'), '{}')
      writeFileSync(join(dir, 'locale', 'zh.json'), '{}')
      writeFileSync(join(dir, 'locale', 'nested', 'deep.json'), '{}')
      expect(filesDeclaredExtras(['locale/*.json'], dir).sort())
        .toEqual(['locale/en.json', 'locale/zh.json'])
      // Unknown glob shapes (a `*` segment mid-path) expand to nothing.
      expect(filesDeclaredExtras(['assets/*/icon.png'], dir)).toEqual([])
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

  it('passes a family sibling declared as a devDependency (the source-plane library shape)', () => {
    // A sibling inlined at build time has no runtime edge to declare: it is a
    // devDependency, and pack-dist itself renames and ranges that field on the
    // family target. The payload still mentions it (emitted .d.ts imports and
    // dead tsc intermediates), so the verifier must count the field it emits —
    // otherwise such a package could never pass its own pack.
    const dir = stage({
      'package.json': JSON.stringify({ name: '@khorsheed/dsh-x', devDependencies: { '@khorsheed/dsh-ui-kernel': '^0.1.0' } }),
      'lib/types/client/index.js': "import { helper } from '@khorsheed/dsh-ui-kernel/src/client/index.ts';",
    })
    try {
      expect(() => verifyTarball(pack(dir), dir, '@khorsheed/dsh-x')).not.toThrow()
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

  it('fails on a tarball carrying sourcemaps or tsbuildinfo', () => {
    // packDist prunes staging; this is the artifact-level backstop for a glob
    // or a late build writing them back in.
    const dir = stage({ 'package.json': '{}', 'lib/index.js': '' })
    try {
      writeFileSync(join(dir, 'lib/index.js.map'), '{}')
      writeFileSync(join(dir, 'lib/tsconfig.tsbuildinfo'), '{}')
      expect(() => verifyTarball(pack(dir), dir, '@khorsheed/dsh-x'))
        .toThrow(/non-publishable build artifacts.*index\.js\.map/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('prunePublishArtifacts', () => {
  it('removes maps and tsbuildinfo recursively, leaving real payload intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-prune-'))
    try {
      mkdirSync(join(dir, 'lib/types/client'), { recursive: true })
      writeFileSync(join(dir, 'lib/index.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/index.js.map'), '{}')
      writeFileSync(join(dir, 'lib/client.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/client.js.map'), '{}')
      writeFileSync(join(dir, 'lib/tsconfig.tsbuildinfo'), '{}')
      writeFileSync(join(dir, 'lib/types/index.d.ts'), 'export {}\n')
      writeFileSync(join(dir, 'lib/types/index.d.ts.map'), '{}')
      // A file whose name merely ends in "map" but is real payload survives.
      writeFileSync(join(dir, 'lib/bitmap.js'), 'export {}\n')
      expect(prunePublishArtifacts(dir)).toEqual([
        'lib/client.js.map',
        'lib/index.js.map',
        'lib/tsconfig.tsbuildinfo',
        'lib/types/index.d.ts.map',
      ])
      expect(walkDir(dir).sort()).toEqual([
        'lib/bitmap.js',
        'lib/client.js',
        'lib/index.js',
        'lib/types/index.d.ts',
      ])
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

  it('a real pack survives workspace:* devDependencies and ships no devDependencies (T77)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-devdeps-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(join(dir, 'lib/types'), { recursive: true })
      writeFileSync(join(dir, 'src/index.ts'), 'export {}\n')
      writeFileSync(join(dir, 'lib/index.js'), 'export {}\n')
      // The emitted declarations mention the inlined dev sibling by name; the
      // verifier must still accept it although the dist manifest drops the field.
      writeFileSync(join(dir, 'lib/types/index.d.ts'), "export type { X } from '@khorsheed/dsh-client-ui-content-preview'\n")
      writeFileSync(join(dir, 'lib/types/index.js'), 'export {}\n')
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@khorsheed/dsh-e2e-devdeps',
        version: '0.1.0',
        files: ['lib'],
        dependencies: { '@khorsheed/dsh-e2e-core': 'workspace:*' },
        devDependencies: { '@khorsheed/dsh-client-ui-content-preview': 'workspace:*', typescript: '^5.0.0' },
      }))
      const tarball = packDist({
        packageDir: dir,
        scope: '@khorsheed',
        version: '0.1.0',
        outDir: dir,
        family: [{ sourceName: '@khorsheed/dsh-e2e-core', targetVersion: '0.3.0' }],
      })
      const manifest = JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' })) as Record<string, unknown>
      expect(manifest['devDependencies']).toBeUndefined()
      expect(manifest['dependencies']).toEqual({ '@khorsheed/dsh-e2e-core': '^0.3.0' })
      expect(JSON.stringify(manifest)).not.toContain('workspace:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('a real pack drops maps/tsbuildinfo but keeps hashed chunks, css and declarations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-dist-payload-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(join(dir, 'lib/types'), { recursive: true })
      writeFileSync(join(dir, 'src/index.ts'), 'export {}\n')
      // Real payload: an entry, a hashed tsdown chunk, css, declarations, and
      // the typert face artifacts the generator contract requires.
      writeFileSync(join(dir, 'lib/index.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/client.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/chunk-ABC123.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/index.css'), '.a{}\n')
      writeFileSync(join(dir, 'lib/types/index.d.ts'), 'export {}\n')
      writeFileSync(join(dir, 'lib/typert.host.js'), 'export {}\n')
      writeFileSync(join(dir, 'lib/typert.remote-client.js'), 'export {}\n')
      // Build state that must not ship.
      writeFileSync(join(dir, 'lib/client.js.map'), '{}')
      writeFileSync(join(dir, 'lib/types/index.d.ts.map'), '{}')
      writeFileSync(join(dir, 'lib/tsconfig.tsbuildinfo'), '{}')
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@khorsheed/dsh-e2e-payload',
        version: '0.1.0',
        files: [
          'lib',
          'lib/typert.host.d.ts',
          'lib/typert.host.js',
          'lib/typert.remote-client.d.ts',
          'lib/typert.remote-client.js',
        ],
      }))
      const tarball = packDist({ packageDir: dir, scope: '@khorsheed', version: '0.1.0', outDir: dir })
      const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      for (const shipped of [
        'package/lib/index.js',
        'package/lib/client.js',
        'package/lib/chunk-ABC123.js',
        'package/lib/index.css',
        'package/lib/types/index.d.ts',
        'package/lib/typert.host.js',
        'package/lib/typert.remote-client.js',
      ]) {
        expect(listing).toContain(shipped)
      }
      expect(listing).not.toMatch(/\.map$/m)
      expect(listing).not.toContain('.tsbuildinfo')
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
