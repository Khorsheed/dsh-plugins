/**
 * The session-header badge (`conversation.session.header.utilities`): a
 * compact chip showing the current session's repository and worktree as two
 * icon buttons plus the combined diff line count. The names live in hover
 * titles (the repo's absolute path; the branch with the uncommitted/committed
 * breakdown) so the chip stays small. Two click zones — the repository icon
 * opens the drawer in repository-browse mode, the branch icon in changes
 * mode ("click what you mean"). Colors express git facts only: green = clean,
 * yellow = uncommitted or unmerged changes. Non-repository sessions render
 * nothing.
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
    <span className={`${css.badge} ${hasChanges ? css.dirty : css.clean}`} role="status" aria-label={t('aria.badge')}>
      <button
        type="button"
        className={`${css.zone} ${css.repoZone}`}
        title={`${data.repoName} · ${data.repo}`}
        aria-label={t('mode.repo')}
        onClick={() => { open('repo') }}
      >
        <IconFolderOpenOutline16 />
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
        <span className={css.counts}>+{totalAdd} −{totalDel}</span>
      </button>
    </span>
  )
}
