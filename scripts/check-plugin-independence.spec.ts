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
  parseTopLevelPatchRows,
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

describe('parseTopLevelPatchRows', () => {
  it('reads insert rows and bare overrides, skipping nested composition content', () => {
    // The preset-bundle shape: three top-level rows, each with a scoped
    // composition under config.plugins whose ids/names must NOT surface —
    // they compose in the preset's scope, never at the profile root.
    const patch = [
      '- id: tool-subagent-claude-code',
      '  disabled: true',
      '',
      '- insert:',
      '    - id: preset-dev',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: dev',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '          - id: planning',
      "            name: 'cordis:group'",
      '            group: true',
      '            config:',
      '              - id: plan-mode',
      "                name: '@deepseek-ai/dsh-plan-mode'",
      '',
      '    # a comment between rows',
      '    - id: preset-dsh-eval',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: dsh-eval',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '',
      '    - id: tool-x',
      "      name: '@khorsheed/dsh-x'",
      '      config:',
      '        provider: kimi-cli',
      '        args:',
      '          - !!js process.execPath',
    ].join('\n')
    expect(parseTopLevelPatchRows(patch)).toEqual([
      { id: 'tool-subagent-claude-code', name: undefined },
      { id: 'preset-dev', name: '@deepseek-ai/dsh-agent-preset' },
      { id: 'preset-dsh-eval', name: '@deepseek-ai/dsh-agent-preset' },
      { id: 'tool-x', name: '@khorsheed/dsh-x' },
    ])
  })

  it('reads rows whose name sits on the item line and ignores entries with neither id nor name', () => {
    const patch = `- insert:\n    - name: '@khorsheed/dsh-a'\n      id: a\n- remove: ghost\n`
    expect(parseTopLevelPatchRows(patch)).toEqual([{ id: 'a', name: '@khorsheed/dsh-a' }])
  })
})

