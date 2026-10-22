/**
 * The turn's views as grouped capsules: the main conversation, external
 * agents (Claude Code, Codex, Kimi…), dsh subagents, and the compactions that
 * happened in this turn. A group with more than three entries shows two (the
 * selected one always among them) and folds the rest into "+N", which opens
 * the whole group in delegation order. The line below names how the selected
 * view relates to the main conversation, with a jump back where one exists.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentScopeOverview, ListTurnsResult, RequestLink } from '../types.ts'
import { requestNumberText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './AgentTabs.module.css'
type T = InspectorTabProps['t']
type Group = 'main' | 'external' | 'subagent' | 'compaction'

const isExternal = (scope: AgentScopeOverview) => scope.kind === 'subagent' && scope.provider !== undefined && !scope.provider.startsWith('dsh')
function groupOf(scope: AgentScopeOverview): Group {
  if (scope.kind === 'main' || scope.kind === 'compaction') return scope.kind
  return isExternal(scope) ? 'external' : 'subagent'
}
const GROUPS: Group[] = ['main', 'external', 'subagent', 'compaction']

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
  if (scope.status === 'ok' && scope.kind !== 'main' && scope.kind !== 'compaction') return <span className={css.ok} aria-hidden="true">✓</span>
  if (scope.status === 'failed') return <span className={css.bad} aria-hidden="true">✗</span>
  return null
}

function Tab({ scope, selected, onSelect, t }: { readonly scope: AgentScopeOverview; readonly selected: boolean; readonly onSelect: (id: string) => void; readonly t: T }): ReactNode {
  const group = groupOf(scope)
  return <button type="button" role="tab" aria-selected={selected} className={css.tab} onClick={() => onSelect(scope.scopeId)} title={labelOf(scope, t)}>
    {group !== 'main' && <i className={css.dot} data-group={group} />}
    <span className={css.label}>{labelOf(scope, t)}</span>
    <Mark scope={scope} />
    <span className={css.count}>{scope.requests.length}</span>
  </button>
}

function Overflow({ group, items, value, onSelect, t }: { readonly group: Group; readonly items: readonly AgentScopeOverview[]; readonly value: string; readonly onSelect: (id: string) => void; readonly t: T }): ReactNode {
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
      +{items.length}
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className={css.pop} role="listbox" aria-label={t(`tabs.group.${group}`)}>
      <div className={css.popHead}><span>{t(`tabs.group.${group}`)} · {items.length}</span><span>{t('tabs.popCols')}</span></div>
      {items.map(scope => <button key={scope.scopeId} type="button" role="option" aria-selected={scope.scopeId === value} className={css.popRow} title={labelOf(scope, t)} onClick={() => { onSelect(scope.scopeId); setOpen(false) }}>
        <i className={css.dot} data-group={group} />
        <span className={css.label}>{labelOf(scope, t)}</span>
        <span className={css.mark}><Mark scope={scope} /></span>
        <span className={css.num}>{scope.delegatedBy ? `#${requestNumberText(scope.delegatedBy)}` : '—'}</span>
        <span className={css.num}>{scope.requests.length}</span>
      </button>)}
    </div>}
  </div>
}

/** How the selected view relates to the main conversation. */
function Relation({ scope, scopes, onOpenRequest, t }: { readonly scope: AgentScopeOverview; readonly scopes: readonly AgentScopeOverview[]; readonly onOpenRequest: (link: RequestLink) => void; readonly t: T }): ReactNode {
  const back = (link: RequestLink) => <button type="button" onClick={() => onOpenRequest(link)}>{t('rel.back', { seq: requestNumberText(link) })}</button>
  if (scope.kind === 'main') {
    const delegations = scopes.filter(s => s.kind === 'subagent').length
    const compactions = scopes.filter(s => s.kind === 'compaction').length
    return <div className={css.relation}>{[
      t('rel.main', { count: String(scope.requests.length) }),
      ...delegations > 0 ? [t('rel.delegations', { count: String(delegations) })] : [],
      ...compactions > 0 ? [t('rel.compactions', { count: String(compactions) })] : [],
    ].join(' · ')}</div>
  }
  if (scope.kind === 'compaction') {
    const c = scope.compaction
    return <div className={css.relation}>
      {c?.replacedCount !== undefined && <span>{t('rel.compacted', { count: String(c.replacedCount) })}</span>}
      {c?.betweenTurns ? <span>{t('rel.betweenTurns')}</span> : c?.after && <span>{t('rel.after', { seq: requestNumberText(c.after) })}</span>}
      {c?.after && back(c.after)}
    </div>
  }
  return <div className={css.relation}>
    <span>{isExternal(scope) ? t('rel.external', { provider: scope.provider ?? '' }) : t('rel.subagent')}</span>
    {scope.delegatedBy ? <><span>{t('rel.delegatedBy', { seq: requestNumberText(scope.delegatedBy) })}</span>{back(scope.delegatedBy)}</> : <span>{t('rel.noCall')}</span>}
    {scope.status === 'failed' && scope.error && <span className={css.bad} title={scope.error}>{t('rel.failed')}</span>}
  </div>
}

export function AgentTabs({ scopes, value, onSelect, onOpenRequest, t }: AgentTabsProps): ReactNode {
  const selected = scopes.find(scope => scope.scopeId === value) ?? scopes[0]
  return <div className={css.root}>
    <div className={css.groups} role="tablist" aria-label={t('tab.title')}>
      {GROUPS.map(group => {
        const items = scopes.filter(scope => groupOf(scope) === group)
        if (items.length === 0) return null
        let shown = items
        if (items.length > 3) {
          const current = items.find(scope => scope.scopeId === value)
          shown = current === undefined || items.indexOf(current) < 2 ? items.slice(0, 2) : [items[0]!, current]
        }
        const rest = items.filter(scope => !shown.includes(scope))
        return <div key={group} className={css.group}>
          {group !== 'main' && group !== 'compaction' && <span className={css.groupLabel}>{t(`tabs.group.${group}`)}</span>}
          {shown.map(scope => <Tab key={scope.scopeId} scope={scope} selected={scope.scopeId === selected?.scopeId} onSelect={onSelect} t={t} />)}
          {rest.length > 0 && <Overflow group={group} items={items} value={value} onSelect={onSelect} t={t} />}
        </div>
      })}
    </div>
    {selected && <Relation scope={selected} scopes={scopes} onOpenRequest={onOpenRequest} t={t} />}
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
