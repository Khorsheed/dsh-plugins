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
