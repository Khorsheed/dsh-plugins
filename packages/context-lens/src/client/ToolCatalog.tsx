/** A scan-friendly inventory with lossless inline schema inspection. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ToolDefItem } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { fmt } from './aggregate.ts'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import css from './SegmentBlocks.module.css'
import { SchemaFields, schemaRecord } from './SchemaFields.tsx'
type T = InspectorTabProps['t']
function schema(raw: string): { value: unknown; count: number | null } | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!schemaRecord(value) && typeof value !== 'boolean') return null
    return { value, count: schemaRecord(value) && schemaRecord(value.properties) ? Object.keys(value.properties).length : null }
  } catch { return null }
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
      <span className={css.parameterCount}>{parsed && parsed.count !== null ? t('lens.parameterCount', { count: String(parsed.count) }) : '—'}</span>
      <span className={css.number} title={t('chain.chars', { count: fmt(tool.chars) })}>{fmt(tool.chars)}</span>
      <IconChevronDownOutlineMedium size={16} className={css.chevron} />
    </summary>
    {open && <div className={css.toolBody}>
      <div className={css.toolToolbar}><span>{t('lens.toolDefinition')}</span><button type="button" className={css.more} aria-pressed={raw} onClick={() => setRaw(!raw)}>{t(raw ? 'view.structured' : 'view.raw')}</button></div>
      <div className={css.prose}>{tool.description}</div>
      {raw ? <pre className={css.pre}>{tool.parameters}</pre> : parsed ? <SchemaFields value={parsed.value} t={t} /> : <div className={css.schemaCaption}>{t('schema.unreadable')}</div>}
    </div>}
  </details>
}
export function ToolCatalog({ tools, t }: { readonly tools: ToolDefItem[]; readonly t: T }) {
  return <div className={css.toolCatalog}>{tools.map(tool => <ToolRow key={tool.name} tool={tool} t={t} />)}</div>
}
