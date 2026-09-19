import { useState } from 'react'
import type { LocalAgentMemberConfiguration, LocalAgentModelDirectory } from '../types.ts'
import type { LocalAgentKey } from './locales.ts'
import css from './MemberConfiguration.module.css'

export type ConfigurationTranslate = (key: LocalAgentKey) => string

/** User choices are concrete; legacy inheritance stays a backend compatibility concern. */
export function ModelConfigurationFields({ directory, value, onChange, resolvedModel, resolvedEffort, disabled, showEffort = true, t }: {
  directory?: LocalAgentModelDirectory | undefined
  value: LocalAgentMemberConfiguration
  onChange(value: LocalAgentMemberConfiguration): void
  resolvedModel?: string | undefined
  resolvedEffort?: string | undefined
  disabled?: boolean | undefined
  showEffort?: boolean | undefined
  t: ConfigurationTranslate
}) {
  const [search, setSearch] = useState('')
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>(showEffort ? 'root' : 'model')
  const entries = directory?.entries ?? []
  const model = value.model.mode === 'value' ? value.model.value : resolvedModel ?? entries.find(entry => !entry.hidden)?.value
  const entry = entries.find(entry => entry.value === model || entry.resolvedModel === model)
  const options = entry?.reasoning?.options ?? []
  const effort = value.effort.mode === 'value' ? value.effort.value : resolvedEffort ?? entry?.reasoning?.default ?? options[0]?.value
  const query = search.trim().toLowerCase()
  const candidates = entries.filter(entry => !query || `${entry.label} ${entry.value} ${entry.resolvedModel ?? ''}`.toLowerCase().includes(query))
  const selectModel = (next: string): void => {
    const reasoning = entries.find(entry => entry.value === next)?.reasoning
    const nextEffort = next === model || reasoning?.options.some(option => option.value === effort) ? effort : reasoning?.default ?? reasoning?.options[0]?.value
    onChange({ model: { mode: 'value', value: next }, effort: nextEffort === undefined ? { mode: 'default' } : { mode: 'value', value: nextEffort } })
    setPane(showEffort ? 'root' : 'model')
  }
  return <fieldset className={css.fields} disabled={disabled}>
    {pane === 'root' ? <>
      <button type="button" className={css.menuRow} onClick={() => setPane('model')}><span>{t('configuration.model')}</span>{' '}<span>{entry?.label ?? model ?? t('loading')} ›</span></button>
      <button type="button" className={css.menuRow} disabled={options.length === 0} onClick={() => setPane('effort')}><span>{t('configuration.effort')}</span>{' '}<span>{options.find(option => option.value === effort)?.label ?? effort ?? t('configuration.unavailable')}{options.length ? ' ›' : ''}</span></button>
      {options.length === 0 && <small role="status">{t('configuration.effortUnknown')}</small>}
    </> : <>
      {showEffort && <button type="button" className={css.back} onClick={() => setPane('root')}>‹ {t('configuration.back')}</button>}
      {pane === 'model' ? <>
        <input aria-label={t('configuration.search')} placeholder={t('configuration.search')} value={search} onChange={event => setSearch(event.target.value)} />
        <div className={css.candidates} role="listbox" aria-label={t('configuration.model')}>
          {candidates.map(candidate => <button key={candidate.value} type="button" role="option" aria-selected={candidate.value === model}
            onClick={() => selectModel(candidate.value)}><span className={css.optionLabel}><strong>{candidate.label}</strong>{candidate.value === model && <span aria-hidden="true" className={css.check}>✓</span>}</span><small>{candidate.value}{candidate.resolvedModel ? ` → ${candidate.resolvedModel}` : ''}</small></button>)}
          {candidates.length === 0 && <span>{t('configuration.empty')}</span>}
        </div>
      </> : <div className={css.candidates} role="listbox" aria-label={t('configuration.effort')}>
        {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === effort}
          onClick={() => { if (model) onChange({ model: { mode: 'value', value: model }, effort: { mode: 'value', value: option.value } }); setPane('root') }}>
          <span className={css.optionLabel}><strong>{option.label}</strong>{option.value === effort && <span aria-hidden="true" className={css.check}>✓</span>}</span>{option.description && <small>{option.description}</small>}
        </button>)}
      </div>}
    </>}
    {directory && directory.status !== 'ready' && <small role="status">{t(`configuration.directory.${directory.status}`)}</small>}
  </fieldset>
}
