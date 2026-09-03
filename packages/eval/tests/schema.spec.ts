import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONDITION_SCHEMA,
  EXPECTED_NS_VALUES,
  LOCK_SCHEMA,
  PERMISSIONS_BY_HARNESS,
  PERMISSION_VALUES,
  PLAN_SCHEMA,
  VERDICT_SCHEMA,
  jsonEquals,
  schemaSubsetProblems,
  validateJson,
} from '../src/schema.ts'
import { conditionDiagnostics } from '../src/validate.ts'

const T1_CONDITION = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/dataset/datasets/harness-comparison/conditions/dsh-exec.json'), 'utf8'),
) as unknown

describe('contract schemas', () => {
  it('all four stay inside the supported JSON Schema subset', () => {
    for (const schema of [CONDITION_SCHEMA, PLAN_SCHEMA, VERDICT_SCHEMA, LOCK_SCHEMA]) {
      expect(schemaSubsetProblems(schema)).toEqual([])
    }
  })

  it('the permission vocabulary covers exactly the four harness families', () => {
    expect(Object.keys(PERMISSIONS_BY_HARNESS).sort()).toEqual(['claude-code', 'codex', 'dsh', 'kimi'])
    expect(PERMISSION_VALUES).toEqual([
      'auto-approve', 'danger-full-access', 'normal', 'read-only', 'skip', 'unrestricted', 'workspace-write',
    ])
    for (const words of Object.values(PERMISSIONS_BY_HARNESS)) {
      expect(words.length).toBeGreaterThan(0)
      for (const word of words) expect(PERMISSION_VALUES).toContain(word)
    }
  })

  it('expectedNs names the three verdict sources', () => {
    expect([...EXPECTED_NS_VALUES].sort()).toEqual(['human-final', 'llm-draft', 'script'])
  })
})

describe('validateJson', () => {
  it('accepts the T1 example against the condition schema', () => {
    expect(validateJson(CONDITION_SCHEMA, T1_CONDITION)).toEqual([])
  })

  it('rejects additional properties (the hash shape is closed)', () => {
    const extra = structuredClone(T1_CONDITION) as Record<string, unknown>
    extra['template'] = 'should-not-be-here'
    expect(validateJson(CONDITION_SCHEMA, extra)).toContain('$: additional property "template" is not allowed')
  })

  it('rejects a wrong schema id and a permissions value outside the union', () => {
    const wrongSchema = { ...structuredClone(T1_CONDITION), schema: 'dataseek.condition/2' }
    expect(validateJson(CONDITION_SCHEMA, wrongSchema)).toContain('$.schema: expected const "dataseek.condition/1"')
    const badPerms = { ...structuredClone(T1_CONDITION), permissions: 'yolo' }
    expect(validateJson(CONDITION_SCHEMA, badPerms)).toContain('$.permissions: not one of the declared enum values')
  })

  it('reports missing required properties with a path', () => {
    const missing = structuredClone(T1_CONDITION) as Record<string, unknown>
    delete missing['permissions']
    expect(validateJson(CONDITION_SCHEMA, missing)).toContain('$: missing required property "permissions"')
  })

  it('accepts nullable typed fields ([\"string\",\"null\"]) with null values', () => {
    const nullHome = structuredClone(T1_CONDITION) as Record<string, unknown>
    expect(validateJson(CONDITION_SCHEMA, nullHome)).toEqual([]) // home.sha is already null
  })
})

describe('conditionDiagnostics', () => {
  it('lists the four nullable fields as unresolved warnings on the T1 example', () => {
    const { errors, warnings } = conditionDiagnostics(T1_CONDITION)
    expect(errors).toEqual([])
    expect(warnings.map(w => w.code)).toEqual([
      'UNRESOLVED_FIELD', 'UNRESOLVED_FIELD', 'UNRESOLVED_FIELD', 'UNRESOLVED_FIELD',
    ])
    expect(warnings.map(w => w.message)).toEqual([
      expect.stringContaining('harness.version'),
      expect.stringContaining('model.declared'),
      expect.stringContaining('model.endpoint'),
      expect.stringContaining('home.sha'),
    ])
  })

  it('errors on a permission word from another harness\'s vocabulary', () => {
    const dshWithClaudeWord = { ...structuredClone(T1_CONDITION), permissions: 'skip' }
    const { errors } = conditionDiagnostics(dshWithClaudeWord)
    expect(errors).toEqual([{ code: 'PERMISSION_NOT_FOR_HARNESS', message: expect.stringContaining('dsh vocabulary') }])
  })

  it('errors on a permission word outside the schema enum (the union)', () => {
    const unknown = { ...structuredClone(T1_CONDITION), permissions: 'yolo' }
    expect(conditionDiagnostics(unknown).errors).toEqual([
      { code: 'CONDITION_SCHEMA', message: '$.permissions: not one of the declared enum values' },
    ])
  })

  it('degrades to the union check for an unknown harness name', () => {
    const future = { ...structuredClone(T1_CONDITION), harness: { ...structuredClone(T1_CONDITION).harness, name: 'future-cli' } }
    expect(conditionDiagnostics(future).errors).toEqual([])
  })

  it('errors on a malformed home.sha', () => {
    const bad = structuredClone(T1_CONDITION) as Record<string, unknown>
    ;(bad['home'] as Record<string, unknown>)['sha'] = 'not-a-hash'
    expect(conditionDiagnostics(bad).errors).toEqual([
      { code: 'SHA_FORMAT', message: expect.stringContaining('64-hex') },
    ])
  })

  it('accepts a fully resolved condition without warnings', () => {
    const resolved = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/protocol/condition.example.json'), 'utf8'),
    ) as unknown
    expect(conditionDiagnostics(resolved)).toEqual({ errors: [], warnings: [] })
  })
})

describe('jsonEquals', () => {
  it('is key-order-insensitive and number-strict', () => {
    expect(jsonEquals({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 })).toBe(true)
    expect(jsonEquals(1, 1.0)).toBe(true)
    expect(jsonEquals(1, '1')).toBe(false)
    expect(jsonEquals(null, undefined)).toBe(false)
  })
})
