import type { AgentScopeOverview, RequestConfig, RequestListItem } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { requestNumberText, fmt } from './aggregate.ts'
import css from './ConfigFacts.module.css'
type T = InspectorTabProps['t']

/** Only dispatch facts, not inferred provider defaults. */
export function ConfigFacts({ config = {}, t }: { config?: RequestConfig | undefined; t: T }) {
  return <div className={css.facts} role="group" aria-label={t('config.title')} title={t('config.hint')}>
    <div className={css.route}><b>{config.model || t('config.unknown')}</b><span>{config.provider || '—'}</span></div>
    <dl>
      <div><dt>{t('config.effort')}</dt><dd>{config.reasoningEffort ?? t('config.unknown')}</dd></div>
      <div><dt>{t('config.maxTokens')}</dt><dd>{config.maxTokens === undefined ? t('config.unknown') : `${fmt(config.maxTokens)} tok`}</dd></div>
      {config.temperature !== undefined && <div><dt>{t('config.temperature')}</dt><dd>{config.temperature}</dd></div>}
    </dl>
  </div>
}

/** Consecutive runs preserve A→B→A switches instead of collapsing to one scope snapshot. */
export function configRuns(requests: readonly RequestListItem[]) {
  const runs: { key: string; config?: RequestConfig | undefined; requests: RequestListItem[] }[] = []
  for (const r of [...requests].sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq)) {
    const c = r.config
    const key = JSON.stringify([c?.provider, c?.model, c?.reasoningEffort, c?.maxTokens, c?.temperature])
    const last = runs[runs.length - 1]
    if (last?.key === key) last.requests.push(r)
    else runs.push({ key, config: c, requests: [r] })
  }
  return runs
}

export function ScopeConfigs({ scope, onOpenRequest, t }: { scope: AgentScopeOverview; onOpenRequest: (seq: number, scopeId: string) => void; t: T }) {
  const runs = configRuns(scope.requests)
  if (!runs.length) return null
  return <section className={css.scope} aria-label={t('config.title')}>
    <h3>{t('config.runs', { count: String(runs.length) })}</h3>
    <div className={css.runs}>{runs.map(run => {
      const first = run.requests[0]!, last = run.requests[run.requests.length - 1]!
      return <div className={css.run} key={first.seq}>
        <button type="button" aria-label={t('config.open', { seq: requestNumberText(first) })} onClick={() => onOpenRequest(first.seq, scope.scopeId)}>#{requestNumberText(first)}{last.seq !== first.seq ? ` – #${requestNumberText(last)}` : ''}</button>
        <ConfigFacts config={run.config} t={t} />
      </div>
    })}</div>
  </section>
}
