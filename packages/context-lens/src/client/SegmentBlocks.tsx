/** Compact composition rows and immediately readable exchange cards. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CapturedRequest, CapturedResponse, RequestLink, SegmentCategory, SegmentItem } from '../types.ts'
import { duplicateStats, fmt, fmtK, fmtSpan, type CompositionFilter } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './SegmentBlocks.module.css'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import { ToolCatalog } from './ToolCatalog.tsx'
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
function BodyText({ text }: { readonly text: string }) {
  let code = false
  try { const value: unknown = JSON.parse(text); code = value !== null && typeof value === 'object' } catch { /* Prose stays verbatim. */ }
  return <pre className={code ? css.pre : css.prose}>{text}</pre>
}
function ItemFull({ item }: { readonly item: SegmentItem }) {
  const a = item.category === 'assistant' ? parseAssistant(item.full) : null
  if (!a || (!a.reasoning && !a.text && !a.calls?.length)) return <BodyText text={item.full} />
  return <>
    {a.reasoning && <><div className={css.fullLabel}>reasoning</div><BodyText text={a.reasoning} /></>}
    {a.text && <><div className={css.fullLabel}>text</div><BodyText text={a.text} /></>}
    {a.calls?.map((c, i) => <div key={i}><div className={css.fullLabel}>tool_call · {c.name}</div><pre className={css.pre}>{c.arguments}</pre></div>)}
  </>
}

/** Compression is provenance, not another copy of the active context. */
function RewriteMeta({ item, onOpenRequest, t }: { readonly item: SegmentItem; readonly onOpenRequest?: ((link: RequestLink) => void) | undefined; readonly t: T }) {
  if (!item.compactionId && !item.pruning) return null
  return <div className={css.rewriteMeta}>
    {item.compactionId && <><span>{t('compaction.checkpoint')}</span>{item.compactionRequest && onOpenRequest
      ? <button type="button" onClick={() => onOpenRequest(item.compactionRequest!)}>{t('compaction.inspect')} ↗</button>
      : <span>{t('compaction.unavailable')}</span>}</>}
    {item.pruning && <><span>{t('pruning.changed', { before: fmt(item.pruning.beforeChars), after: fmt(item.pruning.afterChars) })}</span>
      {item.pruning.before && onOpenRequest && <button type="button" onClick={() => onOpenRequest(item.pruning!.before!)}>{t('pruning.before')} ↗</button>}</>}
  </div>
}

