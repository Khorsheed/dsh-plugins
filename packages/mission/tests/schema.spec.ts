import { describe, expect, it } from 'vitest'
import { assertSchemaSubset, schemaSubsetProblems, validateJson } from '../src/schema.ts'

describe('schema subset validator', () => {
  it('accepts values matching type/required/properties', () => {
    const schema = {
      type: 'object',
      required: ['name', 'count'],
      properties: { name: { type: 'string' }, count: { type: 'integer' } },
    }
    expect(validateJson(schema, { name: 'a', count: 1 })).toEqual([])
    expect(validateJson(schema, { name: 'a' })).toEqual(['$: missing required property "count"'])
    expect(validateJson(schema, { name: 'a', count: 1.5 })).toHaveLength(1)
    expect(validateJson(schema, { name: 3, count: 1 })).toHaveLength(1)
  })

  it('validates arrays with items', () => {
    const schema = { type: 'array', items: { type: 'string' } }
    expect(validateJson(schema, ['a', 'b'])).toEqual([])
    expect(validateJson(schema, ['a', 2])).toEqual(['$[1]: expected type string, got number'])
  })

  it('supports if/then conditional requirements', () => {
    const schema = {
      type: 'object',
      properties: { kind: { type: 'string' } },
      if: { properties: { kind: { const: 'full' } }, required: ['kind'] },
      then: { required: ['detail'] },
    }
    expect(validateJson(schema, { kind: 'full', detail: 'x' })).toEqual([])
    expect(validateJson(schema, { kind: 'full' })).toEqual(['$: missing required property "detail"'])
    expect(validateJson(schema, { kind: 'lite' })).toEqual([])
  })

  it('supports const and enum with deep equality', () => {
    expect(validateJson({ const: { a: [1, 2] } }, { a: [1, 2] })).toEqual([])
    expect(validateJson({ const: { a: [1, 2] } }, { a: [2, 1] })).toHaveLength(1)
    expect(validateJson({ enum: ['x', 'y'] }, 'y')).toEqual([])
    expect(validateJson({ enum: ['x', 'y'] }, 'z')).toHaveLength(1)
  })

  it('honors additionalProperties (false and schema forms)', () => {
    const closed = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }
    expect(validateJson(closed, { a: 'x' })).toEqual([])
    expect(validateJson(closed, { a: 'x', b: 1 })).toEqual(['$: additional property "b" is not allowed'])
    const typed = { type: 'object', additionalProperties: { type: 'number' } }
    expect(validateJson(typed, { a: 1, b: 2 })).toEqual([])
    expect(validateJson(typed, { a: 'no' })).toHaveLength(1)
  })

  it('supports boolean schemas and type unions', () => {
    expect(validateJson(true, 42)).toEqual([])
    expect(validateJson(false, 42)).toHaveLength(1)
    expect(validateJson({ type: ['string', 'null'] }, null)).toEqual([])
    expect(validateJson({ type: 'integer' }, 3)).toEqual([])
    expect(validateJson({ type: 'integer' }, 3.5)).toHaveLength(1)
  })

  it('rejects schemas outside the subset', () => {
    expect(schemaSubsetProblems({ type: 'string', pattern: '^a' })).toHaveLength(1)
    expect(schemaSubsetProblems({ properties: { a: { minimum: 3 } } })).toHaveLength(1)
    expect(schemaSubsetProblems({ $ref: '#/definitions/x' })).toHaveLength(1)
    expect(schemaSubsetProblems({ type: 'object' })).toEqual([])
    expect(schemaSubsetProblems({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'null' })).toEqual([])
    expect(() => assertSchemaSubset({ anyOf: [] }, 'test.json')).toThrow(/unsupported keyword/)
  })
})
