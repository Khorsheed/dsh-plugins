/**
 * T80d · P1-4 — the 对比组 table lists the fields the subjects DISAGREE on,
 * read off the rows themselves, so what is highlighted is what is on screen.
 */
import { describe, expect, it } from 'vitest'
import { compareColumns, condIdHover } from '../src/client/ConditionsPage.tsx'
import type { EvalConditionRow } from '../src/types.ts'

const row = (over: Partial<EvalConditionRow>): EvalConditionRow => ({
  id: 'c',
  harness: 'dsh',
  drive: 'exec',
  model: 'deepseek-v4-flash',
  endpoint: 'default',
  scope: null,
  preset: null,
  sha: null,
  lock: { present: true, matches: true, homeSha: null, provisionedAt: null, cliVersion: null },
  status: 'ready',
  unresolved: [],
  errors: [],
  warnings: [],
  ...over,
})

const shown = (rows: EvalConditionRow[]) => compareColumns(rows).map(column => `${column.key}${column.differs ? '*' : ''}`)

describe('compareColumns', () => {
  it('shows only the differing fields, marked', () => {
    expect(shown([row({ id: 'a' }), row({ id: 'b', model: 'other-model' })])).toEqual(['model*'])
    expect(shown([row({ id: 'a' }), row({ id: 'b', harness: 'claude', scope: 'ws' })])).toEqual(['harness*', 'scope*'])
  })

  it('keeps an unset endpoint on screen, because that cell is where it gets fixed', () => {
    expect(shown([row({ id: 'a' }), row({ id: 'b', model: 'm2', endpoint: null })])).toEqual(['model*', 'endpoint*'])
    expect(shown([row({ id: 'a', endpoint: null }), row({ id: 'b', endpoint: null, preset: 'p' })])).toEqual(['endpoint', 'preset*'])
  })

  it('falls back to harness and model when nothing differs, or there is one row', () => {
    expect(shown([row({ id: 'a' }), row({ id: 'b' })])).toEqual(['harness', 'model'])
    expect(shown([row({ id: 'a', endpoint: null })])).toEqual(['harness', 'model', 'endpoint'])
  })
})

describe('condIdHover', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`)

  it('is the declaration sha, plus the scoped-home digest once a lock recorded one', () => {
    expect(condIdHover(row({ id: 'a' }), t as never)).toBe('a')
    expect(condIdHover(row({ id: 'a', sha: 'abc' }), t as never)).toBe('abc')
    expect(condIdHover(row({ id: 'a', sha: 'abc', lock: { present: true, matches: true, homeSha: 'h1', provisionedAt: null, cliVersion: null } }), t as never))
      .toBe('abc\nconditions.homeShaHover {"sha":"h1"}')
  })
})
