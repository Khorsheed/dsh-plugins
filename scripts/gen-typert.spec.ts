import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyTypertPackageSources, selectTypertPackages } from './gen-typert.mts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('selectTypertPackages', () => {
  it('selects only the explicitly requested plugin package', () => {
    const selected = selectTypertPackages('@khorsheed/dsh-capability-catalog')
    expect(selected.map(pkg => pkg.name)).toEqual(['@khorsheed/dsh-capability-catalog'])
  })

  it('rejects a filter with no registered package', () => {
    expect(() => selectTypertPackages('@khorsheed/dsh-missing')).toThrow(/matched no registered package/)
  })
})

describe('copyTypertPackageSources', () => {
  it('does not require an unselected sibling source tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-gen-typert-'))
    temporaryRoots.push(root)
    const source = join(root, 'source')
    const overlay = join(root, 'overlay')
    const selected = selectTypertPackages('@khorsheed/dsh-capability-catalog')
    const pkg = selected[0]!
    const pkgRoot = join(source, pkg.dir)
    mkdirSync(join(pkgRoot, 'src'), { recursive: true })
    writeFileSync(join(pkgRoot, 'src', 'index.ts'), 'export const value = 1\n')
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ name: pkg.name }))
    for (const config of pkg.hostConfigs) writeFileSync(join(pkgRoot, config), '{}\n')

    copyTypertPackageSources(selected, source, overlay)

    expect(existsSync(join(overlay, pkg.dir, 'src', 'index.ts'))).toBe(true)
    expect(existsSync(join(overlay, 'packages', 'message-tools'))).toBe(false)
  })
})
