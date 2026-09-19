import { requestId } from './request-id.ts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LocalAgentMemberConfiguration } from '../types.ts'
import type { MemberConfigurationStore } from './member-configuration.ts'
import { ModelConfigurationFields, type ConfigurationTranslate } from './ModelConfigurationFields.tsx'
import css from './MemberConfiguration.module.css'
import { MemberPaintDiagnostics } from './MemberPaintDiagnostics.tsx'
import type { LivePaintDiagnostics } from './live-paint.ts'

export function MemberConfiguration({ store, t, diagnostics }: { store: MemberConfigurationStore; t: ConfigurationTranslate; diagnostics?: LivePaintDiagnostics }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const root = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const state = snapshot.state
  const current = state?.round?.configuration ?? state?.current
  const selection = state?.pending?.selection ?? state?.operation?.selection ?? state?.current.selection
  const label = (selection: LocalAgentMemberConfiguration | undefined, model = current?.resolved.model, effort = current?.resolved.effort): string => {
    const value = selection?.model.mode === 'value' ? selection.model.value : model
    const entry = snapshot.directory?.entries.find(entry => entry.value === value || entry.resolvedModel === value)
    const strength = selection?.effort.mode === 'value' ? selection.effort.value : effort
    return [entry?.label ?? value ?? t('loading'), entry?.reasoning?.options.find(option => option.value === strength)?.label ?? strength].filter(Boolean).join(' · ')
  }
  const currentLabel = label(current?.selection)
  const disabled = busy || !snapshot.connected || state?.lockedReason !== undefined
  useEffect(() => {
    const close = (event: MouseEvent): void => { if (root.current && !root.current.contains(event.target as Node)) root.current.open = false }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && root.current) root.current.open = false }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  const act = async (operation: 'select' | 'cancel' | 'retry', next?: LocalAgentMemberConfiguration): Promise<void> => {
    if (!state || disabled) return
    setBusy(true); setError(undefined)
    try {
      const request = requestId()
      const receipt = operation === 'retry' ? (await store.face.retry(store.id, state.revision), undefined)
        : operation === 'cancel' ? await store.face.cancel(store.id, request, state.revision)
          : await store.face.select(store.id, request, state.revision, next!)
      if (receipt && ['failed', 'conflict', 'locked', 'unsupported'].includes(receipt.status)) setError(receipt.error ?? t('configuration.failed'))
      await store.refresh()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <details className={css.root} ref={root}>
    <summary aria-label={t('configuration.title')}>{currentLabel}{state?.pending || state?.operation ? ` · ${t('configuration.pending')}` : ''}</summary>
    {diagnostics && <MemberPaintDiagnostics sessionId={store.id} diagnostics={diagnostics} />}
    <div className={css.panel}>
      {selection && <ModelConfigurationFields directory={snapshot.directory} value={selection} resolvedModel={state?.current.resolved.model} resolvedEffort={state?.current.resolved.effort} disabled={disabled} t={t}
        onChange={selection => { void act('select', selection) }} />}
      {state?.pending && <div role="status">{t('configuration.pending')}: {label(state.pending.selection)}</div>}
      {state?.operation && <div role="status">{t('configuration.applying')}: {label(state.operation.selection)}</div>}
      {state?.round && <small>{t('configuration.boundary')}</small>}
      {!snapshot.connected && <div role="status">{t('configuration.reconnecting')}</div>}
      {(error ?? state?.error ?? snapshot.error) && <div role="alert">{error ?? state?.error ?? snapshot.error}</div>}
      {state?.lockedReason && <div role="status">{state.lockedReason}</div>}
      <div className={css.actions}>
        {(state?.pending || state?.operation) && <button type="button" disabled={disabled} onClick={() => { void act('cancel') }}>{t('configuration.cancel')}</button>}
        {state?.status === 'failed' && <button type="button" disabled={disabled} onClick={() => { void act('retry') }}>{t('configuration.retry')}</button>}
      </div>
      <details className={css.advanced}><summary>{t('configuration.details')}</summary>
        <small>{snapshot.directory?.reason}</small>
        <button type="button" disabled={busy || snapshot.directory?.refreshing} onClick={() => { void store.refreshDirectory().catch(error => setError(String(error))) }}>{t('configuration.refresh')}</button>
      </details>
    </div>
  </details>
}
