import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkInjectName,
  findCrossImports,
  findInjects,
  isAllowedEdge,
  parsePatchInjects,
  parsePatchNames,
  scanPackage,
  scanTree,
  stripCodeComments,
} from './check-plugin-independence.ts'

describe('parsePatchNames', () => {
  it('reads quoted names and flags unquoted ones (@ is YAML-reserved)', () => {
    const patch = `- insert:\n    - id: a\n      name: '@khorsheed/dsh-a'\n    - id: b\n      name: "@khorsheed/dsh-b"\n    - id: c\n      name: '@khorsheed/dsh-c'\n`
    expect(parsePatchNames(patch)).toEqual([
      { name: '@khorsheed/dsh-a', quoted: true },
      { name: '@khorsheed/dsh-b', quoted: true },
      { name: '@khorsheed/dsh-c', quoted: true },
    ])
    const bad = `- insert:\n    - id: a\n      name: ${'@khorsheed/dsh-a'}\n`
    expect(parsePatchNames(bad)).toEqual([{ name: '@khorsheed/dsh-a', quoted: false }])
  })
})

describe('parsePatchInjects', () => {
  it('reads bare service names from inline inject rows', () => {
    const patch = `    - id: runner\n      name: '@khorsheed/dsh-x'\n      inject: [localAgentDshHeadlessStartup]\n`
    expect(parsePatchInjects(patch)).toEqual(['localAgentDshHeadlessStartup'])
    expect(parsePatchInjects('- id: a\n  name: \'@khorsheed/dsh-a\'\n')).toEqual([])
  })
})

describe('findInjects', () => {
  it('parses export const inject arrays', () => {
    expect(findInjects(`export const inject = ['localAgent', 'subagents', "subprocess"]`))
      .toEqual(['localAgent', 'subagents', 'subprocess'])
    expect(findInjects('const x = 1')).toEqual([])
  })
})

describe('findCrossImports', () => {
  it('collects khorsheed specifiers from import/require forms', () => {
    const src = [
      `import type { X } from '@khorsheed/dsh-local-agent'`,
      `const a = require('@khorsheed/dsh-file-preview')`,
      `const b = require.resolve('@khorsheed/dsh-local-agent-dsh-headless')`,
      `await import('@khorsheed/dsh-local-agent-tool-subagent')`,
      `import('@khorsheed/dsh-local-agent')`, // duplicate dedupes
    ].join('\n')
    expect(findCrossImports(src).sort()).toEqual([
      '@khorsheed/dsh-file-preview',
      '@khorsheed/dsh-local-agent',
      '@khorsheed/dsh-local-agent-dsh-headless',
      '@khorsheed/dsh-local-agent-tool-subagent',
    ])
  })

  it('ignores prose mentions that are not imports', () => {
    expect(findCrossImports('// ships in the bundle @khorsheed/dsh-local-agent patch')).toEqual([])
  })
})

describe('checkInjectName', () => {
  it('rejects injecting a community package outright', () => {
    expect(checkInjectName('kimi', '@khorsheed/dsh-local-agent')).toMatch('probe with ctx.get')
  })

  it('limits community services to their owning family', () => {
    expect(checkInjectName('local-agent-kimi', 'localAgent')).toBeNull()
    expect(checkInjectName('whalesong', 'localAgent')).toMatch('owning family')
    expect(checkInjectName('local-agent-dsh-headless', 'localAgentDshHeadlessStartup')).toBeNull()
    expect(checkInjectName('local-agent-dsh', 'localAgentDshHeadlessStartup')).toMatch('owning family')
  })

  it('passes official host services', () => {
    expect(checkInjectName('taskpilot', 'commands')).toBeNull()
    expect(checkInjectName('whalesong', 'webServer')).toBeNull()
  })
})

describe('isAllowedEdge', () => {
  it('allows the sanctioned pairs and nothing else', () => {
    expect(isAllowedEdge('local-agent-kimi', '@khorsheed/dsh-local-agent')).toBe(true)
    expect(isAllowedEdge('ui-file-preview', '@khorsheed/dsh-file-preview')).toBe(true)
    expect(isAllowedEdge('whalesong', '@khorsheed/dsh-file-preview')).toBe(false)
    expect(isAllowedEdge('file-preview', '@khorsheed/dsh-client-ui-file-preview')).toBe(false)
  })
})

