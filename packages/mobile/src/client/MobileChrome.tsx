import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { MobilePresentation, DisplayMode } from './presentation.ts'

export interface MobileChromeInjected {
  presentation: MobilePresentation
  toggleSidebar: () => void
  connection: ConnectionHandle
}

/** Navigation complements the official sidebar; all session operations retain their owners. */
export function MobileChrome({ presentation, toggleSidebar, connection, t }: MobileChromeInjected & PropsLocale<'mobile'>) {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const wire = useSyncExternalStore(connection.state.subscribe, connection.state.getSnapshot)
  const [settings, setSettings] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (settings) dialog.current?.showModal()
    else dialog.current?.close()
  }, [settings])
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.drawer && !settings) toggleSidebar() }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape) }
  }, [state.drawer, settings, toggleSidebar])
  const status = wire ?? 'connecting'
  if (!state.active && !settings) return null
  return <>
    {state.active && <>
      {state.drawer && <button data-mobile-shade aria-label={t('close')} onClick={toggleSidebar} />}
      <nav data-mobile-toolbar aria-label={t('menu')}>
        <button aria-label={state.drawer ? t('close') : t('menu')} aria-expanded={state.drawer} onClick={toggleSidebar}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={state.drawer ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h12M4 17h16'} /></svg>
        </button>
        <div><strong>{t('brand')}</strong><small role="status">{t(status)}</small></div>
        <button aria-label={t('settings')} onClick={() => { setSettings(true) }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--dsw-alias-bg-base, white)"/><circle cx="15" cy="17" r="3" fill="var(--dsw-alias-bg-base, white)"/></svg>
        </button>
      </nav>
    </>}
    <dialog ref={dialog} data-mobile-dialog onClose={() => { setSettings(false) }} aria-label={t('settings')}>
      <h2>{t('settings')}</h2>
      <h3>{t('display')}</h3>
      <div role="group" aria-label={t('display')}>
        {(['auto', 'mobile', 'desktop'] as const).map((mode: DisplayMode) => <button key={mode} aria-pressed={state.mode === mode} onClick={() => { presentation.setMode(mode) }}>{t(mode === 'auto' ? 'automatic' : mode)}</button>)}
      </div>
      <p>{t('appearance')}</p>
      <h3>{t('connection')}</h3>
      <p>{window.location.host}</p>
      <p>{t(status)}</p>
      <button onClick={() => { connection.reconnect() }}>{t('reconnect')}</button>
      <p>{t('privacy')}</p>
      <button data-mobile-done onClick={() => { setSettings(false) }}>{t('done')}</button>
    </dialog>
  </>
}
