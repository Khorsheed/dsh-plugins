/**
 * Every mode bundle carries its mode's preset row as a VERBATIM mirror of the
 * same-named row in @khorsheed/dsh-presets (the per-mode packs, 2026-10-18).
 *
 * The presets bundle was the presets' first home; the mode bundles are their
 * product form (one install = the family plus the mode). While both exist the
 * two copies must not drift: this spec compares each mode bundle's preset row
 * against the presets bundle's — the parsed `plugins:` composition plus the
 * display fields `name` / `description` / `order` (unlike the web-eval parity
 * spec, `order` must match here: both copies ride the SAME deployment's chip
 * list). It compares COMPOSITION, not bytes — the copies differ on purpose in
 * comments (provenance notes) and quoting (both facts YAML-equivalent).
 *
 * When the presets package retires (planned for the next release wave), the
 * mode bundles' patches become the canonical copies and this spec is deleted;
 * each bundle patch's header comment already says so.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composition, field, rowLines } from './preset-row-blocks.ts'

const REPO = join(import.meta.dirname, '..')
const PRESETS = readFileSync(join(REPO, 'packages/presets/cordis.patch.yml'), 'utf8')

/** Mode bundle directory → the mode its preset row installs. */
const MODE_BUNDLES: ReadonlyArray<readonly [dir: string, mode: string]> = [
  ['dev', 'dsh-dev'],
  ['writing', 'dsh-writing'],
  ['learning', 'dsh-learning'],
  ['video', 'dsh-video'],
  ['gamedev', 'dsh-gamedev'],
  ['bundle-eval', 'dsh-eval'],
]

describe.each(MODE_BUNDLES)('packages/%s mirrors preset-%s', (dir, mode) => {
  const patch = readFileSync(join(REPO, 'packages', dir, 'cordis.patch.yml'), 'utf8')
  const ours = rowLines(patch, `preset-${mode}`)
  const theirs = rowLines(PRESETS, `preset-${mode}`)

  it('composes the same plugins, in the same order, as the presets bundle', () => {
    expect(composition(ours)).toEqual(composition(theirs))
  })

  it('carries the same name / description / order display fields', () => {
    for (const key of ['name', 'description', 'order']) {
      expect(field(ours, key), key).toBe(field(theirs, key))
    }
  })

  it('declares the mode in its manifest (kind mode + dsh.bundle.mode)', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'packages', dir, 'package.json'), 'utf8')) as {
      dsh: { bundle: { kind: string; mode: string } }
    }
    expect(manifest.dsh.bundle.kind).toBe('mode')
    expect(manifest.dsh.bundle.mode).toBe(mode)
  })
})
