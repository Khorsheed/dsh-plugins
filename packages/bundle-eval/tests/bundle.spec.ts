import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTopLevelPatchRows, type PatchRow } from '../../../scripts/check-plugin-independence.ts'
import { FAMILY_MEMBERS } from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  dsh: { bundle: { members: string[] }; references: string[] }
}

/** Repo package name → directory. */
const dirOf = new Map<string, string>()
for (const dir of readdirSync(join(root, '..'))) {
  const manifestPath = join(root, '..', dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
  if (json.name !== undefined) dirOf.set(json.name, dir)
}

/** A member package's own canonical patch rows (the bundle must reuse them verbatim). */
function memberRows(pkgName: string): PatchRow[] {
  return parseTopLevelPatchRows(readFileSync(join(root, '..', dirOf.get(pkgName)!, 'cordis.patch.yml'), 'utf8'))
}

const sameRow = (a: PatchRow, b: PatchRow): boolean => a.id === b.id && a.name === b.name

describe('cordis.patch.yml', () => {
  it('mounts exactly the members’ canonical rows, verbatim, in member order', () => {
    const rows = parseTopLevelPatchRows(patch)
    const canonical = FAMILY_MEMBERS.flatMap((member) => memberRows(member))
    expect(rows).toHaveLength(canonical.length)
    rows.forEach((row, index) => {
      expect(sameRow(row, canonical[index]!), `row ${row.id ?? '(no id)'} (${row.name ?? 'no name'}) must be member row #${index}`).toBe(true)
    })
    // Every member contributes at least one row.
    for (const member of FAMILY_MEMBERS) {
      const own = memberRows(member)
      expect(rows.some((row) => own.some((r) => sameRow(r, row))), member).toBe(true)
    }
  })

  it('mounts no tool row — the ./tool entries are preset-granted, never profile-root', () => {
    const rows = parseTopLevelPatchRows(patch)
    for (const row of rows) {
      expect(row.name ?? '', row.id ?? '').not.toMatch(/\/tool$|-tool$/)
    }
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })
})

describe('package.json', () => {
  it('declares dsh.bundle.members matching FAMILY_MEMBERS', () => {
    expect(manifest.dsh.bundle.members).toEqual([...FAMILY_MEMBERS])
  })

  it('carries every member as an npm dependency, and nothing else', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...FAMILY_MEMBERS].sort())
    for (const name of FAMILY_MEMBERS) {
      expect(manifest.dependencies[name], name).toBe('workspace:*')
    }
  })

  it('registers every member in dsh.references', () => {
    for (const name of FAMILY_MEMBERS) {
      expect(manifest.dsh.references, name).toContain(name)
    }
  })
})

describe('locale card metadata', () => {
  it('folds the family into one 评测套件 card (distinct from the eval member card)', () => {
    const zh = JSON.parse(readFileSync(join(root, 'locale', 'zh.json'), 'utf8')) as { meta: { title: string } }
    const en = JSON.parse(readFileSync(join(root, 'locale', 'en.json'), 'utf8')) as { meta: { title: string } }
    expect(zh.meta.title).toBe('评测套件')
    expect(en.meta.title).toBe('Evaluation Suite')
  })
})
