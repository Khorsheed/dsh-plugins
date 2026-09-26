// @vitest-environment node
/**
 * I5·T67 (walkthrough · W3) — the five tones of ui-spec §九, checked against
 * the stylesheet rather than against a rendered page.
 *
 * The rule is 「绿 = 完成 / 成功，蓝 = 进行中，灰 = 未开始，红 = 失败 / 阻塞，
 * 橙 = 警告」, and what went wrong was not the tone a page CHOSE — every call
 * site asked for `ok` and `busy` correctly — but what those two tones were
 * painted with: `ok` took the brand blue and `busy` took the body label
 * colour, so a finished run rendered blue and a running one grey. No client
 * spec could catch that, because a chip's colour is a token in a stylesheet
 * and jsdom computes neither.
 *
 * So this reads the stylesheet. It also reads the 题集 tab's copy of the same
 * rule: the two tabs carry one chip by hand (§八 — a client bundle never
 * imports a sibling plugin), and a rule kept by hand is a rule that needs a
 * test to keep it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** tone → the token family §九 assigns it. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ['ok', 'state-success'],
  ['busy', 'state-business'],
  ['warn', 'state-warn'],
  ['danger', 'state-error'],
]

const SHEETS: ReadonlyArray<readonly [string, string]> = [
  ['eval', new URL('../src/client/LabView.module.css', import.meta.url).pathname],
  ['datasets', new URL('../../datasets/src/client/DatasetsView.module.css', import.meta.url).pathname],
]

/** The declaration body of one `.chipTag[data-tone='…']` rule. */
function toneRule(css: string, tone: string): string {
  const match = new RegExp(`\\.chipTag\\[data-tone='${tone}'\\]\\s*\\{([^}]*)\\}`).exec(css)
  return match?.[1] ?? ''
}

describe('the chip tones are the five ui-spec §九 names', () => {
  for (const [name, path] of SHEETS) {
    const css = readFileSync(path, 'utf8')

    it(`${name}: each tone uses its own token family`, () => {
      for (const [tone, family] of EXPECTED) {
        expect(toneRule(css, tone), `${name} / ${tone}`).toContain(`--dsw-alias-${family}-`)
      }
    })

    it(`${name}: 完成 is not the brand blue and 进行中 is not a label colour`, () => {
      // The two specific mistakes, named: they are the ones a reader notices
      // first and the ones a plausible token name invites.
      expect(toneRule(css, 'ok')).not.toContain('state-business')
      expect(toneRule(css, 'busy')).not.toContain('alias-label-')
    })

    it(`${name}: names no token the host does not ship (T83)`, () => {
      // Both were referenced for months and resolved to nothing, so the rule
      // fell back to inherit: a second surface with no fill, a danger label in
      // body colour. A missing custom property raises no warning anywhere.
      expect(css).not.toContain('--dsw-alias-bg-l2')
      expect(css).not.toContain('state-danger-label')
    })

    it(`${name}: no local variable is defined as itself (T83)`, () => {
      // `--x: var(--x)` is a cycle, which CSS resolves to the guaranteed-invalid
      // value: every use silently falls back to inherit. A global token rename
      // wrote exactly that into both sheets once.
      const cycles = [...css.matchAll(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)/g)]
        .filter(match => match[1] === match[2])
        .map(match => match[1])
      expect(cycles).toEqual([])
    })

    it(`${name}: 未开始 stays neutral — it takes no state token at all`, () => {
      // `neutral` is the base rule's own colour; a tone rule for it would mean
      // «not started» had been given a state, which is the opposite of grey.
      expect(toneRule(css, 'neutral')).toBe('')
    })
  }
})
