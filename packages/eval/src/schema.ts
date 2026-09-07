/**
 * The eval contract module — everything schema-shaped lives here.
 *
 * Four schema documents (`dataseek.condition/1`, `dataseek.plan/1`,
 * `dataseek.verdict/1`, `dataseek.condition-lock/1`), the permission
 * vocabularies, and the hand-rolled JSON Schema (draft 2020-12) SUBSET
 * validator they are checked with. The same schema documents are published
 * verbatim in `docs/dataset-authoring-protocol.md` §6; tests pin doc and code
 * against drift, and the protocol's JSON examples double as validator
 * fixtures.
 *
 * The validator mirrors `mission/src/schema.ts` keyword-for-keyword (same
 * supported subset, same early-return shape). It is deliberately duplicated
 * rather than imported: community plugins never import sibling @khorsheed
 * packages, and stage schemas written for this contract are consumed by
 * mission's schema-check guard at run time — a divergence between the two
 * validators would make validate() promise something the guard then refuses.
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
 * @param schema - a schema that passed {@link schemaSubsetProblems}.
 * @param value - the JSON value to check.
 * @returns path-qualified violation messages; empty means valid.
 */
export function validateJson(schema: unknown, value: unknown): string[] {
  const violations: string[] = []
  validateNode(schema, value, '$', violations)
  return violations
}

// ---------------------------------------------------------------------------
// The contract schemas. These exact documents are published in the
// dataset-authoring protocol §6; a change here is a protocol revision.
// ---------------------------------------------------------------------------

export const CONDITION_SCHEMA_ID = 'dataseek.condition/1'
export const PLAN_SCHEMA_ID = 'dataseek.plan/1'
export const VERDICT_SCHEMA_ID = 'dataseek.verdict/1'
export const LOCK_SCHEMA_ID = 'dataseek.condition-lock/1'

/**
 * The permission vocabulary per harness (frozen decision 3: sandboxing is the
 * container boundary; each CLI's own permission word is pinned per condition).
 * An unknown harness name gets the union check only — degrade, don't explode.
 */
export const PERMISSIONS_BY_HARNESS: Readonly<Record<string, readonly string[]>> = {
  dsh: ['unrestricted'],
  'claude-code': ['skip', 'normal'],
  codex: ['danger-full-access', 'workspace-write', 'read-only'],
  kimi: ['auto-approve'],
}

/** Every word any harness accepts; the schema-level enum. */
export const PERMISSION_VALUES: readonly string[] =
  [...new Set(Object.values(PERMISSIONS_BY_HARNESS).flat())].sort()

/** The three verdict sources a run may expect (mission annotation namespaces). */
export const EXPECTED_NS_VALUES: readonly string[] = ['script', 'llm-draft', 'human-final']

/**
 * Condition fields whose value may be `null`, meaning "not resolved yet" —
 * validate lists them as warnings; the pre-run readiness gate refuses them.
 */
export const CONDITION_NULLABLE_FIELDS: readonly string[] =
  ['harness.version', 'model.declared', 'model.endpoint', 'home.sha']

/** sha256 hex output, lowercase. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** Condition ids double as file names (`conditions/<id>.json`). */
export const CONDITION_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i

export const CONDITION_SCHEMA: SchemaObject = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  title: CONDITION_SCHEMA_ID,
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'harness', 'model', 'reasoning', 'permissions', 'instructions', 'preset', 'skills', 'home', 'env'],
  properties: {
    schema: { const: CONDITION_SCHEMA_ID },
    harness: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'version', 'drive'],
      description: 'The harness under test. version: null while undetected; drive: exec only (frozen decision 2).',
      properties: {
        name: { type: 'string' },
        version: { type: ['string', 'null'] },
        drive: { enum: ['exec'] },
      },
    },
    model: {
      type: 'object',
      additionalProperties: false,
      required: ['declared', 'endpoint'],
      description: 'The declared model and endpoint. null while unresolved; the orchestrator reads back what actually served (frozen decision 5).',
      properties: {
        declared: { type: ['string', 'null'] },
        endpoint: { type: ['string', 'null'] },
      },
    },
    reasoning: {
      type: 'object',
      additionalProperties: false,
      required: ['effort'],
      description: 'Reasoning effort, pinned explicitly per harness (frozen decision 4).',
      properties: { effort: { type: 'string' } },
    },
    permissions: {
      enum: [...PERMISSION_VALUES],
      description: 'The harness permission word; each harness accepts a subset of this union (protocol §6.2).',
    },
    instructions: {
      type: 'string',
      description: 'System-instruction posture; "none" keeps the harness default.',
    },
    preset: {
      type: ['string', 'null'],
      description: 'A named preset the condition runs under, or null for none.',
    },
    skills: {
      type: 'object',
      additionalProperties: false,
      required: ['pack'],
      description: 'The skill pack materialized into the condition\'s environment, or null for none.',
      properties: { pack: { type: ['string', 'null'] } },
    },
    home: {
      type: 'object',
      additionalProperties: false,
      required: ['sha'],
      description: 'sha of the scoped home\'s config content (see the protocol hash rules); null while not provisioned.',
      properties: { sha: { type: ['string', 'null'] } },
    },
    env: {
      type: 'object',
      additionalProperties: false,
      required: ['keys'],
      description: 'Environment variable NAMES the condition injects — never values.',
      properties: { keys: { type: 'array', items: { type: 'string' } } },
    },
    notes: {
      type: 'string',
      description: 'Review commentary; excluded from the condition hash (a comment edit is not a new factor).',
    },
  },
}

