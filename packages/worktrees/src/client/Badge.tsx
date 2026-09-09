/**
 * The session-header badge (`conversation.session.header.utilities`): TWO
 * independent capsules. LEFT (folder icon + repo/workspace name) opens the
 * local-files browser — git-agnostic, so it renders in EVERY session (repo or
 * not), starting from the session's repository root (or the filesystem root
 * when the session is not a repo). RIGHT (branch icon + branch name + counts)
 * opens the worktrees drawer (changes / commits / repo files) and only renders
 * in repository sessions. Status is expressed by the counts color (warn tint
 * when there are uncommitted changes) rather than a jarring outline. The
 * branch capsule re-fetches whenever the active worktree changes (a drawer
 * switch bumps the version), so it tracks the switched worktree's branch.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBranchOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '../types.ts'
import type { WorktreesBadgeProps } from './contract.ts'
import { useLocalRoot } from './local-root.ts'
import { basenameOf } from './language.ts'
import css from './Badge.module.css'

/** The badge. */
export function WorktreesBadge({ sessionId, summary, open, openLocalFiles, subscribeVersion, getVersion, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)
  // This session's current/remembered local-files root (its badge label).
  const localRoot = useLocalRoot(sessionId)

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

  // No isRepo gate here: the local-files capsule renders in EVERY session.
  if (data === null || sessionId === undefined || sessionId === '') return null

  const isRepo = data.isRepo
  const hasChanges = isRepo && (data.dirty > 0
    || data.uncommitted.additions > 0 || data.uncommitted.deletions > 0
    || data.committed.additions > 0 || data.committed.deletions > 0)
  const totalAdd = isRepo ? data.uncommitted.additions + data.committed.additions : 0
  const totalDel = isRepo ? data.uncommitted.deletions + data.committed.deletions : 0
  const branchLabel = isRepo ? (data.branch ?? t('summary.detached')) : ''
  const hoverBreakdown = isRepo ? `${t('summary.uncommitted', {
    add: String(data.uncommitted.additions), del: String(data.uncommitted.deletions),
  })} / ${t('summary.committed', {
    add: String(data.committed.additions), del: String(data.committed.deletions),
  })}` : ''
  // The LEFT capsule label: this session's local-files root (its basename) when
  // one is remembered, else the session repo name (the default browse start).
  const localName = localRoot !== '' ? basenameOf(localRoot) : (isRepo ? data.repoName : t('local.title'))
  // The browse start: the remembered root if any, else the session repo root.
  const localStart = localRoot !== '' ? localRoot : (data.repo !== '' ? data.repo : '/')

  return (
    <span
      className={`${css.badge} ${hasChanges ? css.dirty : css.clean}`}
      role="status"
      aria-label={t('aria.badge')}
    >
      {isRepo && (
        <>
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
          <span className={css.sep} aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        className={`${css.zone} ${css.repoZone}`}
        title={localRoot !== '' ? localRoot : (isRepo ? `${data.repoName} · ${data.repo}` : t('local.browse'))}
        aria-label={t('aria.openLocal')}
        onClick={() => { openLocalFiles(sessionId, localStart) }}
      >
        <IconFolderOpenOutline16 />
        <span className={css.zoneText}>{localName}</span>
      </button>
    </span>
  )
}
