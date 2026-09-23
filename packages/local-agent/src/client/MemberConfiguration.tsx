import { requestId } from './request-id.ts'
import { useState, useSyncExternalStore } from 'react'
import type { LocalAgentMemberConfiguration } from '../types.ts'
import type { MemberConfigurationStore } from './member-configuration.ts'
import { ModelConfigurationFields, type ConfigurationTranslate } from './ModelConfigurationFields.tsx'
import css from './MemberConfiguration.module.css'
import { MemberPaintDiagnostics } from './MemberPaintDiagnostics.tsx'
import type { LivePaintDiagnostics } from './live-paint.ts'
import { useConfigurationMenu } from './use-configuration-menu.ts'

export function MemberConfiguration({ store, t, diagnostics }: { store: MemberConfigurationStore; t: ConfigurationTranslate; diagnostics?: LivePaintDiagnostics }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const menu = useConfigurationMenu('above')
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
  return <details className={css.root} ref={menu.root} open={menu.open} onToggle={event => menu.setOpen(event.currentTarget.open)}>
    <summary aria-label={t('configuration.title')} aria-expanded={menu.open}><span className={css.triggerLabel}>{currentLabel}{state?.pending || state?.operation ? ` · ${t('configuration.pending')}` : ''}</span></summary>
    {diagnostics && <MemberPaintDiagnostics sessionId={store.id} diagnostics={diagnostics} />}
    <div ref={menu.panel} className={css.panel} style={menu.style}>
      {selection && <ModelConfigurationFields directory={snapshot.directory} value={selection} resolvedModel={state?.current.resolved.model} resolvedEffort={state?.current.resolved.effort} disabled={disabled} t={t}
        onChange={selection => { void act('select', selection) }} />}
      {state?.pending && <div role="status">{t('configuration.pending')}: {label(state.pending.selection)}</div>}
      {state?.operation && <div role="status">{t('configuration.applying')}: {label(state.operation.selection)}</div>}
      {state?.round && <small>{t('configuration.boundary')}</small>}
      {!snapshot.connected && <div role="status">{t('configuration.reconnecting')}</div>}
      {(error ?? state?.error ?? snapshot.error) && <div role="alert">{error ?? state?.error ?? snapshot.error}</div>}
      {state?.lockedReason && <div role="status">{state.lockedReason}</div>}
      {(state?.pending || state?.operation || state?.status === 'failed') && <div className={css.actions}>
        {(state?.pending || state?.operation) && <button type="button" disabled={disabled} onClick={() => { void act('cancel') }}>{t('configuration.cancel')}</button>}
        {state?.status === 'failed' && <button type="button" disabled={disabled} onClick={() => { void act('retry') }}>{t('configuration.retry')}</button>}
      </div>}
    </div>
  </details>
}
