/** Read-only JSON Schema presentation. Raw capture remains the lossless fallback. */
import type { InspectorTabProps } from './contract.ts'
import css from './SegmentBlocks.module.css'
type T = InspectorTabProps['t']
export function schemaRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const MAX_DEPTH = 12
const labels = {
  oneOf: 'schema.oneOf', anyOf: 'schema.anyOf', allOf: 'schema.allOf',
  items: 'schema.items', prefixItems: 'schema.prefixItems', additionalItems: 'schema.additionalItems',
  additionalProperties: 'schema.additionalProperties', unevaluatedProperties: 'schema.unevaluatedProperties', unevaluatedItems: 'schema.unevaluatedItems',
  contains: 'schema.contains', not: 'schema.not', if: 'schema.if', then: 'schema.then', else: 'schema.else', propertyNames: 'schema.propertyNames',
  patternProperties: 'schema.patternProperties', dependentSchemas: 'schema.dependentSchemas', $defs: 'schema.definitions', definitions: 'schema.definitions',
  enum: 'schema.enum', const: 'schema.const', default: 'schema.default', examples: 'schema.examples',
  minimum: 'schema.minimum', maximum: 'schema.maximum', exclusiveMinimum: 'schema.exclusiveMinimum', exclusiveMaximum: 'schema.exclusiveMaximum', multipleOf: 'schema.multipleOf',
  minLength: 'schema.minLength', maxLength: 'schema.maxLength', pattern: 'schema.pattern', format: 'schema.format',
  minItems: 'schema.minItems', maxItems: 'schema.maxItems', uniqueItems: 'schema.uniqueItems', minContains: 'schema.minContains', maxContains: 'schema.maxContains',
  minProperties: 'schema.minProperties', maxProperties: 'schema.maxProperties', dependentRequired: 'schema.dependentRequired',
  $ref: 'schema.ref', title: 'schema.title', deprecated: 'schema.deprecated', readOnly: 'schema.readOnly', writeOnly: 'schema.writeOnly',
} as const
const label = (key: string, t: T) => Object.hasOwn(labels, key) ? t(labels[key as keyof typeof labels]) : key
const alternatives = new Set(['oneOf', 'anyOf', 'allOf', 'prefixItems'])
const maps = new Set(['patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const singleSchemas = new Set(['items', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'])
function explicitTypes(value: unknown, depth = 0): string[] | null {
  if (!schemaRecord(value) || depth >= MAX_DEPTH) return null
  if (typeof value.type === 'string') return [value.type]
  if (Array.isArray(value.type) && value.type.length > 0 && value.type.every(x => typeof x === 'string')) return value.type as string[]
  const union = value.oneOf ?? value.anyOf
  if (!Array.isArray(union) || union.length === 0) return null
  const types = union.map(x => explicitTypes(x, depth + 1))
  return types.every(x => x !== null) ? [...new Set(types.flat() as string[])] : null
}
function typeLabel(value: unknown, t: T) {
  if (value === false) return t('schema.never')
  if (value === true) return t('schema.any')
  const types = explicitTypes(value)
  if (types) return types.join(' | ')
  if (schemaRecord(value) && '$ref' in value) return t('schema.reference')
  if (schemaRecord(value) && ['allOf', 'oneOf', 'anyOf'].some(k => k in value)) return t('schema.composite')
  return t('schema.unspecified')
}
/** Unknown keywords and extension values retain their full shape without dumping JSON blocks. */
function ValueTree({ value, depth, t }: { readonly value: unknown; readonly depth: number; readonly t: T }) {
  if (depth >= MAX_DEPTH) return <span>{t('schema.deep')}</span>
  if (Array.isArray(value)) return value.length ? <div className={css.schemaValues}>{value.map((v, i) => <div key={i}><ValueTree value={v} depth={depth + 1} t={t} /></div>)}</div> : <code>[]</code>
  if (schemaRecord(value)) return Object.keys(value).length ? <dl className={css.schemaFacts}>{Object.entries(value).map(([key, v]) => <div key={key}><dt>{key}</dt><dd><ValueTree value={v} depth={depth + 1} t={t} /></dd></div>)}</dl> : <span>{t('schema.emptyObject')}</span>
  return <code>{JSON.stringify(value)}</code>
}
function Constraint({ name, value, depth, t }: { readonly name: string; readonly value: unknown; readonly depth: number; readonly t: T }) {
  if (alternatives.has(name) && Array.isArray(value)) return <div className={css.schemaGroup}>
    <div className={css.schemaCaption}>{label(name, t)}</div>
    <div className={css.schemaChildren}>{value.map((v, i) => <SchemaFields key={i} name={t(name === 'prefixItems' ? 'schema.position' : 'schema.branch', { count: String(i + 1) })} value={v} depth={depth + 1} t={t} />)}</div>
  </div>
  if (maps.has(name) && schemaRecord(value)) return <div className={css.schemaGroup}>
    <div className={css.schemaCaption}>{label(name, t)}</div><div className={css.schemaChildren}>{Object.entries(value).map(([key, v]) => <SchemaFields key={key} name={key} value={v} depth={depth + 1} t={t} />)}</div>
  </div>
  if (['additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems'].includes(name) && typeof value === 'boolean') return <dl className={css.schemaFacts}><div><dt>{label(name, t)}</dt><dd>{t(value ? 'schema.allowed' : 'schema.forbidden')}</dd></div></dl>
  if (singleSchemas.has(name) && (schemaRecord(value) || typeof value === 'boolean')) return <div className={css.schemaChildren}><SchemaFields name={label(name, t)} value={value} depth={depth + 1} t={t} /></div>
  // Older drafts use items arrays for tuples; retain their position, not a union.
  if (name === 'items' && Array.isArray(value)) return <Constraint name="prefixItems" value={value} depth={depth} t={t} />
  return <dl className={css.schemaFacts}><div><dt>{label(name, t)}</dt><dd><ValueTree value={value} depth={depth + 1} t={t} /></dd></div></dl>
}
export function SchemaFields({ name, value, required = false, depth = 0, t }: {
  readonly name?: string; readonly value: unknown; readonly required?: boolean; readonly depth?: number; readonly t: T
}) {
  if (depth >= MAX_DEPTH) return <div className={css.schemaCaption}>{name} · {t('schema.deep')}</div>
  if (!schemaRecord(value) && typeof value !== 'boolean') return <div className={css.schemaCaption}>{name} · {t('schema.unreadable')}</div>
  const fields = schemaRecord(value) ? value : {}
  const properties = schemaRecord(fields.properties) ? fields.properties : null
  const requiredNames = Array.isArray(fields.required) && fields.required.every(x => typeof x === 'string') ? fields.required as string[] : null
  const remainingRequired = requiredNames?.filter(key => !properties || !Object.hasOwn(properties, key)) ?? []
  return <div className={name ? css.parameter : css.schemaRoot}>
    {name ? <div className={css.parameterHead}><code>{name}</code><span>{typeLabel(value, t)}</span>{required && <b>{t('lens.required')}</b>}</div>
      : (!properties || fields.type !== undefined && fields.type !== 'object') && <div className={css.schemaCaption}>{typeLabel(value, t)}</div>}
    {typeof fields.description === 'string' && <div className={css.prose}>{fields.description}</div>}
    {remainingRequired.length > 0 && <Constraint name={t('schema.otherRequired')} value={remainingRequired} depth={depth} t={t} />}
    {Object.entries(fields).filter(([key, v]) => {
      if (key === 'type') return !(typeof v === 'string' || Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string'))
      if (key === 'properties') return !properties
      if (key === 'required') return !requiredNames
      if (key === 'description') return typeof v !== 'string'
      return true
    }).map(([key, v]) => <Constraint key={key} name={key} value={v} depth={depth} t={t} />)}
    {properties && <div className={name ? css.schemaChildren : css.parameters}>{Object.entries(properties).map(([key, v]) => <SchemaFields key={key} name={key} value={v} required={requiredNames?.includes(key) ?? false} depth={depth + 1} t={t} />)}</div>}
  </div>
}
