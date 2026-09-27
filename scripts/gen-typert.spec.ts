import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireTypertLock, copyTypertPackageSources, copyTypertSiblingTypes, dualShapeCodecs, harnessGitState, isTypertCacheFresh, releaseTypertLock, selectTypertPackages, typertFileHash, typertInputHash, typertSiblingTypePaths, TYPERT_PACKAGES, writeTypertCache } from './gen-typert.mts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('dualShapeCodecs', () => {
  it('materializes an eager schema beside every lazy create factory, keeping indentation', () => {
    const generated = [
      'const X$schema = () => (X$schema$value ??= z.object({}))',
      'export const TYPERT = {',
      '  invocations: [',
      '    {',
      '      parameters: [',
      '        {',
      '          codec: {',
      '            mode: \'strict\',',
      '            typeSymbol: \'pkg/types#Req\',',
      '            create: X$schema,',
      '          },',
      '        },',
      '      ],',
      '      result: {',
      '        mode: \'strict\',',
      '        typeSymbol: \'pkg/types#Res\',',
      '        create: X$schema,',
      '      },',
      '    },',
      '  ],',
      '}',
    ].join('\n')
    const out = dualShapeCodecs(generated)
    expect(out).toContain('            create: X$schema,\n            schema: X$schema(),')
    expect(out).toContain('        create: X$schema,\n        schema: X$schema(),')
    // Two codec literals transformed, nothing else touched.
    expect(out.match(/schema: X\$schema\(\),/g)).toHaveLength(2)
    expect(out.replace(/^([ \t]*)create: [A-Za-z0-9_$]+,\n\1schema: [A-Za-z0-9_$]+\(\),$/gm, '')).toBe(generated.replace(/^([ \t]*)create: [A-Za-z0-9_$]+,$/gm, ''))
  })

  it('leaves content without create-factory literals byte-identical', () => {
    const plain = 'const x = { created: 1, create: makeThing, }\nfoo(createBar)\n'
    expect(dualShapeCodecs(plain)).toBe(plain)
  })
})

describe('selectTypertPackages', () => {
  it('selects only the explicitly requested plugin package', () => {
    const selected = selectTypertPackages('@khorsheed/dsh-capability-catalog')
    expect(selected.map(pkg => pkg.name)).toEqual(['@khorsheed/dsh-capability-catalog'])
  })

  it('rejects a filter with no registered package', () => {
    expect(() => selectTypertPackages('@khorsheed/dsh-missing')).toThrow(/matched no registered package/)
  })

  it('expands a scoped batch over declared typert-family edges', () => {
    // room's face reaches local-agent's SessionEventMap augmentation; an
    // unselected sibling resolves from its built lib/types, which is not a
    // registered face contributor, so the merge analysis fails unless the
    // sibling generates in the same batch (2026-09-28, room 0.2.0 deploy).
    const selected = selectTypertPackages('@khorsheed/dsh-room').map(pkg => pkg.name)
    expect(selected).toContain('@khorsheed/dsh-room')
    expect(selected).toContain('@khorsheed/dsh-local-agent')
  })

  it('leaves full (unscoped) selection covering every registered package', () => {
    expect(selectTypertPackages(undefined).length).toBe(TYPERT_PACKAGES.length)
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
    // capability-catalog declares no typert-family edge, so its scoped batch
    // leaves local-agent unselected (room would auto-expand to include it).
    const selected = selectTypertPackages('@khorsheed/dsh-capability-catalog')
    const paths = typertSiblingTypePaths(selected, source)
    expect(paths['@khorsheed/dsh-local-agent']).toEqual(['./packages/local-agent/lib/types/index.d.ts'])
    expect(paths['@khorsheed/dsh-local-agent/*']).toEqual(['./packages/local-agent/lib/types/*'])
    // The selected package keeps its source-plane mapping and is absent here.
    expect(paths['@khorsheed/dsh-capability-catalog']).toBeUndefined()
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
    copyTypertSiblingTypes(selectTypertPackages('@khorsheed/dsh-capability-catalog'), source, overlay2)
    expect(existsSync(join(overlay2, 'packages', 'local-agent', 'lib', 'types', 'index.d.ts'))).toBe(true)
    expect(existsSync(join(overlay2, 'packages', 'local-agent', 'src'))).toBe(false)
  })
})

