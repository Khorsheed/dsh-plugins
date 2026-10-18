import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTopLevelPatchRows, type PatchRow } from '../../scripts/check-plugin-independence.ts'
import { FAMILY_MEMBERS, FAMILY_ROOT_OVERRIDES, MODE } from '../src/index.ts'

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

describe('cordis.patch.yml', () => {
  it('mounts exactly the members’ canonical rows, the root-row overrides and the one mode preset row', () => {
    const rows = parseTopLevelPatchRows(patch)
    const canonical = FAMILY_MEMBERS.flatMap((member) => memberRows(member))
    const presetRows = rows.filter((row) => row.name === AGENT_PRESET)
    expect(presetRows, 'exactly one agent-preset row').toHaveLength(1)
    expect(presetRows[0]!.id).toBe(`preset-${MODE}`)
    const memberSide = rows.filter((row) => row.name !== AGENT_PRESET)
    // canvas contributes two canonical rows; the bundle replaces the enabled
    // root canvas-agent mount with a bare disable override of the same id, so
    // the mounted count equals the canonical count.
    expect(memberSide).toHaveLength(canonical.length)
    for (const row of memberSide) {
      if (row.name === undefined) {
        // A bare override: sanctioned only when it pins a declared override id
        // and a member's canonical row carries that id.
        expect(FAMILY_ROOT_OVERRIDES, `override row ${row.id ?? '(no id)'}`).toContain(row.id)
        expect(canonical.some((r) => r.id === row.id), `override row ${row.id ?? '(no id)'} names no member row`).toBe(true)
        continue
      }
      expect(
        canonical.some((r) => sameRow(r, row)),
        `row ${row.id ?? '(no id)'} (${row.name}) must come from a member's own patch`,
      ).toBe(true)
    }
    // Every member contributes at least one NAMED row (a bare override alone
    // does not count — it adds nothing without the member's own mount).
    for (const member of FAMILY_MEMBERS) {
      const own = memberRows(member)
      expect(memberSide.some((row) => row.name !== undefined && own.some((r) => sameRow(r, row))), member).toBe(true)
    }
  })

  it('disables the root canvas-agent row — the preset grant is the only live one', () => {
    expect(patch).toMatch(/^- id: canvas-agent\n {2}disabled: true$/m)
    const rows = parseTopLevelPatchRows(patch)
    expect(rows.filter((row) => row.id === 'canvas-agent')).toHaveLength(1)
    expect(rows.find((row) => row.id === 'canvas-agent')!.name).toBeUndefined()
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
