/**
 * Package-manifest contract for the headless bundle: it must NOT declare
 * `dsh.bundle`. The declaration is the host's mount trigger — `dsh plugin`
 * reconcilePlugins appends every `dsh.bundle`-declaring direct dependency to
 * the profile's layer stack, and this bundle's sub-dsh-only composition then
 * collides with (or leaks into) the interactive composition. The 2026-08-23
 * P0 and the T6/i1-walk G3 incident are both exactly that mount; the fix is
 * the declaration's removal, so a reintroduction is a regression, not a
 * cleanup.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

describe('dsh-local-agent-dsh-headless package manifest', () => {
  it('declares no dsh.bundle — the reconcile mount trigger stays removed', () => {
    const manifest = JSON.parse(readFileSync(`${packageDir}package.json`, 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle).toBeUndefined()
  })

  it('still ships cordis.patch.yml — the provisioner copies it into the sub-profile patch layer', () => {
    const manifest = JSON.parse(readFileSync(`${packageDir}package.json`, 'utf8')) as { files?: string[] }
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(existsSync(`${packageDir}cordis.patch.yml`)).toBe(true)
  })
})
