/** Compact composition rows and immediately readable exchange cards. */
import { useEffect, useState } from 'react'
import type { CapturedRequest, SegmentCategory, SegmentItem, ToolDefItem } from '../types.ts'
import { duplicateStats, fmt, fmtK, fmtSpan, type CompositionFilter } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './SegmentBlocks.module.css'
type T = InspectorTabProps['t']

export function categoryLabelKey(category: SegmentCategory): `cat.${SegmentCategory}` { return `cat.${category}` }

interface AssistantPayload { reasoning?: string; text?: string; calls?: { name: string; arguments: string }[] }
function parseAssistant(full: string): AssistantPayload | null {
  try {
    const value: unknown = JSON.parse(full)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as AssistantPayload
  } catch { /* Plain assistant text is also valid. */ }
  return null
}
function ItemFull({ item }: { readonly item: SegmentItem }) {
  const a = item.category === 'assistant' ? parseAssistant(item.full) : null
  if (!a || (!a.reasoning && !a.text && !a.calls?.length)) return <pre className={css.pre}>{item.full}</pre>
  return <>
    {a.reasoning && <><div className={css.fullLabel}>reasoning</div><pre className={css.pre}>{a.reasoning}</pre></>}
    {a.text && <><div className={css.fullLabel}>text</div><pre className={css.pre}>{a.text}</pre></>}
    {a.calls?.map((c, i) => <div key={i}><div className={css.fullLabel}>tool_call · {c.name}</div><pre className={css.pre}>{c.arguments}</pre></div>)}
  </>
}

/** Wire-order row, with verbatim expansion independent of its layer. */
export function SegmentItemRow({ item, fromOverride, repeats = 0, highlight = false, t }: {
  readonly item: SegmentItem; readonly fromOverride?: string | undefined
  readonly repeats?: number; readonly highlight?: boolean; readonly t: T
}) {
  const [open, setOpen] = useState(false)
  return <details className={css.item} open={open} data-highlight={highlight}>
    <summary className={css.row} title={item.preview} onClick={e => { e.preventDefault(); setOpen(v => !v) }}>
      <span className={css.idx}>{item.index < 0 ? '—' : String(item.index).padStart(3, '0')}</span>
      <i className={css.dot} data-cat={item.category} /><span className={css.type}>{t(categoryLabelKey(item.category))}</span>
      <span className={css.preview}>{item.preview}</span>
      <span>{repeats > 1 && <span className={css.badge}>×{repeats}</span>}{item.isError && <span className={css.errorNote}>{t('lens.errors')}</span>}</span>
      <span className={css.number}>{fmt(item.chars)}</span>
    </summary>
    {open && <div className={css.full}>
      <div className={css.fullLabel}>{fromOverride ?? item.source}{item.sourceTurn === undefined ? '' : ` · ${t('lens.sourceTurn', { turn: String(item.sourceTurn) })}`}{item.durationMs === undefined ? '' : ` · ${fmtSpan(item.durationMs)}`}</div>
      <ItemFull item={item} />
    </div>}
  </details>
}
function ToolCell({ tool, t }: { readonly tool: ToolDefItem; readonly t: T }) {
  const [open, setOpen] = useState(false)
  let definition: string
  try { definition = JSON.stringify({ name: tool.name, description: tool.description, parameters: JSON.parse(tool.parameters) as unknown }, null, 1) }
  catch { definition = `${tool.name}\n${tool.description}\n${tool.parameters}` }
  return <details className={css.toolCell} open={open}>
    <summary onClick={e => { e.preventDefault(); setOpen(v => !v) }}><span>{tool.name}</span>{tool.added && <span className={css.badge}>{t('lens.layerAdded')}</span>}<span className={css.number}>{fmt(tool.chars)}</span></summary>
    {open && <pre className={css.pre}>{definition}</pre>}
  </details>
}
export interface SegmentBlocksProps {
  readonly request: CapturedRequest
  readonly filterCat: CompositionFilter
  readonly previousResponseNumber: number | null
  readonly t: T
}

