import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPackageMap, packageRows, renderPackageMap } from './generate-package-map.ts'

const root = join(import.meta.dirname!, '..')

describe('renderPackageMap', () => {
  it('is deterministic', () => {
    expect(renderPackageMap(root)).toBe(renderPackageMap(root))
  })

  it('counts exactly what the manifests say', () => {
    const rows = packageRows(root)
    const text = renderPackageMap(root)
    expect(text).toContain(`包总数:**${rows.length}**`)
    expect(text).toContain(`自挂载 bundle(\`dsh.bundle.patch\`):**${rows.filter((r) => r.form === 'bundle').length}**`)
    expect(text).toContain(`组合组件(不自挂载,\`dsh.composition.component\`):**${rows.filter((r) => r.form === 'composition').length}**`)
  })

  it('derives form, component, client half and profile membership from manifests', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dsh-map-tree-'))
    try {
      for (const dir of ['packages/a', 'packages/b', 'profiles/p']) mkdirSync(join(repo, dir), { recursive: true })
      writeFileSync(join(repo, 'packages/a/package.json'), JSON.stringify({
        name: '@khorsheed/dsh-a',
        version: '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' }, compat: { minHost: '0.1.5-rc.1' } },
      }))
      writeFileSync(join(repo, 'packages/b/package.json'), JSON.stringify({
        name: '@khorsheed/dsh-b',
        version: '0.1.0',
        dsh: { composition: { component: 'preset-composed-row' } },
      }))
      writeFileSync(join(repo, 'profiles/p/package.json'), JSON.stringify({
        dependencies: { '@khorsheed/dsh-a': 'workspace:*', '@khorsheed/dsh-b': 'workspace:*' },
        dsh: { profile: { bundles: ['@khorsheed/dsh-a'] } },
      }))
      const text = renderPackageMap(repo)
      expect(text).toContain('包总数:**2**')
      expect(text).toContain('| `@khorsheed/dsh-a` | `packages/a` | 1.0.0 | bundle | — | web | 0.1.5-rc.1 | p |')
      expect(text).toContain('| `@khorsheed/dsh-b` | `packages/b` | 0.1.0 | composition | preset-composed-row | — | — | p |')
      expect(text).toContain('| `profiles/p` | 2 | 1 |')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('checkPackageMap', () => {
  it('matches the committed docs/packages.md', () => {
    // The regression this exists for: a manifest changes shape (self-mount,
    // composition component, profile membership) and the published map is not
    // regenerated — the map then lies about the tree.
    expect(checkPackageMap(root, join(root, 'docs/packages.md'))).toBeNull()
  })

  it('reports a missing map and a stale map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-map-'))
    try {
      const out = join(dir, 'packages.md')
      expect(checkPackageMap(root, out)).toMatch(/missing/)
      writeFileSync(out, 'stale\n')
      expect(checkPackageMap(root, out)).toMatch(/stale/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
