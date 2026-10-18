/** A scan-friendly inventory with lossless inline schema inspection. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ToolDefItem } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { fmt } from './aggregate.ts'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import css from './SegmentBlocks.module.css'
type T = InspectorTabProps['t']
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function schema(raw: string) {
  try {
    const value: unknown = JSON.parse(raw)
    if (!record(value) || !record(value.properties)) return null
    const { properties, ...constraints } = value
    return { properties, constraints, required: Array.isArray(value.required) ? value.required : [] }
  } catch { return null }
}
function Parameter({ name, value, required, t }: { readonly name: string; readonly value: unknown; readonly required: boolean; readonly t: T }) {
  const fields = record(value) ? value : {}
  const { type, description, ...rest } = fields
  const typeLabel = typeof type === 'string' ? type : Array.isArray(type) && type.every(x => typeof x === 'string') ? type.join(' | ') : '—'
  // Unknown/non-string metadata stays visible in the constraints, never disappears in a summary.
  const constraints = record(value) ? { ...rest, ...(typeLabel === '—' && type !== undefined ? { type } : {}), ...(description !== undefined && typeof description !== 'string' ? { description } : {}) } : value
  return <div className={css.parameter}>
    <div className={css.parameterHead}><code>{name}</code><span>{typeLabel}</span>{required && <b>{t('lens.required')}</b>}</div>
    {typeof description === 'string' && <div className={css.prose}>{description}</div>}
    {(!record(constraints) || Object.keys(constraints).length > 0) && <pre className={css.pre}>{JSON.stringify(constraints, null, 2)}</pre>}
  </div>
}
function ToolRow({ tool, t }: { readonly tool: ToolDefItem; readonly t: T }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const [restore, setRestore] = useState(false)
  const row = useRef<HTMLDetailsElement>(null)
  const parsed = schema(tool.parameters)
  useLayoutEffect(() => {
    if (!restore) return
    row.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
    row.current?.querySelector('summary')?.focus({ preventScroll: true })
    setRestore(false)
  }, [restore])
  return <details ref={row} className={css.toolCell} open={open}>
    <summary className={css.toolRow} title={tool.description} onClick={e => { e.preventDefault(); setOpen(!open); if (open) setRestore(true) }}>
      <span className={css.toolName}>{tool.name}{tool.added && <span className={css.badge}>{t('lens.layerAdded')}</span>}</span>
      <span className={css.preview}>{tool.description}</span>
      <span className={css.parameterCount}>{parsed ? t('lens.parameterCount', { count: String(Object.keys(parsed.properties).length) }) : '—'}</span>
      <span className={css.number} title={t('chain.chars', { count: fmt(tool.chars) })}>{fmt(tool.chars)}</span>
      <IconChevronDownOutlineMedium size={16} className={css.chevron} />
    </summary>
    {open && <div className={css.toolBody}>
      <div className={css.toolToolbar}><span>{t('lens.toolDefinition')}</span>{parsed && <button type="button" className={css.more} aria-pressed={raw} onClick={() => setRaw(!raw)}>{t(raw ? 'view.structured' : 'view.raw')}</button>}</div>
      <div className={css.prose}>{tool.description}</div>
      {parsed && !raw ? <>
        <div className={css.parameters}>{Object.entries(parsed.properties).map(([name, value]) => <Parameter key={name} name={name} value={value} required={parsed.required.includes(name)} t={t} />)}</div>
        {Object.keys(parsed.constraints).length > 0 && <details className={css.schemaConstraints}><summary>{t('lens.schemaConstraints')}</summary><pre className={css.pre}>{JSON.stringify(parsed.constraints, null, 2)}</pre></details>}
      </> : <pre className={css.pre}>{tool.parameters}</pre>}
    </div>}
  </details>
}
export function ToolCatalog({ tools, t }: { readonly tools: ToolDefItem[]; readonly t: T }) {
  return <div className={css.toolCatalog}>{tools.map(tool => <ToolRow key={tool.name} tool={tool} t={t} />)}</div>
}
