/**
 * The selected turn's participants as one flat row: the main conversation,
 * then every agent that ran in this turn (external agents and subagents
 * alike) and the turn's compactions. Nothing that did not take part shows.
 * Past four participants beside the main conversation, three stay visible
 * (the selected one always among them) and the rest fold into "+N", which
 * lists them all in the order they started. A note at the row's end holds
 * facts with a jump — the request that delegated the view, a compaction's
 * position — so the tabs keep the header's bottom edge. A failure shows as
 * the tab's ✗ and the failure card below, nowhere else.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentScopeOverview, ListTurnsResult, RequestLink } from '../types.ts'
import { requestNumberText } from './aggregate.ts'
import { selfRoundLabel, unrecordedText } from './RoomRecords.tsx'
import type { InspectorTabProps } from './contract.ts'
import css from './AgentTabs.module.css'
type T = InspectorTabProps['t']

/** Participants shown beside the main conversation before the rest fold behind "+N". */
const VISIBLE = 3

export interface AgentTabsProps {
  readonly scopes: readonly AgentScopeOverview[]
  readonly value: string
  readonly onSelect: (scopeId: string) => void
  readonly onOpenRequest: (link: RequestLink) => void
  readonly t: T
  /** The room's decision-model calls this turn: a 房间 tab after the agents when positive. */
  readonly roomCount?: number | undefined
}

function labelOf(scope: AgentScopeOverview, t: T): string {
  if (scope.kind === 'main') return t('scope.mainName')
  if (scope.kind === 'compaction') return t('tabs.compaction')
  // A member's self-started round beside the member in a room round: 「kimi · 后台任务完成后继续 2」.
  if (scope.kind === 'subagent' && scope.continues !== undefined) {
    return selfRoundLabel({ ...scope, continues: scope.continues }, t)
  }
  return scope.label ?? scope.scopeId
}

/** 289K / 44.7K: the stats line's compact count. */
function compactTokens(n: number): string {
  const scaled = (v: number): string => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

function Mark({ scope }: { readonly scope: AgentScopeOverview }): ReactNode {
  // Success is the norm; only a failure earns a mark.
  if (scope.status === 'failed') return <span className={css.bad} aria-hidden="true">✗</span>
  return null
}

function Tab({ scope, selected, onSelect, t }: { readonly scope: AgentScopeOverview; readonly selected: boolean; readonly onSelect: (id: string) => void; readonly t: T }): ReactNode {
  return <button type="button" role="tab" aria-selected={selected} className={css.tab} onClick={() => onSelect(scope.scopeId)} title={labelOf(scope, t)}>
    <span className={css.label}>{labelOf(scope, t)}</span>
    <Mark scope={scope} />
    <span className={css.count}>{scope.requests.length}</span>
  </button>
}

function Overflow({ hidden, items, value, onSelect, t }: { readonly hidden: number; readonly items: readonly AgentScopeOverview[]; readonly value: string; readonly onSelect: (id: string) => void; readonly t: T }): ReactNode {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return <div ref={box} className={css.moreBox}>
    <button type="button" className={css.more} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(v => !v)}>
      +{hidden}
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className={css.pop} role="listbox" aria-label={t('tabs.participants')}>
      <div className={css.popHead}><span>{t('tabs.participants')} · {items.length}</span><span>{t('tabs.popCols')}</span></div>
      {items.map(scope => <button key={scope.scopeId} type="button" role="option" aria-selected={scope.scopeId === value} className={css.popRow} title={labelOf(scope, t)} onClick={() => { onSelect(scope.scopeId); setOpen(false) }}>
        <span className={css.label}>{labelOf(scope, t)}</span>
        <span className={css.mark}><Mark scope={scope} /></span>
        <span className={css.num}>{scope.delegatedBy ? `#${requestNumberText(scope.delegatedBy)}` : '—'}</span>
        <span className={css.num}>{scope.requests.length}</span>
      </button>)}
    </div>}
  </div>
}

