import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GROUPING_KEY, groupSessions, recentSessions } from './navigation.ts'
import type { LibraryGrouping, NavigationCapabilities } from './navigation.ts'
import { hasNativeAction, requestNativeAction } from './native.ts'

type Props = PropsLocale<'mobile'> & { navigation: NavigationCapabilities; onOpen: () => void; onBeforeOpen?: () => void }

/** Browse official metadata; the official workspace service remains the only navigation writer. */
export function MobileLibrary({ navigation, onOpen, onBeforeOpen, t }: Props) {
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
          })}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h7l2 3h9v11H3V6Z"/></svg><strong>{group.label}</strong><small>{group.rows.length}</small><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"}/></svg></button> : <h2>{group.label}</h2>}
          {open && <ul>{group.rows.map(row => <li key={row.id}>
            <button data-mobile-session aria-current={sessions.current === row.id ? 'page' : undefined} onClick={() => {
              try { onBeforeOpen?.(); navigation.workspace.openSession(row.id); setError(false); onOpen() } catch { setError(true) }
            }}>
              <span data-mobile-session-copy><strong>{row.title || (row.blank ? t('newSession') : row.displayTitle)}</strong><small>{grouping === 'time' ? row.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || t('unassignedWorkspace') : row.running ? t('running') : row.completed ? t('completed') : t('conversation')}</small></span>
              {row.running ? <span data-mobile-activity role="status">{t('running')}</span> : <time dateTime={new Date(row.updatedAt).toISOString()}>{new Date(row.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
            </button>
          </li>)}</ul>}
        </section>
      })}
    </div>
    <footer data-mobile-search-dock>
      <label data-mobile-search><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input ref={input} type="search" value={query} onFocus={() => setSearching(true)} onChange={e => setQuery(e.target.value)} placeholder={t('searchTitles')} aria-label={t('searchTitles')}/></label>
      {searching ? <button data-mobile-search-cancel onClick={() => { setQuery(''); setSearching(false); input.current?.blur() }}>{t('cancel')}</button> : hasNativeAction('scan') && <button data-mobile-scan aria-label={t('scan')} onClick={() => requestNativeAction('scan')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M5 12h14"/></svg></button>}
    </footer>
  </section>
}
