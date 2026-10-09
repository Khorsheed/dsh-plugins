/**
 * 将附上: the dock above the composer that shows what the panel will attach
 * to the next send (decision D3: visible before sending, removable, net
 * changes only). The host attaches them at the next model step; this dock
 * only shows and trims the list.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PendingChange } from '../types.ts'
import type { GameDockProps } from './contract.ts'
import css from './GameTab.module.css'

/** The dock. Renders nothing when there is nothing to attach. */
export function GameDock({ sessionId, t, api, subscribeSessionEvents, touch }: GameDockProps): ReactNode {
  const [pending, setPending] = useState<readonly PendingChange[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [rev, setRev] = useState(0)

  useEffect(() => subscribeSessionEvents(id => { if (id === sessionId) setRev(n => n + 1) }), [subscribeSessionEvents, sessionId])
  useEffect(() => {
    let live = true
    void api.state(sessionId).then(r => {
      if (!live || !r.ok) return
      setPending(r.value.bound?.pending ?? [])
      setProjectId(r.value.bound?.id ?? null)
    }).catch(() => {})
    return () => { live = false }
  }, [api, sessionId, rev])

  if (projectId === null || pending.length === 0) return null
  return <div className={css.dock}>
    <button type="button" className={css.dockHead} aria-expanded={open} onClick={() => { setOpen(o => !o) }}>
      <span className={css.dockTag}>{t('dock.title')}</span>
      <span className={css.dockCount}>{t('dock.count', { count: pending.length })}</span>
      <span className={css.dockSummary}>{pending.slice(0, 2).map(p => p.text).join(' · ')}</span>
      <span className={css.dockHint}>{open ? t('dock.collapse') : t('dock.expand')}</span>
    </button>
    {open && <ul className={css.dockList}>
      {pending.map(p => <li key={p.key}>
        <span>{p.text}</span>
        <button type="button" className={css.dockDrop} aria-label={t('dock.drop')} title={t('dock.drop')}
          onClick={() => { void api.dropPending(sessionId, projectId, p.key).then(() => { touch(sessionId) }) }}>×</button>
      </li>)}
    </ul>}
  </div>
}