/** How the selected view relates to the main conversation: facts with a jump, no explanations. */
function Relation({ scope, onOpenRequest, t }: { readonly scope: AgentScopeOverview; readonly onOpenRequest: (link: RequestLink) => void; readonly t: T }): ReactNode {
  const back = (link: RequestLink) => <button type="button" onClick={() => onOpenRequest(link)}>{t('rel.back', { seq: requestNumberText(link) })}</button>
  const parts: ReactNode[] = []
  if (scope.kind === 'compaction') {
    const c = scope.compaction
    if (c?.replacedCount !== undefined) parts.push(<span key="n">{t('rel.compacted', { count: String(c.replacedCount) })}</span>)
    // An external CLI member's: who started it, and the occupancy it left.
    if (c?.member !== undefined) {
      const m = c.member
      // In the 未归轮 group the compaction belongs to no round: never say "this round".
      const loose = scope.scopeId.startsWith('compaction:unattributed:')
      parts.push(<span key="m">{t(m.source === 'auto' ? loose ? 'rel.memberAutoLoose' : 'rel.memberAuto' : 'rel.memberManual', { name: m.name ?? '' })}</span>)
      if (m.beforeTokens !== undefined && m.afterTokens !== undefined) parts.push(<span key="t">{t('rel.memberTokens', { before: compactTokens(m.beforeTokens), after: compactTokens(m.afterTokens) })}</span>)
      // What the source does not report, as local-agent marked it: never filled in.
      if (m.unrecorded !== undefined && m.unrecorded.length > 0) parts.push(<span key="u">{t('rel.memberUnrecorded', { items: unrecordedText(m.unrecorded, t) })}</span>)
    } else if (c?.betweenTurns) parts.push(<span key="w">{t('rel.betweenTurns')}</span>)
    else if (c?.after) parts.push(<span key="w">{t('rel.after', { seq: requestNumberText(c.after) })}</span>, <span key="b">{back(c.after)}</span>)
  } else if (scope.cliSubagent !== undefined && scope.delegatedBy) {
    // A member CLI's own subagent: the request of the view whose call started it.
    const by = scope.cliSubagent.parentName ?? t('scope.mainName')
    parts.push(<span key="by">{t('rel.spawnedBy', { name: by, seq: requestNumberText(scope.delegatedBy) })}</span>, <span key="b">{back(scope.delegatedBy)}</span>)
  } else if (scope.delegatedBy) {
    parts.push(<span key="by">{t('rel.delegatedBy', { seq: requestNumberText(scope.delegatedBy) })}</span>, <span key="b">{back(scope.delegatedBy)}</span>)
  } else if (scope.continues?.startedBy !== undefined) {
    // A self-started round: the request whose tool call started the task (or its round's first request).
    const start = scope.continues.startedBy
    parts.push(<span key="by">{t(start.viaTask ? 'rel.startedByTask' : 'rel.startedByRound', { seq: requestNumberText(start) })}</span>, <span key="b">{back(start)}</span>)
  }
  return parts.length === 0 ? null : <div className={css.relation}>{parts}</div>
}

/** A member CLI's own subagents right after the view that called them (the order the response gave them). */
function afterCallers(agents: readonly AgentScopeOverview[]): AgentScopeOverview[] {
  const out = agents.filter(scope => scope.cliSubagent === undefined || !agents.some(other => other.scopeId === scope.cliSubagent!.parentScopeId))
  const placed = agents.filter(scope => !out.includes(scope))
  for (const child of placed) {
    const at = out.findIndex(scope => scope.scopeId === child.cliSubagent!.parentScopeId)
    let end = at + 1
    while (end < out.length && out[end]!.cliSubagent?.parentScopeId === child.cliSubagent!.parentScopeId) end += 1
    out.splice(end, 0, child)
  }
  return out
}

/** The 房间 tab's value (no agent scope carries it). */
export const ROOM_TAB = 'room:decisions'

export function AgentTabs({ scopes, value, onSelect, onOpenRequest, roomCount, t }: AgentTabsProps): ReactNode {
  const selected = scopes.find(scope => scope.scopeId === value) ?? scopes[0]
  const main = scopes.filter(scope => scope.kind === 'main')
  const others = [
    ...afterCallers(scopes.filter(scope => scope.kind === 'subagent').sort((a, b) => a.startedAt - b.startedAt)),
    ...scopes.filter(scope => scope.kind === 'compaction'),
  ]
  let shown = others
  if (others.length > VISIBLE + 1) {
    shown = others.slice(0, VISIBLE)
    const current = others.find(scope => scope.scopeId === value)
    if (current !== undefined && !shown.includes(current)) shown = [...others.slice(0, VISIBLE - 1), current]
  }
  return <div className={css.root}>
    <div className={css.row} role="tablist" aria-label={t('tab.title')}>
      {[...main, ...shown].map(scope => <Tab key={scope.scopeId} scope={scope} selected={value !== ROOM_TAB && scope.scopeId === selected?.scopeId} onSelect={onSelect} t={t} />)}
      {shown.length < others.length && <Overflow hidden={others.length - shown.length} items={others} value={value} onSelect={onSelect} t={t} />}
      {/* The room's own decision-model calls this turn, after every agent. */}
      {roomCount !== undefined && roomCount > 0 && (
        <button type="button" role="tab" aria-selected={value === ROOM_TAB} className={css.tab} onClick={() => onSelect(ROOM_TAB)}>
          <span className={css.label}>{t('room.tab')}</span>
          <span className={css.count}>{roomCount}</span>
        </button>
      )}
      {selected && value !== ROOM_TAB && <Relation scope={selected} onOpenRequest={onOpenRequest} t={t} />}
    </div>
  </div>
}

/** A session opened on its own that is another session's child. */
export function ParentLine({ parent, t }: { readonly parent: NonNullable<ListTurnsResult['parent']>; readonly t: T }): ReactNode {
  return <div className={css.parent}>
    <span className={css.muted}>{t('rel.parent')}</span>
    <b>{parent.title ?? parent.sessionId}</b>
    {parent.hostTurn !== undefined && <span className={css.muted}>· {t('rel.parentTurn', { turn: String(parent.hostTurn) })}</span>}
    {parent.label !== undefined && <span className={css.muted}>· {t('rel.parentLabel', { label: parent.label })}</span>}
  </div>
}
