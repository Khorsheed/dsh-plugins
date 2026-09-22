/**
 * The session-header badge (`conversation.session.header.utilities`): ONE
 * capsule (branch icon + branch name + counts) opening the worktrees
 * right-Sidebar tab (changes / commits / repo files), rendered only in
 * repository sessions. Status is expressed by the counts color (warn tint
 * when there are uncommitted changes) rather than a jarring outline. The
 * capsule re-fetches whenever the active worktree changes (a tab switch bumps
 * the version), so it tracks the switched worktree's branch.
 *
 * The badge used to carry a second, folder capsule opening the local-files
 * browser in EVERY session; 2026-09-10 the workspace capsule left the header
 * (file browsing converged on the sidebar / conversation-tab entries), while
 * the browser surface itself (shell.overlay) stays mounted.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventorySnapshot, SessionSummary } from '../types.ts'
import type { WorktreesBadgeProps } from './contract.ts'
// The criterion's row constant lives with the tab's registration-level gate —
// one constant, two enforcement levels of the same rule.
import { WORKTREES_TOOL_ROW_MODULE } from './preset-visibility.ts'
import css from './Badge.module.css'

const TOOL_ROW_MODULE = WORKTREES_TOOL_ROW_MODULE

/** The badge. */
export function WorktreesBadge({ sessionId, summary, fetchBadgeConfig, fetchComposition, open, subscribeVersion, subscribeSessionEvents, useSessions, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)
  // The display gate: null while the config RPC is pending or failed, and
  // whenever the composition leaves `visiblePresets` empty — all meaning "no
  // gate, always show" (fail-open in both directions).
  const [gate, setGate] = useState<readonly string[] | null>(null)
  // The OFFICIAL preset-composition data the DEFAULT criterion reads; null
  // while the inventory RPC is pending/failed and whenever the host mounts
  // no pluginInventory namespace at all — all "no composition data,
  // fail-open" (the badge never disappears for want of an answer).
  const [composition, setComposition] = useState<PluginInventorySnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchBadgeConfig().then(result => {
      if (cancelled || !result.ok) return
      const list = result.value.visiblePresets
      setGate(list.length > 0 ? list : null)
    }).catch(() => { /* an unreachable Remote reads as no gate (fail-open) */ })
    return () => { cancelled = true }
  }, [fetchBadgeConfig])

  useEffect(() => {
    if (fetchComposition === undefined) return
    let cancelled = false
    void fetchComposition().then(result => {
      if (cancelled || !result.ok) return
      setComposition(result.value)
    }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    return () => { cancelled = true }
  }, [fetchComposition])

  // The current session's agent preset, the same read ui-agent-preset's
  // header label makes — per host line: the 0.1.2 line projects the preset
  // into `projectionValues.agentPreset`, while the 0.1.1 line (npm stable
  // 0.1.1-rc.2) carries it as the list row's TOP-LEVEL `agentPreset` field
  // (its client row type predates the projection). Dual-read, projection
  // first; undefined on both = the session records no preset.
  const preset = useSessions((state) => {
    if (sessionId === undefined) return undefined
    const row = state.byId[sessionId]
    const value = row?.projectionValues?.agentPreset
      ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
    return typeof value === 'string' ? value : undefined
  })

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    let cancelled = false
    void summary(sessionId).then(result => {
      if (result.ok && !cancelled) setData(result.value)
    })
    return () => { cancelled = true }
  }, [summary, sessionId])

  // The badge's invalidation channels — none of them periodic, because a
  // summary costs several git invocations:
  //  - the plugin's own version: a worktree switch, or any refresh the tab
  //    performed (the header must not lag the pane);
  //  - the Host's FORWARDED session events: `api-session/status` fires on an
  //    agent running flip (turn boundary, i.e. the model's tools — including a
  //    worktree switch — have just run) and `api-session/activity` on a user
  //    message. A model-side switch lands here, which is what used to leave the
  //    header on the main checkout while the pane showed the worktree;
  //  - the window regaining focus/visibility: the only way an out-of-band
  //    change (another agent, another checkout) gets re-read, and it costs one
  //    RPC per return instead of a timer.
  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    const refetch = (): void => {
      void summary(sessionId).then(result => {
        if (result.ok) setData(result.value)
      })
    }
    const unsubscribeVersion = subscribeVersion(refetch)
    const unsubscribeSession = subscribeSessionEvents((id) => {
      if (id === sessionId) refetch()
    })
    const onVisibility = (): void => {
      if (document.visibilityState !== 'hidden') refetch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refetch)
    return () => {
      unsubscribeVersion()
      unsubscribeSession()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refetch)
    }
  }, [sessionId, summary, subscribeVersion, subscribeSessionEvents])

  // The visibility decision, in criterion order (sessions with NO preset
  // stay visible on every path — fail-open; the gate hides dev chrome,
  // never breaks preset-less deployments):
  // 1. A configured `visiblePresets` (non-empty) is the OVERRIDE: the
  //    hand-maintained list gates, exactly the pilot semantics.
  // 2. Otherwise the OFFICIAL composition data decides: the badge shows
  //    exactly when the session's preset composition names the
  //    `@khorsheed/dsh-worktrees-tool` row. A preset group that is missing
  //    from the snapshot or answered `broken` is unreadable data, not an
  //    answer — fail-open; so is a pending/failed inventory fetch.
  if (preset !== undefined) {
    if (gate !== null) {
      if (!gate.includes(preset)) return null
    } else if (composition !== null) {
      const group = composition.agentPresets?.find(candidate => candidate.id === preset)
      if (group !== undefined && group.broken === undefined
        && !group.rows.some(row => row.moduleName === TOOL_ROW_MODULE)) return null
    }
  }

  // The branch capsule is the badge's only content: non-repo sessions render
  // nothing (the folder capsule that used to cover them left the header).
  if (data === null || sessionId === undefined || sessionId === '') return null
  if (!data.isRepo) return null

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
