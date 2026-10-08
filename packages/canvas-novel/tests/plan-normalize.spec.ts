/**
 * The chapter plan's tolerant read: a cast row whose description was packed
 * into who (role left empty) is split back into the name and what they do.
 */
import { describe, expect, it } from 'vitest'
import { normalizePlan } from '../src/types.ts'

describe('normalizePlan cast rows', () => {
  it('splits a bracketed description out of who when role is empty', () => {
    const plan = normalizePlan({
      summary: '做梦者察觉异常。',
      cast: [
        { who: '做梦者（身份由情节逐步揭示，普通身份但数据敏感）' },
        { who: '制造者系统(无名 AI，不直接出现)' },
        { who: '老周（钟表匠）', role: '修表时说漏了嘴' },
        { who: '阿青' },
      ],
    })
    expect(plan?.cast).toEqual([
      { who: '做梦者', role: '身份由情节逐步揭示，普通身份但数据敏感' },
      { who: '制造者系统', role: '无名 AI，不直接出现' },
      { who: '老周（钟表匠）', role: '修表时说漏了嘴' },
      { who: '阿青' },
    ])
  })
})
