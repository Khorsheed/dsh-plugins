import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

describe('dsh-local-agent framework bundle patch', () => {
  it('mounts the local-agent core row at the profile root', () => {
    // The core row ships in this package's own patch (dsh.bundle), so a
    // profile that installs THIS package as a direct dependency reconciles the
    // core into its bundles layer (apps/cli plugin.ts reconcilePlugins). A
    // harness bundle depending on this package is not enough: the reconciler
    // only ever sees direct profile dependencies.
    expect(patch).toContain('- id: local-agent')
    expect(patch).toContain("name: '@khorsheed/dsh-local-agent'")
    expect(patch).toContain("homesRoot: !!js dshHomePath('local-agent')")
  })

  it('inserts exactly one row', () => {
    expect(patch.match(/- id:/g)).toHaveLength(1)
  })
})