describe('preset-declarations bundles', () => {
  function fixture(pkg: Record<string, unknown>, files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-preset-'))
    const dir = join(root, 'presets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return {
      pkg: { dir: 'presets', path: dir, json: pkg as never },
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }

  const PATCH = [
    '- insert:',
    '    - id: preset-dev',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: dev',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
  ].join('\n')

  it('passes a well-formed preset-declarations bundle (no own runtime row)', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-presets',
        files: ['lib', 'cordis.patch.yml'],
        keywords: ['dsh', 'dsh-plugin'],
        repository: { url: 'git+https://github.com/Khorsheed/dsh-plugins.git', directory: 'packages/presets' },
        dsh: { bundle: { patch: './cordis.patch.yml', kind: 'preset-declarations' } },
      },
      { 'cordis.patch.yml': PATCH },
    )
    try {
      expect(scanPackage(pkg, ['@khorsheed/dsh-presets'])).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('flags a preset-declarations row named anything but the official preset plugin, or with a non-preset id', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-presets',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml', kind: 'preset-declarations' } },
      },
      {
        'cordis.patch.yml': `- insert:\n    - id: preset-dev\n      name: '@deepseek-ai/dsh-agent-preset'\n    - id: presets\n      name: '@khorsheed/dsh-presets'\n    - id: eval\n      name: '@deepseek-ai/dsh-agent-preset'\n`,
      },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-presets']).filter((f) => f.kind === 'identity')
      expect(findings.some((f) => f.detail.includes('presets is named @khorsheed/dsh-presets'))).toBe(true)
      expect(findings.some((f) => f.detail.includes('row id eval does not match preset-<id>'))).toBe(true)
      expect(findings).toHaveLength(2)
    } finally {
      cleanup()
    }
  })

  it('flags a self-mounting package without the kind whose rows are all preset declarations', () => {
    // The regression the kind exists for: without the declaration the identity
    // rule reports the missing own row instead of silently accepting a bundle
    // that mounts no runtime row of its own.
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-presets',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      { 'cordis.patch.yml': PATCH },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-presets'])
      expect(findings.some((f) => f.kind === 'identity' && f.detail.includes('no row named @khorsheed/dsh-presets'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags an unknown bundle kind', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-presets',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml', kind: 'whatever' } },
      },
      { 'cordis.patch.yml': PATCH },
    )
    try {
      const findings = scanPackage(pkg, ['@khorsheed/dsh-presets'])
      expect(findings.some((f) => f.kind === 'bundle kind' && f.detail.includes('is not one of'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('lets nested preset rows reuse profile-root ids of other packages (scoped composition, no collision)', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-tree-'))
    const write = (dir: string, json: Record<string, unknown>, patch: string) => {
      const path = join(root, dir)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify(json))
      writeFileSync(join(path, 'cordis.patch.yml'), patch)
    }
    write('kimi', {
      name: '@khorsheed/dsh-local-agent-kimi',
      private: true,
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, `- insert:\n    - id: tool-subagent-kimi\n      name: '@khorsheed/dsh-local-agent-tool-subagent'\n`)
    write('presets', {
      name: '@khorsheed/dsh-presets',
      private: true,
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml', kind: 'preset-declarations' } },
    }, [
      '- insert:',
      '    - id: preset-dev',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: dev',
      '        plugins:',
      '          - id: tool-subagent-kimi',
      "            name: '@khorsheed/dsh-local-agent-tool-subagent'",
      '    - id: preset-dsh-eval',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: dsh-eval',
      '        plugins:',
      '          - id: tool-subagent-kimi',
      "            name: '@khorsheed/dsh-local-agent-tool-subagent'",
    ].join('\n'))
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'loader row id')
      expect(findings).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('family bundles', () => {
  function fixture(pkg: Record<string, unknown>, files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-family-'))
    const dir = join(root, 'bundle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return {
      pkg: { dir: 'bundle', path: dir, json: pkg as never },
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }

  function packagesRoot(specs: Array<{ dir: string; json: Record<string, unknown>; files: Record<string, string> }>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-family-tree-'))
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
    json: {
      name: '@khorsheed/dsh-core',
      private: true,
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    files: {
      'cordis.patch.yml': [
        '- id: tool-core-official',
        '  disabled: true',
        '',
        '- insert:',
        '    - id: core',
        "      name: '@khorsheed/dsh-core'",
        '      config:',
        '        homesRoot: /tmp',
      ].join('\n'),
    },
  }
  const provider = {
    dir: 'provider',
    json: {
      name: '@khorsheed/dsh-provider',
      private: true,
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    files: {
      // The provider's canonical rows include one naming the family's DEPS-ONLY
      // tool package (the local-agent shape: tool-subagent-kimi names
      // dsh-local-agent-tool-subagent) — the bundle's allowlist is the union of
      // member canonical rows, so this row must pass verbatim.
      'cordis.patch.yml': `- insert:\n    - id: provider\n      name: '@khorsheed/dsh-provider'\n\n    - id: tool-subagent-demo\n      name: '@khorsheed/dsh-provider-tool'\n      config:\n        provider: demo\n`,
    },
  }
  const BUNDLE_PATCH = [
    '- id: tool-core-official',
    '  disabled: true',
    '',
    '- insert:',
    '    - id: core',
    "      name: '@khorsheed/dsh-core'",
    '      config:',
    '        homesRoot: /tmp',
    '',
    '    - id: provider',
    "      name: '@khorsheed/dsh-provider'",
    '',
    '    - id: tool-subagent-demo',
    "      name: '@khorsheed/dsh-provider-tool'",
    '      config:',
    '        provider: demo',
  ].join('\n')
  const bundleJson = {
    name: '@khorsheed/dsh-bundle-demo',
    private: true,
    files: ['lib', 'cordis.patch.yml'],
    dependencies: { '@khorsheed/dsh-core': 'workspace:*', '@khorsheed/dsh-provider': 'workspace:*' },
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
        kind: 'family',
        members: ['@khorsheed/dsh-core', '@khorsheed/dsh-provider'],
      },
      references: ['@khorsheed/dsh-core', '@khorsheed/dsh-provider'],
    },
  }
  const bundle = {
    dir: 'bundle',
    json: bundleJson,
    files: { 'cordis.patch.yml': BUNDLE_PATCH, 'src/index.ts': 'export const MEMBERS = 2\n' },
  }
  const MEMBER_NAMES = ['@khorsheed/dsh-core', '@khorsheed/dsh-provider', '@khorsheed/dsh-bundle-demo']

  it('passes a well-formed family bundle: member edges, roster, verbatim rows, no own surface', () => {
    const { root, cleanup } = packagesRoot([core, provider, bundle])
    try {
      expect(scanTree(root).findings).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('flags a member missing from dependencies or dsh.references, a ghost member, and self-membership', () => {
    const { pkg, cleanup } = fixture(
      {
        ...bundleJson,
        dependencies: { '@khorsheed/dsh-core': 'workspace:*' },
        dsh: {
          bundle: {
            patch: './cordis.patch.yml',
            kind: 'family',
            members: ['@khorsheed/dsh-core', '@khorsheed/dsh-provider', '@khorsheed/dsh-ghost', '@khorsheed/dsh-bundle-demo'],
          },
          references: ['@khorsheed/dsh-core'],
        },
      },
      { 'cordis.patch.yml': BUNDLE_PATCH },
    )
    try {
      const findings = scanPackage(pkg, MEMBER_NAMES).filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-provider is not in dependencies'))).toBe(true)
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-provider is not registered in dsh.references'))).toBe(true)
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-ghost, which is not a package in this repo'))).toBe(true)
      expect(findings.some((f) => f.detail.includes('names the bundle itself'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('requires a non-empty members list and no browser half', () => {
    const { pkg, cleanup } = fixture(
      {
        ...bundleJson,
        dsh: { bundle: { patch: './cordis.patch.yml', kind: 'family' }, client: { platform: 'web' } },
      },
      { 'cordis.patch.yml': BUNDLE_PATCH },
    )
    try {
      const findings = scanPackage(pkg, MEMBER_NAMES).filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('non-empty dsh.bundle.members'))).toBe(true)
      expect(findings.some((f) => f.detail.includes('no dsh.client browser half'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags runtime registrations in the bundle sources (pure composition)', () => {
    const { pkg, cleanup } = fixture(bundleJson, {
      'cordis.patch.yml': BUNDLE_PATCH,
      'src/index.ts': `import type { Context } from '@deepseek-ai/cordis'\nexport function apply(ctx: Context): void {\n  ctx.tools.register({ name: 'x' } as never)\n}\n`,
    })
    try {
      const findings = scanPackage(pkg, MEMBER_NAMES).filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('export function apply'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags a member that does not self-mount, an invented row, and a member contributing no row', () => {
    const lib = {
      dir: 'lib-only',
      json: {
        name: '@khorsheed/dsh-lib-only',
        private: true,
        dsh: { composition: { component: 'source-plane-library' } },
      },
      files: {},
    }
    const invented = {
      ...bundle,
      json: {
        ...bundleJson,
        dependencies: { ...bundleJson.dependencies, '@khorsheed/dsh-lib-only': 'workspace:*' },
        dsh: {
          bundle: {
            patch: './cordis.patch.yml',
            kind: 'family',
            members: ['@khorsheed/dsh-core', '@khorsheed/dsh-provider', '@khorsheed/dsh-lib-only'],
          },
          references: ['@khorsheed/dsh-core', '@khorsheed/dsh-provider', '@khorsheed/dsh-lib-only'],
        },
      },
      files: {
        'cordis.patch.yml': `${BUNDLE_PATCH}\n    - id: core-2\n      name: '@khorsheed/dsh-core'\n`,
        'src/index.ts': 'export const MEMBERS = 3\n',
      },
    }
    const { root, cleanup } = packagesRoot([core, provider, lib, invented])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-lib-only does not self-mount'))).toBe(true)
      expect(findings.some((f) => f.detail.includes("row core-2 (@khorsheed/dsh-core) is not a top-level row of that member's own patch"))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags a bare override row no member patch carries', () => {
    const overridden = {
      ...bundle,
      files: {
        'cordis.patch.yml': `- id: ghost-row\n  disabled: true\n\n${BUNDLE_PATCH}\n`,
        'src/index.ts': 'export const MEMBERS = 2\n',
      },
    }
    const { root, cleanup } = packagesRoot([core, provider, overridden])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('override row ghost-row matches no top-level row of any member'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags a declared member whose rows the patch omits', () => {
    const partial = {
      ...bundle,
      files: {
        'cordis.patch.yml': `- insert:\n    - id: core\n      name: '@khorsheed/dsh-core'\n      config:\n        homesRoot: /tmp\n`,
        'src/index.ts': 'export const MEMBERS = 2\n',
      },
    }
    const { root, cleanup } = packagesRoot([core, provider, partial])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'family bundle')
      expect(findings.some((f) => f.detail.includes('@khorsheed/dsh-provider contributes no row'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('does not count member rows twice in the row-id ledger or the ownership scan', () => {
    // The sanction's reason to exist: the bundle re-mounts the members'
    // canonical rows, and installing the bundle alone applies only ITS patch
    // (reconcilePlugins folds direct dependencies), so no row mounts twice.
    const { root, cleanup } = packagesRoot([core, provider, bundle])
    try {
      const findings = scanTree(root).findings
      expect(findings.filter((f) => f.kind === 'loader row id')).toEqual([])
      expect(findings.filter((f) => f.kind === 'patch row ownership')).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('still flags a family bundle row naming a NON-member self-mounting package', () => {
    const stranger = {
      dir: 'stranger',
      json: {
        name: '@khorsheed/dsh-stranger',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      files: { 'cordis.patch.yml': `- insert:\n    - id: stranger\n      name: '@khorsheed/dsh-stranger'\n` },
    }
    const poaching = {
      ...bundle,
      files: {
        'cordis.patch.yml': `${BUNDLE_PATCH}\n    - id: stranger\n      name: '@khorsheed/dsh-stranger'\n`,
        'src/index.ts': 'export const MEMBERS = 2\n',
      },
    }
    const { root, cleanup } = packagesRoot([core, provider, stranger, poaching])
    try {
      const findings = scanTree(root).findings
      expect(findings.some((f) => f.kind === 'patch row ownership' && f.detail.includes('@khorsheed/dsh-stranger'))).toBe(true)
      expect(findings.some((f) => f.kind === 'family bundle' && f.detail.includes('stranger is named @khorsheed/dsh-stranger'))).toBe(true)
    } finally {
      cleanup()
    }
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
    expect(isAllowedEdge('file-preview', '@khorsheed/dsh-client-ui-content-preview')).toBe(true)
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

  it('requires composition metadata when a package does not self-mount', () => {
    const { pkg, cleanup } = fixture(
      { name: '@khorsheed/dsh-demo', private: true, files: ['lib'] },
      { 'src/index.ts': 'export const x = 1\n' },
    )
    try {
      expect(scanPackage(pkg, ['@khorsheed/dsh-demo']).map((f) => f.kind)).toContain('self-mounting')
    } finally {
      cleanup()
    }
  })

  it('rejects a package that declares a composition component and self-mounts', () => {
    const { pkg, cleanup } = fixture(
      {
        name: '@khorsheed/dsh-demo',
        private: true,
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' }, composition: { component: 'preset-composed-row' } },
      },
      { 'cordis.patch.yml': `- insert:\n    - id: demo\n      name: '@khorsheed/dsh-demo'\n` },
    )
    try {
      expect(scanPackage(pkg, ['@khorsheed/dsh-demo']).map((f) => f.kind)).toContain('composition component')
    } finally {
      cleanup()
    }
  })
})

describe('composition metadata and the NO_OWN_PATCH cross-check', () => {
  function packagesRoot(specs: Array<{ dir: string; json: Record<string, unknown> }>) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-independence-comp-'))
    for (const s of specs) {
      const dir = join(root, s.dir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(s.json))
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }

  it('flags metadata that NO_OWN_PATCH does not mirror', () => {
    const { root, cleanup } = packagesRoot([
      { dir: 'demo', json: { name: '@khorsheed/dsh-demo', private: true, dsh: { composition: { component: 'preset-composed-row' } } } },
    ])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'composition component')
      expect(findings.some((f) => f.detail.includes('not listed in NO_OWN_PATCH'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('flags a NO_OWN_PATCH entry that declares no metadata', () => {
    const { root, cleanup } = packagesRoot([
      { dir: 'room-tool', json: { name: '@khorsheed/dsh-room-tool', private: true } },
    ])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'composition component')
      expect(findings.some((f) => f.detail.includes('declares no dsh.composition.component'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('rejects a component value outside the declared vocabulary', () => {
    const { root, cleanup } = packagesRoot([
      { dir: 'room-tool', json: { name: '@khorsheed/dsh-room-tool', private: true, dsh: { composition: { component: 'whatever' } } } },
    ])
    try {
      const findings = scanTree(root).findings.filter((f) => f.kind === 'composition component')
      expect(findings.some((f) => f.detail.includes('is not one of'))).toBe(true)
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
