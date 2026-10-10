import type { CapturedRequest } from '../types.ts'
import { aggregateCategories, cachePct, fmt, fmtK, fmtSpan, inputTotal, summaryText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './TokenView.module.css'
type T = InspectorTabProps['t']

/** The request identity and measurements remain visible in JSON mode. */
export function RequestFacts({ request: r, t, raw = false, onToggleRaw }: {
  readonly request: CapturedRequest
  readonly t: T
  readonly raw?: boolean
  readonly onToggleRaw?: () => void
}) {
  const u = r.usage
  const chars = aggregateCategories(r).reduce((n, c) => n + c.chars, 0)
  const duration = (ms: number | undefined) => ms === undefined ? '—' : fmtSpan(ms)
  const metrics = [
    { label: t('req.input'), value: u ? fmt(inputTotal(u)) : '—', unit: 'tok', sub: t('chain.chars', { count: fmt(chars) }) },
    { label: t('lens.hit'), value: u ? (cachePct(u)?.toFixed(1) ?? '—') : '—', unit: '%', sub: u ? `${fmt(u.cacheReadTokens ?? 0)} tok` : '—' },
    { label: t('lens.miss'), value: u ? fmt(u.inputTokens) : '—', unit: 'tok', sub: r.config.maxTokens === undefined ? '' : t('lens.outputLimit', { count: fmtK(r.config.maxTokens) }) },
    { label: t('lens.duration'), value: duration(r.timing.totalMs), unit: '', sub: `${t('req.output')} ${u ? fmt(u.outputTokens) : '—'} tok · ${t('lens.firstToken', { duration: duration(r.timing.waitMs) })}` },
  ]
  return <>
    <div className={css.detailHead}>
      <b>#{r.seq} · {summaryText(r.responseSummary, t('resp.directAnswer'))}</b>
      <span className={css.model}>{[r.config.provider, r.config.model].filter(Boolean).join('/') || '—'}</span>
      {onToggleRaw && <button type="button" className={css.jsonToggle} aria-label={t('view.raw')} title={t('view.raw')} aria-pressed={raw} onClick={onToggleRaw}>{'{ }'}</button>}
    </div>
    <div className={css.metrics}>
      {metrics.map(m => <div key={m.label}><span>{m.label}</span><b>{m.value}<small>{m.unit}</small></b><span title={m.sub}>{m.sub}</span></div>)}
    </div>
  </>
}

/** Provider usage and exact prefix comparison are distinct facts. */
export function CacheFacts({ request: r, t }: { readonly request: CapturedRequest; readonly t: T }) {
  const u = r.usage, prefix = r.prefix
  return <section>
    <h3 className={css.sectionTitle}>{t('lens.cache')}</h3>
    <div className={css.prefix}>
      {u && <>
        <div className={css.cacheStrip}><i style={{ width: `${cachePct(u) ?? 0}%` }} /></div>
        <div className={css.cacheLegend}><span><i />{t('lens.hit')} {fmt(u.cacheReadTokens ?? 0)}</span><span><i />{t('lens.miss')} {fmt(u.inputTokens)}</span></div>
      </>}
      {prefix === undefined ? <span>{t('lens.prefixUnknown')}</span> : prefix.changed ? <>
        <span>{t('lens.prefixChanged', { index: String(prefix.changed.index).padStart(3, '0'), seq: String(prefix.previousSeq) })}</span>
        <pre className={css.before}>− {prefix.changed.before}</pre>
        <pre className={css.after}>+ {prefix.changed.after}</pre>
      </> : <span>{t('lens.prefixSame', { seq: String(prefix.previousSeq), gap: fmtSpan(prefix.gapMs) })}</span>}
      {prefix?.toolsChanged && <div>{t('lens.toolsChanged')}</div>}
    </div>
  </section>
}
