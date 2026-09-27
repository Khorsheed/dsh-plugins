import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  caretAdmits,
  checkProfile,
  loadPackageIndex,
  loadProfiles,
  parseRowNames,
  scanPackagePatches,
  scanProfiles,
  type PackageIndex,
  type ProfileShape,
} from './check-profile-bundles.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** A tiny index: `core` self-mounts, `provider` hard-depends on it. */
const index: PackageIndex = new Map([
  ['@khorsheed/dsh-core', { dir: 'packages/core', dependencies: [], selfMounting: true, version: '0.3.0', exportKeys: ['.'] }],
  [
    '@khorsheed/dsh-provider',
    { dir: 'packages/provider', dependencies: ['@khorsheed/dsh-core', '@khorsheed/dsh-row'], selfMounting: true, version: '0.1.0', exportKeys: ['.'] },
  ],
  ['@khorsheed/dsh-row', { dir: 'packages/row', dependencies: ['@khorsheed/dsh-core'], selfMounting: false, version: '0.2.0', exportKeys: ['.'] }],
  ['@khorsheed/dsh-with-tool', { dir: 'packages/with-tool', dependencies: [], selfMounting: false, version: '0.2.0', exportKeys: ['.', './tool'] }],
  ['@khorsheed/dsh-optional', { dir: 'packages/optional', dependencies: [], selfMounting: true, version: '0.1.0', exportKeys: ['.'] }],
])

const profile = (over: Partial<ProfileShape> = {}): ProfileShape => ({
  path: 'profiles/demo/package.json',
  dependencies: [],
  dependencyRanges: {},
  bundles: [],
  rows: [],
  ...over,
})

/** Finding kinds, so assertions read as the violated rule. */
const kinds = (shape: ProfileShape): string[] => checkProfile(shape, index).map(f => f.kind)

describe('parseRowNames', () => {
  it('reads quoted and unquoted @khorsheed row names, ignoring other keys', () => {
    const yaml = [
      `- id: a`,
      `  name: '@khorsheed/dsh-a'`,
      `  name: "@khorsheed/dsh-b"`,
      `- id: c`,
      `  name: @khorsheed/dsh-c`,
      `  headlessBundleDir: /opt/dsh/node_modules/@khorsheed/dsh-not-a-row`,
      `  # name: '@khorsheed/dsh-commented-out'`,
    ].join('\n')
    expect(parseRowNames(yaml)).toEqual(['@khorsheed/dsh-a', '@khorsheed/dsh-b', '@khorsheed/dsh-c'])
  })

  it('reads subpath composition-entry rows (the canvas ./agent pattern) verbatim', () => {
    const yaml = `- id: worktrees-tool\n  name: '@khorsheed/dsh-worktrees/tool'\n`
    expect(parseRowNames(yaml)).toEqual(['@khorsheed/dsh-worktrees/tool'])
  })
})

