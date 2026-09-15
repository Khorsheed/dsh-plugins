import { useId, useState } from 'react'
import type { LocalAgentConfigurationChoice, LocalAgentMemberConfiguration, LocalAgentModelDirectory } from '../types.ts'
import type { LocalAgentKey } from './locales.ts'
import css from './MemberConfiguration.module.css'

export type ConfigurationTranslate = (key: LocalAgentKey) => string
const encoded = (choice: LocalAgentConfigurationChoice): string => choice.mode === 'value' ? `value:${choice.value}` : choice.mode
const decoded = (value: string): LocalAgentConfigurationChoice => value === 'inherit' || value === 'default' ? { mode: value } : { mode: 'value', value: value.slice(6) }

/** The native directory vocabulary is shared by members, invites and settings. */
export function ModelConfigurationFields({ directory, value, onChange, resolvedModel, disabled, inherit = true, showEffort = true, defaultLabel, t }: {
  directory?: LocalAgentModelDirectory | undefined
  value: LocalAgentMemberConfiguration
  onChange(value: LocalAgentMemberConfiguration): void
  resolvedModel?: string | undefined
  disabled?: boolean | undefined
  inherit?: boolean | undefined
  showEffort?: boolean | undefined
  defaultLabel?: string | undefined
  t: ConfigurationTranslate
}) {
  const id = useId()
  const [search, setSearch] = useState('')
  const entries = directory?.entries ?? []
  const model = value.model.mode === 'value' ? value.model.value : resolvedModel ?? directory?.defaultModel
  const entry = entries.find(entry => entry.value === model || entry.resolvedModel === model)
  const options = entry?.reasoning?.options ?? []
  const effort = value.effort.mode === 'value' ? value.effort.value : undefined
  const query = search.trim().toLowerCase()
  const candidates = entries.filter(entry => !query || `${entry.label} ${entry.value} ${entry.resolvedModel ?? ''}`.toLowerCase().includes(query))
  return <fieldset className={css.fields} disabled={disabled}>
    <legend>{t('configuration.model')}</legend>
    <div className={css.modes}>
      {inherit && <button type="button" aria-pressed={value.model.mode === 'inherit'} onClick={() => onChange({ ...value, model: { mode: 'inherit' } })}>{t('configuration.inherit')}</button>}
      <button type="button" aria-pressed={value.model.mode === 'default'} onClick={() => onChange({ ...value, model: { mode: 'default' } })}>{defaultLabel ?? t('configuration.default')}</button>
    </div>
    <label htmlFor={`${id}-search`}>{t('configuration.search')}</label>
    <input id={`${id}-search`} value={search} onChange={event => setSearch(event.target.value)} />
    <div className={css.candidates} role="listbox" aria-label={t('configuration.model')}>
      {candidates.map(candidate => <button key={candidate.value} type="button" role="option"
        aria-selected={value.model.mode === 'value' && value.model.value === candidate.value}
        onClick={() => onChange({ ...value, model: { mode: 'value', value: candidate.value } })}>
        <strong>{candidate.label}</strong>
        <span>{candidate.value}{candidate.resolvedModel ? ` → ${candidate.resolvedModel}` : ''}</span>
        <small>{t(`configuration.source.${candidate.source}`)}{candidate.hidden ? ` · ${t('configuration.hidden')}` : ''}</small>
        {candidate.description && <small>{candidate.description}</small>}
      </button>)}
      {candidates.length === 0 && <span>{t('configuration.empty')}</span>}
    </div>
    {directory?.customInput && <div className={css.custom}>
      <label htmlFor={`${id}-custom`}>{t('configuration.custom')}</label>
      <input id={`${id}-custom`} value={value.model.mode === 'value' ? value.model.value : ''}
        onChange={event => onChange({ ...value, model: { mode: 'value', value: event.target.value } })} />
    </div>}
    {showEffort && <>
    <label htmlFor={`${id}-effort`}>{t('configuration.effort')}</label>
    <select id={`${id}-effort`} value={encoded(value.effort)} onChange={event => onChange({ ...value, effort: decoded(event.target.value) })}>
      {inherit && <option value="inherit">{t('configuration.inherit')}</option>}
      <option value="default">{t('configuration.default')}</option>
      {options.map(option => <option key={option.value} value={`value:${option.value}`}>{option.label} ({option.value})</option>)}
      {value.effort.mode === 'value' && !options.some(option => option.value === effort) && <option value={encoded(value.effort)}>{value.effort.value} · {t('configuration.unverified')}</option>}
    </select>
    {options.length === 0 && <small>{t('configuration.effortUnknown')}</small>}
    {value.effort.mode === 'value' && options.find(option => option.value === effort)?.description && <small>{options.find(option => option.value === effort)?.description}</small>}
    </>}
    {directory && <small role="status">{t(`configuration.directory.${directory.status}`)}{!directory.complete ? ` · ${t('configuration.incomplete')}` : ''}{directory.reason ? ` · ${directory.reason}` : ''}</small>}
  </fieldset>
}
