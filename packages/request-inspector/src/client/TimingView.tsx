/**
 * The 耗时分布 tab: the whole-turn (or one delegation run's) timing view — the
 * six-bucket split (模型等待/模型思考/工具参数/模型输出/工具执行/其他开销),
 * the strictly ordered lane timeline, the per-tool breakdown, and per-call
 * rows that click through to the token tab's request. The lanes carry their
 * scope, so the scope chips filter this view exactly the way they filter the
 * token tab; whole-turn sums equal the host's `TurnTiming.buckets` by
 * construction.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import type { ReactNode } from 'react'
import type { AgentScopeOverview, RequestConfig, RequestListItem, TurnTiming } from '../types.ts'
import {
  TIMING_KINDS, fmt, fmtClock, fmtSpan, summarizeLanes, type TimingKind,
} from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './TimingView.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** The bucket label's locale key. */
function bucketLabelKey(kind: TimingKind): `time.bucket.${TimingKind}` {
  return `time.bucket.${kind}`
}

/** The design's per-call chips show the five model-side buckets (not 其他开销). */
const CALL_ROW_KINDS = TIMING_KINDS.filter(kind => kind !== 'other')

export interface TimingViewProps {
  /** The turn's timing payload (null while loading). */
  readonly timing: TurnTiming | null
  /** The turn's scopes (the call rows' usage/summary join). */
  readonly scopes: readonly AgentScopeOverview[]
  /** The scope the chips selected; undefined = the whole turn. */
  readonly filterScopeId: string | undefined
  /** Whether the filter scope is a delegation run (the summary label switches). */
  readonly filterIsSubagent: boolean
  /** The viewed scope's config line (the design's `config · provider/model · maxTokens`). */
  readonly config: RequestConfig | undefined
  /** Click-through: open the token tab on this request. */
  readonly onOpenRequest: (seq: number, scopeId: string) => void
  readonly t: T
}

