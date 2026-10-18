import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTopLevelPatchRows, type PatchRow } from '../../../scripts/check-plugin-independence.ts'
import { FAMILY_DEPS_ONLY, FAMILY_MEMBERS, MODE } from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  dsh: { bundle: { kind: string; mode: string; members: string[] }; references: string[] }
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
  it('mounts exactly the members’ canonical rows plus the one mode preset row (mounted last), verbatim', () => {
    const rows = parseTopLevelPatchRows(patch)
    const canonical = FAMILY_MEMBERS.flatMap((member) => memberRows(member))
    const presetRows = rows.filter((row) => row.name === '@deepseek-ai/dsh-agent-preset')
    expect(presetRows, 'exactly one agent-preset row').toHaveLength(1)
    expect(presetRows[0]!.id).toBe(`preset-${MODE}`)
    const memberSide = rows.filter((row) => row.name !== '@deepseek-ai/dsh-agent-preset')
    // The local-agent members contribute the two bare tool-subagent-* overrides
    // alongside their insert rows; both sit at the top level, so membership is
    // checked order-insensitively (the preset row still mounts last).
    expect(memberSide).toHaveLength(canonical.length)
    for (const row of memberSide) {
      expect(
        canonical.some((r) => sameRow(r, row)),
        `row ${row.id ?? '(no id)'} (${row.name ?? 'no name'}) must be member row`,
      ).toBe(true)
    }
    expect(rows[rows.length - 1]).toEqual(presetRows[0])
    // Every member contributes at least one row.
    for (const member of FAMILY_MEMBERS) {
      const own = memberRows(member)
      expect(rows.some((row) => own.some((r) => sameRow(r, row))), member).toBe(true)
    }
  })

  it('mounts no profile-root tool row — the ./tool entries are granted inside the preset row', () => {
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
  it('declares the mode kind and the dsh.bundle.mode it carries', () => {
    expect(manifest.dsh.bundle.kind).toBe('mode')
    expect(manifest.dsh.bundle.mode).toBe(MODE)
  })

  it('declares dsh.bundle.members matching FAMILY_MEMBERS', () => {
    expect(manifest.dsh.bundle.members).toEqual([...FAMILY_MEMBERS])
  })

  it('carries every member and the deps-only library as npm dependencies, and nothing else', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...FAMILY_MEMBERS, ...FAMILY_DEPS_ONLY].sort())
    for (const name of [...FAMILY_MEMBERS, ...FAMILY_DEPS_ONLY]) {
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
