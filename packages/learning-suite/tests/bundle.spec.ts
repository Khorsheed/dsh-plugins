import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTopLevelPatchRows, type PatchRow } from '../../scripts/check-plugin-independence.ts'
import { FAMILY_MEMBERS, MODE } from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  dsh: { bundle: { kind: string; mode: string; members: string[] }; references: string[] }
}

const AGENT_PRESET = '@deepseek-ai/dsh-agent-preset'

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

/** A companion composition row: a name with a subpath beyond the package (`@khorsheed/dsh-reader/tool`). */
const isCompanionRow = (row: PatchRow): boolean => row.name !== undefined && /^@khorsheed\/[^/]+\/.+/.test(row.name)

describe('cordis.patch.yml', () => {
  it('mounts exactly the members’ canonical rows minus the companion composition rows, plus the one mode preset row', () => {
    const rows = parseTopLevelPatchRows(patch)
    // The reader's ./tool row is a companion composition row: granted by the
    // preset row below, never mounted here.
    const canonical = FAMILY_MEMBERS.flatMap((member) => memberRows(member)).filter((row) => !isCompanionRow(row))
    const presetRows = rows.filter((row) => row.name === AGENT_PRESET)
    expect(presetRows, 'exactly one agent-preset row').toHaveLength(1)
    expect(presetRows[0]!.id).toBe(`preset-${MODE}`)
    const memberSide = rows.filter((row) => row.name !== AGENT_PRESET)
    expect(memberSide).toHaveLength(canonical.length)
    for (const row of memberSide) {
      expect(
        canonical.some((r) => sameRow(r, row)),
        `row ${row.id ?? '(no id)'} (${row.name ?? 'no name'}) must come from a member's own patch`,
      ).toBe(true)
    }
    // Every member contributes at least one row.
    for (const member of FAMILY_MEMBERS) {
      const own = memberRows(member)
      expect(memberSide.some((row) => own.some((r) => sameRow(r, row))), member).toBe(true)
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
  it('declares the mode kind and the dsh.bundle.mode it carries', () => {
    expect(manifest.dsh.bundle.kind).toBe('mode')
    expect(manifest.dsh.bundle.mode).toBe(MODE)
  })

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