describe('typert freshness cache', () => {
  /** A fake repo root with one minimal typert package and a script file. */
  function fakeRepo(): { root: string, script: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-typert-cache-'))
    temporaryRoots.push(root)
    const pkg = TYPERT_PACKAGES.find(pkg => pkg.dir === 'packages/mission')!
    mkdirSync(join(root, pkg.dir, 'src'), { recursive: true })
    writeFileSync(join(root, pkg.dir, 'src', 'index.ts'), 'export const v = 1\n')
    writeFileSync(join(root, pkg.dir, 'package.json'), JSON.stringify({ name: pkg.name }))
    for (const config of pkg.hostConfigs) writeFileSync(join(root, pkg.dir, config), '{}\n')
    const script = join(root, 'gen-typert.mts')
    writeFileSync(script, '// generator\n')
    return { root, script }
  }
  const mission = TYPERT_PACKAGES.find(pkg => pkg.dir === 'packages/mission')!

  it('hashes every generator input: src edits move the key, unrelated files do not matter', () => {
    const { root, script } = fakeRepo()
    const before = typertInputHash(root, [mission], script)
    expect(typertInputHash(root, [mission], script)).toBe(before)
    writeFileSync(join(root, mission.dir, 'src', 'index.ts'), 'export const v = 2\n')
    expect(typertInputHash(root, [mission], script)).not.toBe(before)
  })

  it('accepts a stamp whose key and recorded outputs are intact, rejects any drift', () => {
    const { root } = fakeRepo()
    const cachePath = join(root, 'scratch', 'typert-cache.json')
    const outRel = join(mission.dir, 'lib', 'typert.host.d.ts')
    mkdirSync(join(root, mission.dir, 'lib'), { recursive: true })
    writeFileSync(join(root, outRel), 'declare const face: 1\n')
    writeTypertCache(cachePath, 'key-1', { [outRel]: typertFileHash(join(root, outRel)) })

    expect(isTypertCacheFresh(cachePath, 'key-1', root)).toBe(true)
    expect(isTypertCacheFresh(cachePath, 'key-2', root)).toBe(false)
    // An output rewritten behind the stamp's back is a miss, not a silent pass.
    writeFileSync(join(root, outRel), 'declare const face: 2\n')
    expect(isTypertCacheFresh(cachePath, 'key-1', root)).toBe(false)
    // A deleted output (a cold lib) is a miss.
    writeTypertCache(cachePath, 'key-1', { [outRel]: typertFileHash(join(root, outRel)) })
    rmSync(join(root, outRel))
    expect(isTypertCacheFresh(cachePath, 'key-1', root)).toBe(false)
    // No stamp at all is a miss.
    expect(isTypertCacheFresh(join(root, 'scratch', 'absent.json'), 'key-1', root)).toBe(false)
  })

  it('treats a non-git harness checkout as uncacheable rather than crashing', () => {
    const notGit = mkdtempSync(join(tmpdir(), 'dsh-typert-harness-'))
    temporaryRoots.push(notGit)
    expect(harnessGitState(notGit)).toBeNull()
  })
})

describe('full-mode generation lock', () => {
  it('takes the lock on a cold DSH_HOME instead of spinning until the break deadline', () => {
    // A DSH_HOME that has never generated has no scratch/ — the state every
    // fresh install starts in. The non-recursive mkdir that makes the lock
    // atomic fails with ENOENT there, and the retry loop cannot tell that
    // apart from a held lock: before the parent was created first this call
    // spun for 900 seconds, broke a lock nobody held, and spun again.
    const home = mkdtempSync(join(tmpdir(), 'dsh-typert-lock-'))
    temporaryRoots.push(home)
    const lockDir = join(home, 'scratch', 'typert-gen.lock')
    expect(existsSync(join(home, 'scratch'))).toBe(false)

    const started = Date.now()
    acquireTypertLock(lockDir)

    expect(existsSync(lockDir)).toBe(true)
    expect(Date.now() - started).toBeLessThan(2_000)
    releaseTypertLock(lockDir)
    expect(existsSync(lockDir)).toBe(false)
    // Releasing removes the lock, never the scratch dir the cache lives in.
    expect(existsSync(join(home, 'scratch'))).toBe(true)
  })
})
