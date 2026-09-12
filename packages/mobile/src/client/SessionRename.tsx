import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NavigationCapabilities } from './navigation.ts'

/** Same per-session command as the Web workspace dialog; no local title cache. */
export function SessionRename({ navigation, sessionId, title, close, t }: { navigation: NavigationCapabilities; sessionId: Parameters<NavigationCapabilities['sessions']['binding']>[0]; title: string; close: () => void } & PropsLocale<'mobile'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(title), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), submitting = useRef(false)
  useLayoutEffect(() => {
    alive.current = true
    dialog.current?.showModal()
    return () => { alive.current = false; dialog.current?.close() }
  }, [])
  const save = async () => {
    if (submitting.current || !draft.trim()) return
    submitting.current = true
    setBusy(true); setError('')
    try {
      const session = navigation.sessions.binding(sessionId)?.session
      if (!session) throw new Error(t('renameUnavailable'))
      const result = await session.rename(draft.trim())
      if (!result.ok) throw new Error(result.error.message)
      if (alive.current) close()
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('renameUnavailable'))
    } finally { submitting.current = false; if (alive.current) setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} data-mobile-dialog data-mobile-rename-dialog aria-labelledby="mobile-rename-heading" onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id="mobile-rename-heading">{t('renameSession')}</h2>
      <label>{t('sessionTitle')}<input value={draft} onChange={event => setDraft(event.target.value)} autoComplete="off" enterKeyHint="done" disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}/></label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>{t('cancel')}</button><button type="submit" data-mobile-primary disabled={busy || !draft.trim()}>{t(busy ? 'saving' : 'save')}</button></footer>
    </form>
  </dialog>, document.body)
}
