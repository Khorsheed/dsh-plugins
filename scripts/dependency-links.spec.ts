import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDeploymentLinks, scanDependencyLinks } from './dependency-links.mts'

const roots: string[] = []
function fixture() { const p = mkdtempSync(join(tmpdir(), 'deploy-links-')); roots.push(p); return p }
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })
describe('deployment link diagnosis', () => {
  it('reports every dangling link and leaves links and data intact', () => {
    const root = fixture()
    mkdirSync(join(root, 'node_modules'))
    symlinkSync('missing', join(root, 'node_modules', 'lost'))
    symlinkSync('missing-too', join(root, 'other'))
    writeFileSync(join(root, 'session.json'), 'unchanged')
    const result = scanDependencyLinks([{ path: root }])
    expect(result).toHaveLength(2)
    expect(result.every(x => x.code === 'ENOENT' && x.target)).toBe(true)
    expect(() => checkDeploymentLinks(root, root)).toThrow('No links were changed')
    expect(readlinkSync(join(root, 'other'))).toBe('missing-too')
  })
  it('does not traverse valid aliases or directory cycles, but detects unresolvable link cycles', () => {
    const root = fixture()
    mkdirSync(join(root, 'real'))
    symlinkSync('real', join(root, 'alias'))
    symlinkSync('..', join(root, 'real', 'parent'))
    expect(scanDependencyLinks([{ path: root }])).toEqual([])
    symlinkSync('b', join(root, 'a')); symlinkSync('a', join(root, 'b'))
    expect(scanDependencyLinks([{ path: root }]).map(x => x.code)).toEqual(['ELOOP', 'ELOOP'])
  })
  it('excludes only home top-level scratch and git; scans nested scratch and harness native dependencies', () => {
    const home = fixture(), harness = fixture()
    for (const path of [join(home, 'scratch'), join(home, '.git'), join(home, 'nested', 'scratch'), join(harness, 'native')]) {
      mkdirSync(path, { recursive: true }); symlinkSync('missing', join(path, 'lost'))
    }
    const result = scanDependencyLinks([{ path: home, exclude: ['scratch'] }, { path: harness }])
    expect(result.map(x => x.path)).toEqual([join(realpathSync(home), 'nested', 'scratch', 'lost'), join(realpathSync(harness), 'native', 'lost')])
  })
  it('supports symlinked roots, and fails on missing scan roots rather than reporting success', () => {
    const root = fixture(), link = join(root, 'alias'); mkdirSync(join(root, 'real')); symlinkSync('real', link)
    expect(scanDependencyLinks([{ path: link }])).toEqual([])
    expect(scanDependencyLinks([{ path: join(root, 'absent') }])[0].code).toBe('ENOENT')
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports unreadable directories instead of silently skipping them', () => {
    const root = fixture(), unreadable = join(root, 'unreadable'); mkdirSync(unreadable); chmodSync(unreadable, 0)
    try { expect(scanDependencyLinks([{ path: root }]).map(x => x.code)).toEqual(['EACCES']) }
    finally { chmodSync(unreadable, 0o700) }
  })
})
