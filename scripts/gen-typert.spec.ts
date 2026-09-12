import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyTypertPackageSources, copyTypertSiblingTypes, selectTypertPackages, typertSiblingTypePaths, TYPERT_PACKAGES } from './gen-typert.mts'

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

describe('unselected sibling type resolution', () => {
  /** A fake repo root holding one sibling's built lib/types. */
  function sourceWithSiblingTypes(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-gen-typert-'))
    temporaryRoots.push(root)
    const sibling = TYPERT_PACKAGES.find(pkg => pkg.dir === 'packages/local-agent')!
    mkdirSync(join(root, sibling.dir, 'lib', 'types'), { recursive: true })
    writeFileSync(join(root, sibling.dir, 'lib', 'types', 'index.d.ts'), 'export declare const x: 1\n')
    return root
  }

  it('maps unselected siblings with a built lib/types to their declarations, never the selected package', () => {
    const source = sourceWithSiblingTypes()
    const selected = selectTypertPackages('@khorsheed/dsh-room')
    const paths = typertSiblingTypePaths(selected, source)
    expect(paths['@khorsheed/dsh-local-agent']).toEqual(['./packages/local-agent/lib/types/index.d.ts'])
    expect(paths['@khorsheed/dsh-local-agent/*']).toEqual(['./packages/local-agent/lib/types/*'])
    // The selected package keeps its source-plane mapping and is absent here.
    expect(paths['@khorsheed/dsh-room']).toBeUndefined()
    // A sibling without a built lib/types is skipped.
    expect(paths['@khorsheed/dsh-mission']).toBeUndefined()
  })

  it('copies only unselected siblings\' lib/types into the overlay', () => {
    const source = sourceWithSiblingTypes()
    const overlay = mkdtempSync(join(tmpdir(), 'dsh-gen-typert-overlay-'))
    temporaryRoots.push(overlay)
    const selected = selectTypertPackages('@khorsheed/dsh-local-agent')
    copyTypertSiblingTypes(selected, source, overlay)
    // local-agent is selected here, so its types are NOT copied.
    expect(existsSync(join(overlay, 'packages', 'local-agent'))).toBe(false)

    const overlay2 = mkdtempSync(join(tmpdir(), 'dsh-gen-typert-overlay-'))
    temporaryRoots.push(overlay2)
    copyTypertSiblingTypes(selectTypertPackages('@khorsheed/dsh-room'), source, overlay2)
    expect(existsSync(join(overlay2, 'packages', 'local-agent', 'lib', 'types', 'index.d.ts'))).toBe(true)
    expect(existsSync(join(overlay2, 'packages', 'local-agent', 'src'))).toBe(false)
  })
})
