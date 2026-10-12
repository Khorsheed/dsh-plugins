import type { CapturedRequest } from '../types.ts'
import { aggregateCategories, cachePct, fmt, fmtK, fmtSpan, inputTotal, summaryText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './TokenView.module.css'
import { ConfigFacts } from './ConfigFacts.tsx'
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
      {onToggleRaw && <button type="button" className={css.jsonToggle} aria-label={t('view.raw')} title={t('view.raw')} aria-pressed={raw} onClick={onToggleRaw}>{'{ }'}</button>}
    </div>
    <ConfigFacts config={r.config} t={t} />
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
      {prefix === undefined ? <span title={t('lens.prefixBaselineHint')}>{t('lens.prefixUnknown')}</span> : prefix.changed ? <>
        <span>{t('lens.prefixChanged', { index: String(prefix.changed.index).padStart(3, '0'), seq: String(prefix.previousSeq) })}</span>
        <PrefixDifference changed={prefix.changed} t={t} />
      </> : <span>{t('lens.prefixSame', { seq: String(prefix.previousSeq), gap: fmtSpan(prefix.gapMs) })}</span>}
      {prefix?.toolsChanged && <div>{t('lens.toolsChanged')}</div>}
    </div>
  </section>
}

function PrefixDifference({ changed, t }: { changed: NonNullable<NonNullable<CapturedRequest['prefix']>['changed']>; t: T }) {
  const d = changed.text
  if (!d) return <><pre className={css.before}>− {changed.before}</pre><pre className={css.after}>+ {changed.after}</pre></>
  const leading = `${d.leadingOmitted ? '…' : ''}${d.leading}`
  const trailing = `${d.trailing}${d.trailingOmitted ? '…' : ''}`
  const truncated = d.removedChars > 160 || d.addedChars > 160
  return <>
    {changed.beforeCategory !== changed.afterCategory && <span>{t('lens.diffCategory', { before: changed.beforeCategory ? t(`cat.${changed.beforeCategory}`) : '—', after: changed.afterCategory ? t(`cat.${changed.afterCategory}`) : '—' })}</span>}
    {(d.removedChars > 0 || d.addedChars > 0) && <>
      <span className={css.diffMeta}>{t('lens.diffPosition', { offset: fmt(d.offset + 1), before: fmt(d.removedChars), after: fmt(d.addedChars) })}</span>
      <pre className={css.diffLine}><span className={css.before}>− </span>{leading}{d.removedChars > 0 && <del>{d.removed}{d.removedChars > 160 ? '…' : ''}</del>}{trailing}{!leading && !d.removed && !trailing && t('lens.diffEmpty')}</pre>
      <pre className={css.diffLine}><span className={css.after}>+ </span>{leading}{d.addedChars > 0 && <ins>{d.added}{d.addedChars > 160 ? '…' : ''}</ins>}{trailing}{!leading && !d.added && !trailing && t('lens.diffEmpty')}</pre>
      {truncated && <span className={css.diffMeta}>{t('lens.diffTruncated')}</span>}
    </>}
  </>
}
