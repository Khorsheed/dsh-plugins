/**
 * The sidebar's own judging: choice keys in their three spellings, fill-in
 * alternatives, and the looseness that must not decide an answer.
 */
import { describe, expect, it } from 'vitest'
import { choiceIndex, fillMatches, numericValue } from '../src/client/judge.ts'

const options = ['环绕、包围', '限定、划定界限', '描述、记录', '征服、占领']

describe('choiceIndex', () => {
  it('reads a letter, a lettered option and the option text', () => {
    expect(choiceIndex(options, 'B')).toBe(1)
    expect(choiceIndex(options, 'b. 限定、划定界限')).toBe(1)
    expect(choiceIndex(options, '限定、划定界限')).toBe(1)
    expect(choiceIndex(options, '征服')).toBe(3)
  })

  it('answers -1 for a key that names no option', () => {
    expect(choiceIndex(options, '飞翔')).toBe(-1)
  })
})

describe('fillMatches', () => {
  it('ignores case, width, spacing and a trailing full stop', () => {
    expect(fillMatches(' Instalments. ', 'instalments')).toBe(true)
    expect(fillMatches('ＨＥＬＤ', 'held')).toBe(true)
  })

  it('accepts any listed alternative and nothing else', () => {
    expect(fillMatches('installments', 'instalments / installments')).toBe(true)
    expect(fillMatches('instalment', 'instalments')).toBe(false)
    expect(fillMatches('', 'x')).toBe(false)
  })

  it('folds LaTeX notation onto its plain reading before judging', () => {
    expect(fillMatches('$-2$', '-2')).toBe(true)
    expect(fillMatches('\\sqrt{2}', '√2')).toBe(true)
    expect(fillMatches('(-\\infty, 2) \\cup [3, +\\infty)', '(-∞, 2) ∪ [3, +∞)')).toBe(true)
    expect(fillMatches('x \\le 2', 'x ≤ 2')).toBe(true)
    expect(fillMatches('\\sqrt{4}', '√2')).toBe(false)
  })
})

import { choiceOptions, clozeOf, letterMarks, pickMode, spellMatches } from '../src/client/judge.ts'

const word = (box: number, streak = 0, sentence = 'He was to be paid in instalments.') => ({
  id: 'c', kind: 'word' as const, term: 'instalment', aliases: [], gloss: '分期付款',
  contexts: [{ sentence }], mastery: { box, streak },
})

describe('review modes', () => {
  it('explains concepts, spells known words, alternates cloze and choice', () => {
    expect(pickMode({ ...word(0), kind: 'concept' }, 5)).toBe('explain')
    expect(pickMode(word(3), 5)).toBe('spell')
    expect(pickMode(word(1, 0), 5)).toBe('cloze')
    expect(pickMode(word(1, 1), 5)).toBe('choice')
    expect(pickMode(word(1, 1), 1)).toBe('cloze')
    expect(pickMode(word(0, 0, 'no match here'), 1)).toBe('spell')
  })

  it('blanks the whole inflected word', () => {
    expect(clozeOf('He was to be paid in instalments.', 'instalment')).toEqual({ before: 'He was to be paid in ', after: '.', answer: 'instalments' })
    expect(clozeOf('nothing', 'held')).toBeUndefined()
  })

  it('accepts UK / US spellings and plurals, nothing else', () => {
    expect(spellMatches('installments', ['instalments'])).toBe(true)
    expect(spellMatches('Colour', ['color'])).toBe(true)
    expect(spellMatches('organize', ['organise'])).toBe(true)
    expect(spellMatches('instalment', ['instalments'])).toBe(true)
    expect(spellMatches('instrument', ['instalments'])).toBe(false)
  })

  it('marks letters and builds four options with the answer among them', () => {
    expect(letterMarks('instal', 'instalments')).toEqual([true, true, true, true, true, true])
    expect(letterMarks('insx', 'inst')).toEqual([true, true, true, false])
    const { options, correct } = choiceOptions('举行', ['阁楼', '分期付款', '全盛期', '限定'], () => 0)
    expect(options).toHaveLength(4)
    expect(options[correct]).toBe('举行')
  })
})

describe('fill judging on 3080 answers (2026-10-19)', () => {
  it('a fraction key is one answer, never two alternatives split on its slash', () => {
    expect(fillMatches('1/2', '1/2')).toBe(true)
    expect(fillMatches('1', '1/2')).toBe(false)
    expect(fillMatches('2', '1/2')).toBe(false)
  })

  it('the same number in another notation matches: decimal, \\frac, ½, percent, √ and π', () => {
    expect(fillMatches('0.5', '1/2')).toBe(true)
    expect(fillMatches('\\frac{1}{2}', '1/2')).toBe(true)
    expect(fillMatches('½', '1/2')).toBe(true)
    expect(fillMatches('50%', '1/2')).toBe(true)
    expect(fillMatches('\\frac{\\sqrt{3}}{2}', '√3/2')).toBe(true)
    expect(fillMatches('2π/3', '\\frac{2\\pi}{3}')).toBe(true)
    expect(fillMatches('0.51', '1/2')).toBe(false)
    expect(numericValue('√3/2')).toBeCloseTo(Math.sqrt(3) / 2)
    expect(numericValue('x=2')).toBe(2)
    expect(numericValue('北京')).toBeUndefined()
  })

  it('a multi-blank answer matches part by part, whatever the comma', () => {
    expect(fillMatches('1/2，\\frac{\\sqrt{3}}{2}', '1/2, √3/2')).toBe(true)
    expect(fillMatches('0.5; √3/2', '1/2, √3/2')).toBe(true)
    expect(fillMatches('√3/2, 1/2', '1/2, √3/2')).toBe(false)
  })

  it('alternatives are written spaced " / ", "|" or "或"; wrapping quotes never decide', () => {
    expect(fillMatches('Beijing', '北京 / Beijing')).toBe(true)
    expect(fillMatches('北京', '北京|Beijing')).toBe(true)
    expect(fillMatches('Peking', '北京 或 Peking')).toBe(true)
    expect(fillMatches('「不应期」', '不应期')).toBe(true)
    expect(fillMatches('[-1, 2)', '[-1,2)')).toBe(true)
    expect(fillMatches('(-1, 2)', '[-1,2)')).toBe(false)
  })
})
