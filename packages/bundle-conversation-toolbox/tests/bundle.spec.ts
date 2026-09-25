import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTopLevelPatchRows, type PatchRow } from '../../scripts/check-plugin-independence.ts'
import { FAMILY_MEMBERS } from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  dsh: { bundle: { members: string[] }; references: string[] }
}

/** Repo package name → directory (member dirs do not always mirror the package basename). */
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
  it('mounts exactly the seven members’ canonical rows, verbatim', () => {
    const rows = parseTopLevelPatchRows(patch)
    const canonical = FAMILY_MEMBERS.flatMap((member) => memberRows(member))
    expect(rows).toHaveLength(canonical.length)
    expect(rows.map((row) => row.id)).toEqual(canonical.map((row) => row.id))
    for (const row of rows) {
      expect(
        canonical.some((r) => sameRow(r, row)),
        `row ${row.id ?? '(no id)'} (${row.name ?? 'no name'}) must come from a member's own patch`,
      ).toBe(true)
    }
    // Every member contributes at least one row.
    for (const member of FAMILY_MEMBERS) {
      const own = memberRows(member)
      expect(rows.some((row) => own.some((r) => sameRow(r, row))), member).toBe(true)
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

  it('carries every member as an npm dependency', () => {
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
