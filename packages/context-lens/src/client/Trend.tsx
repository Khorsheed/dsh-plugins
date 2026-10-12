import { useEffect, useRef } from 'react'
import type { SessionTrend } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { cachePct, inputTotal } from './aggregate.ts'
import css from './InspectorPanel.module.css'
/** A body-free map of captured requests; drag, wheel or keyboard to reach older turns. */
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
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  )
  useEffect(() => {
    const el = ref.current,
      current = el?.querySelector<HTMLElement>('[data-current="true"]')
    if (el && current)
      el.scrollLeft =
        current.offsetLeft - el.clientWidth / 2 + current.offsetWidth / 2
  }, [turnSeq, scopeId, data])
  const requests = data.requests.filter(r => r.scopeId === scopeId)
  const turns = data.turns.filter(turn => requests.some(r => r.turnSeq === turn.turnSeq))
  const max = Math.max(
    1,
    ...requests.map((r) => (r.usage ? inputTotal(r.usage) : 0)),
  )
  return (
    <section aria-label={t('lens.trendScope', { scope: scopeLabel })}>
      <div className={css.trendLabel}>
        {t('lens.trendScope', { scope: scopeLabel })} · {t('lens.trendCount', { count: String(requests.length) })}
        <span>{t('lens.trendLegend')}</span>
      </div>
      <div
        ref={ref}
        className={css.trend}
        onPointerDown={(e) => {
          drag.current = {
            x: e.clientX,
            scroll: e.currentTarget.scrollLeft,
            moved: false,
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (Math.abs(dx) > 4) {
            d.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          if (d.moved) e.currentTarget.scrollLeft = d.scroll - dx
        }}
        onPointerUp={() => {
          setTimeout(() => {
            drag.current = null
          }, 0)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX))
            e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {turns.map((turn) => (
          <div
            key={turn.turnSeq}
            className={css.trendGroup}
            data-current={turnSeq === turn.turnSeq}
          >
            <div className={css.trendBars}>
              {requests
                .filter((r) => r.turnSeq === turn.turnSeq)
                .map((r) => {
                  const total = r.usage ? inputTotal(r.usage) : 0,
                    hit = r.usage ? cachePct(r.usage) : null
                  return (
                    <button
                      key={r.seq}
                      type="button"
                      className={css.trendBar}
                      data-selected={r.seq === selectedSeq}
                      aria-label={`${t('turn.label', { seq: String(turn.hostTurn ?? turn.turnSeq) })} #${r.seq} · ${hit ?? '—'}%`}
                      title={`#${r.seq} · ${total} tok · ${hit ?? '—'}%`}
                      style={{ height: `${Math.max(3, (total / max) * 40)}px` }}
                      onClick={() => {
                        if (!drag.current?.moved)
                          onSelect(turn.turnSeq, r.seq, r.scopeId)
                      }}
                    >
                      <i style={{ height: `${hit ?? 0}%` }} />
                    </button>
                  )
                })}
            </div>
            <span>{turn.hostTurn ?? '·'}</span>
          </div>
        ))}
      </div>
      {requests.length === 0 && <span className={css.trendLabel}>{t('lens.trendEmpty')}</span>}
    </section>
  )
}
