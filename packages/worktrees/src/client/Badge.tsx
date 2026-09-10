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
export function WorktreesBadge({ sessionId, summary, fetchBadgeConfig, open, openLocalFiles, subscribeVersion, getVersion, useSessions, t }: WorktreesBadgeProps): ReactNode {
  const [data, setData] = useState<SessionSummary | null>(null)
  // The display gate: null while the config RPC is pending or failed, and
  // whenever the composition leaves `visiblePresets` empty — all meaning "no
  // gate, always show" (fail-open in both directions).
  const [gate, setGate] = useState<readonly string[] | null>(null)
  // This session's current/remembered local-files root (its badge label).
  const localRoot = useLocalRoot(sessionId)

  useEffect(() => {
    let cancelled = false
    void fetchBadgeConfig().then(result => {
      if (cancelled || !result.ok) return
      const list = result.value.visiblePresets
      setGate(list.length > 0 ? list : null)
    }).catch(() => { /* an unreachable Remote reads as no gate (fail-open) */ })
    return () => { cancelled = true }
  }, [fetchBadgeConfig])

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

  // The preset gate: a non-empty `visiblePresets` hides the badge in sessions
  // whose preset id is outside the list; sessions with NO preset stay visible
  // (fail-open — the gate hides dev chrome, never breaks preset-less
  // deployments). Loading keeps its own null below.
  if (gate !== null && preset !== undefined && !gate.includes(preset)) return null

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