describe('scanPackage', () => {
  function fixture(pkg: Record<string, unknown>, files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-'))
    const dir = join(root, 'demo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return {
      pkg: { dir: 'demo', path: dir, json: pkg as never },
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }

  it('passes a well-formed standalone plugin', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        files: ['lib', 'cordis.patch.yml'],
        keywords: ['dsh', 'dsh-plugin'],
        repository: { url: 'git+https://github.com/Khorsheed/dsh-plugins.git', directory: 'packages/demo' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n`,
        'src/invariant.ts': `const PACKAGE_NAME = '@khorsheed/dsh-demo'\n`,
      },
    )
    try {
      expect(scanPackage(pkg, ['@khorsheed/dsh-demo'])).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('flags an unquoted patch name, a missing files entry, and stale metadata', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        files: ['lib'],
        repository: { url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'packages/x/demo' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: demo\n      name: ${'@khorsheed/dsh-demo'}\n`,
        'src/invariant.ts': `const PACKAGE_NAME = 'dsh-demo'\n`,
      },
    )
    try {
      const kinds = scanPackage(pkg, ['@khorsheed/dsh-demo']).map((f) => f.kind)
      expect(kinds).toContain('self-mounting') // patch not in files
      expect(kinds).toContain('identity') // unquoted name + PACKAGE_NAME mismatch
      expect(kinds).toContain('publish metadata')
    } finally {
      cleanup()
    }
  })

  it('flags cross-plugin imports outside the sanctioned pairs', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n`,
        'src/index.ts': `import { x } from '@khorsheed/dsh-local-agent'\n`,
      },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-demo', '@khorsheed/dsh-local-agent'])
      expect(findings.map((f) => f.kind)).toContain('cross-plugin import')
    } finally {
      cleanup()
    }
  })

  it('flags a payload directory that files does not cover', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        files: ['lib', 'cordis.patch.yml'],
        keywords: ['dsh', 'dsh-plugin'],
        repository: { url: 'git+https://github.com/Khorsheed/dsh-plugins.git', directory: 'packages/demo' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n`,
        'src/invariant.ts': `const PACKAGE_NAME = '@khorsheed/dsh-demo'\n`,
        'skills/demo/SKILL.md': '# demo\n',
      },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-demo'])
      expect(findings.map((f) => f.detail).join()).toContain('skills/ exists but is not covered by files')
    } finally {
      cleanup()
    }
  })

  it('flags a foreign-scope self reference in docs', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n`,
        'README.md': `# ${'@deepseek-ai/dsh-demo'}\n`,
      },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-demo'])
      expect(findings.map((f) => f.kind)).toContain('foreign scope')
    } finally {
      cleanup()
    }
  })
})

describe('repo tree', () => {
  it('every package in packages/ conforms', () => {
    const { count, findings } = scanTree(join(import.meta.dirname!, '..', 'packages'))
    expect(count).toBeGreaterThan(0)
    expect(findings).toEqual([])
  })
})

