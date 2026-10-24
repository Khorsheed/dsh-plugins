import { useEffect, useRef, useState } from 'react'
import type { LocalAgentModelDirectory } from '../types.ts'
import { ModelConfigurationFields, type ConfigurationTranslate } from './ModelConfigurationFields.tsx'
import css from './MemberConfiguration.module.css'
import { useConfigurationMenu } from './use-configuration-menu.ts'

export interface ModelDirectoryFace {
  read(refresh: boolean): Promise<LocalAgentModelDirectory | null>
  follow(signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory>
}
export interface HarnessModelPickerProps {
  face: ModelDirectoryFace
  value: string
  onChange(value: string): void
  /**
   * Present = the menu also offers the model's reasoning-effort row
   * ('' = follow the harness default). Absent = the picker stays model-only
   * (settings cards' behavior).
   */
  effort?: { value: string; onChange(value: string): void } | undefined
  disabled?: boolean | undefined
  defaultLabel?: string | undefined
  /**
   * Present = render as form fields (a labelled model select, plus an effort
   * select when `effort` is present) in the host form's own classes, instead
   * of the drill-down menu — for a dialog whose other fields are selects.
   */
  fields?: { field?: string | undefined; label?: string | undefined; select?: string | undefined; row?: string | undefined } | undefined
  t: ConfigurationTranslate
}

/** Discover while expanded or resolving an empty choice; settings remain caller-owned drafts. */
export function HarnessModelPicker({ face, value, onChange, effort, disabled, fields, t }: HarnessModelPickerProps) {
  const menu = useConfigurationMenu('below')
  const { setOpen } = menu
  // Form fields show the directory all the time: discovery runs as if open.
  const open = menu.open || fields !== undefined
  const [surface, setSurface] = useState<{ face: ModelDirectoryFace; directory: LocalAgentModelDirectory }>()
  const directory = surface?.face === face ? surface.directory : undefined
  const currentFace = useRef(face)
  currentFace.current = face
  const setDirectory = (directory: LocalAgentModelDirectory): void => { if (currentFace.current === face) setSurface({ face, directory }) }
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!open && value) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const follow = async (): Promise<void> => {
      try {
        for await (const result of face.follow(controller.signal)) {
          if (controller.signal.aborted) return
          setDirectory(result); setError(undefined)
        }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
      if (!controller.signal.aborted) timer = setTimeout(() => { void follow() }, 1_000)
    }
    void follow()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [face, open, Boolean(value)])
  useEffect(() => {
    const first = directory?.entries.find(entry => !entry.hidden)
    if (!value && !disabled && first) onChange(first.value)
  }, [directory, value, disabled, onChange])
  const entry = directory?.entries.find(entry => entry.value === value)
  if (fields !== undefined) return <ModelSelects directory={directory} error={error} value={value} onChange={onChange} effort={effort} disabled={disabled} classes={fields} t={t} />
  return <details ref={menu.root} className={`${css.root} ${css.settings}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label={t('configuration.model')} aria-expanded={open}><span className={css.triggerLabel}>{entry?.label ?? (value || t('configuration.choose'))}</span></summary>
    {open && <div ref={menu.panel} className={css.panel} style={menu.style}>
      {error && <div role="alert">{error}</div>}
      {!directory && <span role="status">{t('loading')}</span>}
      <ModelConfigurationFields directory={directory} value={{ model: value ? { mode: 'value', value } : { mode: 'default' }, effort: effort !== undefined && effort.value !== '' ? { mode: 'value', value: effort.value } : { mode: 'default' } }}
        onChange={selection => {
          onChange(selection.model.mode === 'value' ? selection.model.value : '')
          effort?.onChange(selection.effort.mode === 'value' ? selection.effort.value : '')
          // The effort-capable menu navigates between panes instead of
          // closing on a pick (the MemberConfiguration card's behavior).
          if (effort === undefined) setOpen(false)
        }}
        showEffort={effort !== undefined} disabled={disabled} t={t} />
    </div>}
  </details>
}

/** The form-field face: a model select and, when asked, the model's effort select ('' = the model's default). */
function ModelSelects({ directory, error, value, onChange, effort, disabled, classes, t }: {
  directory: LocalAgentModelDirectory | undefined
  error: string | undefined
  value: string
  onChange(value: string): void
  effort: HarnessModelPickerProps['effort']
  disabled: boolean | undefined
  classes: NonNullable<HarnessModelPickerProps['fields']>
  t: ConfigurationTranslate
}) {
  const entries = directory?.entries ?? []
  // The chosen model stays listed even when the directory hides it.
  const shown = entries.filter(entry => !entry.hidden || entry.value === value)
  const reasoning = entries.find(entry => entry.value === value)?.reasoning
  const options = reasoning?.options ?? []
  const defaultEffort = options.find(option => option.value === reasoning?.default)?.label ?? reasoning?.default
  const pickModel = (next: string): void => {
    onChange(next)
    // An effort the next model does not offer falls back to its default.
    const nextOptions = entries.find(entry => entry.value === next)?.reasoning?.options ?? []
    if (effort !== undefined && effort.value !== '' && !nextOptions.some(option => option.value === effort.value)) effort.onChange('')
  }
  return <div className={classes.row}>
    <label className={classes.field}>
      <span className={classes.label}>{t('configuration.model')}</span>
      <select className={classes.select} aria-label={t('configuration.model')} value={value} disabled={disabled || directory === undefined} onChange={event => { pickModel(event.target.value) }}>
        {directory === undefined && <option value={value}>{value || t('loading')}</option>}
        {directory !== undefined && value === '' && <option value="">{t('configuration.choose')}</option>}
        {directory !== undefined && value !== '' && !shown.some(entry => entry.value === value) && <option value={value}>{value}</option>}
        {shown.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      {error !== undefined && <span role="alert">{error}</span>}
    </label>
    {effort !== undefined && <label className={classes.field}>
      <span className={classes.label}>{t('configuration.effort')}</span>
      <select className={classes.select} aria-label={t('configuration.effort')} value={effort.value} disabled={disabled || options.length === 0} onChange={event => { effort.onChange(event.target.value) }}>
        <option value="">{defaultEffort === undefined ? t('configuration.effortDefault') : `${t('configuration.effortDefault')}（${defaultEffort}）`}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
  </div>
}
