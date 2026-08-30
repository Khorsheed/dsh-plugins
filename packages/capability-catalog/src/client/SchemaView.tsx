  import { useEffect, useMemo, useState, type ReactNode } from 'react'
  import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CatalogJsonValue, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import css from './CapabilityCatalogCard.module.css'

/** Pretty-print a tool's parameter JSON (or a no-params hint). */
function formatParams(parameters: CatalogToolRow['parameters'], t: (key: CapabilityCatalogKey) => string): string {
  if (parameters === undefined || parameters === null) return t('toolNoParams')
  if (typeof parameters !== 'object') return String(parameters)
  if (Array.isArray(parameters)) return parameters.length === 0 ? t('toolNoParams') : JSON.stringify(parameters, null, 2)
  if (Object.keys(parameters).length === 0) return t('toolNoParams')
  try {
    return JSON.stringify(parameters, null, 2)
  } catch {
    return t('toolNoParams')
  }
}

/** The candidate child schema for a property (array items object, or object with
 * properties) — used to render an expandable nested table. */
function nestedSchemaOf(schema: CatalogJsonValue): CatalogJsonValue | undefined {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (s['type'] === 'array') {
    const items = s['items']
    if (items !== null && typeof items === 'object' && typeof (items as Record<string, unknown>)['properties'] === 'object') {
      return items as CatalogJsonValue
    }
    return undefined
  }
  if (typeof s['properties'] === 'object' && s['properties'] !== null) return schema
  return undefined
}

/** The property entries of an object schema (or null when not tabular). */
function schemaProps(schema: CatalogJsonValue): [string, Record<string, unknown>][] | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null
  const props = (schema as Record<string, unknown>)['properties']
  if (typeof props !== 'object' || props === null) return null
  const entries = Object.entries(props) as [string, Record<string, unknown>][]
  return entries.length > 0 ? entries : null
}

/** The required-name set of an object schema. */
function requiredNames(schema: CatalogJsonValue): Set<string> {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return new Set()
  const required = (schema as Record<string, unknown>)['required']
  return new Set<string>(Array.isArray(required) ? (required as string[]) : [])
}

/** A compact type label (array<itemType> / object / string / …). */
function typeLabel(schema: Record<string, unknown>): string {
  const t = schema['type']
  if (Array.isArray(t)) return (t as string[]).join('|')
  if (t === 'array') {
    const items = schema['items']
    if (items !== null && typeof items === 'object') {
      const it = (items as Record<string, unknown>)['type']
      if (typeof it === 'string') return `array<${it}>`
      if (typeof (items as Record<string, unknown>)['properties'] === 'object') return 'array<object>'
    }
    return 'array'
  }
  if (t === undefined && typeof schema['properties'] === 'object') return 'object'
  return typeof t === 'string' ? t : ''
}

/** True when a property schema carries visible nested children (array-of-object
 * items or object properties). Drives both the chevron and the level gutter. */
function hasNestedKids(schema: Record<string, unknown>): boolean {
  const nested = nestedSchemaOf(schema as CatalogJsonValue)
  return nested !== undefined && schemaProps(nested) !== null
}

/** One property node in the schema tree: a head row (chevron + mono name +
 * required `*` + type chip) with the description on a second line aligned to
 * the name, and nested children inside a guide-lined indent. A parent node's
 * whole head row is the toggle button (big hit target, one focus stop). Levels
 * where NO sibling is expandable drop the chevron gutter entirely, so flat
 * schemas are not indented for nothing. */
