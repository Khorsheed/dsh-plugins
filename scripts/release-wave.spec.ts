import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bumpVersion,
  checkWave,
  collectWaveMembers,
  compareVersions,
  familyFindings,
  planWave,
  readManifest,
  resolveName,
  srcEdges,
  tagFor,
  topoOrder,
  writeManifest,
  type WaveEntry,
  type WaveMember,
} from './release-wave.mts'

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'release-wave-'))
}

function makePkg(root: string, dir: string, pkg: Record<string, unknown>): void {
  const dirPath = join(root, 'packages', dir)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'package.json'), JSON.stringify({
    name: `@khorsheed/dsh-${dir}`,
    version: '0.1.0',
    ...pkg,
  }))
}

function member(dir: string, version = '0.1.0', name = `@khorsheed/dsh-${dir}`): WaveMember {
  return { name, dir, version }
}

function entry(partial: Partial<WaveEntry> & { name: string }): WaveEntry {
  return { dir: partial.name.replace(/^@khorsheed\/dsh-/, ''), current: '0.1.0', target: '0.2.0', bump: 'none', debut: false, ...partial }
}

describe('collectWaveMembers (membership filter)', () => {
  it('keeps self-mounting and release-group packages; drops private, patch-less, retired', () => {
    const root = fixture()
    try {
      makePkg(root, 'alpha', { dsh: { bundle: { patch: 'cordis.patch.yml' } } })
      makePkg(root, 'beta', { private: true, dsh: { bundle: { patch: 'cordis.patch.yml' } } })
      makePkg(root, 'gamma', {}) // no dsh.bundle.patch — not self-mounting
      makePkg(root, 'worktrees-tool', { name: '@khorsheed/dsh-worktrees-tool', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
      // The family headless bundle carries no patch of its own (sub-profile
      // patch) yet publishes on the family line.
      makePkg(root, 'local-agent-dsh-headless', {})
      const members = collectWaveMembers(join(root, 'packages'))
      expect(members.map(m => m.dir).sort()).toEqual(['alpha', 'local-agent-dsh-headless'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('topo order over src-level edges', () => {
  it('orders a multi-line import target before its importer', () => {
    const root = fixture()
    try {
      makePkg(root, 'local-agent-dsh-headless', {})
      makePkg(root, 'local-agent-dsh', {})
      const srcDir = join(root, 'packages', 'local-agent-dsh', 'src')
      mkdirSync(srcDir, { recursive: true })
      // The 2026-10-18 deploy-incident shape: a multi-line import block with a
      // subpath specifier — a single-line grep misses it.
      writeFileSync(join(srcDir, 'live-driver.ts'), `import {
  WIRE_VERSION,
  type WireMessage,
} from '@khorsheed/dsh-local-agent-dsh-headless/wire'

export const x = WIRE_VERSION
`)
      const members = [member('local-agent-dsh'), member('local-agent-dsh-headless')]
      const edges = srcEdges(join(root, 'packages'), members)
      expect(edges.get('@khorsheed/dsh-local-agent-dsh')).toEqual(new Set(['@khorsheed/dsh-local-agent-dsh-headless']))
      const ordered = topoOrder(members, edges).map(m => m.dir)
      expect(ordered.indexOf('local-agent-dsh-headless')).toBeLessThan(ordered.indexOf('local-agent-dsh'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores comment mentions and edges leaving the wave', () => {
    const root = fixture()
    try {
      makePkg(root, 'aaa', {})
      makePkg(root, 'bbb', {})
      const srcDir = join(root, 'packages', 'aaa', 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'index.ts'), `// delegates to @khorsheed/dsh-bbb for everything
/* and @khorsheed/dsh-zzz in a block comment */
import { real } from '@khorsheed/dsh-zzz'
export { real }
`)
      const members = [member('aaa'), member('bbb')]
      const edges = srcEdges(join(root, 'packages'), members)
      // zzz is not a wave member, bbb is mentioned only in comments: no edges.
      expect(edges.get('@khorsheed/dsh-aaa')).toEqual(new Set())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws on a cycle, naming the members', () => {
    const members = [member('aaa'), member('bbb')]
    const edges = new Map([
      ['@khorsheed/dsh-aaa', new Set(['@khorsheed/dsh-bbb'])],
      ['@khorsheed/dsh-bbb', new Set(['@khorsheed/dsh-aaa'])],
    ])
    expect(() => topoOrder(members, edges)).toThrow(/cycle.*dsh-aaa/)
  })
})

describe('planWave version decisions', () => {
  const none = new Set<string>()
  const plan = (members: WaveMember[], published: Record<string, string>, changed: string[] = [], debut = none) =>
    planWave(members, {
      debut,
      defer: none,
      publishedVersion: name => published[name] ?? null,
      contentChanged: dir => changed.includes(dir),
    })

  it('publishes as-is when the repo line is ahead of npm', () => {
    const { manifest } = plan([member('alpha', '0.2.0')], { '@khorsheed/dsh-alpha': '0.1.0' })
    expect(manifest.packages).toEqual([
      { name: '@khorsheed/dsh-alpha', dir: 'alpha', current: '0.1.0', target: '0.2.0', bump: 'none', debut: false },
    ])
  })

  it('suggests a patch when the repo line equals npm but the content moved', () => {
    // The message-tools case: 仓内 0.3.3 == npm 0.3.3 with new commits.
    const { manifest } = plan([member('message-tools', '0.3.3')], { '@khorsheed/dsh-message-tools': '0.3.3' }, ['message-tools'])
    expect(manifest.packages[0]).toMatchObject({ bump: 'patch', target: '0.3.4' })
  })

  it('bumps the rc number on an rc line', () => {
    const { manifest } = plan([member('local-agent', '0.2.0-rc.1')], { '@khorsheed/dsh-local-agent': '0.2.0-rc.1' }, ['local-agent'])
    expect(manifest.packages[0]).toMatchObject({ bump: 'patch', target: '0.2.0-rc.2' })
  })

  it('defers an unchanged already-published package', () => {
    const { manifest, deferred } = plan([member('alpha', '0.1.0')], { '@khorsheed/dsh-alpha': '0.1.0' })
    expect(manifest.packages).toEqual([])
    expect(deferred[0]).toMatchObject({ name: '@khorsheed/dsh-alpha' })
    expect(deferred[0]!.reason).toContain('no content change')
  })

  it('defers the unpublished unless debuted; debut marks bump debut and current null', () => {
    const held = plan([member('context-lens', '0.1.0')], {})
    expect(held.manifest.packages).toEqual([])
    expect(held.deferred[0]!.reason).toContain('--debut')

    const shipped = plan([member('context-lens', '0.1.0')], {}, [], new Set(['@khorsheed/dsh-context-lens']))
    expect(shipped.manifest.packages).toEqual([
      { name: '@khorsheed/dsh-context-lens', dir: 'context-lens', current: null, target: '0.1.0', bump: 'debut', debut: true },
    ])
  })

  it('honors --defer and rejects debut∩defer / debut of a published name', () => {
    const deferred = planWave([member('canvas', '0.6.0')], {
      debut: none,
      defer: new Set(['@khorsheed/dsh-canvas']),
      publishedVersion: () => null,
      contentChanged: () => false,
    })
    expect(deferred.manifest.packages).toEqual([])
    expect(deferred.deferred[0]!.reason).toBe('--defer')

    expect(() => planWave([member('canvas')], {
      debut: new Set(['@khorsheed/dsh-canvas']),
      defer: new Set(['@khorsheed/dsh-canvas']),
      publishedVersion: () => null,
      contentChanged: () => false,
    })).toThrow(/both --debut and --defer/)

    expect(() => plan([member('alpha')], { '@khorsheed/dsh-alpha': '0.1.0' }, [], new Set(['@khorsheed/dsh-alpha'])))
      .toThrow(/already published/)
  })

  it('warns when the repo line fell behind npm', () => {
    const { manifest, warnings } = plan([member('alpha', '0.1.0')], { '@khorsheed/dsh-alpha': '0.2.0' })
    expect(manifest.packages[0]).toMatchObject({ bump: 'patch', target: '0.2.1' })
    expect(warnings[0]).toContain('BEHIND npm')
  })
})

describe('manifest read/write', () => {
  it('round-trips and keeps deferred packages out', () => {
    const root = fixture()
    try {
      const { manifest, deferred } = planWave([member('alpha', '0.2.0'), member('canvas', '0.6.0')], {
        debut: new Set<string>(),
        defer: new Set(['@khorsheed/dsh-canvas']),
        publishedVersion: name => (name === '@khorsheed/dsh-alpha' ? '0.1.0' : null),
        contentChanged: () => false,
      })
      expect(deferred.map(d => d.name)).toEqual(['@khorsheed/dsh-canvas'])
      writeManifest(root, manifest)
      const loaded = readManifest(root)
      expect(loaded).toEqual(manifest)
      // 2-space indent + trailing newline, same as the package.json convention.
      const text = readFileSync(join(root, '.release-wave.json'), 'utf8')
      expect(text.endsWith('}\n')).toBe(true)
      expect(text).toContain('\n  "packages"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails loud when no plan ran', () => {
    const root = fixture()
    try {
      expect(() => readManifest(root)).toThrow(/plan/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('tagFor', () => {
  it('tags by directory name — the historical convention', () => {
    // 仓内实证:包 @khorsheed/dsh-client-message-tools 的 tag 是 message-tools-v*,
    // @khorsheed/dsh-reader(dir dsh-reader)的 tag 是 dsh-reader-v*。
    expect(tagFor('message-tools', '0.5.0')).toBe('message-tools-v0.5.0')
    expect(tagFor('dsh-reader', '0.3.0')).toBe('dsh-reader-v0.3.0')
    expect(tagFor('local-agent-dsh-headless', '0.2.0-rc.1')).toBe('local-agent-dsh-headless-v0.2.0-rc.1')
  })
})

describe('semver helpers', () => {
  it('compares prereleases the npm way', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0-rc.10', '0.2.0-rc.6')).toBe(1)
    expect(compareVersions('0.2.0-rc.1', '0.2.0-rc.1')).toBe(0)
  })
  it('bumps patch/minor/rc', () => {
    expect(bumpVersion('0.3.3', 'patch')).toBe('0.3.4')
    expect(bumpVersion('0.3.3', 'minor')).toBe('0.4.0')
    expect(bumpVersion('0.2.0-rc.1', 'patch')).toBe('0.2.0-rc.2')
  })
})

const FAMILY_DIRS = ['local-agent', 'local-agent-dsh-headless', 'local-agent-kimi', 'local-agent-codex', 'local-agent-claude-code', 'local-agent-dsh']

function familyMembers(version = '0.2.0-rc.1'): WaveMember[] {
  return FAMILY_DIRS.map(dir => member(dir, version))
}

describe('familyFindings', () => {
  it('passes a whole-family wave at one target', () => {
    const manifest = { packages: familyMembers().map(m => entry({ name: m.name, dir: m.dir, target: '0.2.0', current: '0.2.0-rc.1' })) }
    expect(familyFindings(manifest, familyMembers())).toEqual([])
  })

  it('errors when in-wave family targets disagree', () => {
    const manifest = {
      packages: familyMembers().map(m => entry({
        name: m.name,
        dir: m.dir,
        target: m.dir === 'local-agent-kimi' ? '0.2.1' : '0.2.0',
      })),
    }
    const findings = familyFindings(manifest, familyMembers())
    expect(findings.some(f => f.severity === 'error' && f.detail.includes('one version line'))).toBe(true)
  })

  it('errors on a partial family wave that moves the line; warns when unmoved', () => {
    const members = familyMembers()
    const partial = members.filter(m => m.dir !== 'local-agent-kimi')
    const moved = { packages: partial.map(m => entry({ name: m.name, dir: m.dir, target: '0.2.0', bump: 'patch' })) }
    expect(familyFindings(moved, members).some(f => f.severity === 'error' && f.detail.includes('partial family wave'))).toBe(true)

    // 纯区间重发:版本不动(仓内即目标),部分成员进 wave → warn 而非 error。
    const unmoved = { packages: partial.map(m => entry({ name: m.name, dir: m.dir, target: '0.2.0-rc.1', bump: 'none' as const })) }
    const findings = familyFindings(unmoved, members)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warn')
  })
})

describe('checkWave', () => {
  const base = entry({ name: '@khorsheed/dsh-alpha', dir: 'alpha', current: '0.1.0', target: '0.2.0' })
  const ctx = (over: Partial<Parameters<typeof checkWave>[1]> = {}) => ({
    root: '/nonexistent',
    members: [member('alpha', '0.2.0')],
    publishedVersion: () => '0.1.0',
    listTags: () => [],
    ...over,
  })

  it('passes a coherent manifest', () => {
    expect(checkWave({ packages: [base] }, ctx())).toEqual([])
  })

  it('errors when package.json has not been bumped to the target', () => {
    const findings = checkWave({ packages: [base] }, ctx({ members: [member('alpha', '0.1.0')] }))
    expect(findings[0]!.detail).toContain('release:wave bump')
  })

  it('errors when the target does not exceed npm', () => {
    const findings = checkWave({ packages: [base] }, ctx({ publishedVersion: () => '0.2.0' }))
    expect(findings[0]!.detail).toContain('not above npm')
  })

  it('errors when the tag already exists', () => {
    const findings = checkWave({ packages: [base] }, ctx({ listTags: () => ['alpha-v0.2.0'] }))
    expect(findings[0]!.detail).toContain('already exists')
  })

  it('skips the npm-greater check for debuts but fails a debut whose name is taken', () => {
    const debut = entry({ name: '@khorsheed/dsh-context-lens', dir: 'context-lens', current: null, target: '0.1.0', bump: 'debut', debut: true })
    expect(checkWave({ packages: [debut] }, ctx({
      members: [member('context-lens', '0.1.0')],
      publishedVersion: () => null,
    }))).toEqual([])
    const taken = checkWave({ packages: [debut] }, ctx({
      members: [member('context-lens', '0.1.0')],
      publishedVersion: () => '0.0.9',
    }))
    expect(taken[0]!.detail).toContain('debut')
  })
})

describe('resolveName', () => {
  const members = [member('message-tools', '0.3.3', '@khorsheed/dsh-client-message-tools')]
  it('accepts full name, dir, or short name', () => {
    expect(resolveName(members, '@khorsheed/dsh-client-message-tools')).toBe('@khorsheed/dsh-client-message-tools')
    expect(resolveName(members, 'message-tools')).toBe('@khorsheed/dsh-client-message-tools')
    expect(resolveName(members, 'client-message-tools')).toBe('@khorsheed/dsh-client-message-tools')
    expect(() => resolveName(members, 'nope')).toThrow(/unknown package/)
  })
})
