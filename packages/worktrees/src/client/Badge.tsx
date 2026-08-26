/**
 * The session-header badge (`conversation.session.header.utilities`): TWO
 * independent capsules. LEFT (folder icon + repo/workspace name) opens the
 * local-files browser — git-agnostic, so it renders in EVERY session (repo or
 * not), starting from the session's repository root (or the filesystem root
 * when the session is not a repo). RIGHT (branch icon + branch name + counts)
 * opens the worktrees drawer (changes / commits / repo files) and only renders
 * in repository sessions. Status is expressed by the counts color (warn tint
 * when there are uncommitted changes) rather than a jarring outline.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBranchOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '../types.ts'
import type { WorktreesBadgeProps } from './contract.ts'
import css from './Badge.module.css'

/** The badge. */
export function WorktreesBadge({ sessionId, summary, open, openLocalFiles, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void summary(sessionId).then(result => {
      if (result.ok && !cancelled) setData(result.value)
    })
    return () => { cancelled = true }
  }, [summary, sessionId])

  if (data === null) return null

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
  // The LEFT capsule's browse start: the repository root in a repo session,
  // otherwise the filesystem root (the user navigates from there).
  const localStart = data.repo !== '' ? data.repo : '/'

  return (
    <span
      className={`${css.badge} ${hasChanges ? css.dirty : css.clean}`}
      role="status"
      aria-label={t('aria.badge')}
    >
      <button
        type="button"
        className={`${css.zone} ${css.repoZone}`}
        title={isRepo ? `${data.repoName} · ${data.repo}` : t('local.browse')}
        aria-label={t('aria.openLocal')}
        onClick={() => { openLocalFiles(localStart) }}
      >
        <IconFolderOpenOutline16 />
        <span className={css.zoneText}>{isRepo ? data.repoName : t('local.title')}</span>
      </button>
      {isRepo && (
        <>
          <span className={css.sep} aria-hidden="true" />
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
        </>
      )}
    </span>
  )
}