function SchemaNode({ name, schema, required, path, gutter, collapsed, onToggle, t }: {
  name: string
  schema: Record<string, unknown>
  required: boolean
  path: string
  gutter: boolean
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  t: (key: CapabilityCatalogKey) => string
}): ReactNode {
  const nested = nestedSchemaOf(schema as CatalogJsonValue)
  const kids = nested === undefined ? null : schemaProps(nested)
  const kidRequired = nested === undefined ? null : requiredNames(nested)
  const open = !collapsed.has(path)
  const type = typeLabel(schema)
  const desc = typeof schema['description'] === 'string' && schema['description'] !== '' ? schema['description'] : undefined
  const head = (
    <>
      <span className={css.schemaName}>{name}</span>
      {required ? <span className={css.schemaReq} title={t('paramRequired')}>*</span> : null}
      {type !== '' ? <span className={css.schemaType}>{type}</span> : null}
    </>
  )
  return (
    <div className={css.schemaNode}>
      {kids !== null ? (
        <button type="button" className={css.schemaHeadBtn} onClick={() => onToggle(path)} aria-expanded={open}>
          <span className={css.schemaChevron}>
            {open ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
          </span>
          {head}
        </button>
      ) : (
        <div className={css.schemaHead}>
          {gutter ? <span className={css.schemaChevronSpacer} /> : null}
          {head}
        </div>
      )}
      {desc !== undefined ? <div className={css.schemaDesc} data-gutter={gutter || undefined}>{desc}</div> : null}
      {kids !== null && open ? (
        <div className={css.schemaKids}>
          {kids.map(([kidName, kidSchema]) => {
            const kidPath = `${path}.${kidName}`
            return (
              <SchemaNode
                key={kidPath}
                name={kidName}
                schema={kidSchema}
                required={kidRequired?.has(kidName) ?? false}
                path={kidPath}
                gutter={kids.some(([, k]) => hasNestedKids(k))}
                collapsed={collapsed}
                onToggle={onToggle}
                t={t}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** The schema tree: one SchemaNode per top-level property. All levels start
 * EXPANDED (state tracks the collapsed set) — the guide lines keep the full
 * hierarchy readable at a glance, and deep MCP schemas collapse per node. */
function SchemaTree({ schema, t }: {
  schema: CatalogJsonValue
  t: (key: CapabilityCatalogKey) => string
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const props = schemaProps(schema)
  if (props === null) return null
  const required = requiredNames(schema)
  return (
    <div className={css.schemaTree}>
      {props.map(([name, p]) => (
        <SchemaNode
          key={name}
          name={name}
          schema={p}
          required={required.has(name)}
          path={name}
          gutter={props.some(([, prop]) => hasNestedKids(prop))}
          collapsed={collapsed}
          onToggle={toggle}
          t={t}
        />
      ))}
    </div>
  )
}

/** Reusable parameter view: a schema tree with a 结构/JSON toggle and a
 * one-click 复制 JSON, falling back to the raw JSON block when the schema is not
 * an object with properties. Used by the (shared) tool detail modal. */
export function SchemaView({ parameters, title, t }: {
  parameters: CatalogJsonValue | undefined
  title?: string
  t: (key: CapabilityCatalogKey) => string
}) {
  const hasTree = parameters !== undefined && parameters !== null && schemaProps(parameters) !== null
  const [view, setView] = useState<'tree' | 'json'>('tree')
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!hasTree) setView('json') }, [hasTree])
  const paramsJson = useMemo(() => formatParams(parameters, t), [parameters, t])
  const copyJson = async (): Promise<void> => {
    if (parameters === undefined || parameters === null) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(parameters, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard may be blocked */ }
  }
  return (
    <div>
      <div className={css.toolParamsHead}>
        {title !== undefined ? <span className={css.toolDetailParamsTitle}>{title}</span> : <span />}
        <span className={css.toolParamsActions}>
          {hasTree ? (
            <span className={css.toolParamsTabs}>
              <button type="button" className={css.toolParamsTab} data-active={view === 'tree'} onClick={() => setView('tree')}>{t('paramsTree')}</button>
              <button type="button" className={css.toolParamsTab} data-active={view === 'json'} onClick={() => setView('json')}>{t('paramsJson')}</button>
            </span>
          ) : null}
          <button
            type="button"
            className={css.toolCopyBtn}
            disabled={parameters === undefined || parameters === null}
            onClick={() => void copyJson()}
          >{copied ? t('copied') : t('copyJson')}</button>
        </span>
      </div>
      {parameters === undefined || parameters === null ? (
        <div className={css.toolParamsEmpty}>{t('toolNoParams')}</div>
      ) : hasTree && view === 'tree' ? (
        <SchemaTree schema={parameters} t={t} />
      ) : (
        <div className={css.toolParamsBody}>{paramsJson}</div>
      )}
    </div>
  )
}
