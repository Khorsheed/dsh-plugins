import { useEffect, useRef, useState } from 'react'
import type { LocalAgentModelDirectory } from '../types.ts'
import { ModelConfigurationFields, type ConfigurationTranslate } from './ModelConfigurationFields.tsx'
import css from './MemberConfiguration.module.css'

export interface ModelDirectoryFace {
  read(refresh: boolean): Promise<LocalAgentModelDirectory | null>
  follow(signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory>
}
export interface HarnessModelPickerProps {
  face: ModelDirectoryFace
  value: string
  onChange(value: string): void
  disabled?: boolean | undefined
  defaultLabel?: string | undefined
  t: ConfigurationTranslate
}

/** Discover while expanded or resolving an empty choice; settings remain caller-owned drafts. */
export function HarnessModelPicker({ face, value, onChange, disabled, t }: HarnessModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [surface, setSurface] = useState<{ face: ModelDirectoryFace; directory: LocalAgentModelDirectory }>()
  const directory = surface?.face === face ? surface.directory : undefined
  const currentFace = useRef(face)
  currentFace.current = face
  const setDirectory = (directory: LocalAgentModelDirectory): void => { if (currentFace.current === face) setSurface({ face, directory }) }
  const [error, setError] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
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
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try { const result = await face.read(true); if (result !== null) setDirectory(result); setError(undefined) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setRefreshing(false) }
  }
  useEffect(() => {
    const first = directory?.entries.find(entry => !entry.hidden)
    if (!value && !disabled && first) onChange(first.value)
  }, [directory, value, disabled, onChange])
  const entry = directory?.entries.find(entry => entry.value === value)
  return <details className={`${css.root} ${css.settings}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label={t('configuration.model')}>{entry?.label ?? (value || t('configuration.choose'))}</summary>
    {open && <div className={css.panel}>
      {error && <div role="alert">{error}</div>}
      {!directory && <span role="status">{t('loading')}</span>}
      <ModelConfigurationFields directory={directory} value={{ model: value ? { mode: 'value', value } : { mode: 'default' }, effort: { mode: 'default' } }}
        onChange={selection => { onChange(selection.model.mode === 'value' ? selection.model.value : ''); setOpen(false) }}
        showEffort={false} disabled={disabled} t={t} />
      <details className={css.advanced}><summary>{t('configuration.details')}</summary><small>{directory?.reason}</small>
      <button type="button" disabled={refreshing || directory?.refreshing} onClick={() => { void refresh() }}>{t('configuration.refresh')}</button></details>
    </div>}
  </details>
}
