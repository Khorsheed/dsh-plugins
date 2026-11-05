import { describe, expect, it } from 'vitest'
import { searchSettings, suspectedSettingDuplicate } from '../src/settings.ts'
import type { RuleView } from '../src/types.ts'

function rule(cardId: string, name: string, sort: RuleView['sort'] = 'faction', text = `${name}的详细设定`): RuleView {
  return { cardId, ref: `w${cardId}`, role: 'world', name, sort, text, status: 'kept' }
}

const RULES = [
  rule('1', '微系'),
  rule('2', '乌托邦'),
  rule('3', '三板斧信息科技有限公司'),
  rule('4', '钟楼', 'place', '钟楼立在两层梦之间'),
  { ...rule('5', '旧档案', 'system'), status: 'archived' as const },
]

describe('setting search and duplicate suspicion', () => {
  it('searches by kind, name and content, and reads refs in full without archived cards', () => {
    expect(searchSettings(RULES, { query: '三板斧', kind: '势力' }).map(hit => hit.rule.ref)).toEqual(['w3'])
    expect(searchSettings(RULES, { query: '两层梦' }).map(hit => hit.rule.ref)).toEqual(['w4'])
    expect(searchSettings(RULES, { refs: ['w2', 'w5'] }).map(hit => hit.rule.ref)).toEqual(['w2'])
    expect(searchSettings(RULES, { kind: '地点' }).map(hit => hit.rule.ref)).toEqual(['w4'])
  })

  it('flags containment and combined names, but does not invent a fuzzy company match', () => {
    expect(suspectedSettingDuplicate(RULES, '微系与乌托邦')).toMatchObject({ rule: { cardId: '1' }, candidates: [{ cardId: '1' }, { cardId: '2' }] })
    expect(suspectedSettingDuplicate(RULES, '微系联盟')).toMatchObject({ rule: { cardId: '1' } })
    expect(suspectedSettingDuplicate(RULES, '于心的创业公司')).toBeUndefined()
    expect(suspectedSettingDuplicate(RULES, '甲与乙')?.rule).toBeUndefined()
    expect(suspectedSettingDuplicate(RULES, '甲与乙')?.reason).toContain('独立实体')
  })

  it.each(['微系（工作稿）', '微系(暂定)', ' 微 系 ', '微系。', '微系！'])('does not exclude the normalized equivalent %s', incoming => {
    expect(suspectedSettingDuplicate(RULES, incoming)).toMatchObject({ rule: { cardId: '1' } })
    expect(suspectedSettingDuplicate(RULES, incoming)?.reason).toContain('规范化')
  })

  it('treats ASCII case and punctuation as equivalent without inferring aliases', () => {
    const rules = [rule('6', 'Micro-Soft（草稿）')]
    expect(suspectedSettingDuplicate(rules, 'micro soft')).toMatchObject({ rule: { cardId: '6' } })
    expect(suspectedSettingDuplicate(rules, '微软')).toBeUndefined()
  })
})