export const PLAN_SCHEMA: SchemaObject = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  title: PLAN_SCHEMA_ID,
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'dataset', 'conditions', 'reps', 'stages', 'order', 'budget', 'expectedNs'],
  properties: {
    schema: { const: PLAN_SCHEMA_ID },
    dataset: {
      type: 'object',
      additionalProperties: false,
      required: ['repo', 'commit', 'id', 'items'],
      description: 'What is being tested against. commit: null means the snapshot pins it at run start.',
      properties: {
        repo: { type: 'string' },
        commit: { type: ['string', 'null'] },
        id: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
    },
    conditions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Condition IDs (file names), not hashes; hashes resolve from conditions/<id>.lock.json.',
    },
    reps: {
      type: 'integer',
      description: 'Independent samples per cell; each rep is its own mission.',
    },
    stages: {
      type: 'array',
      items: { type: 'string' },
      description: 'Stage names, each backed by schemas/<stage>.json.',
    },
    order: {
      type: 'object',
      additionalProperties: false,
      required: ['seed', 'interleave'],
      description: 'Execution order; the seed is recorded with the run (frozen decision 11).',
      properties: {
        seed: { type: 'integer' },
        interleave: { type: 'boolean' },
      },
    },
    budget: {
      type: 'object',
      additionalProperties: false,
      required: ['activeMinutes', 'turns'],
      description: 'Per-cell budget in active minutes (not wall clock) and delegation turns.',
      properties: {
        activeMinutes: { type: 'number' },
        turns: { type: 'integer' },
      },
    },
    judge: {
      type: 'object',
      additionalProperties: false,
      required: ['conditions', 'samples'],
      description: 'Optional. The judge is itself a condition; absent judge means no LLM judging this run.',
      properties: {
        conditions: { type: 'array', items: { type: 'string' } },
        samples: { type: 'integer' },
      },
    },
    expectedNs: {
      type: 'array',
      items: { enum: [...EXPECTED_NS_VALUES] },
      description: 'Verdict sources this run expects; the report marks the missing ones honestly.',
    },
    retry: {
      type: 'object',
      additionalProperties: false,
      required: ['infrastructure'],
      description: 'Optional. Per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts). Run-call options may override.',
      properties: {
        infrastructure: { type: 'integer', description: 'Maximum infrastructure retries per cell; 0 disables retrying. Default 1.' },
      },
    },
    exports: {
      type: 'string',
      description: 'Optional. Bundle export directory (~/… allowed); default <dataset repo>/exports. Run-call options may override.',
    },
    notes: {
      type: 'string',
      description: 'Review commentary; not part of any hash.',
    },
  },
}

export const VERDICT_SCHEMA: SchemaObject = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  title: VERDICT_SCHEMA_ID,
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'task', 'criterion', 'pass', 'evidence', 'by'],
  properties: {
    schema: { const: VERDICT_SCHEMA_ID },
    task: { type: 'string' },
    criterion: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string', description: 'A checkable fact, not an opinion.' },
    by: { type: 'string', description: 'Where the verdict came from: probe path, judge condition, or the judge bench.' },
  },
}

export const LOCK_SCHEMA: SchemaObject = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  title: LOCK_SCHEMA_ID,
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'condition', 'sha'],
  properties: {
    schema: { const: LOCK_SCHEMA_ID },
    condition: { type: 'string', description: 'The condition id this lock was computed from.' },
    sha: { type: 'string', description: 'The condition hash at lock time; plans resolve their shas here.' },
    home: {
      type: 'object',
      additionalProperties: false,
      required: ['sha'],
      description: 'Present once provision has materialized the scoped home.',
      properties: { sha: { type: 'string' } },
    },
  },
}
