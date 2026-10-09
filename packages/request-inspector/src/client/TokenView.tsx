/**
 * The Token 分布 tab: the request list on the left (one card per model call —
 * `#seq · responseSummary`, 输入/输出 tok · 耗时, 缓存命中 + the mini bar) and
 * the selected request's composition on the right (config line, category
 * stacked bar + legend filter, the 输入 four-segment detail, then the 输出
 * section with the request's own response). The list collapses to a
 * horizontal strip when the panel narrows (one layout, container query).
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import type { ReactNode } from 'react'
import type {
  AgentScopeOverview, CapturedRequest, RequestListItem, SegmentCategory,
} from '../types.ts'
import { aggregateCategories, cachePct, fmt, fmtDur, fmtK, inputTotal, summaryText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import { OutputBlock, SegmentBlocks, categoryLabelKey } from './SegmentBlocks.tsx'
import css from './TokenView.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** One request card in the left list. */
function RequestCard({ request, selected, onSelect, t }: {
  readonly request: RequestListItem
  readonly selected: boolean
  readonly onSelect: (seq: number) => void
  readonly t: T
}) {
  const usage = request.usage
  const totalIn = usage === undefined ? 0 : inputTotal(usage)
  const pct = usage === undefined ? null : cachePct(usage)
  return (
    <button
      type="button"
      className={selected ? css.reqItemSel : css.reqItem}
      aria-pressed={selected}
      onClick={() => { onSelect(request.seq) }}
    >
      <span className={css.reqName}>#{request.seq} · {summaryText(request.responseSummary, t('resp.directAnswer'))}</span>
      <span className={css.reqIo}>
        {usage === undefined
          ? (request.status === 'streaming' ? t('req.streaming') : t('req.failed'))
          : `${t('req.input')} ${fmtK(totalIn)} · ${t('req.output')} ${fmtK(usage.outputTokens)}${request.totalMs === undefined ? '' : ` · ${fmtDur(request.totalMs)}`}`}
      </span>
      {usage !== undefined && pct !== null && (
        <span className={css.reqSub}>{t('req.cacheHit', { tokens: fmtK(usage.cacheReadTokens ?? 0), pct: String(pct) })}</span>
      )}
      {usage !== undefined && pct !== null && (
        <span className={css.cacheBar} data-low={pct < 50 ? 'true' : 'false'}>
          <span className={css.cacheFill} style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  )
}

/** The detail header's config line: config · provider/model · maxTokens. */
function anchorConfigText(request: CapturedRequest, t: T): string {
  const parts: string[] = []
  const route = [request.config.provider, request.config.model].filter(part => part !== undefined && part.length > 0).join('/')
  if (route.length > 0) parts.push(route)
  if (request.config.maxTokens !== undefined) parts.push(`${t('detail.maxTokens')} ${fmt(request.config.maxTokens)}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export interface TokenViewProps {
  /** The selected scope's overview (light request rows). */
  readonly scope: AgentScopeOverview
  /** The selected request seq (null = none selected yet). */
  readonly selectedSeq: number | null
  /** The selected request's full capture; null while loading. */
  readonly request: CapturedRequest | null
  /** The legend's category filter. */
  readonly filterCat: SegmentCategory | null
  /** The previous request's seq in this scope (the 新增 provenance label); null when none exists. */
  readonly previousResponseSeq: number | null
  readonly onSelect: (seq: number) => void
  readonly onToggleFilter: (category: SegmentCategory) => void
  readonly t: T
}

/** The token tab body. */
export function TokenView({ scope, selectedSeq, request, filterCat, previousResponseSeq, onSelect, onToggleFilter, t }: TokenViewProps): ReactNode {
  const selectedItem = scope.requests.find(candidate => candidate.seq === selectedSeq) ?? scope.requests[0]
  const cats = request === null ? [] : aggregateCategories(request)
  const shownChars = cats.reduce((n, cat) => n + cat.chars, 0)
  const usage = request?.usage
  const totalIn = usage === undefined ? null : inputTotal(usage)
  const messageCount = request === null
    ? 0
    : request.segments.system.length + request.segments.history.length + request.segments.added.length
  return (
    <div className={css.md}>
      <div className={css.reqList} role="listbox" aria-label={t('view.token')}>
        {scope.requests.map(item => (
          <RequestCard
            key={item.seq}
            request={item}
            selected={selectedItem?.seq === item.seq}
            onSelect={onSelect}
            t={t}
          />
        ))}
      </div>
      <div className={css.reqDetail}>
        {request === null || selectedItem === undefined ? (
          <div className={css.stateNote} role="status">{t('state.loading')}</div>
        ) : (
          <>
            <div className={css.catbarWrap}>
              <div className={css.catbarTitle}>
                <span>{t('cat.title', { seq: String(request.seq) })}</span>
                <span className={css.mono}>
                  {totalIn === null ? t('chain.chars', { count: fmt(shownChars) }) : `${fmt(totalIn)} tok`}
                </span>
              </div>
              <div className={css.anchor}>
                {t('detail.config')} · <span className={css.mono}>{anchorConfigText(request, t)}</span>
              </div>
              <div className={css.catbar} role="presentation">
                {cats.map(cat => (
                  <div key={cat.category} data-cat={cat.category} style={{ flex: `${cat.chars} 1 0` }} />
                ))}
              </div>
              <div className={css.legend}>
                {cats.map(cat => {
                  const off = filterCat !== null && filterCat !== cat.category
                  return (
                    <button
                      key={cat.category}
                      type="button"
                      className={off ? css.legendItemOff : css.legendItem}
                      aria-pressed={filterCat === cat.category}
                      onClick={() => { onToggleFilter(cat.category) }}
                    >
                      <span className={css.dot} data-cat={cat.category} />
                      <span className={css.legendName}>{t(categoryLabelKey(cat.category))} · {t('cat.rows', { count: String(cat.count) })}</span>
                      <span className={css.mono}>{fmt(cat.chars)} · {shownChars === 0 ? '0' : (cat.chars / shownChars * 100).toFixed(1)}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className={css.chainTitle}>
              <span>
                {t('chain.title', { count: String(messageCount) })}
                {filterCat !== null && (
                  <>
                    {' · '}
                    {t('chain.filtered', { category: t(categoryLabelKey(filterCat)) })}
                    {' '}
                    <button type="button" className={css.filterClear} onClick={() => { onToggleFilter(filterCat) }}>✕</button>
                  </>
                )}
              </span>
              <span className={css.mono}>{t('chain.chars', { count: fmt(shownChars) })}</span>
            </div>
            <SegmentBlocks request={request} filterCat={filterCat} previousResponseSeq={previousResponseSeq} t={t} />
            <OutputBlock request={request} t={t} />
          </>
        )}
      </div>
    </div>
  )
}
