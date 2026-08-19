import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MissionService } from '../src/service.ts'
import { lintTemplate, parseTemplate, SIMPLE_TEMPLATE } from '../src/template.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-template-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('template parse/validate', () => {
  it('rejects undeclared states, duplicates, and multi-initial machines', () => {
    expect(() => parseTemplate({ states: ['a'], transitions: [{ from: 'a', to: 'b' }] }, 't')).toThrow(/not a declared state/)
    expect(() => parseTemplate({ states: ['a', 'a'], transitions: [] }, 't')).toThrow(/duplicate/)
    expect(() => parseTemplate({ states: ['a', 'b'], transitions: [] }, 't')).toThrow(/initial states/)
    expect(() => parseTemplate({ states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }, 't'))
      .toThrow(/no initial state/)
    expect(() => parseTemplate({ states: ['a'], transitions: [{ from: 'a', to: 'a', guard: { type: 'nope' } }] }, 't'))
      .toThrow(/unknown guard type/)
  })

  it('accepts both nested stateMachine and flattened top-level forms', () => {
    const flat = parseTemplate({ states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }], releasableStates: ['b'] }, 'flat')
    const nested = parseTemplate({ stateMachine: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }], releasableStates: ['b'] } }, 'nested')
    expect(flat.stateMachine).toEqual(nested.stateMachine)
  })

  it('rejects template missions depending on unknown ids', () => {
    expect(() => parseTemplate({
      states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }],
      missions: [{ id: 'x', dependsOn: ['ghost'] }],
    }, 't')).toThrow(/not a mission of this template/)
  })
})

describe('run lint', () => {
  it('the built-in simple template lints clean', () => {
    const result = lintTemplate(SIMPLE_TEMPLATE)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('errors when a transition enters a releasable state without a guard', () => {
    const template = parseTemplate({
      states: ['work', 'releasable', 'released'],
      transitions: [
        { from: 'work', to: 'releasable' },
        { from: 'releasable', to: 'released' },
      ],
      releasableStates: ['releasable'],
    }, 't')
    const result = lintTemplate(template)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/without a guard/)
  })

  it('warns when a terminal bypasses every releasable state', () => {
    const template = parseTemplate({
      states: ['work', 'releasable', 'released', 'dropped'],
      transitions: [
        { from: 'work', to: 'releasable', guard: { type: 'attested', key: 'ok' } },
        { from: 'releasable', to: 'released' },
        { from: 'work', to: 'dropped' },
      ],
      releasableStates: ['releasable'],
    }, 't')
    const result = lintTemplate(template)
    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/"dropped"/)
  })

  it('errors when a schema-check schema leaves the subset or is missing', () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ type: 'object', patternProperties: {} }))
    const template = parseTemplate({
      states: ['a', 'b'],
      transitions: [
        { from: 'a', to: 'b', guard: { type: 'schema-check', schemaPath: 'bad.json' } },
      ],
    }, 't')
    expect(lintTemplate(template, dir).errors[0]).toMatch(/unsupported keyword/)
    const missing = parseTemplate({
      states: ['a', 'b'],
      transitions: [{ from: 'a', to: 'b', guard: { type: 'schema-check', schemaPath: 'nope.json' } }],
    }, 't')
    expect(lintTemplate(missing, dir).errors[0]).toMatch(/unreadable/)
  })

  it('a lint error refuses run creation', async () => {
    const service = new MissionService(join(dir, 'data'))
    const template = {
      states: ['work', 'releasable'],
      transitions: [{ from: 'work', to: 'releasable' }],
      releasableStates: ['releasable'],
    }
    await expect(service.runCreate({ template })).rejects.toThrow(/failed lint/)
    expect(service.runList()).toEqual([])
  })
})
