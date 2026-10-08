/**
 * The sidebar's own judging: choice keys in their three spellings, fill-in
 * alternatives, and the looseness that must not decide an answer.
 */
import { describe, expect, it } from 'vitest'
import { choiceIndex, fillMatches } from '../src/client/judge.ts'

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
