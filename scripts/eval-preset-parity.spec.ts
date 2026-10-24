/**
 * The two copies of the evaluation agent preset stay one composition
 * (T100, 2026-10-06; two-way again since 2026-10-24).
 *
 * The evaluation line used to run only on its own instance, whose profile-local
 * bundle (profiles/eval/presets) declares `eval` (评测模式). Moving the line
 * to 3080 meant the bundle 3080 runs must carry the same agent: `dsh-eval` is
 * the same composition under the id 3080's sessions already use. That row
 * lived in @khorsheed/dsh-presets first, then (2026-10-18) also in the eval
 * mode pack @khorsheed/dsh-eval-suite; since the presets package retired
 * (2026-10-24) the mode pack's `preset-dsh-eval` is the only community copy.
 * T100 also mirrored `dataset-authoring` (题集整理); T102 folded organizing
 * into the evaluation mode and removed that row on all sides, so one row is
 * left.
 *
 * The eval pack's copy is the canonical one — its `plugins:` block is
 * apparatus, sha-pinned in eval-preset-bundle.spec.ts — and this spec makes
 * drift a red test in either direction. It compares COMPOSITION, not bytes:
 * the copies differ on purpose in comments (where the provenance notes sit)
 * and in quoting (the mode pack quotes every `name:` value, `'cordis:group'`
 * included, which YAML reads as the same string). The display fields `name`
 * and `description` must match too; `order` may not (each deployment orders
 * its own chip list).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composition, field, rowLines } from './preset-row-blocks.ts'

const REPO = join(import.meta.dirname, '..')
const EVAL_PACK = readFileSync(join(REPO, 'profiles/eval/presets/cordis.patch.yml'), 'utf8')
const BUNDLE_EVAL = readFileSync(join(REPO, 'packages/bundle-eval/cordis.patch.yml'), 'utf8')

describe('eval presets: eval pack bundle (canonical) and the eval mode pack carry one composition', () => {
  it('preset-dsh-eval composes exactly what preset-eval does', () => {
    const web = rowLines(EVAL_PACK, 'preset-eval')
    const ours = rowLines(BUNDLE_EVAL, 'preset-dsh-eval')
    expect(composition(ours)).toEqual(composition(web))
    expect(field(ours, 'name')).toBe(field(web, 'name'))
    expect(field(ours, 'description')).toBe(field(web, 'description'))
  })

  it('no side declares the retired 题集整理 preset (T102)', () => {
    for (const patch of [EVAL_PACK, BUNDLE_EVAL]) {
      expect(patch).not.toContain('    - id: preset-dataset-authoring')
      expect(patch).not.toMatch(/^ {8}id: dataset-authoring$/m)
    }
  })

  it('the normalizer sees the rows that matter (guards against comparing two empty lists)', () => {
    const evalRows = composition(rowLines(BUNDLE_EVAL, 'preset-dsh-eval')).join('\n')
    expect(evalRows).toContain("- id: eval-tool\n            name: @khorsheed/dsh-eval/tool")
    expect(evalRows).toContain('Registered datasets are exactly what datasets_list returns')
    expect(evalRows).toContain('Load the dataset-authoring skill')
    expect(evalRows).toContain("- id: tool-bash\n            name: @deepseek-ai/dsh-tool-bash")
    expect(evalRows).toContain('              tools: organize')
  })
})
