/**
 * Hand-rolled JSON Schema (draft 2020-12) SUBSET validator for the
 * `schema-check` guard. The subset is deliberate: `type`, `required`,
 * `properties`, `items`, `if`/`then`, `const`, `enum`, `additionalProperties`
 * (plus pass-through annotations `$schema`/`$id`/`title`/`description` and
 * boolean schemas). No dependency (ajv would be one); lint rejects schemas
 * outside the subset so guard execution is deterministic everywhere.
 *
 * Semantics follow draft 2020-12 for the supported keywords; unsupported
 * keywords are not "ignored" — `assertSchemaSubset` refuses them up front, so
 * a schema never silently means less than its author wrote.
 */

/** Keywords the subset honors; anything else fails the subset check. */
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description',
  'type', 'required', 'properties', 'items', 'if', 'then', 'const', 'enum', 'additionalProperties',
])

const JSON_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

type SchemaObject = Record<string, unknown>

function isPlainObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON deep equality (object key order-insensitive). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b)
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEquals(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && jsonEquals(a[k], b[k]))
  }
  return false
}

function checkSchemaNode(schema: unknown, path: string, errors: string[]): void {
  if (typeof schema === 'boolean') return
  if (!isPlainObject(schema)) {
    errors.push(`${path}: schema nodes must be objects or booleans`)
    return
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(`${path}: unsupported keyword ${JSON.stringify(key)} (subset: type/required/properties/items/if/then/const/enum/additionalProperties)`)
    }
  }
  const type = schema['type']
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type]
    if (types.length === 0 || types.some(t => typeof t !== 'string' || !JSON_TYPES.has(t))) {
      errors.push(`${path}.type: must be one (or an array) of ${[...JSON_TYPES].join('/')}`)
    }
  }
  const required = schema['required']
  if (required !== undefined && (!Array.isArray(required) || required.some(r => typeof r !== 'string'))) {
    errors.push(`${path}.required: must be an array of strings`)
  }
  const enumValues = schema['enum']
  if (enumValues !== undefined && (!Array.isArray(enumValues) || enumValues.length === 0)) {
    errors.push(`${path}.enum: must be a non-empty array`)
  }
  const properties = schema['properties']
  if (properties !== undefined) {
    if (!isPlainObject(properties)) {
      errors.push(`${path}.properties: must be an object`)
    } else {
      for (const [key, sub] of Object.entries(properties)) checkSchemaNode(sub, `${path}.properties.${key}`, errors)
    }
  }
  if (schema['items'] !== undefined) checkSchemaNode(schema['items'], `${path}.items`, errors)
  if (schema['if'] !== undefined) checkSchemaNode(schema['if'], `${path}.if`, errors)
  if (schema['then'] !== undefined) checkSchemaNode(schema['then'], `${path}.then`, errors)
  const additional = schema['additionalProperties']
  if (additional !== undefined && typeof additional !== 'boolean') {
    checkSchemaNode(additional, `${path}.additionalProperties`, errors)
  }
}

/**
 * Validate that a schema stays inside the supported subset.
 * @param schema - the parsed schema document.
 * @returns a list of problems; empty means the schema is usable by {@link validateJson}.
 */
export function schemaSubsetProblems(schema: unknown): string[] {
  const errors: string[] = []
  checkSchemaNode(schema, '#', errors)
  return errors
}

/**
 * Throw when a schema leaves the supported subset.
 * @param schema - the parsed schema document.
 * @param origin - where the schema came from, for the error message.
 */
export function assertSchemaSubset(schema: unknown, origin: string): void {
  const problems = schemaSubsetProblems(schema)
  if (problems.length > 0) {
    throw new Error(`mission: schema ${origin} leaves the supported subset:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return 'number'
  return typeof value
}

function matchesType(type: string, value: unknown): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeOf(value) === type
}

function validateNode(schema: unknown, value: unknown, path: string, violations: string[]): void {
  if (typeof schema === 'boolean') {
    if (!schema) violations.push(`${path}: not allowed (false schema)`)
    return
  }
  if (!isPlainObject(schema)) return // subset check already reported this; stay total here

  const type = schema['type']
  if (type !== undefined) {
    const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string')
    if (types.length > 0 && !types.some(t => matchesType(t, value))) {
      violations.push(`${path}: expected type ${types.join('|')}, got ${typeOf(value)}`)
      return // further object/array keywords would only add noise on a mistyped value
    }
  }
  if ('const' in schema && !jsonEquals(schema['const'], value)) {
    violations.push(`${path}: expected const ${JSON.stringify(schema['const'])}`)
  }
  const enumValues = schema['enum']
  if (Array.isArray(enumValues) && enumValues.length > 0 && !enumValues.some(e => jsonEquals(e, value))) {
    violations.push(`${path}: not one of the declared enum values`)
  }
  if (isPlainObject(value)) {
    const required = schema['required']
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key)) {
          violations.push(`${path}: missing required property ${JSON.stringify(key)}`)
        }
      }
    }
    const properties = isPlainObject(schema['properties']) ? schema['properties'] : undefined
    const additional = schema['additionalProperties']
    for (const [key, sub] of Object.entries(value)) {
      const subSchema = properties?.[key]
      if (subSchema !== undefined) {
        validateNode(subSchema, sub, `${path}.${key}`, violations)
      } else if (additional === false) {
        violations.push(`${path}: additional property ${JSON.stringify(key)} is not allowed`)
      } else if (isPlainObject(additional) || typeof additional === 'boolean') {
        validateNode(additional, sub, `${path}.${key}`, violations)
      }
    }
  }
  if (Array.isArray(value) && schema['items'] !== undefined) {
    value.forEach((item, i) => validateNode(schema['items'], item, `${path}[${i}]`, violations))
  }
  if (schema['if'] !== undefined && schema['then'] !== undefined) {
    const ifViolations: string[] = []
    validateNode(schema['if'], value, path, ifViolations)
    if (ifViolations.length === 0) validateNode(schema['then'], value, path, violations)
  }
}

/**
 * Validate a JSON value against a subset schema.
 * @param schema - a schema that passed {@link assertSchemaSubset}.
 * @param value - the JSON value to check.
 * @returns path-qualified violation messages; empty means valid.
 */
export function validateJson(schema: unknown, value: unknown): string[] {
  const violations: string[] = []
  validateNode(schema, value, '$', violations)
  return violations
}
