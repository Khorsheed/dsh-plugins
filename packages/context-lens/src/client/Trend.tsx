import { useEffect, useRef, useState } from 'react'
import type { SessionTrend } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { requestNumberText, cachePct, inputTotal } from './aggregate.ts'
import css from './InspectorPanel.module.css'

type TrendRequest = SessionTrend['requests'][number]
const isCompaction = (scopeId: string) => scopeId.startsWith('compaction:')

/** Bar width that fits every request in the box (2–7px); below 2px the strip scrolls instead. */
function fitWidth(box: number, requests: number, groups: number): number {
  if (requests === 0 || box === 0) return 7
  const perBar = Math.floor((box - groups * 10) / requests) - 1
  return Math.max(2, Math.min(7, perBar))
}

/**
 * A body-free map of one view's requests across the session's turns. Bars fit
 * the panel width; turns are separated and labelled at their start; the
 * current turn is outlined. On the main conversation, a dot under a request
 * marks the child views its tool calls started, and a dashed line marks where
 * a compaction happened — both switch to that view.
 */
export function Trend({
  data,
  turnSeq,
  selectedSeq,
  scopeId,
  scopeLabel,
  onSelect,
  onSelectScope,
  t,
}: {
  readonly data: SessionTrend
  readonly turnSeq: number | null
  readonly selectedSeq: number | null
  readonly scopeId: string
  readonly scopeLabel: string
  readonly onSelect: (turnSeq: number, seq: number, scopeId: string) => void
  readonly onSelectScope?: ((turnSeq: number, scopeId: string) => void) | undefined
  readonly t: InspectorTabProps['t']
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const el = ref.current,
      current = el?.querySelector<HTMLElement>('[data-current="true"]')
    if (el && current && el.scrollWidth > el.clientWidth)
      el.scrollLeft = current.offsetLeft - el.clientWidth / 2 + current.offsetWidth / 2
  }, [turnSeq, scopeId, data])

  const requests = data.requests.filter(r => r.scopeId === scopeId)
  const main = scopeId === 'main'
  const compactions = main ? data.requests.filter(r => isCompaction(r.scopeId)) : []
  /** Turns where some other agent ran: their label carries a mark, so the map shows where to look. */
  const withAgents = new Set(main ? data.requests.filter(r => r.scopeId !== 'main' && !isCompaction(r.scopeId)).map(r => r.turnSeq) : [])
  const turns = data.turns.filter(turn => requests.some(r => r.turnSeq === turn.turnSeq))
  const max = Math.max(1, ...requests.map(r => (r.usage ? inputTotal(r.usage) : 0)))
  const barWidth = fitWidth(width, requests.length, turns.length)
  /** Compactions of this turn that happened right before `next` (or at the turn's end). */
  const dividersBefore = (turn: number, next: TrendRequest | undefined, previous: TrendRequest | undefined) =>
    compactions.filter(c => c.turnSeq === turn
      && (previous === undefined || c.startedAt >= previous.startedAt)
      && (next === undefined || c.startedAt < next.startedAt))

  return (
    <section aria-label={t('lens.trendScope', { scope: scopeLabel })}>
      <div ref={ref} className={css.trend} style={{ ['--trend-bar' as string]: `${barWidth}px` }}>
        {turns.map((turn) => {
          const rows = requests.filter(r => r.turnSeq === turn.turnSeq)
          return (
            <div key={turn.turnSeq} className={css.trendGroup} data-current={turnSeq === turn.turnSeq}>
              <div className={css.trendBars}>
                {rows.map((r, i) => {
                  const total = r.usage ? inputTotal(r.usage) : 0,
                    hit = r.usage ? cachePct(r.usage) : null
                  const divider = dividersBefore(turn.turnSeq, r, rows[i - 1])
                  return <span key={r.seq} className={css.trendCell}>
                    {divider.map(c => <button key={c.seq} type="button" className={css.trendCompaction} title={t('trend.compaction')} aria-label={t('trend.compaction')} onClick={() => onSelect(turn.turnSeq, c.seq, c.scopeId)} />)}
                    <button
                      type="button"
                      className={css.trendTarget}
                      data-selected={r.seq === selectedSeq}
                      aria-pressed={r.seq === selectedSeq}
                      aria-label={`${t('turn.label', { seq: String(turn.hostTurn ?? turn.turnSeq) })} #${requestNumberText(r)} · ${hit ?? '—'}%`}
                      title={`#${requestNumberText(r)} · ${total} tok · ${hit ?? '—'}%`}
                      onClick={() => onSelect(turn.turnSeq, r.seq, r.scopeId)}
                    >
                      <span className={css.trendBar} aria-hidden="true" style={{ height: `${Math.max(3, (total / max) * 40)}px` }}>
                        <i style={{ height: `${hit ?? 0}%` }} />
                      </span>
                    </button>
                    {r.delegates && r.delegates.length > 0 && <button type="button" className={css.trendDot} data-external={r.delegates.some(d => d.external)}
                      title={t('trend.delegates', { count: String(r.delegates.length) })} aria-label={t('trend.delegates', { count: String(r.delegates.length) })}
                      onClick={() => onSelectScope?.(turn.turnSeq, r.delegates![0]!.scopeId)} />}
                  </span>
                })}
                {dividersBefore(turn.turnSeq, undefined, rows.at(-1)).map(c => <button key={c.seq} type="button" className={css.trendCompaction} title={t('trend.compaction')} aria-label={t('trend.compaction')} onClick={() => onSelect(turn.turnSeq, c.seq, c.scopeId)} />)}
              </div>
              <span className={css.trendTurn}>{turn.hostTurn ?? '·'}{withAgents.has(turn.turnSeq) && <i className={css.trendAgents} title={t('trend.agents')} aria-label={t('trend.agents')} />}</span>
            </div>
          )
        })}
      </div>
      {requests.length === 0 && <span className={css.trendLabel}>{t('lens.trendEmpty')}</span>}
    </section>
  )
}