describe('checkProfile rules', () => {
  it('accepts a profile that layers every self-mounting dependency', () => {
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-core', '@khorsheed/dsh-row'],
      bundles: ['@deepseek-ai/dsh-base', '@khorsheed/dsh-core'],
      rows: ['@khorsheed/dsh-row'],
    }))).toEqual([])
  })

  it('rule 1: a community bundle entry must be a direct dependency', () => {
    expect(kinds(profile({ bundles: ['@khorsheed/dsh-core'] })))
      .toContain('bundle-not-a-dependency')
    // …but an official template bundle is not a dependency by design.
    expect(kinds(profile({ bundles: ['@deepseek-ai/dsh-base'] }))).toEqual([])
  })

  it('rule 2: a bundle entry resolving to a bundle-less package is fatal (loadProfile throws)', () => {
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-row'], bundles: ['@khorsheed/dsh-row'] })))
      .toContain('bundle-declares-no-patch')
  })

  it('rule 3: a self-mounting dependency left out of bundles never activates', () => {
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-core'], bundles: [] })))
      .toContain('dependency-not-layered')
    // A bundle-less companion row is mounted by a preset, so its absence from
    // bundles is correct — but its own hard dependency on the core is not
    // optional, so closure still pulls the core in.
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-row'], bundles: [] })))
      .toEqual(['closure-missing-dependency', 'closure-missing-bundle'])
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-row', '@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
    }))).toEqual([])
  })

  it('rule 4: a hard dependency on a self-mounting bundle must be pulled in explicitly', () => {
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-provider'], bundles: ['@khorsheed/dsh-provider'] })))
      .toContain('closure-missing-dependency')
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-provider', '@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-provider'],
    }))).toContain('closure-missing-bundle')
  })

  it('rule 4 ignores peerDependencies, so optional integrations stay optional', () => {
    // The exemption is structural: the index carries hard dependencies only.
    // A peer edge on a self-mounting bundle (room → local-agent is the live
    // case) must never force that bundle into every profile that installs the
    // peer.
    const home = mkdtempSync(join(tmpdir(), 'profile-index-'))
    try {
      mkdirSync(join(home, 'packages', 'peer-only'), { recursive: true })
      writeFileSync(join(home, 'packages', 'peer-only', 'package.json'), JSON.stringify({
        name: '@khorsheed/dsh-peer-only',
        peerDependencies: { '@khorsheed/dsh-core': 'workspace:*' },
      }))
      const loaded = loadPackageIndex(home)
      expect(loaded.get('@khorsheed/dsh-peer-only')?.dependencies).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rule 5: a preset row must resolve from the profile itself', () => {
    expect(kinds(profile({ rows: ['@khorsheed/dsh-row'] }))).toContain('preset-row-unresolvable')
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-row'], rows: ['@khorsheed/dsh-row'] })))
      .not.toContain('preset-row-unresolvable')
    // A subpath row resolves through the base package that ships the entry.
    expect(kinds(profile({ rows: ['@khorsheed/dsh-row/tool'] }))).toContain('preset-row-unresolvable')
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-with-tool'], rows: ['@khorsheed/dsh-with-tool/tool'] })))
      .not.toContain('preset-row-unresolvable')
  })

  it('rule 5b: a subpath row requires the workspace base package to export the entry', () => {
    // dsh-row ships no ./tool — the 2026-09-28 incident signature (preset
    // named `@khorsheed/dsh-worktrees/tool` against a base that predated it).
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-row'], rows: ['@khorsheed/dsh-row/tool'] })))
      .toContain('preset-row-subpath-missing')
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-with-tool'], rows: ['@khorsheed/dsh-with-tool/tool'] })))
      .not.toContain('preset-row-subpath-missing')
    // A base outside the workspace is not judged (its exports are unknowable here).
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-external'], rows: ['@khorsheed/dsh-external/tool'] })))
      .not.toContain('preset-row-subpath-missing')
  })

  it('rule 6: retired package names never re-enter a composition', () => {
    expect(kinds(profile({ dependencies: ['@khorsheed/dsh-worktrees-tool'] }))).toContain('retired-package')
    expect(kinds(profile({ bundles: ['@khorsheed/dsh-worktrees-tool'] }))).toContain('retired-package')
    expect(kinds(profile({ rows: ['@khorsheed/dsh-worktrees-tool'] }))).toContain('retired-package')
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
      rows: ['@khorsheed/dsh-with-tool/tool'],
    }))).not.toContain('retired-package')
  })

  it('rule 7: a caret range on a workspace member must admit the workspace version', () => {
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
      dependencyRanges: { '@khorsheed/dsh-core': '^0.2.0' },
    }))).toContain('dependency-range-stale')
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
      dependencyRanges: { '@khorsheed/dsh-core': '^0.3.0' },
    }))).toEqual([])
    // web-eval pins its own member line while the eval family incubates.
    expect(kinds(profile({
      path: 'profiles/web-eval/package.json',
      dependencies: ['@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
      dependencyRanges: { '@khorsheed/dsh-core': '^0.1.0' },
    }))).toEqual([])
    // Exotic ranges are deliberate and unjudged.
    expect(kinds(profile({
      dependencies: ['@khorsheed/dsh-core'],
      bundles: ['@khorsheed/dsh-core'],
      dependencyRanges: { '@khorsheed/dsh-core': 'workspace:*' },
    }))).toEqual([])
  })
})

describe('caretAdmits', () => {
  it('follows npm caret semantics for stable and prerelease floors', () => {
    expect(caretAdmits('^0.3.0', '0.3.0')).toBe(true)
    expect(caretAdmits('^0.3.2', '0.4.0')).toBe(false) // a 0.x caret pins the minor
    expect(caretAdmits('^0.2.1', '0.3.0')).toBe(false)
    expect(caretAdmits('^1.2.3', '1.9.0')).toBe(true)
    expect(caretAdmits('^1.2.3', '2.0.0')).toBe(false)
    expect(caretAdmits('^0.1.0-rc.1', '0.1.0-rc.2')).toBe(true)
    expect(caretAdmits('^0.1.0-rc.1', '0.1.0')).toBe(true)
    expect(caretAdmits('^0.1.0-rc.1', '0.1.1')).toBe(true)
    // A prerelease candidate needs a prerelease floor on the same core triple.
    expect(caretAdmits('^0.1.0', '0.1.0-rc.1')).toBe(false)
    expect(caretAdmits('^0.1.0-rc.1', '0.1.1-rc.1')).toBe(false)
    expect(caretAdmits('workspace:*', '0.1.0')).toBeUndefined()
    expect(caretAdmits('^0.1', '0.1.0')).toBeUndefined()
  })
})

describe('the real tree', () => {
  it('loads every checked-in profile', () => {
    const profiles = loadProfiles(repoRoot)
    expect(profiles.map(p => p.path).sort()).toEqual([
      'profiles/basic/package.json',
      'profiles/dev/package.json',
      'profiles/web-eval/package.json',
    ])
  })

  it('every checked-in profile composes cleanly', () => {
    // Regression guard for the incident this checker was written for: a
    // bundle-less `-tool` row listed in dsh.profile.bundles made the host
    // loader throw before the instance could boot, and presets named
    // companion rows the profile never depended on.
    expect(scanProfiles(repoRoot)).toEqual([])
  })

  it('every package bundle patch names healthy rows', () => {
    // The declarative preset bundle's rows (@khorsheed/dsh-presets) resolve
    // from the installing profile, so membership is not judged here — the
    // subpath-export and retired-name rules are.
    expect(scanPackagePatches(repoRoot)).toEqual([])
  })
})
