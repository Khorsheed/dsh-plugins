import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNoStaleTypes, filesDeclaredExtras, rescopePackageJson, rewriteNames } from './pack-dist.ts'

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

describe('pack-dist CLI wiring', () => {
  it('is importable without running main (no tarball side effect)', () => {
    expect(typeof rescopePackageJson).toBe('function')
    expect(readFileSync(join(__dirname, 'pack-dist.ts'), 'utf8')).toContain('process.argv')
  })
})