/** Filtering changes rows only: group counts, bars and sizes keep their full-request meaning. */
export function SegmentBlocks({ request, filterCat, t }: SegmentBlocksProps) {
  const { system, tools, history, added } = request.segments
  const [openLayers, setOpenLayers] = useState(new Set(['added']))
  const duplicates = duplicateStats([...system, ...history, ...added])
  const matches = (x: SegmentItem) => filterCat === null || (filterCat === '__dup' ? (duplicates.counts.get(x.full) ?? 0) > 1 : x.category === filterCat)
  useEffect(() => {
    if (filterCat === null) return
    setOpenLayers(previous => {
      const next = new Set(previous)
      next.add('history')
      for (const id of ['system', 'added'] as const) if (request.segments[id].some(x => filterCat === '__dup' ? (duplicates.counts.get(x.full) ?? 0) > 1 : x.category === filterCat)) next.add(id)
      if (filterCat === 'tool-definition') next.add('tools')
      return next
    })
  }, [filterCat, request])
  const layers = [
    { id: 'system', items: system, count: system.length, chars: system.reduce((n, x) => n + x.chars, 0), unit: 'cat.rows' as const },
    { id: 'tools', items: [], count: tools.length, chars: tools.reduce((n, x) => n + x.chars, 0), unit: 'seg.toolsFrom' as const },
    { id: 'history', items: history, count: history.length, chars: history.reduce((n, x) => n + x.chars, 0), unit: 'lens.messages' as const },
    { id: 'added', items: added, count: added.length, chars: added.reduce((n, x) => n + x.chars, 0), unit: 'lens.messages' as const },
  ]
  const total = layers.reduce((n, l) => n + l.chars, 0)
  const seen = new Set<string>()
  return <>{layers.map(layer => {
    const open = openLayers.has(layer.id)
    const mix = new Map<string, number>()
    if (layer.id === 'tools') mix.set('tool-definition', layer.chars)
    else for (const x of layer.items) mix.set(x.category, (mix.get(x.category) ?? 0) + x.chars)
    const rows = layer.items.filter(matches)
    let extra = 0
    for (const item of layer.items) {
      if (item.full.length < 40) continue
      if (seen.has(item.full)) extra += item.chars
      seen.add(item.full)
    }
    const names = { system: 'lens.layerSystem', tools: 'lens.layerTools', history: 'lens.layerHistory', added: 'lens.layerAdded' } as const
    return <details key={layer.id} className={css.layer} open={open}>
      <summary className={css.layerHead} onClick={e => { e.preventDefault(); setOpenLayers(previous => { const next = new Set(previous); next.has(layer.id) ? next.delete(layer.id) : next.add(layer.id); return next }) }}>
        <span className={css.caret}>{open ? '▾' : '▸'}</span>
        <span className={css.layerName}>{t(names[layer.id as keyof typeof names])}<small>{t(layer.unit, { count: String(layer.count) })}</small></span>
        <span className={css.mix}><span className={css.mini} style={{ width: `${total ? Math.max(3, layer.chars / total * 100) : 0}%` }}>{[...mix].sort((a,b) => b[1]-a[1]).map(([category,n]) => <i key={category} data-cat={category} style={{ flex: `${n} 1 0` }} />)}</span>
          {extra > 0 && <span className={css.badge}>{t('lens.repeatedChars', { count: fmtK(extra) })}</span>}
          {layer.id === 'tools' && tools.some(x => x.added) && <span className={css.badge}>{t('lens.newTools', { count: String(tools.filter(x => x.added).length) })}</span>}
        </span>
        <span className={css.number}>{fmt(layer.chars)}</span>
      </summary>
      {open && <div className={css.rows}>
        {layer.id === 'tools' ? ((filterCat === null || filterCat === 'tool-definition') && tools.length > 0 ? <div className={css.toolGrid}>{tools.map(tool => <ToolCell key={tool.name} tool={tool} t={t} />)}</div> : <div className={css.emptyNote}>{t(filterCat ? 'lens.noMatch' : 'seg.toolsEmpty')}</div>)
          : rows.length ? rows.map((item, i) => <SegmentItemRow key={`${item.index}-${i}`} item={item} repeats={duplicates.counts.get(item.full) ?? 0} highlight={filterCat === '__dup'} t={t} />)
          : <div className={css.emptyNote}>{t(filterCat ? 'lens.noMatch' : layer.id === 'system' ? 'seg.systemEmpty' : 'seg.empty')}</div>}
      </div>}
    </details>
  })}</>
}