const itemNumber = (item: SegmentItem) => item.index < 0 ? '—' : String(item.index).padStart(3, '0')
interface MessageReading {
  expanded: ReadonlySet<SegmentItem>
  flash: SegmentItem | null
  returnTo: SegmentItem | undefined
  destination: SegmentItem | undefined
  register: (item: SegmentItem, element: HTMLDetailsElement | null) => void
  toggle: (item: SegmentItem) => void
  next: (from: SegmentItem, to: SegmentItem) => void
  jump: (from: SegmentItem, to: SegmentItem) => void
  back: (from: SegmentItem) => void
}
/** The list stays dense; navigation is shared across system/history/added layers. */
function MessageRows({ items, groups, highlight, reading, onOpenRequest, t }: {
  readonly items: SegmentItem[]; readonly groups: Map<string, SegmentItem[]>; readonly highlight: boolean; readonly reading: MessageReading; readonly onOpenRequest?: ((link: RequestLink) => void) | undefined; readonly t: T
}) {
  return <>{items.map((item, i) => {
    const open = reading.expanded.has(item)
    const group = groups.get(item.full) ?? []
    const peers = group.filter(other => other !== item)
    const next = items[i + 1]
    return <details key={item.index} ref={el => reading.register(item, el)} className={css.item} open={open} data-highlight={highlight} data-jump={reading.flash === item}>
      <summary className={css.row} title={item.preview} onClick={e => { e.preventDefault(); reading.toggle(item) }}>
        <span className={css.idx}>{itemNumber(item)}</span>
        <i className={css.dot} data-cat={item.category} /><span className={css.type}>{t(categoryLabelKey(item.category))}</span>
        <span className={css.preview}>{item.preview}</span>
        <span className={css.rowBadges}>{item.pruning && <span className={css.badge}>{t('pruning.badge')}</span>}{group.length > 1 && <span className={css.badge}>×{group.length}</span>}{item.isError && <span className={css.errorNote}>{t('lens.errors')}</span>}</span>
        <span className={css.number}>{fmt(item.chars)}</span>
        <IconChevronDownOutlineMedium size={16} className={css.chevron} />
        {open && <span className={css.readActions}><span>{t('lens.collapse')}</span><button type="button" disabled={!next} onClick={e => {
          e.preventDefault(); e.stopPropagation()
          if (next) reading.next(item, next)
        }}>{t('lens.nextItem')} ↓</button></span>}
      </summary>
      {open && <div className={css.full}>
        {item.isError && <div className={css.errorNote}>{t('lens.errors')}</div>}
        <div className={`${css.fullLabel} ${css.messageMeta}`}>
          <span>{item.source}{item.sourceTurn === undefined ? '' : ` · ${t('lens.sourceTurn', { turn: String(item.sourceTurn) })}`}{item.durationMs === undefined ? '' : ` · ${fmtSpan(item.durationMs)}`}</span>
          {peers.length > 0 && <span className={css.duplicateLinks}>
            <span>{t('lens.sameWith')}</span>
            {peers.map(other => <button key={other.index} type="button" onClick={() => reading.jump(item, other)}>{itemNumber(other)} · {t(categoryLabelKey(other.category))} ↗</button>)}
            <span>{t('lens.sameFullText')}</span>
          </span>}
          {reading.destination === item && reading.returnTo && <button type="button" className={css.returnLink} onClick={() => reading.back(item)}>{t('lens.returnItem', { index: itemNumber(reading.returnTo) })} ↩</button>}
        </div>
        <RewriteMeta item={item} onOpenRequest={onOpenRequest} t={t} />
        <ItemFull item={item} />
      </div>}
    </details>
  })}</>
}
export interface SegmentBlocksProps {
  readonly request: CapturedRequest
  readonly filterCat: CompositionFilter
  readonly onOpenRequest?: ((link: RequestLink) => void) | undefined
  readonly onClearFilter?: () => void
  readonly previousResponseNumber: number | null
  readonly t: T
}

