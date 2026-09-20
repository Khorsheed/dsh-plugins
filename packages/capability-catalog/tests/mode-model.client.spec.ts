/**
 * The comparison model: one grid from N mode faces.
 *
 * The two properties worth pinning are the ones a reader would otherwise have
 * to trust: a duplicate capability keeps the DEFAULT mode's row (so a card's
 * prose does not depend on roster order), and a mode that could not be read
 * contributes nothing to the union while still being reported — "this mode
 * cannot be read" must never look like "this mode loads nothing".
 */
import { describe, expect, it } from 'vitest'
import { buildModeComparison, resolveModeChips } from '../src/client/mode-model.ts'
import type { CatalogModeFace, CatalogPresetOption, CatalogSkillRow, CatalogToolRow } from '../src/types.ts'

function skill(name: string, description: string): CatalogSkillRow {
  return { name, description, source: 'runtime', provider: 'p', modelInvocable: true, userInvocable: true }
}

function tool(name: string, description: string): CatalogToolRow {
  return { name, description, channel: 'plugin', confidence: 'exact' }
}

function face(preset: string, options: {
  readonly isDefault?: boolean
  readonly name?: string
  readonly skills?: readonly CatalogSkillRow[]
  readonly tools?: readonly CatalogToolRow[]
  readonly unavailable?: string
} = {}): CatalogModeFace {
  return {
    preset,
    ...options.name === undefined ? {} : { name: options.name },
    isDefault: options.isDefault === true,
    skills: options.skills ?? [],
    tools: options.tools ?? [],
    ...options.unavailable === undefined ? {} : { unavailable: options.unavailable },
  }
}

describe('buildModeComparison', () => {
  it('unions every readable mode and attributes each capability to its modes', () => {
    const comparison = buildModeComparison([
      face('standard', { isDefault: true, name: '标准模式', skills: [skill('a', 'a from standard'), skill('b', 'b')], tools: [tool('t1', 't1')] }),
      face('minimal', { name: '极简模式', skills: [skill('b', 'b from minimal')], tools: [tool('t1', 't1'), tool('t2', 't2')] }),
    ])
    expect(comparison.modes).toBe(2)
    expect(comparison.skills.map(row => row.name)).toEqual(['a', 'b'])
    expect(comparison.tools.map(row => row.name)).toEqual(['t1', 't2'])
    expect(comparison.skillModes.get('b')).toEqual(['standard', 'minimal'])
    expect(comparison.skillModes.get('a')).toEqual(['standard'])
    expect(comparison.toolModes.get('t2')).toEqual(['minimal'])
    expect(comparison.unavailable).toEqual([])
  })

  it('keeps the default mode\'s row for a capability every mode has', () => {
    const comparison = buildModeComparison([
      face('standard', { isDefault: true, skills: [skill('a', 'from standard')] }),
      face('minimal', { skills: [skill('a', 'from minimal')] }),
    ])
    expect(comparison.skills[0]?.description).toBe('from standard')
  })

  it('adopts the default mode\'s row even when its face is read later', () => {
    const comparison = buildModeComparison([
      face('minimal', { skills: [skill('a', 'from minimal')] }),
      face('standard', { isDefault: true, skills: [skill('a', 'from standard')] }),
    ])
    expect(comparison.skills[0]?.description).toBe('from standard')
  })

  it('excludes an unread mode from the union and reports it instead', () => {
    const comparison = buildModeComparison([
      face('standard', { isDefault: true, name: '标准模式', skills: [skill('a', 'a')] }),
      face('broken', { name: '坏模式', unavailable: 'not valid YAML' }),
    ])
    expect(comparison.modes).toBe(1)
    expect(comparison.skills.map(row => row.name)).toEqual(['a'])
    expect(comparison.skillModes.get('a')).toEqual(['standard'])
    expect(comparison.unavailable).toEqual([
      { preset: 'broken', label: '坏模式', reason: 'not valid YAML' },
    ])
  })

  it('falls back to the preset id as the label of an unread mode', () => {
    const comparison = buildModeComparison([face('ghost', { unavailable: 'no standing scope' })])
    expect(comparison.unavailable[0]?.label).toBe('ghost')
    expect(comparison.modes).toBe(0)
    expect(comparison.skills).toEqual([])
  })

  it('is empty for no faces', () => {
    const comparison = buildModeComparison([])
    expect(comparison).toMatchObject({ modes: 0, skills: [], tools: [], unavailable: [] })
  })
})

describe('resolveModeChips', () => {
  const options: readonly CatalogPresetOption[] = [
    { id: 'standard', name: '标准模式', isDefault: true },
    { id: 'minimal', name: '极简模式' },
  ]

  it('labels chips from the roster, in the order given', () => {
    expect(resolveModeChips(['minimal', 'standard'], options)).toEqual([
      { id: 'minimal', label: '极简模式', isDefault: false },
      { id: 'standard', label: '标准模式', isDefault: true },
    ])
  })

  it('labels an id the roster no longer supplies with the id itself', () => {
    expect(resolveModeChips(['retired'], options)).toEqual([{ id: 'retired', label: 'retired', isDefault: false }])
  })

  it('renders nothing for no ids', () => {
    expect(resolveModeChips([], options)).toEqual([])
  })
})
