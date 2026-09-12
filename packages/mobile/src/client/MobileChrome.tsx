import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { installNavigationGestures } from './gestures.ts'
import { MobileRoomNavigation } from './MobileRooms.tsx'
import type { MobileRooms } from './rooms.ts'
import { MobileIcon } from './MobileIcon.tsx'
import { MobileLibrary } from './MobileLibrary.tsx'
import type { MobileNavigation, NavigationCapabilities } from './navigation.ts'
import type { MobilePresentation, DisplayMode } from './presentation.ts'
import type { MobileSurface } from './surface.ts'
import { hasNativeAction, reportChrome, requestNativeAction } from './native.ts'

export interface MobileChromeInjected {
  rooms?: MobileRooms
  navigation: MobileNavigation
  presentation: MobilePresentation
  toggleSidebar: () => void
  connection: ConnectionHandle
}

const emptySubscribe = () => () => {}
const emptyPreset = () => ''
function ConversationTitle({ navigation, fallback, prepareNavigation, surface, renameLabel }: { navigation: NavigationCapabilities; fallback: string; prepareNavigation: () => void; surface?: MobileSurface; renameLabel: string }) {
  const feed = navigation.sessions.list
  const sessions = useSyncExternalStore(useCallback(listener => feed.subscribe(listener), [feed]), useCallback(() => feed.getSnapshot(), [feed]))
  useLayoutEffect(() => prepareNavigation(), [sessions.current, prepareNavigation])
  const row = sessions.current ? sessions.byId[sessions.current] : undefined
  const preset = useSyncExternalStore(surface?.subscribe ?? emptySubscribe, surface?.getSnapshot ?? emptyPreset)
  const cwd = row?.cwd?.split(/[\\/]/).filter(Boolean).at(-1)
  return <><span data-mobile-title-line><strong data-mobile-session-title={row && !row.blank ? '' : undefined}>{row && !row.blank ? row.title || row.displayTitle : fallback}</strong>{row && !row.blank && <button data-mobile-rename aria-label={renameLabel} onClick={() => document.querySelector<HTMLButtonElement>('[data-mobile-original-rename]')?.click()}><MobileIcon name="edit" size={16}/></button>}</span>{row && !row.blank && (cwd || preset) && <span data-mobile-subtitle><span title={row.cwd}>{cwd}</span>{cwd && preset && <span aria-hidden>·</span>}{preset && <span>{preset}</span>}</span>}</>
}

/** One visible navigation bar, with native connection sheets when supported. */
export function MobileChrome({ presentation, toggleSidebar, connection, navigation, rooms, t }: MobileChromeInjected & PropsLocale<'mobile'>) {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const wire = useSyncExternalStore(connection.state.subscribe, connection.state.getSnapshot)
  const available = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const [library, setLibrary] = useState(false), [settings, setSettings] = useState(false)
  const [wide, setWide] = useState(window.innerWidth >= 960)
  useEffect(() => { const resize = () => setWide(window.innerWidth >= 960); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const [connectionExpanded, setConnectionExpanded] = useState(false)
  useEffect(() => {
    setConnectionExpanded(false)
    if (wire === 'connected') return
    const timer = window.setTimeout(() => setConnectionExpanded(true), 4000)
    return () => window.clearTimeout(timer)
  }, [wire])
  useEffect(() => {
    if (state.active && wire === 'connected' && available?.sessions.list.getSnapshot().phase === 'pending') void available.sessions.refresh().catch(() => {})
  }, [state.active, wire, available])
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
    if (!state.active || !library || !available || wide) return
    const main = document.querySelector<HTMLElement>('[data-mobile-frame] > div:has(> [data-slot="main"])')
    if (!main) return
    const previous = main.inert; main.inert = true
    return () => { main.inert = previous }
  }, [state.active, library, available, wide])
  useEffect(() => {
    document.documentElement.toggleAttribute('data-mobile-library-open', state.active && library && !!available)
    return () => document.documentElement.removeAttribute('data-mobile-library-open')
  }, [state.active, library, available])
  useEffect(() => {
    if (!state.active || !available || settings) return
    return installNavigationGestures(document, setLibrary)
  }, [state.active, available, settings])
  const openLibrary = () => {
    if (!available) { toggleSidebar(); return }
    if (state.drawer) toggleSidebar()
    setLibrary(true)
  }
  const startSession = () => {
    presentation.prepareNavigation()
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
  if (!state.active && !settings && state.mode !== 'desktop') return null
  return <>
    {!state.active && state.mode === 'desktop' && <button data-mobile-restore onClick={() => presentation.setMode('mobile')}>{t('restoreMobile')}</button>}
    {state.active && <>
      {available && <aside data-mobile-library-pane hidden={!library && !wide}>
        <nav data-mobile-library-toolbar aria-label={t('menu')}><button aria-label={t('settings')} onClick={openSettings}><MobileIcon name="settings"/></button><button aria-label={t('newSession')} onClick={startSession}><MobileIcon name="compose"/></button></nav>
        <MobileLibrary {...(rooms ? { rooms } : {})} navigation={available} t={t} onBeforeOpen={presentation.prepareNavigation} onOpen={() => setLibrary(false)} /></aside>}
      {library && available && <button data-mobile-peek-close aria-label={t('close')} onClick={() => setLibrary(false)} />}
      {state.drawer && <button data-mobile-shade aria-label={t('close')} onClick={toggleSidebar} />}
      <nav data-mobile-toolbar data-library={false} aria-label={t('menu')}>
        <button aria-label={t('menu')} onClick={openLibrary}>
          <MobileIcon name="back"/>
        </button>
        <div data-mobile-nav-title>{(available ? <ConversationTitle navigation={available} prepareNavigation={presentation.prepareNavigation} surface={presentation.surface} fallback={t('newSession')} renameLabel={t('renameSession')} /> : <strong>{t('brand')}</strong>)}{wire !== 'connected' && !connectionExpanded && <small role="status">{t(wire ?? 'connecting')}</small>}</div>
        <button data-mobile-new={!!available} aria-label={available ? t('newSession') : t('settings')} onClick={available ? startSession : openSettings}><MobileIcon name={available ? "compose" : "settings"}/></button>
        {available && rooms && <MobileRoomNavigation rooms={rooms} navigation={available} prepareNavigation={presentation.prepareNavigation} t={t}/>}
      </nav>
      {wire !== 'connected' && connectionExpanded && <div data-mobile-connection-status role="status"><span>{t(wire ?? 'connecting')}</span><button onClick={() => connection.reconnect()}>{t('reconnect')}</button></div>}
    </>}
    <dialog ref={dialog} data-mobile-dialog onClose={() => setSettings(false)} aria-label={t('settings')}>
      <h2>{t('settings')}</h2>
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
