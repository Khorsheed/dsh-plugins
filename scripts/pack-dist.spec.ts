import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDeclaredPayloadsExist, assertNoStaleTypes, filesDeclaredExtras, packDist, rescopePackageJson, rewriteNames, verifyTarball } from './pack-dist.ts'

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

  it('renames family peers to the dist scope and ranges them on the dist version', () => {
    const family = new Map([['@deepseek-ai/dsh-file-preview', '@khorsheed/dsh-file-preview']])
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
      '@khorsheed/dsh-file-preview': '^0.1.0',
      '@deepseek-ai/dsh-client-runtime': '^0.1.0-rc.5',
    })
    expect(out.devDependencies).toEqual({ '@khorsheed/dsh-file-preview': '^0.1.0' })
  })

  it('keeps family edges in dependencies (the core/companion contract), drops bundled/host-provided deps', () => {
    const family = new Map([
      ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent'],
      ['@khorsheed/dsh-local-agent-tool-subagent', '@khorsheed/dsh-local-agent-tool-subagent'],
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
