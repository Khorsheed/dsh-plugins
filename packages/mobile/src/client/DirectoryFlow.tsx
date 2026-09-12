import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MobileDirectoryListing } from '../protocol.ts'
import type { MobileDirectory } from './directory.ts'
import type { MobileNavigation } from './navigation.ts'
import { MobileIcon } from './MobileIcon.tsx'

export interface DirectoryInjected { directory: MobileDirectory; navigation: MobileNavigation }
const emptySubscribe = () => () => {}
const emptyWorkspaces: readonly { path: string; title: string }[] = []

/** Both workspace adoption and a pure member path pick use the same read-only browser. */
export function DirectoryFlow({ open, busy, onPicked, onCancel, directory, navigation, preferSaved = false, t }: DirectoryFlowOwnerProps & DirectoryInjected & PropsLocale<'mobile'> & { preferSaved?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const controller = useRef<AbortController>()
  const [listing, setListing] = useState<MobileDirectoryListing>()
  const [path, setPath] = useState(''), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'saved' | 'browse'>('saved'), [hidden, setHidden] = useState(false)
  const [query, setQuery] = useState('')
  const available = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const feed = available?.workspaces.list
  const saved = useSyncExternalStore(feed ? listener => feed.subscribe(listener) : emptySubscribe, () => feed?.getSnapshot().items ?? emptyWorkspaces)
  const browse = async (target?: string) => {
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setLoading(true); setFailed(false); setListing(undefined); setPath(target ?? ''); setTab('browse'); setQuery('')
    try {
      const next = await directory.list(target, request.signal)
      if (request.signal.aborted) return
      setListing(next); setPath(next.path)
    } catch { if (!request.signal.aborted) setFailed(true) }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    if (open) { dialog.current?.showModal(); if (!preferSaved) void browse() }
    else { dialog.current?.close(); controller.current?.abort(); setListing(undefined); setPath(''); setTab('saved'); setFailed(false); setLoading(false) }
    return () => { controller.current?.abort() }
  }, [open])
  const choose = () => { if (!busy && !loading && listing && path === listing.path) onPicked(listing.path) }
  return createPortal(<dialog ref={dialog} data-mobile-dialog data-mobile-directory aria-label={t('directoryTitle')} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <header><h2>{t('directoryTitle')}</h2><button type="button" aria-label={t('cancel')} disabled={busy} onClick={onCancel}><MobileIcon name="close"/></button></header>
    <p>{t('directoryHint')}</p>
    <div data-directory-tabs><button type="button" aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>{t('workspaces')}</button><button type="button" aria-pressed={tab === 'browse'} onClick={() => { if (listing) setTab('browse'); else void browse() }}>{t('directoryComputer')}</button></div>
    <div data-directory-scroll>
      {tab === 'saved' ? <div>{saved.length ? saved.map(item => <button data-directory-row type="button" key={item.path} onClick={() => { setPath(item.path); void browse(item.path) }}><MobileIcon name="folder"/><span><strong>{item.title || item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path}</strong><small>{item.path}</small></span><MobileIcon name="right"/></button>) : <p>{t('directoryNoSaved')}</p>}</div> : <>
        <div data-directory-current><MobileIcon name="folder"/><span>{listing?.path || path || t('directoryLoading')}</span></div>
        <details data-directory-manual><summary>{t('directoryManual')}</summary><form onSubmit={event => { event.preventDefault(); event.currentTarget.querySelector('input')?.blur(); if (path.trim()) void browse(path.trim()) }}><label>{t('hostPath')}<span data-directory-path><input aria-label={t('hostPath')} value={path} onChange={event => setPath(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="/path/to/project"/><button type="submit" disabled={!path.trim()}>{t('directoryGo')}</button></span></label></form></details>
        <div data-directory-location><button type="button" disabled={loading || !listing?.parent} onClick={() => { if (listing?.parent) void browse(listing.parent) }}><MobileIcon name="back"/>{t('directoryParent')}</button><label><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)}/>{t('directoryHidden')}</label></div>
        {loading && <p role="status">{t('directoryLoading')}</p>}
        {failed && <p role="alert">{t('directoryError')} <button type="button" onClick={() => { void browse(path || undefined) }}>{t('directoryRetry')}</button></p>}
        {listing && <><input type="search" aria-label={t('directorySearch')} placeholder={t('directorySearch')} value={query} onChange={event => setQuery(event.target.value)}/>{listing.entries.filter(entry => (hidden || !entry.hidden) && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(entry => <button data-directory-row type="button" key={entry.path} onClick={() => { void browse(entry.path) }}><MobileIcon name="folder"/><span>{entry.name}</span><MobileIcon name="right"/></button>)}{!listing.entries.some(entry => hidden || !entry.hidden) && <p>{t('directoryEmpty')}</p>}{listing.truncated && <p>{t('directoryTruncated')}</p>}</>}
      </>}
    </div>
    <footer><button type="button" data-mobile-done disabled={busy || loading || !listing || path !== listing.path || tab !== 'browse'} onClick={choose}>{t('directorySelect')}</button></footer>
  </dialog>, document.body)
}

export function MobileDirectoryOverlay({ directory, navigation, t }: DirectoryInjected & PropsLocale<'mobile'>) {
  const open = useSyncExternalStore(directory.subscribe, directory.getSnapshot)
  return <DirectoryFlow preferSaved open={open} busy={false} onPicked={directory.finish} onCancel={() => directory.finish(null)} onError={() => {}} directory={directory} navigation={navigation} t={t}/>
}