function Clamped({ text, t }: { readonly text: string; readonly t: T }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 300
  return <><pre className={css.clamp} data-open={open} data-long={long}>{text}</pre>{long && <button className={css.more} type="button" onClick={() => setOpen(v => !v)}>{open ? t('lens.collapse') : t('lens.expand', { count: fmt(text.length) })}</button>}</>
}
function ArgumentValue({ name, value }: { readonly name: string; readonly value: string }) {
  const [open, setOpen] = useState(false)
  return <><span className={css.argKey}>{name}</span><button type="button" className={css.argValue} aria-label={name} aria-expanded={open} title={value} onClick={() => setOpen(v => !v)}>{value}</button></>
}
function Arguments({ raw, t }: { readonly raw: string; readonly t: T }) {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return <Clamped text={raw} t={t} /> }
  if (!obj || typeof obj !== 'object') return <Clamped text={raw} t={t} />
  return <div className={css.args}>{Object.entries(obj).map(([k,v]) => <ArgumentValue key={k} name={k} value={typeof v === 'string' ? v : JSON.stringify(v)} />)}</div>
}
function Reasoning({ text, ms, t }: { readonly text: string; readonly ms: number | undefined; readonly t: T }) {
  const [open, setOpen] = useState(false)
  return <div className={css.think}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}><b>{t('lens.reasoning')}</b> · {ms === undefined ? '—' : fmtSpan(ms)} · {t('chain.chars', { count: fmt(text.length) })}</button>
    <div className={css.thinkText} data-open={open}>{text}</div>
  </div>
}
/** The output body is visible, including reasoning and arguments, without opening a wrapper. */
export function OutputBlock({ request, t }: { readonly request: CapturedRequest; readonly t: T }) {
  const response = request.response
  return <div className={css.output}>
    {request.status === 'failed' && request.error && <div className={css.errorNote}>{request.error}</div>}
    {response === undefined ? <div className={css.emptyNote}>{t(request.status === 'streaming' ? 'out.streaming' : 'lens.noResponse')}</div> : <>
      {response.reasoning && <Reasoning text={response.reasoning} ms={request.timing.reasoningMs} t={t} />}
      {response.text && <Clamped text={response.text} t={t} />}
      {response.toolCalls.map((c,i) => <div className={css.call} key={i}>
        <div className={css.callHead}><span>{t('lens.calls')}</span><b>{c.name}</b><span className={css.number}>{fmt(c.arguments.length)}</span></div><Arguments raw={c.arguments} t={t} />
      </div>)}
    </>}
  </div>
}
function InputCard({ item, from, repeats, t }: { readonly item: SegmentItem; readonly from: string; readonly repeats: number; readonly t: T }) {
  const [open, setOpen] = useState(false)
  const a = item.category === 'assistant' ? parseAssistant(item.full) : null
  const body = a ? [a.text, ...(a.calls ?? []).map(c => `→ ${c.name}`)].filter(Boolean).join('\n') || item.preview : item.full || item.preview
  return <div className={css.message} data-error={item.isError}>
    <button type="button" className={css.messageHead} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <i className={css.dot} data-cat={item.category} /><b>{t(categoryLabelKey(item.category))}</b><span className={css.source} title={from}>{from}</span>{repeats > 1 && <span className={css.badge}>×{repeats}</span>}<span className={css.number}>{fmt(item.chars)}</span>
    </button>
    {item.isError && <div className={css.errorNote}>{t('lens.errors')}</div>}
    {open ? <div className={css.messageFull}><div className={css.fullLabel}>{item.sourceTurn === undefined ? '' : t('lens.sourceTurn', { turn: String(item.sourceTurn) })}</div><ItemFull item={item} /></div> : <div className={css.messageBody} onClick={() => setOpen(true)}>{body}</div>}
  </div>
}
export function Exchange({ request, previousResponseNumber, t }: { readonly request: CapturedRequest; readonly previousResponseNumber: number | null; readonly t: T }) {
  const duplicates = duplicateStats([...request.segments.system, ...request.segments.history, ...request.segments.added])
  return <section aria-label={t('lens.exchange')}>
    <h3 className={css.exchangeTitle}>{t('lens.exchange')}</h3>
    <div className={css.exchange}>
      <div className={css.column}><div className={css.columnLabel}>{t('lens.newInput')} · {request.segments.added.length}</div>
        {request.segments.added.map((item,i) => <InputCard key={i} item={item} repeats={duplicates.counts.get(item.full) ?? 0} t={t} from={item.category === 'assistant' && previousResponseNumber !== null ? t('row.prevResponse', { seq:String(previousResponseNumber) }) : item.source} />)}
      </div>
      <div className={css.arrow} aria-hidden="true">→</div>
      <div className={css.column} role="region" aria-label={t('out.title')}><div className={css.columnLabel}><span>{t('out.title')}</span><span>{request.usage ? fmt(request.usage.outputTokens) : '—'} tok</span></div><OutputBlock request={request} t={t} /></div>
    </div>
  </section>
}
