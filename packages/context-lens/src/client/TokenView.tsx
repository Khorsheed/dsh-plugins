/** Request navigation and the selected capture's structured / JSON detail. */
import { useState, type ReactNode } from 'react'
import type { AgentScopeOverview, CapturedRequest, RequestListItem } from '../types.ts'
import { requestNumberText, aggregateCategories, cachePct, duplicateStats, fmt, fmtSpan, fmtK, inputTotal, summaryText, type CompositionFilter } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import { CacheFacts, RequestFacts } from './RequestFacts.tsx'
import { RawView } from './RawView.tsx'
import { Exchange, SegmentBlocks, categoryLabelKey } from './SegmentBlocks.tsx'
import css from './TokenView.module.css'
type T = InspectorTabProps['t']

function RequestCard({ request: r, selected, onSelect, t }: {
  readonly request: RequestListItem; readonly selected: boolean
  readonly onSelect: (seq: number) => void; readonly t: T
}) {
  const pct = r.usage === undefined ? null : cachePct(r.usage)
  return <button type="button" className={selected ? css.reqItemSel : css.reqItem} title={r.requestNumber === undefined ? t('req.numberUnknown') : undefined} aria-label={`#${requestNumberText(r)} · ${summaryText(r.responseSummary, t('resp.directAnswer'))}`} aria-pressed={selected} onClick={() => onSelect(r.seq)}>
    <span className={css.reqName}><span>#{requestNumberText(r)} · </span>{summaryText(r.responseSummary, t('resp.directAnswer'))}</span>
    <span className={css.reqHit} data-low={pct === 0}>{pct === null ? '—' : `${pct.toFixed(1)}%`}</span>
    <span className={css.reqIo}>{r.usage ? `${fmtK(inputTotal(r.usage))} → ${fmtK(r.usage.outputTokens)}` : t(r.status === 'streaming' ? 'req.streaming' : 'req.failed')}</span>
    <span className={css.reqTime}>{r.totalMs === undefined ? '—' : fmtSpan(r.totalMs)}</span>
    {(r.toolErrors ?? 0) > 0 && <span className={css.reqFlag}>{t('lens.errors')} {r.toolErrors}</span>}
    {r.status === 'failed' && <span className={css.reqFlag}>{t('req.failed')}</span>}
  </button>
}

export interface TokenViewProps {
  readonly scope: AgentScopeOverview
  readonly selectedSeq: number | null
  readonly request: CapturedRequest | null
  readonly filterCat: CompositionFilter
  readonly previousResponseNumber: number | null
  readonly onSelect: (seq: number) => void
  readonly onToggleFilter: (category: Exclude<CompositionFilter, null>) => void
  readonly t: T
}

export function TokenView({ scope, selectedSeq, request, filterCat, previousResponseNumber, onSelect, onToggleFilter, t }: TokenViewProps): ReactNode {
  const [raw, setRaw] = useState(false)
  const selectedItem = scope.requests.find(r => r.seq === selectedSeq) ?? scope.requests[0]
  const cats = request === null ? [] : aggregateCategories(request).filter(c => c.chars > 0)
  const totalChars = cats.reduce((n, c) => n + c.chars, 0)
  const duplicates = duplicateStats(request ? [...request.segments.system, ...request.segments.history, ...request.segments.added] : [])
  return <div className={css.md}>
    <nav className={css.reqList} aria-label={t('view.token')}>
      {scope.requests.map(r => <RequestCard key={r.seq} request={r} selected={selectedItem?.seq === r.seq} onSelect={onSelect} t={t} />)}
    </nav>
    <div className={css.reqDetail}>
      {request === null || selectedItem === undefined ? <div className={css.stateNote} role="status">{t('state.loading')}</div> : <>
        <RequestFacts request={request} t={t} raw={raw} onToggleRaw={() => setRaw(v => !v)} />
        {raw ? <RawView request={request} t={t} /> : <>
          <CacheFacts request={request} t={t} />
          <Exchange key={`${request.scopeId}-${request.seq}`} request={request} previousResponseNumber={previousResponseNumber} t={t} />
          <section aria-label={t('lens.composition')}>
            <div className={css.sectionTitle}><h3>{t('lens.composition')}</h3><span>{t('chain.chars', { count: fmt(totalChars) })}</span><abbr className={css.info} title={t('lens.compositionHint')}>i</abbr></div>
            <div className={css.stack}>
              <div className={css.catbar} aria-hidden="true">
                {cats.map(c => <i key={c.category} data-cat={c.category} data-off={filterCat !== null && filterCat !== '__dup' && filterCat !== c.category} style={{ flex: `${c.chars} 1 0` }} />)}
              </div>
              <div className={css.legend}>
                {cats.map(c => <button key={c.category} type="button" className={css.legendItem} data-off={filterCat !== null && filterCat !== c.category} aria-pressed={filterCat === c.category} onClick={() => onToggleFilter(c.category)}>
                  <i className={css.dot} data-cat={c.category} />{t(categoryLabelKey(c.category))}<span>{(c.chars / totalChars * 100).toFixed(1)}%</span>
                </button>)}
                {duplicates.extraChars > 0 && <button type="button" className={css.legendItem} data-off={filterCat !== null && filterCat !== '__dup'} aria-pressed={filterCat === '__dup'} onClick={() => onToggleFilter('__dup')}>
                  <span className={css.badge}>×N</span>{t('lens.duplicates')}<span>{fmtK(duplicates.extraChars)}</span>
                </button>}
              </div>
              <SegmentBlocks key={`${request.scopeId}-${request.seq}`} request={request} filterCat={filterCat} previousResponseNumber={previousResponseNumber} t={t} />
            </div>
          </section>
        </>}
      </>}
    </div>
  </div>
}
