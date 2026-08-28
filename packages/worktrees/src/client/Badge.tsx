/**
 * The session-header badge (`conversation.session.header.utilities`): a pure
 * git worktree status capsule — branch name and the combined diff line count,
 * with hover titles carrying the uncommitted/committed breakdown. Clicking
 * opens the worktrees drawer (changes / commits / repo files). Only renders in
 * repository sessions. Status is expressed by the counts color (warn tint when
 * there are uncommitted changes) rather than a jarring outline.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '../types.ts'
import type { WorktreesBadgeProps } from './contract.ts'
import css from './Badge.module.css'

/** The badge. */
export function WorktreesBadge({ sessionId, summary, open, subscribeVersion, getVersion, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    let cancelled = false
    void summary(sessionId).then(result => {
      if (result.ok && !cancelled) setData(result.value)
    })
    return () => { cancelled = true }
  }, [summary, sessionId])

  // Re-fetch the summary whenever the active worktree changes (a drawer
  // switch bumps the version) — the badge then tracks the switched worktree's
  // branch instead of staying on the main checkout.
  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    const refetch = (): void => {
      void summary(sessionId).then(result => {
        if (result.ok) setData(result.value)
      })
    }
    // Immediate read to seed the initial version, then keep it current.
    void getVersion()
    const unsubscribe = subscribeVersion(refetch)
    return unsubscribe
  }, [sessionId, summary, subscribeVersion, getVersion])

  if (data === null || sessionId === undefined || sessionId === '' || !data.isRepo) return null

  const hasChanges = data.dirty > 0
    || data.uncommitted.additions > 0 || data.uncommitted.deletions > 0
    || data.committed.additions > 0 || data.committed.deletions > 0
  const totalAdd = data.uncommitted.additions + data.committed.additions
  const totalDel = data.uncommitted.deletions + data.committed.deletions
  const branchLabel = data.branch ?? t('summary.detached')
  const hoverBreakdown = `${t('summary.uncommitted', {
    add: String(data.uncommitted.additions), del: String(data.uncommitted.deletions),
  })} / ${t('summary.committed', {
    add: String(data.committed.additions), del: String(data.committed.deletions),
  })}`

  return (
    <span
      className={`${css.badge} ${hasChanges ? css.dirty : css.clean}`}
      role="status"
      aria-label={t('aria.badge')}
    >
      <button
        type="button"
        className={css.zone}
        title={`${branchLabel} · ${hoverBreakdown}`}
        aria-label={t('aria.openDrawer')}
        onClick={() => { open('worktree') }}
      >
        <IconBranchOutline16 />
        <span className={css.zoneText}>{branchLabel}</span>
        <span className={`${css.counts} ${hasChanges ? css.countsDirty : ''}`}>+{totalAdd} −{totalDel}</span>
      </button>
    </span>
  )
}
