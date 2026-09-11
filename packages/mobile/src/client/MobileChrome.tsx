import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { MobileLibrary } from './MobileLibrary.tsx'
import type { MobileNavigation, NavigationCapabilities } from './navigation.ts'
import type { MobilePresentation, DisplayMode } from './presentation.ts'
import { hasNativeAction, reportChrome, requestNativeAction } from './native.ts'

export interface MobileChromeInjected {
  navigation: MobileNavigation
  presentation: MobilePresentation
  toggleSidebar: () => void
  connection: ConnectionHandle
}

function ConversationTitle({ navigation, fallback }: { navigation: NavigationCapabilities; fallback: string }) {
  const feed = navigation.sessions.list
  const sessions = useSyncExternalStore(useCallback(listener => feed.subscribe(listener), [feed]), useCallback(() => feed.getSnapshot(), [feed]))
  const row = sessions.current ? sessions.byId[sessions.current] : undefined
  return <strong>{row && !row.blank ? row.title || row.displayTitle : fallback}</strong>
}

/** One visible navigation bar, with native connection sheets when supported. */
export function MobileChrome({ presentation, toggleSidebar, connection, navigation, t }: MobileChromeInjected & PropsLocale<'mobile'>) {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const wire = useSyncExternalStore(connection.state.subscribe, connection.state.getSnapshot)
  const available = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const [library, setLibrary] = useState(false), [settings, setSettings] = useState(false)
  const activated = useRef(false), dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!state.active) { activated.current = false; setLibrary(false); return }
    if (available && !activated.current) {
      activated.current = true; setLibrary(true)
      if (state.drawer) toggleSidebar()
    }
  }, [state.active, state.drawer, available, toggleSidebar])
  useEffect(() => { reportChrome(state.active); return () => reportChrome(false) }, [state.active])
  useEffect(() => {
    if (!state.active || !library || !available) return
    const main = document.querySelector<HTMLElement>('[data-mobile-frame] > div:has(> [data-slot="main"])')
    if (!main) return
    const previous = main.inert; main.inert = true
    return () => { main.inert = previous }
  }, [state.active, library, available])
  const openLibrary = () => {
    if (!available) { toggleSidebar(); return }
    if (state.drawer) toggleSidebar()
    setLibrary(true)
  }
  const startSession = () => {
    available?.workspace.startSession()
    if (state.drawer) toggleSidebar()
    setSettings(false); setLibrary(false)
  }
  const openSettings = () => {
    if (hasNativeAction('settings')) requestNativeAction('settings')
    else setSettings(true)
  }
  useEffect(() => { if (settings) dialog.current?.showModal(); else dialog.current?.close() }, [settings])
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || settings) return
      if (library) setLibrary(false)
      else if (state.drawer) toggleSidebar()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [state.drawer, settings, library, toggleSidebar])
  if (!state.active && !settings) return null
  return <>
    {state.active && <>
      {library && available && <MobileLibrary navigation={available} t={t} onOpen={() => setLibrary(false)} />}
      {state.drawer && <button data-mobile-shade aria-label={t('close')} onClick={toggleSidebar} />}
      <nav data-mobile-toolbar aria-label={t('menu')}>
        <button aria-label={library ? t('settings') : t('menu')} onClick={library ? openSettings : openLibrary}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{library ? <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--dsw-alias-bg-base, white)"/><circle cx="15" cy="17" r="3" fill="var(--dsw-alias-bg-base, white)"/></> : <path d="m14 5-7 7 7 7"/>}</svg>
        </button>
        <div data-mobile-nav-title>{!library && (available ? <ConversationTitle navigation={available} fallback={t('newSession')} /> : <strong>{t('brand')}</strong>)}</div>
        <button aria-label={library ? t('newSession') : t('options')} onClick={library ? startSession : () => setSettings(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{library ? <path d="M14 4H5v15h15v-9M10 14l2-5 6-6 3 3-6 6-5 2Z"/> : <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>}</svg>
        </button>
      </nav>
      {wire !== 'connected' && <div data-mobile-connection-status role="status"><span>{t(wire ?? 'connecting')}</span><button onClick={() => connection.reconnect()}>{t('reconnect')}</button></div>}
    </>}
    <dialog ref={dialog} data-mobile-dialog onClose={() => setSettings(false)} aria-label={library ? t('settings') : t('options')}>
      <h2>{library ? t('settings') : t('options')}</h2>
      {available && <button data-mobile-option onClick={startSession}>{t('newSession')}</button>}
      <button data-mobile-option onClick={() => { setSettings(false); setLibrary(false); if (!state.drawer) toggleSidebar() }}>{t('workspaces')}</button>
      {hasNativeAction('settings') ? <button data-mobile-option onClick={() => { setSettings(false); requestNativeAction('settings') }}>{t('connectionSettings')}</button> : <><h3>{t('connection')}</h3><p>{window.location.host}</p><p>{t(wire ?? 'connecting')}</p><button onClick={() => connection.reconnect()}>{t('reconnect')}</button></>}
      <h3>{t('display')}</h3><div role="group" aria-label={t('display')}>
        {(['auto', 'mobile', 'desktop'] as const).map((mode: DisplayMode) => <button key={mode} aria-pressed={state.mode === mode} onClick={() => presentation.setMode(mode)}>{t(mode === 'auto' ? 'automatic' : mode)}</button>)}
      </div><p>{t('appearance')}</p>
      <button data-mobile-done onClick={() => setSettings(false)}>{t('done')}</button>
    </dialog>
  </>
}