describe('family data references', () => {
  function fixture(pkg: Record<string, unknown>, files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-ref-'))
    const dir = join(root, 'demo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return {
      pkg: { dir: 'demo', path: dir, json: pkg as never },
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }

  const PATCH = `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n`
  const CLIENT = `export const TOOL_ROW_MODULE = '@khorsheed/dsh-demo-tool'\n`
  const NAMES = ['@khorsheed/dsh-demo', '@khorsheed/dsh-demo-tool']

  it('flags a sibling the code names as data with neither an edge nor dsh.references', () => {
    // The regression this rule exists for: delete a core's `dsh.references`
    // while its client bundle still carries the companion row name — the pack
    // gate would catch it, `pnpm check:plugins` must too.
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      { 'cordis.patch.yml': PATCH, 'src/client/Badge.tsx': CLIENT },
    )
    try {
      const findings = scanPackage(pkg, NAMES)
      expect(findings.map((f) => f.kind)).toContain('data reference')
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-demo-tool'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('passes when the same data mention is declared in dsh.references', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' }, references: ['@khorsheed/dsh-demo-tool'] },
      },
      { 'cordis.patch.yml': PATCH, 'src/client/Badge.tsx': CLIENT },
    )
    try {
      expect(scanPackage(pkg, NAMES).filter((f) => f.kind === 'data reference')).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('passes when the code mentions the sibling as prose only (comments are not references)', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      { 'cordis.patch.yml': PATCH, 'src/index.ts': `// moved to @khorsheed/dsh-demo-tool\n/* see @khorsheed/dsh-demo-tool */\nexport const x = 1\n` },
    )
    try {
      expect(scanPackage(pkg, NAMES).filter((f) => f.kind === 'data reference')).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('flags a reference that is not a repo package or that duplicates an edge', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dependencies: { '@khorsheed/dsh-demo-tool': 'workspace:*' },
        dsh: { bundle: { patch: './cordis.patch.yml' }, references: ['@khorsheed/dsh-ghost', '@khorsheed/dsh-demo-tool'] },
      },
      { 'cordis.patch.yml': PATCH },
    )
    try {
      const refs = scanPackage(pkg, NAMES).filter((f) => f.kind === 'data reference')
      expect(refs.some((f) => f.detail.includes('not a package in this repo'))).toBe(true)
      expect(refs.some((f) => f.detail.includes('also a dependency edge'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('stripCodeComments leaves string literals alone', () => {
    expect(stripCodeComments(`const u = 'https://x/@khorsheed/dsh-demo-tool'\n// @khorsheed/dsh-gone\n`))
      .toContain("@khorsheed/dsh-demo-tool")
    expect(stripCodeComments(`const u = 'https://x'\n// @khorsheed/dsh-gone\n`))
      .not.toContain('@khorsheed/dsh-gone')
  })
})

describe('patch row ownership', () => {
  function packagesRoot(specs: Array<{ dir: string; json: Record<string, unknown>; files: Record<string, string> }>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-tree-'))
    for (const s of specs) {
      const dir = join(root, s.dir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(s.json))
      for (const [rel, text] of Object.entries(s.files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true })
        writeFileSync(join(dir, rel), text)
      }
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }

  const core = {
    dir: 'core',
    json: { name: '@khorsheed/dsh-core', private: true, files: ['lib', 'cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } },
    files: { 'cordis.patch.yml': `- insert:\n    - id: core\n      name: '@khorsheed/dsh-core'\n` },
  }

  it('flags a patch that inserts another self-mounting package row', () => {
    // The local-agent incident, generically frozen: a provider patch must never
    // re-insert the core row (both installed → the core row mounts twice).
    const { root, cleanup } = packagesRoot([core, {
      dir: 'provider',
      json: { name: '@khorsheed/dsh-provider', private: true, files: ['lib', 'cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } },
      files: { 'cordis.patch.yml': `- insert:\n    - id: provider\n      name: '@khorsheed/dsh-provider'\n    - id: core\n      name: '@khorsheed/dsh-core'\n` },
    }])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'patch row ownership')
      expect(findings).toHaveLength(1)
      expect(findings[0]!.path).toContain('provider')
      expect(findings[0]!.detail).toContain('@khorsheed/dsh-core')
    } finally {
      cleanup()
    }
  })

  it('allows a patch to insert a companion row that does not self-mount', () => {
    const { root, cleanup } = packagesRoot([core, {
      dir: 'companion',
      json: { name: '@khorsheed/dsh-companion', private: true, files: ['lib', 'cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } },
      files: { 'cordis.patch.yml': `- insert:\n    - id: companion\n      name: '@khorsheed/dsh-companion'\n    - id: companion-tool\n      name: '@khorsheed/dsh-companion-tool'\n` },
    }])
    try {
      expect(scanTree(root).findings.filter((f) => f.kind === 'patch row ownership')).toEqual([])
    } finally {
      cleanup()
    }
  })
})
