/**
 * The session-header badge (`conversation.session.header.utilities`): an
 * informative worktree status capsule — repository name, branch, and the
 * combined diff line count, with hover titles carrying the full path and the
 * uncommitted/committed breakdown. Two click zones — the repository segment
 * opens the drawer in repository-browse mode, the branch segment in changes
 * mode ("click what you mean"). Status is expressed by the counts color
 * (warn tint when there are uncommitted or unmerged changes) rather than a
 * jarring outline. Non-repository sessions render nothing.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBranchOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '../types.ts'
import type { WorktreesBadgeProps } from './contract.ts'
import css from './Badge.module.css'

/** The badge. */
export function WorktreesBadge({ sessionId, summary, open, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void summary(sessionId).then(result => {
      if (result.ok && !cancelled) setData(result.value)
    })
    return () => { cancelled = true }
  }, [summary, sessionId])

  if (data === null || !data.isRepo) return null

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
        className={`${css.zone} ${css.repoZone}`}
        title={`${data.repoName} · ${data.repo}`}
        aria-label={t('mode.repo')}
        onClick={() => { open('repo') }}
      >
        <IconFolderOpenOutline16 />
        <span className={css.zoneText}>{data.repoName}</span>
      </button>
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
    </span>
  )
}