/** The config line's text: provider/model · maxTokens, or — when nothing was captured. */
function configText(config: RequestConfig | undefined, t: T): string {
  const parts: string[] = []
  const route = [config?.provider, config?.model].filter(part => part !== undefined && part.length > 0).join('/')
  if (route.length > 0) parts.push(route)
  if (config?.maxTokens !== undefined) parts.push(`${t('detail.maxTokens')} ${fmt(config.maxTokens)}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** The timing tab body. */
export function TimingView({ timing, scopes, filterScopeId, filterIsSubagent, config, onOpenRequest, t }: TimingViewProps): ReactNode {
  if (timing === null) {
    return <div className={css.stateNote} role="status">{t('state.loading')}</div>
  }
  const summary = summarizeLanes(timing.lanes, filterScopeId)
  const requestInfo = new Map<number, RequestListItem>()
  for (const scope of scopes) {
    for (const request of scope.requests) requestInfo.set(request.seq, request)
  }
  const spanMs = Math.max(0, summary.t1 - summary.t0)
  const outputTokens = summary.requests.reduce((n, row) => n + (requestInfo.get(row.requestSeq)?.usage?.outputTokens ?? 0), 0)
  const generatedMs = summary.buckets.reasoning + summary.buckets['tool-args'] + summary.buckets.text
  const grandTotal = TIMING_KINDS.reduce((n, kind) => n + summary.buckets[kind], 0)
  const mid = summary.t0 + spanMs / 2
  return (
    <div className={css.scroll}>
      <div className={css.timeSummary}>
        <div className={css.cell}>
          <div className={css.v}>{spanMs > 0 ? fmtSpan(spanMs) : fmtSpan(timing.totalMs)}</div>
          <div className={css.k}>{filterIsSubagent ? t('time.totalScope') : t('time.total')}</div>
        </div>
        <div className={css.cell}>
          <div className={css.v}>{summary.requests.length}</div>
          <div className={css.k}>{t('time.calls')}</div>
        </div>
        <div className={css.cell}>
          <div className={css.v}>{fmt(outputTokens)}</div>
          <div className={css.k}>{t('time.outputTok')}</div>
        </div>
        <div className={css.cell}>
          <div className={css.v}>{fmtSpan(generatedMs)}</div>
          <div className={css.k}>{t('time.genTime')}</div>
        </div>
      </div>
      <div className={css.configLine}>{t('detail.config')} · <span className={css.mono}>{configText(config, t)}</span></div>
      <div className={css.catbarWrap}>
        <div className={css.catbarTitle}>
          <span>{t('time.catTitle', { scope: filterIsSubagent ? t('time.scopeRun') : t('time.scopeTurn') })}</span>
          <span className={css.mono}>{fmtSpan(spanMs)}</span>
        </div>
        <div className={css.catbar} role="presentation">
          {TIMING_KINDS.map(kind => (
            <div key={kind} data-bucket={kind} style={{ flex: `${summary.buckets[kind]} 1 0` }} />
          ))}
        </div>
        <div className={css.legend}>
          {TIMING_KINDS.map(kind => (
            <div key={kind} className={css.legendItem}>
              <span className={css.dot} data-bucket={kind} />
              <span className={css.legendName}>
                {t(bucketLabelKey(kind))}
                {summary.counts[kind] > 0 && ` · ${t('time.times', { count: String(summary.counts[kind]) })}`}
              </span>
              <span className={css.mono}>
                {fmtSpan(summary.buckets[kind])} · {grandTotal === 0 ? '0' : (summary.buckets[kind] / grandTotal * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        <div className={css.timeline} role="presentation">
          {summary.t1 > summary.t0 && timing.lanes
            .filter(lane => filterScopeId === undefined || lane.scopeId === filterScopeId)
            .map((lane, index) => (
              <div
                key={`${lane.requestSeq}-${lane.startedAt}-${index}`}
                className={css.blk}
                data-bucket={lane.kind}
                style={{
                  left: `${(lane.startedAt - summary.t0) / spanMs * 100}%`,
                  width: `${Math.max(lane.durationMs / spanMs * 100, 0.3)}%`,
                }}
              />
            ))}
        </div>
        <div className={css.tlScale}>
          <span>{fmtClock(summary.t0)}</span>
          <span>{fmtClock(mid)}</span>
          <span>{fmtClock(summary.t1)}</span>
        </div>
      </div>
      <div className={css.byTool}>
        <div className={css.byToolTitle}>{t('time.byTool')}</div>
        {summary.tools.length === 0 && <div className={css.stateNote}>{t('seg.empty')}</div>}
        {summary.tools.map(tool => (
          <div key={tool.tool} className={css.paraRow}>
            <span className={css.pp}>{tool.tool}</span>
            <span className={css.pc}>×{tool.calls}</span>
            <span className={css.pc}>{t('time.bucket.tool-args')} {fmtSpan(tool.argsMs)}</span>
            <span className={css.pcStrong}>{t('time.bucket.tool-exec')} {fmtSpan(tool.execMs)}</span>
          </div>
        ))}
      </div>
      {summary.requests.map(row => {
        const info = requestInfo.get(row.requestSeq)
        return (
          <button
            key={row.requestSeq}
            type="button"
            className={css.callRow}
            onClick={() => { onOpenRequest(row.requestSeq, row.scopeId) }}
          >
            <span className={css.cr1}>
              <span className={css.cn}>#{row.requestSeq}</span>
              <span className={css.ct}>{fmtClock(row.startedAt)}</span>
              <span className={css.cs}>{info?.responseSummary ?? ''}</span>
              <span className={css.cm}>
                {t('time.callMeta', {
                  tokens: fmt(info?.usage?.outputTokens ?? 0),
                  duration: fmtSpan(row.endedAt - row.startedAt),
                })}
              </span>
            </span>
            <span className={css.cr2}>
              {CALL_ROW_KINDS.map(kind => row.byKind[kind] > 0 && (
                <span key={kind} className={css.cr2Item}>
                  <span className={css.dot} data-bucket={kind} />
                  {t(bucketLabelKey(kind))} <b>{fmtSpan(row.byKind[kind])}</b>
                </span>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
