/**
 * 面板改动: the dock above the composer that collects what the user changed
 * in the game panel and has not told the agent yet. Nothing goes to the
 * model by itself (2026-10-10, replacing the automatic attach): 「写进对话」
 * writes the list into the composer, the user adds their intent and sends.
 * The host clears exactly the changes a sent message lists.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { PANEL_CHANGES_MARK, type PendingChange } from '../types.ts'
import type { GameDockProps } from './contract.ts'
import css from './GameTab.module.css'

/** The composer text for a change list. */
export function panelChangesDraft(t: GameDockProps['t'], pending: readonly PendingChange[]): string {
  return [`${PANEL_CHANGES_MARK}${t('dock.draftLead')}`, ...pending.map(p => `- ${p.text}`), '', ''].join('\n')
}

/** The dock. Renders nothing when there is nothing unsent. */
export function GameDock({ sessionId, t, api, insertDraft, subscribeSessionEvents, touch }: GameDockProps): ReactNode {
  const [pending, setPending] = useState<readonly PendingChange[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [written, setWritten] = useState<string | null>(null)
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

  // "Written" holds only while the list it wrote is still the list pending.
  const signature = pending.map(p => p.key + p.text).join('|')
  const isWritten = written !== null && written === signature

  if (projectId === null || pending.length === 0) return null
  return <div className={css.dock}>
    <div className={css.dockHead}>
      <button type="button" className={css.dockToggle} aria-expanded={open} onClick={() => { setOpen(o => !o) }}>
        <span className={css.dockTag}>{t('dock.title')}</span>
        <span className={css.dockCount}>{t('dock.count', { count: pending.length })}</span>
        <span className={css.dockSummary}>{isWritten ? t('dock.written') : pending.slice(0, 2).map(p => p.text).join(' · ')}</span>
        <span className={css.dockHint}>{open ? t('dock.collapse') : t('dock.expand')}</span>
      </button>
      <button type="button" className={css.dockSend} disabled={isWritten} onClick={() => {
        if (insertDraft(sessionId, panelChangesDraft(t, pending))) setWritten(signature)
      }}>{isWritten ? t('dock.sentToDraft') : t('dock.send')}</button>
    </div>
    {open && <ul className={css.dockList}>
      {pending.map(p => <li key={p.key}>
        <span>{p.text}</span>
        <button type="button" className={css.dockDrop} aria-label={t('dock.drop')} title={t('dock.drop')}
          onClick={() => { void api.dropPending(sessionId, projectId, p.key).then(() => { touch(sessionId) }) }}>×</button>
      </li>)}
    </ul>}
  </div>
}
