import type { CapturedRequest } from '../types.ts'
import { cachePct, fmt, fmtSpan, inputTotal, summaryText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './TokenView.module.css'
/** Provider cache measurements and exact assembly differences are separate facts. */
export function RequestFacts({
  request: r,
  t,
}: {
  readonly request: CapturedRequest
  readonly t: InspectorTabProps['t']
}) {
  const u = r.usage,
    prefix = r.prefix
  return (
    <>
      <div className={css.detailHead}>
        <b>
          #{r.seq} · {summaryText(r.responseSummary, t('resp.directAnswer'))}
        </b>
        <span>
          {[r.config.provider, r.config.model].filter(Boolean).join('/')}
        </span>
      </div>
      <div className={css.metrics}>
        {[
          [t('req.input'), u ? `${fmt(inputTotal(u))} tok` : '—'],
          [
            t('lens.hit'),
            u
              ? `${cachePct(u) ?? '—'}% · ${fmt(u.cacheReadTokens ?? 0)} tok`
              : '—',
          ],
          [t('lens.miss'), u ? `${fmt(u.inputTokens)} tok` : '—'],
          [
            t('view.time'),
            r.timing.totalMs === undefined ? '—' : fmtSpan(r.timing.totalMs),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <section className={css.prefix}>
        <h3>{t('lens.cache')}</h3>
        {u && (
          <div className={css.cacheStrip}>
            <i style={{ width: `${cachePct(u) ?? 0}%` }} />
          </div>
        )}
        {prefix === undefined ? (
          <span>{t('lens.prefixUnknown')}</span>
        ) : prefix.changed ? (
          <>
            <span>
              {t('lens.prefixChanged', {
                index: String(prefix.changed.index),
                seq: String(prefix.previousSeq),
              })}
            </span>
            <pre className={css.before}>− {prefix.changed.before}</pre>
            <pre className={css.after}>+ {prefix.changed.after}</pre>
          </>
        ) : (
          <span>
            {t('lens.prefixSame', {
              seq: String(prefix.previousSeq),
              gap: fmtSpan(prefix.gapMs),
            })}
          </span>
        )}
        {prefix?.toolsChanged && <div>{t('lens.toolsChanged')}</div>}
      </section>
    </>
  )
}
