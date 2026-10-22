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
}

function labelOf(scope: AgentScopeOverview, t: T): string {
  if (scope.kind === 'main') return t('scope.mainName')
  if (scope.kind === 'compaction') return t('tabs.compaction')
  return scope.label ?? scope.scopeId
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
    if (c?.betweenTurns) parts.push(<span key="w">{t('rel.betweenTurns')}</span>)
    else if (c?.after) parts.push(<span key="w">{t('rel.after', { seq: requestNumberText(c.after) })}</span>, <span key="b">{back(c.after)}</span>)
  } else if (scope.delegatedBy) {
    parts.push(<span key="by">{t('rel.delegatedBy', { seq: requestNumberText(scope.delegatedBy) })}</span>, <span key="b">{back(scope.delegatedBy)}</span>)
  }
  return parts.length === 0 ? null : <div className={css.relation}>{parts}</div>
}

export function AgentTabs({ scopes, value, onSelect, onOpenRequest, t }: AgentTabsProps): ReactNode {
  const selected = scopes.find(scope => scope.scopeId === value) ?? scopes[0]
  const main = scopes.filter(scope => scope.kind === 'main')
  const others = [
    ...scopes.filter(scope => scope.kind === 'subagent').sort((a, b) => a.startedAt - b.startedAt),
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
      {[...main, ...shown].map(scope => <Tab key={scope.scopeId} scope={scope} selected={scope.scopeId === selected?.scopeId} onSelect={onSelect} t={t} />)}
      {shown.length < others.length && <Overflow hidden={others.length - shown.length} items={others} value={value} onSelect={onSelect} t={t} />}
      {selected && <Relation scope={selected} onOpenRequest={onOpenRequest} t={t} />}
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
