import { useCallback, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { recentSessions } from './navigation.ts'
import type { NavigationCapabilities } from './navigation.ts'

type Props = PropsLocale<'mobile'> & {
  navigation: NavigationCapabilities
  onOpen: () => void
  onNew: () => void
  onSettings: () => void
  onWorkspaces: () => void
}

/** An independent navigation surface; opening a row calls the official UI navigation owner. */
export function MobileLibrary({ navigation, onOpen, onNew, onSettings, onWorkspaces, t }: Props) {
  // Official feeds may expose prototype methods; preserve their receiver and subscription identity.
  const sessionFeed = navigation.sessions.list
  const workspaceFeed = navigation.workspaces.list
  const sessions = useSyncExternalStore(
    useCallback(listener => sessionFeed.subscribe(listener), [sessionFeed]),
    useCallback(() => sessionFeed.getSnapshot(), [sessionFeed]),
  )
  const workspaces = useSyncExternalStore(
    useCallback(listener => workspaceFeed.subscribe(listener), [workspaceFeed]),
    useCallback(() => workspaceFeed.getSnapshot(), [workspaceFeed]),
  )
  const [query, setQuery] = useState('')
  const [error, setError] = useState(false)
  const rows = recentSessions(sessions, workspaces.archivedSessionIds, query)
  return <section data-mobile-library aria-label={t('menu')}>
    <header data-mobile-library-header>
      <span data-mobile-eyebrow>{t('libraryEyebrow')}</span>
      <h1>{t('libraryTitle')}</h1>
      <p>{t('librarySubtitle')}</p>
      <button data-mobile-new onClick={onNew}><span aria-hidden="true">＋</span>{t('newSession')}<span aria-hidden="true">↗</span></button>
      <label data-mobile-search><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchTitles')} aria-label={t('searchTitles')}/></label>
    </header>
    <div data-mobile-recents>
      <div data-mobile-section-title><h2>{query ? t('searchResults') : t('recent')}</h2><button onClick={onWorkspaces}>{t('workspaces')} <span aria-hidden="true">↗</span></button></div>
      {error && <p role="alert">{t('navigationError')}</p>}
      {sessions.phase !== 'ready' && !rows.length ? <p role="status">{t('loadingSessions')}</p> : rows.length === 0 ? <p data-mobile-empty>{query ? t('noMatches') : t('noSessions')}</p> : <ul>{rows.map(row => <li key={row.id}>
        <button data-mobile-session aria-current={sessions.current === row.id ? 'page' : undefined} onClick={() => {
          try { navigation.workspace.openSession(row.id); setError(false); onOpen() } catch { setError(true) }
        }}>
          <span data-mobile-session-icon aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 5h14v11H9l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></svg></span>
          <span data-mobile-session-copy><strong>{row.title || (row.blank ? t('newSession') : row.displayTitle)}</strong><small>{row.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? t('workspace')}<span> · </span><time dateTime={new Date(row.updatedAt).toISOString()}>{new Date(row.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></small></span>
          {row.running ? <span data-mobile-activity role="status">{t('running')}</span> : row.completed ? <span data-mobile-completed aria-label={t('completed')} /> : <span data-mobile-row-arrow aria-hidden="true">›</span>}
        </button>
      </li>)}</ul>}
    </div>
    <footer data-mobile-library-footer><span>{t('libraryFooter')}</span><button onClick={onSettings}>{t('settings')} <span aria-hidden="true">↗</span></button></footer>
  </section>
}
