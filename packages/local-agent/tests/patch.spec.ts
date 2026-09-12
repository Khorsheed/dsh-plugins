import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CORE_NAME = '@khorsheed/dsh-local-agent'
const CORE_ROW_ID = 'local-agent'

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const corePatch = read('../cordis.patch.yml')

interface FamilyMember {
  readonly dir: string
  readonly name: string
  readonly patch: string
  /** Declares `dsh.bundle.patch` — the host can mount this package's row directly. */
  readonly mounts: boolean
}

/**
 * The family is discovered, not listed: every `local-agent*` package that ships
 * a bundle patch is a member, and `mounts` says whether installing it as a
 * profile dependency activates its row. A new provider is therefore covered the
 * moment it lands — the negative assertion below cannot silently lose scope.
 */
function readFamily(): FamilyMember[] {
  const packagesRoot = fileURLToPath(new URL('../../', import.meta.url))
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('local-agent'))
    .flatMap((e) => {
      const manifestPath = join(packagesRoot, e.name, 'package.json')
      const patchPath = join(packagesRoot, e.name, 'cordis.patch.yml')
      if (!existsSync(manifestPath) || !existsSync(patchPath)) return []
      const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string
        dsh?: { bundle?: { patch?: string } }
      }
      if (typeof json.name !== 'string') return []
      return [{
        dir: e.name,
        name: json.name,
        patch: readFileSync(patchPath, 'utf8'),
        mounts: json.dsh?.bundle?.patch !== undefined,
      }]
    })
}

const family = readFamily()
const providers = family.filter((m) => m.mounts && m.name !== CORE_NAME)

/**
 * The sibling row this patch names, if it mounts one of `owners`.
 *
 * The contract this file freezes: a provider's patch inserts its own row plus
 * rows for companions that do NOT self-mount (the shared `-tool` package), and
 * never a row for another self-mounting package — the core in particular. A
 * provider that re-inserted the core row would mount it twice whenever two
 * providers are installed, because the core's own patch already mounts it when
 * the core is a direct profile dependency.
 */
function foreignOwningRow(patch: string, owners: readonly string[]): string | null {
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\s*name:\s*(\S.*)$/.exec(line)
    if (!m) continue
    const value = m[1]!.trim().replace(/^['"]|['"]$/g, '')
    if (owners.includes(value)) return value
  }
  return null
}

describe('dsh-local-agent framework bundle patch', () => {
  it('mounts the local-agent core row at the profile root', () => {
    // The core row ships in this package's own patch (dsh.bundle), so a
    // profile that installs THIS package as a direct dependency reconciles the
    // core into its bundles layer (apps/cli plugin.ts reconcilePlugins). A
    // harness bundle depending on this package is not enough: the reconciler
    // only ever sees direct profile dependencies.
    expect(corePatch).toContain('- id: local-agent')
    expect(corePatch).toContain("name: '@khorsheed/dsh-local-agent'")
    expect(corePatch).toContain("homesRoot: !!js dshHomePath('local-agent')")
  })

  it('inserts exactly one row', () => {
    expect(corePatch.match(/- id:/g)).toHaveLength(1)
  })
})

describe('provider patches never re-mount the core', () => {
  it('discovers the whole family', () => {
    expect(family.map((m) => m.dir).sort()).toEqual([
      'local-agent',
      'local-agent-claude-code',
      'local-agent-codex',
      'local-agent-dsh',
      'local-agent-dsh-headless',
      'local-agent-kimi',
    ])
    expect(providers.map((m) => m.dir).sort()).toEqual([
      'local-agent-claude-code',
      'local-agent-codex',
      'local-agent-dsh',
      'local-agent-kimi',
    ])
  })

  it('no provider patch inserts the core row', () => {
    for (const p of providers) {
      expect(foreignOwningRow(p.patch, [CORE_NAME]), p.dir).toBeNull()
      expect(p.patch, p.dir).not.toMatch(/^\s*-?\s*id:\s*local-agent\s*$/m)
    }
  })

  it('every provider patch mounts its own row', () => {
    for (const p of providers) {
      expect(foreignOwningRow(p.patch, [p.name]), p.dir).toBe(p.name)
    }
  })

  it('the detector catches a re-inserted core row (this assertion has teeth)', () => {
    const injected = `${providers[0]!.patch}\n    - id: ${CORE_ROW_ID}\n      name: '${CORE_NAME}'\n`
    expect(foreignOwningRow(injected, [CORE_NAME])).toBe(CORE_NAME)
  })
})
