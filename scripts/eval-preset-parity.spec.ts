/**
 * The two copies of the evaluation agent preset stay one composition
 * (T100, 2026-10-06).
 *
 * The evaluation line used to run only on its own instance, whose profile-local
 * bundle (profiles/web-eval/presets) declares `eval` (评测模式). Moving the line
 * to 3080 means the published @khorsheed/dsh-presets bundle 3080 runs must
 * carry the same agent: `dsh-eval` there is the same composition under the id
 * 3080's sessions already use. T100 also mirrored `dataset-authoring`
 * (题集整理); T102 folded organizing into the evaluation mode and removed that
 * row on both sides, so one pair is left.
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
  it('preset-dsh-eval composes exactly what preset-eval does', () => {
    const web = rowLines(WEB_EVAL, 'preset-eval')
    const ours = rowLines(PRESETS, 'preset-dsh-eval')
    expect(composition(ours)).toEqual(composition(web))
    expect(field(ours, 'name')).toBe(field(web, 'name'))
    expect(field(ours, 'description')).toBe(field(web, 'description'))
  })

  it('neither side declares the retired 题集整理 preset (T102)', () => {
    for (const patch of [WEB_EVAL, PRESETS]) {
      expect(patch).not.toContain('    - id: preset-dataset-authoring')
      expect(patch).not.toMatch(/^ {8}id: dataset-authoring$/m)
    }
  })

  it('the normalizer sees the rows that matter (guards against comparing two empty lists)', () => {
    const evalRows = composition(rowLines(PRESETS, 'preset-dsh-eval')).join('\n')
    expect(evalRows).toContain("- id: eval-tool\n            name: @khorsheed/dsh-eval/tool")
    expect(evalRows).toContain('Registered datasets are exactly what datasets_list returns')
    expect(evalRows).toContain('Load the dataset-authoring skill')
    expect(evalRows).toContain("- id: tool-bash\n            name: @deepseek-ai/dsh-tool-bash")
    expect(evalRows).toContain('              tools: organize')
  })
})
