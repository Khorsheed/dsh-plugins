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
/** Stretches of one lane's window with no activity, tagged by where they sit. */
function idleSpans(lanes: readonly { startedAt: number; durationMs: number }[], from: number, to: number): { from: number; to: number; head: boolean; tail: boolean }[] {
  const out: { from: number; to: number; head: boolean; tail: boolean }[] = []
  let cursor = from
  for (const lane of [...lanes].sort((a, b) => a.startedAt - b.startedAt)) {
    if (lane.startedAt > cursor) out.push({ from: cursor, to: Math.min(lane.startedAt, to), head: cursor === from, tail: false })
    cursor = Math.max(cursor, lane.startedAt + lane.durationMs)
  }
  if (cursor < to) out.push({ from: cursor, to, head: lanes.length === 0, tail: lanes.length > 0 })
  return out.filter((g) => g.to > g.from)
}

/** Each non-tool row's timeline color, so the table and the timeline legend read alike. */
const NON_BUCKET = { wait: 'wait', text: 'text', direct: 'reasoning', slack: 'other' } as const

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
  /** Idle time, split by where it sits (rows only when present). */
  const idleRows = ([['lens.gapsHead', data.gapsHead], ['lens.gaps', data.gapsBetween], ['lens.gapsTail', data.gapsTail]] as const)
    .filter(([, ms]) => ms >= 50)
  /** The non-tool table's share cue scales to its largest row. */
  const nonMax = Math.max(1, ...nonKeys.map((k) => [...data.non[k].values()].reduce((n, ms) => n + ms, 0)), ...idleRows.map(([, ms]) => ms))
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
          [t('lens.other'), data.gaps, [
            ...data.gapsHead >= 50 ? [`${t('lens.gapsHead')} ${fmtSpan(data.gapsHead)}`] : [],
            ...data.gapsBetween >= 50 ? [`${t('lens.gaps')} ${fmtSpan(data.gapsBetween)}`] : [],
            ...data.gapsTail >= 50 ? [`${t('lens.gapsTail')} ${fmtSpan(data.gapsTail)}`] : [],
          ].join(' · ') || t('lens.gaps')],
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
          <span><i className={css.dotIdle} /> {t('time.idle')}</span>
        </div>
        {scopes.map((s) => (
          <div
            key={s.scopeId}
            className={css.lane}
            data-dim={scopes.length > 1 ? String(s.scopeId !== scope.scopeId) : undefined}
          >
            <button
              type="button"
              className={css.laneName}
              onClick={() => onSelectScope?.(s.scopeId)}
            >
              {s.kind === 'main' ? t('lens.main') : (s.label ?? s.scopeId)}
            </button>
            <div className={css.timeline}>
              {idleSpans(timing.lanes.filter((l) => l.scopeId === s.scopeId), s.kind === 'main' ? start : s.startedAt, s.kind === 'main' ? end : (s.endedAt ?? end))
                .filter((g) => g.to - g.from >= Math.max(200, span * 0.01))
                .map((g) => {
                  const where = g.head ? t('lens.gapsHead') : g.tail ? t('lens.gapsTail') : t('lens.gaps')
                  const label = `${t('time.idle')} · ${where} ${fmtSpan(g.to - g.from)}`
                  return <span key={`idle-${g.from}`} className={css.idle} title={label} aria-label={label}
                    style={{ left: `${((g.from - start) / span) * 100}%`, width: `${((g.to - g.from) / span) * 100}%` }} />
                })}
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
        <h3 className={css.titleRow}>{t('lens.toolTime')}<abbr className={css.info} title={t('lens.attribution')}>i</abbr></h3>
        <div className={css.tableScroll}>
          <table className={css.tt}>
            <thead>
              <tr>
                <th>{t('lens.tool')}</th>
                {keys.map((k) => (
                  <th key={k} aria-sort={sort === k ? 'descending' : 'none'} data-sorted={sort === k}>
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
                    <td
                      key={k}
                      data-zero={r[k] === 0 || (k !== 'calls' && k !== 'errors' && r[k] < 50)}
                      data-error={k === 'errors' && r[k] > 0}
                      data-total={k === 'total'}
                      style={k === 'total' ? { ['--share' as string]: String(r.total / Math.max(1, ...rows.map((v) => v.total))) } : undefined}
                    >
                      <span>{k === 'calls' || k === 'errors' ? r[k] : fmtSpan(r[k])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('lens.total')}</td>
                {keys.map((k) => {
                  const sum = rows.reduce((n, r) => n + r[k], 0)
                  return <td key={k} data-zero={sum === 0}>{k === 'calls' || k === 'errors' ? sum : fmtSpan(sum)}</td>
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section>
        <h3>{t('lens.nonTool')}</h3>
        <div className={css.tableScroll}>
          <table className={css.tt}>
            <thead>
              <tr>
                <th>{t('lens.type')}</th>
                <th>{t('lens.calls')}</th>
                <th>{t('lens.longest')}</th>
                <th data-sorted="true">{t('lens.total')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className={css.ttGroup}><td colSpan={4}>{t('time.groupModel')}</td></tr>
              {nonKeys.map((k) => {
                const items = [...data.non[k]]
                  .filter(([, ms]) => ms > 0)
                  .sort((a, b) => b[1] - a[1])
                if (!items.length) return null
                const sum = items.reduce((n, [, ms]) => n + ms, 0)
                return (
                  <Fragment key={k}>
                    <tr data-open={open.has(k)}>
                      <td>
                        <button
                          type="button"
                          className={css.ttToggle}
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
                          <span className={css.ttChev} aria-hidden="true">›</span>
                          <i className={css.ttSwatch} data-bucket={NON_BUCKET[k]} />
                          {t(`lens.${k}`)}
                        </button>
                      </td>
                      <td>{items.length}</td>
                      <td>#{numberOf(items[0]![0])} {fmtSpan(items[0]![1])}</td>
                      <td data-total="true" data-zero={sum < 50} style={{ ['--share' as string]: String(sum / nonMax) }}><span>{fmtSpan(sum)}</span></td>
                    </tr>
                    {open.has(k) && items.map(([seq, ms], i) => {
                      const r = scope.requests.find((r) => r.seq === seq)!
                      return (
                        <tr key={seq} className={css.ttDetail} data-last={i === items.length - 1}>
                          <td>
                            <button type="button" onClick={() => onOpenRequest(seq, scope.scopeId)}>
                              <span className={css.ttReq}>#{numberOf(seq)}</span>
                              {summaryText(r.responseSummary, t('resp.directAnswer'), t('compaction.title'), t('resp.thinking'))}
                            </button>
                          </td>
                          <td />
                          <td className={css.ttMeta}>
                            {k === 'wait' && r.usage ? `${t('lens.hit')} ${cachePct(r.usage) ?? '—'}% · ${fmtK(inputTotal(r.usage))}` : ''}
                          </td>
                          <td>{fmtSpan(ms)}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              {idleRows.length > 0 && <tr className={css.ttGroup}><td colSpan={4}>{t('time.idle')}</td></tr>}
              {idleRows.map(([key, ms]) => (
                <tr key={key}>
                  <td><span className={css.ttToggle}><span className={css.ttChev} aria-hidden="true" /><i className={css.ttSwatch} data-bucket="idle" />{t(key)}</span></td>
                  <td data-zero="true">—</td>
                  <td data-zero="true">—</td>
                  <td data-total="true" style={{ ['--share' as string]: String(ms / nonMax) }}><span>{fmtSpan(ms)}</span></td>
                </tr>
              ))}
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
        </div>
      </section>
    </div>
  )
}
