import { requestId } from './request-id.ts'
import { useState, useSyncExternalStore } from 'react'
import type { LocalAgentConfigurationChoice, LocalAgentMemberConfiguration } from '../types.ts'
import type { MemberConfigurationStore } from './member-configuration.ts'
import { ModelConfigurationFields, type ConfigurationTranslate } from './ModelConfigurationFields.tsx'
import css from './MemberConfiguration.module.css'

export function MemberConfiguration({ store, t }: { store: MemberConfigurationStore; t: ConfigurationTranslate }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [draft, setDraft] = useState<{ selection: LocalAgentMemberConfiguration; revision: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const state = snapshot.state
  const choice = (value: LocalAgentConfigurationChoice): string => value.mode === 'value' ? value.value : t(`configuration.${value.mode}`)
  const label = (selection: LocalAgentMemberConfiguration): string => `${choice(selection.model)} · ${choice(selection.effort)}`
  const current = state?.round?.configuration ?? state?.current
  const currentLabel = current === undefined ? t('loading') : `${current.resolved.model ?? choice(current.selection.model)} · ${current.resolved.effort ?? choice(current.selection.effort)}`
  const selection = draft?.selection ?? state?.pending?.selection ?? state?.operation?.selection ?? state?.current.selection
  const disabled = busy || !snapshot.connected || state?.lockedReason !== undefined
  const act = async (operation: 'select' | 'cancel' | 'retry'): Promise<void> => {
    if (!state || disabled) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const request = requestId()
      const receipt = operation === 'retry'
        ? (await store.face.retry(store.id, state.revision), undefined)
        : operation === 'cancel'
          ? await store.face.cancel(store.id, request, state.revision)
          : await store.face.select(store.id, request, draft?.revision ?? state.revision, selection!)
      if (receipt && ['failed', 'conflict', 'locked', 'unsupported'].includes(receipt.status)) {
        setError(receipt.error ?? t('configuration.failed'))
        if (receipt.status === 'conflict') setDraft(undefined)
      } else {
        setDraft(undefined)
        setNotice(t(operation === 'cancel' ? 'configuration.cancelled' : 'configuration.accepted'))
      }
      await store.refresh()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <details className={css.root}>
    <summary aria-label={t('configuration.title')}>{currentLabel}{state?.pending || state?.operation ? ` · ${t('configuration.pending')}` : ''}</summary>
    <div className={css.panel}>
      <div><strong>{t(state?.round ? 'configuration.round' : 'configuration.ready')}</strong><div className={css.value}>{currentLabel}</div></div>
      {state?.pending && <div role="status"><strong>{t('configuration.pending')}</strong><div className={css.value}>{label(state.pending.selection)}</div></div>}
      {state?.operation && <div role="status">{t('configuration.applying')}: {label(state.operation.selection)}</div>}
      <small>{t('configuration.boundary')}</small>
      {!snapshot.connected && <div role="status">{t('configuration.reconnecting')}</div>}
      {(error ?? state?.error ?? snapshot.error) && <div role="alert">{error ?? state?.error ?? snapshot.error}</div>}
      {state?.lockedReason && <div role="status">{state.lockedReason}</div>}
      {notice && <div role="status">{notice}</div>}
      {selection && <ModelConfigurationFields directory={snapshot.directory} value={selection} resolvedModel={draft === undefined ? state?.current.resolved.model : undefined} disabled={disabled} t={t}
        onChange={selection => { setDraft({ selection, revision: draft?.revision ?? state!.revision }); setNotice(undefined) }} />}
      <div className={css.actions}>
        <button type="button" disabled={disabled || !draft || (selection?.model.mode === 'value' && !selection.model.value.trim())} onClick={() => { void act('select') }}>{t('configuration.apply')}</button>
        {(state?.pending || state?.operation) && <button type="button" disabled={disabled} onClick={() => { void act('cancel') }}>{t('configuration.cancel')}</button>}
        {state?.status === 'failed' && <button type="button" disabled={disabled} onClick={() => { void act('retry') }}>{t('configuration.retry')}</button>}
        <button type="button" disabled={busy || snapshot.directory?.refreshing} onClick={() => { void store.refreshDirectory().catch(error => setError(String(error))) }}>{t('configuration.refresh')}</button>
      </div>
    </div>
  </details>
}