/** Filtering changes rows only: group counts, bars and sizes keep their full-request meaning. */
export function SegmentBlocks({ request, filterCat, onClearFilter, onOpenRequest, t }: SegmentBlocksProps) {
  const { system, tools, history, added } = request.segments
  const [openLayers, setOpenLayers] = useState(new Set(['added']))
  const duplicates = duplicateStats([...system, ...history, ...added])
  const groups = new Map<string, SegmentItem[]>()
  for (const item of [...system, ...history, ...added]) {
    if ((duplicates.counts.get(item.full) ?? 0) > 1) {
      const group = groups.get(item.full) ?? []
      group.push(item)
      groups.set(item.full, group)
    }
  }
  const [expanded, setExpanded] = useState(new Set<SegmentItem>())
  const [target, setTarget] = useState<SegmentItem | null>(null)
  const [flash, setFlash] = useState<SegmentItem | null>(null)
  const [trail, setTrail] = useState<SegmentItem[]>([])
  const [destination, setDestination] = useState<SegmentItem>()
  const refs = useRef(new Map<SegmentItem, HTMLDetailsElement>())
  useLayoutEffect(() => {
    if (!target) return
    const row = refs.current.get(target)
    if (!row) return
    row.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    row.querySelector('summary')?.focus({ preventScroll: true })
    setFlash(target)
    setTarget(null)
  }, [target, filterCat])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(timer)
  }, [flash])
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
  const navigate = (from: SegmentItem, to: SegmentItem) => {
    if (!matches(to)) onClearFilter?.()
    setOpenLayers(previous => {
      const next = new Set(previous)
      for (const id of ['system', 'history', 'added'] as const) if (request.segments[id].includes(to)) next.add(id)
      return next
    })
    setExpanded(previous => { const next = new Set(previous); next.delete(from); next.add(to); return next })
    setTarget(to)
  }
  const reading: MessageReading = {
    expanded, flash, returnTo: trail.at(-1), destination,
    register: (item, element) => { if (element) refs.current.set(item, element); else refs.current.delete(item) },
    toggle: item => {
      if (expanded.has(item)) setTarget(item)
      setExpanded(previous => { const next = new Set(previous); next.has(item) ? next.delete(item) : next.add(item); return next })
      setTrail([]); setDestination(undefined)
    },
    next: (from, to) => { setTrail([]); setDestination(undefined); navigate(from, to) },
    jump: (from, to) => { setTrail(previous => [...previous, from]); setDestination(to); navigate(from, to) },
    back: from => {
      const to = trail.at(-1)
      if (!to) return
      setTrail(previous => previous.slice(0, -1)); setDestination(to); navigate(from, to)
    },
  }
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
        <IconChevronDownOutlineMedium size={16} className={css.chevron} />
        <span className={css.layerName}>{t(names[layer.id as keyof typeof names])}<small>{t(layer.unit, { count: String(layer.count) })}</small></span>
        <span className={css.mix}><span className={css.mini} style={{ width: `${total ? Math.max(3, layer.chars / total * 100) : 0}%` }}>{[...mix].sort((a,b) => b[1]-a[1]).map(([category,n]) => <i key={category} data-cat={category} style={{ flex: `${n} 1 0` }} />)}</span>
          {extra > 0 && <span className={css.badge}>{t('lens.repeatedChars', { count: fmtK(extra) })}</span>}
          {layer.id === 'tools' && tools.some(x => x.added) && <span className={css.badge}>{t('lens.newTools', { count: String(tools.filter(x => x.added).length) })}</span>}
        </span>
        <span className={css.number}>{fmt(layer.chars)}</span>
      </summary>
      {open && <div className={css.rows}>
        {layer.id === 'tools' ? ((filterCat === null || filterCat === 'tool-definition') && tools.length > 0 ? <ToolCatalog tools={tools} t={t} /> : <div className={css.emptyNote}>{t(filterCat ? 'lens.noMatch' : 'seg.toolsEmpty')}</div>)
          : rows.length ? <MessageRows items={rows} groups={groups} highlight={filterCat === '__dup'} reading={reading} onOpenRequest={onOpenRequest} t={t} />
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
  // Non-JSON arguments (a shell command line) keep the key/value table's inset.
  try { obj = JSON.parse(raw) } catch { return <div className={css.argsRaw}><Clamped text={raw} t={t} /></div> }
  if (!obj || typeof obj !== 'object') return <div className={css.argsRaw}><Clamped text={raw} t={t} /></div>
  return <div className={css.args}>{Object.entries(obj).map(([k,v]) => <ArgumentValue key={k} name={k} value={typeof v === 'string' ? v : JSON.stringify(v)} />)}</div>
}
function Reasoning({ text, ms, t }: { readonly text: string; readonly ms: number | undefined; readonly t: T }) {
  const [open, setOpen] = useState(false)
  return <div className={css.think}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}><b>{t('lens.reasoning')}</b> · {ms === undefined ? '—' : fmtSpan(ms)} · {t('chain.chars', { count: fmt(text.length) })}</button>
    <div className={css.thinkText} data-open={open}>{text}</div>
  </div>
}
/** Result text is attached by call ID, including same-name and parallel calls. */
function ToolCallCard({ call, t }: { call: CapturedResponse['toolCalls'][number]; t: T }) {
  const [open, setOpen] = useState(false)
  const execution = call.execution
  const failed = execution?.status === 'failed'
  const result = execution?.result
  const status = execution?.status ?? 'unknown'
  return <div className={css.call} data-status={status}>
    <div className={css.callHead}><span>{t('lens.calls')}</span><b>{call.name}</b>
      <span className={css.callStatus} data-status={status}>{t(`tool.status.${status}`)}</span>
      <span className={css.number}>{fmt(call.arguments.length)}</span>
    </div>
    <Arguments raw={call.arguments} t={t} />
    {execution && execution.status !== 'running' && <div className={css.result} data-error={failed}>
      <div className={css.resultHead}><b>{t('tool.result')}</b>
        {result !== undefined && <button type="button" className={css.more} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? t('lens.collapse') : t(failed ? 'tool.expand' : 'tool.show', { count: fmt(result.length) })}</button>}
      </div>
      {result === undefined ? <div className={css.emptyNote}>{t('tool.noResult')}</div>
        : (failed || open) && <pre className={css.resultText} data-open={open}>{result || t('tool.emptyResult')}</pre>}
    </div>}
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
      {response.toolCalls.map((call, i) => <ToolCallCard key={call.callId ?? i} call={call} t={t} />)}
    </>}
  </div>
}
function InputCard({ item, from, repeats, onOpenRequest, t }: { readonly item: SegmentItem; readonly from: string; readonly repeats: number; readonly onOpenRequest?: ((link: RequestLink) => void) | undefined; readonly t: T }) {
  const [open, setOpen] = useState(false)
  const a = item.category === 'assistant' ? parseAssistant(item.full) : null
  const body = a ? [a.text, ...(a.calls ?? []).map(c => `→ ${c.name}`)].filter(Boolean).join('\n') || item.preview : item.full || item.preview
  return <div className={css.message} data-error={item.isError}>
    <button type="button" className={css.messageHead} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <i className={css.dot} data-cat={item.category} /><b>{t(categoryLabelKey(item.category))}</b><span className={css.source} title={from}>{from}</span>{repeats > 1 && <span className={css.badge}>×{repeats}</span>}<span className={css.number}>{fmt(item.chars)}</span>
    </button>
    {item.isError && <div className={css.errorNote}>{t('lens.errors')}</div>}
    <RewriteMeta item={item} onOpenRequest={onOpenRequest} t={t} />
    {open ? <div className={css.messageFull}><div className={css.fullLabel}>{item.sourceTurn === undefined ? '' : t('lens.sourceTurn', { turn: String(item.sourceTurn) })}</div><ItemFull item={item} /></div> : <div className={css.messageBody} onClick={() => setOpen(true)}>{body}</div>}
  </div>
}
export function Exchange({ request, previousResponseNumber, onOpenRequest, t }: { readonly request: CapturedRequest; readonly previousResponseNumber: number | null; readonly onOpenRequest?: ((link: RequestLink) => void) | undefined; readonly t: T }) {
  const duplicates = duplicateStats([...request.segments.system, ...request.segments.history, ...request.segments.added])
  return <section aria-label={t('lens.exchange')}>
    <h3 className={css.exchangeTitle}>{t('lens.exchange')}</h3>
    <div className={css.exchange}>
      <div className={css.column}><div className={css.columnLabel}>{t(request.compaction?.inputPartial ? 'compaction.region' : 'lens.newInput')} · {request.segments.added.length}</div>
        {request.segments.added.map((item,i) => <InputCard key={i} item={item} onOpenRequest={onOpenRequest} repeats={duplicates.counts.get(item.full) ?? 0} t={t} from={item.category === 'assistant' && previousResponseNumber !== null ? t('row.prevResponse', { seq:String(previousResponseNumber) }) : item.category === 'tool-result' && item.sourceRequestNumber !== undefined ? `${item.source} · ${t('row.callResult', { seq: String(item.sourceRequestNumber) })}` : item.source} />)}
      </div>
      <div className={css.arrow} aria-hidden="true">→</div>
      <div className={css.column} role="region" aria-label={t('out.title')}><div className={css.columnLabel}><span>{t('out.title')}</span><span>{request.usage ? fmt(request.usage.outputTokens) : '—'} tok</span></div><OutputBlock request={request} t={t} /></div>
    </div>
  </section>
}
