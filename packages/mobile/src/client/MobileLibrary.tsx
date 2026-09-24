import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GROUPING_KEY, groupSessions, mainSessionId, recentSessions } from './navigation.ts'
import type { LibraryGrouping, NavigationCapabilities } from './navigation.ts'
import type { MobileRooms } from './rooms.ts'
import { MobileIcon } from './MobileIcon.tsx'
import { hasNativeAction, requestNativeAction } from './native.ts'

type Props = PropsLocale<'mobile'> & { rooms?: MobileRooms; navigation: NavigationCapabilities; onOpen: () => void; onBeforeOpen?: () => void }

/** Browse official metadata; the official workspace service remains the only navigation writer. */
export function MobileLibrary({ rooms, navigation, onOpen, onBeforeOpen, t }: Props) {
  const sessionFeed = navigation.sessions.list, workspaceFeed = navigation.workspaces.list
  // Official feeds may expose prototype methods. Keep their receiver and stable subscriptions.
  const sessions = useSyncExternalStore(useCallback(listener => sessionFeed.subscribe(listener), [sessionFeed]), useCallback(() => sessionFeed.getSnapshot(), [sessionFeed]))
  const workspaces = useSyncExternalStore(useCallback(listener => workspaceFeed.subscribe(listener), [workspaceFeed]), useCallback(() => workspaceFeed.getSnapshot(), [workspaceFeed]))
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [error, setError] = useState(false)
  const [grouping, setGrouping] = useState<LibraryGrouping>(() => {
    try { return localStorage.getItem(GROUPING_KEY) === 'workspace' ? 'workspace' : 'time' } catch { return 'time' }
  })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const input = useRef<HTMLInputElement>(null)
  const rows = recentSessions(sessions, workspaces.archivedSessionIds, query)
  const current = mainSessionId(sessions)
  const groups = groupSessions(rows, grouping, { today: t('today'), yesterday: t('yesterday'), earlier: t('earlier'), workspace: t('unassignedWorkspace') })
  const chooseGrouping = (value: LibraryGrouping) => {
    setGrouping(value)
    try { localStorage.setItem(GROUPING_KEY, value) } catch { /* Restricted storage keeps this preference in memory. */ }
  }
  return <section data-mobile-library aria-label={t('menu')}>
    <header data-mobile-library-header>
      <h1>{t('menu')}</h1>
      <div data-mobile-grouping role="group" aria-label={t('grouping')}>
        {(['time', 'workspace'] as const).map(value => <button key={value} aria-pressed={grouping === value} onClick={() => chooseGrouping(value)}>{t(value === 'time' ? 'byTime' : 'byWorkspace')}</button>)}
      </div>
    </header>
    <div data-mobile-recents>
      {error && <p role="alert">{t('navigationError')}</p>}
      {sessions.phase !== 'ready' && !rows.length ? <p role="status">{t('loadingSessions')}</p> : rows.length === 0 ? <p data-mobile-empty role="status">{query ? t('noMatches') : t('noSessions')}</p> : groups.map(group => {
        const open = grouping === 'time' || !!query.trim() || !collapsed.has(group.key)
        return <section key={group.key} data-mobile-session-group>
          {grouping === 'workspace' ? <button data-mobile-workspace-group aria-expanded={open} onClick={() => setCollapsed(previous => {
            const next = new Set(previous); next.has(group.key) ? next.delete(group.key) : next.add(group.key); return next
          })}><MobileIcon name="folder" size={18}/><strong>{group.label}</strong><small>{group.rows.length}</small><MobileIcon name={open ? "down" : "right"} size={18}/></button> : <h2>{group.label}</h2>}
          {open && <ul>{group.rows.map(row => <li key={row.id}>
            <button data-mobile-session data-mobile-session-id={row.id} aria-current={current === row.id ? 'page' : undefined} onClick={() => {
              try { onBeforeOpen?.(); navigation.workspace.openSession(row.id); setError(false); onOpen() } catch { setError(true) }
            }}>
              <span data-mobile-session-copy><strong>{row.title || (row.blank ? t('newSession') : row.displayTitle)}</strong><SessionMetadata id={row.id} cwd={row.cwd ?? ''} {...(rooms ? { rooms } : {})} t={t}/></span>
              {row.running ? <span data-mobile-activity role="status">{t('running')}</span> : <time dateTime={new Date(row.updatedAt).toISOString()}>{new Date(row.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
            </button>
          </li>)}</ul>}
        </section>
      })}
    </div>
    <footer data-mobile-search-dock>
      <label data-mobile-search><MobileIcon name="search" size={20}/><input ref={input} type="search" enterKeyHint="search" autoComplete="off" value={query} onFocus={() => setSearching(true)} onChange={e => setQuery(e.target.value)} placeholder={t('searchTitles')} aria-label={t('searchTitles')}/></label>
      {searching ? <button data-mobile-search-cancel aria-label={t('cancel')} onClick={() => { setQuery(''); setSearching(false); input.current?.blur() }}><MobileIcon name="close"/></button> : hasNativeAction('scan') && <button data-mobile-scan aria-label={t('scan')} onClick={() => requestNativeAction('scan')}><MobileIcon name="scan"/></button>}
    </footer>
  </section>
}

const emptyRoomSubscribe = () => () => {}
const emptyRoomSnapshot = () => 0
function SessionMetadata({ id, cwd, rooms, t }: { id: string; cwd: string; rooms?: MobileRooms } & PropsLocale<'mobile'>) {
  const ref = useRef<HTMLElement>(null)
  useSyncExternalStore(rooms?.subscribe ?? emptyRoomSubscribe, rooms?.getSnapshot ?? emptyRoomSnapshot)
  useEffect(() => {
    if (!rooms?.available() || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') { void rooms.refresh(id); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { void rooms.refresh(id); observer.disconnect() } })
    observer.observe(ref.current); return () => observer.disconnect()
  }, [rooms, id])
  const state = rooms?.get(id), count = state ? state.members.length : state === null || !rooms?.available() ? 1 : '…'
  return <small ref={ref}>{cwd.split(/[\\/]/).filter(Boolean).at(-1) || t('unassignedWorkspace')} · {count} {t('memberUnit')}</small>
}
