/**
 * The two copies of the evaluation-side agent presets stay one composition
 * (T100, 2026-10-06).
 *
 * The evaluation line used to run only on its own instance, whose profile-local
 * bundle (profiles/web-eval/presets) declares `eval` (评测模式) and
 * `dataset-authoring` (题集整理). Moving the line to 3080 means the published
 * @khorsheed/dsh-presets bundle 3080 runs must carry the same agents:
 * `dsh-eval` there is the same composition under the id 3080's sessions
 * already use, and `dataset-authoring` is mirrored under its own id (the id the
 * datasets core's authoringPreset default opens).
 *
 * The web-eval copy is the canonical one — its `plugins:` block is apparatus,
 * sha-pinned in web-eval-preset-bundle.spec.ts — and this spec makes drift a
 * red test in either direction. It compares COMPOSITION, not bytes: the two
 * files differ on purpose in comments (where the provenance notes sit) and in
 * quoting (dsh-presets quotes every `name:` value, `'cordis:group'` included,
 * which YAML reads as the same string). The display fields `name` and
 * `description` must match too; `order` may not (each deployment orders its own
 * chip list).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..')
const WEB_EVAL = readFileSync(join(REPO, 'profiles/web-eval/presets/cordis.patch.yml'), 'utf8')
const PRESETS = readFileSync(join(REPO, 'packages/presets/cordis.patch.yml'), 'utf8')

/** One top-level preset row's lines, from `    - id: <row>` up to the next top-level row or row comment. */
function rowLines(patch: string, row: string): string[] {
  const lines = patch.split('\n')
  const start = lines.indexOf(`    - id: ${row}`)
  expect(start, `${row} present`).toBeGreaterThanOrEqual(0)
  const next = lines.findIndex((line, index) => index > start && /^ {4}[-#]/.test(line))
  return lines.slice(start, next === -1 ? lines.length : next)
}

/** Strip one YAML scalar's single/double quotes (the only quoting either file uses). */
const unquote = (value: string): string => value.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')

/**
 * The composition the loader reads: the row's `plugins:` lines with comment
 * lines, blank lines and trailing ` # …` comments dropped and every `name:`
 * value unquoted. Indentation is kept — it IS the structure.
 */
function composition(lines: string[]): string[] {
  const at = lines.indexOf('        plugins:')
  expect(at, 'a plugins: key at row-config depth').toBeGreaterThan(0)
  return lines.slice(at + 1)
    .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .map(line => line.replace(/\s+#\s.*$/, ''))
    .map(line => line.replace(/^(\s*name: )(.*)$/, (_m, key: string, value: string) => key + unquote(value)))
}

/** A row-config display field (`        <key>: value`), unquoted. */
function field(lines: string[], key: string): string | undefined {
  const line = lines.find(l => l.startsWith(`        ${key}: `))
  return line === undefined ? undefined : unquote(line.slice(`        ${key}: `.length))
}

describe('eval presets: web-eval bundle (canonical) and dsh-presets (3080) carry one composition', () => {
  for (const [webRow, presetsRow] of [
    ['preset-eval', 'preset-dsh-eval'],
    ['preset-dataset-authoring', 'preset-dataset-authoring'],
  ] as const) {
    it(`${presetsRow} composes exactly what ${webRow} does`, () => {
      const web = rowLines(WEB_EVAL, webRow)
      const ours = rowLines(PRESETS, presetsRow)
      expect(composition(ours)).toEqual(composition(web))
      expect(field(ours, 'name')).toBe(field(web, 'name'))
      expect(field(ours, 'description')).toBe(field(web, 'description'))
    })
  }

  it('the normalizer sees the rows that matter (guards against comparing two empty lists)', () => {
    const evalRows = composition(rowLines(PRESETS, 'preset-dsh-eval')).join('\n')
    expect(evalRows).toContain("- id: eval-tool\n            name: @khorsheed/dsh-eval/tool")
    expect(evalRows).toContain('Datasets are exactly what datasets_list returns as registered')
    const authoringRows = composition(rowLines(PRESETS, 'preset-dataset-authoring')).join('\n')
    expect(authoringRows).toContain('              tools: organize')
  })
})
