import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

describe('datasets bundle patch', () => {
  it('mounts the datasets row at the profile root', () => {
    // The row ships in this package's own patch (dsh.bundle), so
    // `dsh plugin --profile <name> add` reconciles it into the bundles layer.
    expect(patch).toContain('- id: datasets')
    // Scoped names are quoted: a bare @-prefixed scalar is invalid YAML.
    expect(patch).toContain('name: "@khorsheed/dsh-datasets"')
  })

  it('inserts exactly one row', () => {
    expect(patch.match(/- id:/g)).toHaveLength(1)
  })
})
