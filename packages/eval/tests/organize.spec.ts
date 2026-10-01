/** 「让 Agent 组织」's pure half (T87): the request, the name rule, the placeholder filter. */
import { describe, expect, it } from 'vitest'
import { CONDITION_ID_RE } from '../src/contract/schema.ts'
import { buildOrganizeRequest, checkExperimentName, EXPERIMENT_NAME_RE, visibleItems } from '../src/client/organize.ts'
import { en, zh } from '../src/client/locales.ts'
import type { EvalKey } from '../src/client/locales.ts'

const echo = (key: EvalKey, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

/** The real dictionary, with `{name}` placeholders filled — what a person reads. */
function dictionary(table: Record<EvalKey, string>) {
  return (key: EvalKey, params?: Record<string, unknown>) =>
    table[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))
}

describe('buildOrganizeRequest', () => {
  it('name only: everything else is an open question, in order, then the four defaults and the draft-only close', () => {
    expect(buildOrganizeRequest({ name: ' sidebar ' }, echo).split('\n')).toEqual([
      'organize.intro',
      '',
      'organize.settledHeading',
      '- organize.settled.name {"name":"sidebar"}',
      '',
      'organize.openHeading',
      '1. organize.open.question',
      '2. organize.open.dataset',
      '3. organize.open.items',
      '4. organize.open.conditions',
      '5. organize.open.judge',
      '6. organize.open.reps',
      '7. organize.open.budget',
      '',
      'organize.defaults',
      'organize.finish',
    ])
  })

  it('chosen fields are settled and no longer asked; the question is kept on one line', () => {
    const text = buildOrganizeRequest(
      { name: 'room', question: '协作空间\n  好不好用', dataset: 'reg/ds', items: ['F2', 'F3'] },
      echo,
    )
    expect(text).toContain('- organize.settled.question {"question":"协作空间 好不好用"}')
    expect(text).toContain('- organize.settled.dataset {"dataset":"reg/ds"}')
    expect(text).toContain('- organize.settled.items {"items":"F2organize.joinF3"}')
    expect(text).not.toMatch(/organize\.open\.(question|dataset|items)/)
    // The four that always get a suggestion stay open even on a full form.
    expect(text).toContain('1. organize.open.conditions')
    expect(text).toContain('4. organize.open.budget')
  })

  it('选题 (T90): all / random settle the items and quote the selection argument verbatim', () => {
    const all = buildOrganizeRequest(
      { name: 'r', dataset: 'reg/ds', selection: { mode: 'all', pool: 12, includePlaceholders: false } }, echo,
    )
    expect(all).toContain(`- organize.settled.all ${JSON.stringify({ count: 12, arg: '{"mode":"all"}' })}`)
    expect(all).not.toContain('organize.open.items')

    const random = buildOrganizeRequest({
      name: 'r', dataset: 'reg/ds', selection: { mode: 'random', count: 3, seed: 42, pool: 12, includePlaceholders: true },
    }, echo)
    expect(random).toContain(`- organize.settled.randomWithPlaceholders ${JSON.stringify({
      count: 3, seed: 42, pool: 12, arg: '{"mode":"random","count":3,"seed":42,"include_placeholders":true}',
    })}`)

    // A pick of nothing is not a choice: the items stay open for the agent.
    const none = buildOrganizeRequest({ name: 'r', dataset: 'reg/ds', selection: { mode: 'pick', items: [] } }, echo)
    expect(none).toContain('organize.open.items')
    // Without a set, a selection means nothing.
    expect(buildOrganizeRequest({ name: 'r', selection: { mode: 'all', pool: 1, includePlaceholders: false } }, echo))
      .toContain('organize.open.items')
  })

  it('选题 lines read cleanly in both languages and carry the tool argument', () => {
    for (const table of [zh, en]) {
      const text = buildOrganizeRequest({
        name: 'x1', dataset: 'reg/ds', selection: { mode: 'random', count: 2, seed: 9, pool: 5, includePlaceholders: false },
      }, dictionary(table as Record<EvalKey, string>))
      expect(text).toContain('{"mode":"random","count":2,"seed":9}')
      expect(text).not.toMatch(/\{\w+\}/)
    }
  })

  it('reads as a request in both languages, drafts with eval_plan_draft and says not to start', () => {
    for (const table of [zh, en]) {
      const text = buildOrganizeRequest({ name: 'x1' }, dictionary(table as Record<EvalKey, string>))
      expect(text).toContain('x1')
      expect(text).toContain('eval_plan_draft')
      expect(text).not.toMatch(/\{\w+\}/)
    }
    const zhText = buildOrganizeRequest({ name: 'x1' }, dictionary(zh as Record<EvalKey, string>))
    expect(zhText).toContain('不要启动')
    expect(zhText).toContain('次数（默认 1 次）')
  })
})

describe('checkExperimentName', () => {
  it('is eval_plan_draft\'s own rule', () => {
    expect(EXPERIMENT_NAME_RE.source).toBe(CONDITION_ID_RE.source)
    expect(EXPERIMENT_NAME_RE.flags).toBe(CONDITION_ID_RE.flags)
  })

  it('names the broken part', () => {
    expect(checkExperimentName('sidebar-vs.inline_2')).toEqual({ ok: true })
    expect(checkExperimentName('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(checkExperimentName('.hidden')).toEqual({ ok: false, reason: 'start' })
    expect(checkExperimentName('_x')).toEqual({ ok: false, reason: 'start' })
    expect(checkExperimentName('a b/c b')).toEqual({ ok: false, reason: 'chars', bad: [' ', '/'] })
    expect(checkExperimentName('侧栏')).toEqual({ ok: false, reason: 'chars', bad: ['侧', '栏'] })
  })
})

describe('visibleItems', () => {
  const items = [
    { id: 'P0-placeholder', title: null, stages: null, placeholder: true },
    { id: 'F2', title: 'room', stages: 4, placeholder: false },
  ]
  it('hides placeholders unless asked, keeping the set\'s order', () => {
    expect(visibleItems(items, false).map(item => item.id)).toEqual(['F2'])
    expect(visibleItems(items, true).map(item => item.id)).toEqual(['P0-placeholder', 'F2'])
  })
})
