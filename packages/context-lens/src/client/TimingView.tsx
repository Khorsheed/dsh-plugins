import { Fragment, useState, type ReactNode } from 'react'
import type { AgentScopeOverview, RequestConfig, TurnTiming } from '../types.ts'
import {
  requestNumberText,
  cachePct,
  fmtK,
  fmtSpan,
  inputTotal,
  summaryText,
  TIMING_KINDS,
} from './aggregate.ts'
import { scopeTiming } from './timing.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './TimingView.module.css'
import { ScopeConfigs } from './ConfigFacts.tsx'
type T = InspectorTabProps['t']
export interface TimingViewProps {
  readonly timing: TurnTiming | null
  readonly scopes: readonly AgentScopeOverview[]
  readonly filterScopeId: string | undefined
  readonly filterIsSubagent: boolean
  readonly config: RequestConfig | undefined
  readonly onOpenRequest: (seq: number, scopeId: string) => void
  readonly onSelectScope?: (scopeId: string) => void
  readonly t: T
}

/** All agents have separate lanes; cards and tables always describe the selected agent. */
export function TimingView({
  timing,
  scopes,
  filterScopeId,
  onOpenRequest,
  onSelectScope,
  t,
}: TimingViewProps): ReactNode {
  const [sort, setSort] = useState<
    'calls' | 'errors' | 'think' | 'args' | 'exec' | 'total'
  >('total')
  const [open, setOpen] = useState<Set<string>>(new Set(['wait']))
  const scope =
    scopes.find((s) => s.scopeId === (filterScopeId ?? 'main')) ?? scopes[0]
  if (!timing || !scope) return <div role="status">{t('state.loading')}</div>
  const requestBySeq = new Map(scopes.flatMap(s => s.requests).map(r => [r.seq, r]))
  const numberOf = (seq: number) => requestNumberText(requestBySeq.get(seq))
  const data = scopeTiming(timing, scope)
  const rows = [...data.tools].sort((a, b) => b[sort] - a[sort])
  const keys = ['calls', 'errors', 'think', 'args', 'exec', 'total'] as const
  const nonKeys = ['wait', 'text', 'direct', 'slack'] as const
  const totalTools = rows.reduce((n, r) => n + r.total, 0)
  const start = timing.startedAt ?? Math.min(...scopes.map((s) => s.startedAt))
  const end = Math.max(
    start + timing.totalMs,
    ...timing.lanes.map((l) => l.startedAt + l.durationMs),
  )
  const span = Math.max(1, end - start)
  return (
    <div className={css.scroll}>
      <ScopeConfigs scope={scope} onOpenRequest={onOpenRequest} t={t} />
      <div className={css.timeSummary}>
        {[
          [
            scope.kind === 'main' ? t('time.total') : t('time.totalScope'),
            data.total,
            t('lens.equation'),
          ],
          [
            t('lens.model'),
            data.model,
            `${scope.requests.length} · ${t('time.bucket.reasoning')} ${fmtSpan(data.think)}`,
          ],
          [
            t('lens.tools'),
            data.exec,
            `${t('lens.calls')} ${rows.reduce((n, r) => n + r.calls, 0)} · ${t('lens.errors')} ${rows.reduce((n, r) => n + r.errors, 0)}`,
          ],
          [t('lens.other'), data.gaps, t('lens.gaps')],
        ].map(([label, value, sub]) => (
          <div className={css.cell} key={String(label)}>
            <div className={css.k}>{label}</div>
            <div className={css.v}>{fmtSpan(Number(value))}</div>
            <div className={css.k}>{sub}</div>
          </div>
        ))}
      </div>
      {scopes.some(s => s.requests.some(r => r.timingApproximate)) && <div className={css.stateNote}>{t('compaction.timingHint')}</div>}
      {data.overlap > 0 && (
        <div className={css.stateNote}>{t('lens.overlap')}</div>
      )}
      {scopes.length > 1 && (
        <div className={css.stateNote}>{t('lens.nested')}</div>
      )}
      <section>
        <h3>{t('lens.timeline')}</h3>
        <div className={css.legend}>
          {TIMING_KINDS.map((k) => (
            <span key={k}>
              <i className={css.dot} data-bucket={k} /> {t(`time.bucket.${k}`)}
            </span>
          ))}
        </div>
        {scopes.map((s) => (
          <div
            key={s.scopeId}
            className={css.lane}
            data-dim={s.scopeId !== scope.scopeId}
          >
            <button
              type="button"
              className={css.laneName}
              onClick={() => onSelectScope?.(s.scopeId)}
            >
              {s.kind === 'main' ? t('lens.main') : (s.label ?? s.scopeId)}
            </button>
            <div className={css.timeline}>
              {timing.lanes
                .filter((l) => l.scopeId === s.scopeId)
                .map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    className={css.blk}
                    data-bucket={l.kind}
                    title={`#${numberOf(l.requestSeq)} ${l.tool ?? t(`time.bucket.${l.kind}`)} · ${fmtSpan(l.durationMs)}`}
                    aria-label={`#${numberOf(l.requestSeq)} ${t(`time.bucket.${l.kind}`)}`}
                    style={{
                      left: `${((l.startedAt - start) / span) * 100}%`,
                      width: `${Math.max(0.3, (l.durationMs / span) * 100)}%`,
                    }}
                    onClick={() => onOpenRequest(l.requestSeq, l.scopeId)}
                  />
                ))}
            </div>
          </div>
        ))}
        <div className={css.tlScale}>
          <span>0</span>
          <span>{fmtSpan(span / 2)}</span>
          <span>{fmtSpan(span)}</span>
        </div>
      </section>
      <section>
        <h3 title={t('lens.attribution')}>{t('lens.toolTime')} ⓘ</h3>
        <div className={css.tableScroll}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{t('lens.tool')}</th>
                {keys.map((k) => (
                  <th key={k} aria-sort={sort === k ? 'descending' : 'none'}>
                    <button type="button" onClick={() => setSort(k)}>
                      {t(`lens.${k}`)}
                      {sort === k ? ' ↓' : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tool}>
                  <td>{r.tool}</td>
                  {keys.map((k) => (
                    <td key={k} data-error={k === 'errors' && r[k] > 0}>
                      {k === 'calls' || k === 'errors' ? (
                        r[k]
                      ) : (
                        <>
                          <i
                            className={css.dataBar}
                            style={{
                              width: `${(r[k] / Math.max(1, ...rows.map((v) => v[k]))) * 100}%`,
                            }}
                          />
                          {fmtSpan(r[k])}
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('lens.total')}</td>
                {keys.map((k) => (
                  <td key={k}>
                    {k === 'calls' || k === 'errors'
                      ? rows.reduce((n, r) => n + r[k], 0)
                      : fmtSpan(rows.reduce((n, r) => n + r[k], 0))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section>
        <h3>{t('lens.nonTool')}</h3>
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('lens.type')}</th>
              <th>{t('lens.calls')}</th>
              <th>{t('lens.longest')}</th>
              <th>{t('lens.total')}</th>
            </tr>
          </thead>
          <tbody>
            {nonKeys.map((k) => {
              const items = [...data.non[k]]
                .filter(([, ms]) => ms > 0)
                .sort((a, b) => b[1] - a[1])
              if (!items.length) return null
              return (
                <Fragment key={k}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        aria-expanded={open.has(k)}
                        onClick={() =>
                          setOpen((p) => {
                            const n = new Set(p)
                            if (n.has(k)) n.delete(k)
                            else n.add(k)
                            return n
                          })
                        }
                      >
                        {open.has(k) ? '▾' : '▸'} {t(`lens.${k}`)}
                      </button>
                    </td>
                    <td>{items.length}</td>
                    <td>
                      #{numberOf(items[0]![0])} {fmtSpan(items[0]![1])}
                    </td>
                    <td>{fmtSpan(items.reduce((n, [, ms]) => n + ms, 0))}</td>
                  </tr>
                  {open.has(k) && (
                    <tr>
                      <td colSpan={4}>
                        {items.map(([seq, ms]) => {
                          const r = scope.requests.find((r) => r.seq === seq)!
                          return (
                            <button
                              key={seq}
                              type="button"
                              className={css.nonRow}
                              onClick={() => onOpenRequest(seq, scope.scopeId)}
                            >
                              <span>#{numberOf(seq)}</span>
                              <span>
                                {summaryText(
                                  r.responseSummary,
                                  t('resp.directAnswer'), t('compaction.title'),
                                )}
                              </span>
                              {k === 'wait' && (
                                <span>
                                  {t('lens.hit')}{' '}
                                  {r.usage
                                    ? `${cachePct(r.usage) ?? '—'}% · ${fmtK(inputTotal(r.usage))}`
                                    : '—'}
                                </span>
                              )}
                              <b>{fmtSpan(ms)}</b>
                            </button>
                          )
                        })}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            <tr>
              <td>{t('lens.gaps')}</td>
              <td>—</td>
              <td>—</td>
              <td>{fmtSpan(data.gaps)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{t('lens.total')}</td>
              <td />
              <td />
              <td>{fmtSpan(data.total - totalTools)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  )
}
