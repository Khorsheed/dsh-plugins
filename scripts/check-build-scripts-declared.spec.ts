import { describe, expect, it } from 'vitest'
import { declaredBuilds, packagesWithInstallScripts } from './check-build-scripts-declared.ts'

describe('declaredBuilds', () => {
  it('reads both verdicts — declining a build is a decision too', () => {
    const yaml = 'packages:\n  - packages/*\nallowBuilds:\n  esbuild: true\n  koffi: false\nminimumReleaseAgeExclude:\n  - x\n'
    expect(declaredBuilds(yaml)).toEqual(new Set(['esbuild', 'koffi']))
  })

  it('stops at the next top-level key rather than swallowing the file', () => {
    const yaml = 'allowBuilds:\n  esbuild: true\noverrides:\n  lodash: 4.0.0\n'
    expect(declaredBuilds(yaml)).toEqual(new Set(['esbuild']))
  })

  it('handles quoted and scoped names', () => {
    expect(declaredBuilds("allowBuilds:\n  '@scope/pkg': true\n")).toEqual(new Set(['@scope/pkg']))
  })

  it('returns empty when the section is absent', () => {
    expect(declaredBuilds('packages:\n  - packages/*\n')).toEqual(new Set())
  })
})

describe('packagesWithInstallScripts', () => {
  it('finds the real tree\'s install-script dependencies, and they are all declared', () => {
    const found = packagesWithInstallScripts()
    // koffi is the one that broke CI on 2026-09-01; esbuild is tsdown's.
    expect(found).toContain('koffi')
    expect(found).toContain('esbuild')
  })

  it('would have flagged koffi before it was declared', () => {
    const before = declaredBuilds('allowBuilds:\n  esbuild: true\n')
    expect(packagesWithInstallScripts().filter((n) => !before.has(n))).toEqual(['koffi'])
  })
})
