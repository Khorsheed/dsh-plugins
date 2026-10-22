import { useEffect, useRef, useState } from 'react'
import type { SessionTrend } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { requestNumberText, cachePct, inputTotal } from './aggregate.ts'
import css from './InspectorPanel.module.css'

type TrendRequest = SessionTrend['requests'][number]
const isCompaction = (scopeId: string) => scopeId.startsWith('compaction:')
/** Smallest cell a turn may shrink to (one label); below it the map scrolls. */
const MIN_CELL = 22
/** A turn's cell grows with its request count past this many. */
const CELL_SHARE = 3

/** Bar width that fits every request across the map (2–6px). */
function fitWidth(box: number, requests: number, turns: number): number {
  if (requests === 0 || box === 0) return 6
  return Math.max(2, Math.min(6, Math.floor((box - turns * 8) / requests) - 2))
}

/**
 * The session map: the main conversation's requests across turns, filling
 * the panel width on one baseline. Each turn is a cell (wider when it holds
 * more requests); the current turn is a tinted band with its number in
 * bold. A dashed line marks where a compaction happened and opens it; the
 * turn's other participants show as tabs below the map, not on it.
 */
export function Trend({
  data,
  turnSeq,
  selectedSeq,
  scopeId,
  scopeLabel,
  onSelect,
  t,
}: {
  readonly data: SessionTrend
  readonly turnSeq: number | null
  readonly selectedSeq: number | null
  readonly scopeId: string
  readonly scopeLabel: string
  readonly onSelect: (turnSeq: number, seq: number, scopeId: string) => void
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
  }, [turnSeq, scopeId, data, width])

  const requests = data.requests.filter(r => r.scopeId === scopeId)
  const main = scopeId === 'main'
  const compactions = main ? data.requests.filter(r => isCompaction(r.scopeId)) : []
  const turns = data.turns.filter(turn => requests.some(r => r.turnSeq === turn.turnSeq))
  const max = Math.max(1, ...requests.map(r => (r.usage ? inputTotal(r.usage) : 0)))
  const barWidth = fitWidth(width, requests.length, turns.length)
  /** Compactions of this turn that happened right before `next` (or at the turn's end). */
  const dividersBefore = (turn: number, next: TrendRequest | undefined, previous: TrendRequest | undefined) =>
    compactions.filter(c => c.turnSeq === turn
      && (previous === undefined || c.startedAt >= previous.startedAt)
      && (next === undefined || c.startedAt < next.startedAt))
  const divider = (turn: number, c: TrendRequest) => <button key={c.seq} type="button" className={css.trendCompaction} title={t('trend.compaction')} aria-label={t('trend.compaction')} onClick={() => onSelect(turn, c.seq, c.scopeId)} />

  return (
    <section aria-label={t('lens.trendScope', { scope: scopeLabel })}>
      <div ref={ref} className={css.trend} style={{ ['--trend-bar' as string]: `${barWidth}px` }}>
        {turns.map((turn) => {
          const rows = requests.filter(r => r.turnSeq === turn.turnSeq)
          const minWidth = Math.max(MIN_CELL, rows.length * (barWidth + 3) + 8)
          return (
            <div key={turn.turnSeq} className={css.trendGroup} data-current={turnSeq === turn.turnSeq}
              style={{ flex: `${Math.max(1, rows.length / CELL_SHARE)} 1 ${minWidth}px`, minWidth }}>
              <div className={css.trendBars}>
                {rows.map((r, i) => {
                  const total = r.usage ? inputTotal(r.usage) : 0,
                    hit = r.usage ? cachePct(r.usage) : null
                  return [
                    ...dividersBefore(turn.turnSeq, r, rows[i - 1]).map(c => divider(turn.turnSeq, c)),
                    <button
                      key={r.seq}
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
                    </button>,
                  ]
                })}
                {dividersBefore(turn.turnSeq, undefined, rows.at(-1)).map(c => divider(turn.turnSeq, c))}
              </div>
              <span className={css.trendTurn}>{turn.hostTurn ?? '·'}</span>
            </div>
          )
        })}
      </div>
      {requests.length === 0 && <span className={css.trendLabel}>{t('lens.trendEmpty')}</span>}
    </section>
  )
}
