/**
 * The team view: the room's organization in the right sidebar, opened from
 * the members tab. One layout that adapts to its own width — narrow, an
 * indented tree (you → coordinator → members) whose nodes expand into the
 * deliveries they received; wide (≥ 600px), the same tree laid out
 * top-down with drawn edges (solid = tasks handed over, with the report
 * count coming back; dashed = FYIs off the tree) and the selected member's
 * details below. Opening it with a `member` param selects and reveals that
 * member (the cards' 在团队中定位).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomState } from '../types.ts'
import { formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import { formatTokens, TEAM_ROOT, teamOf, type Team, type TeamNode } from './team.ts'
import type { MembersViewProps } from './slots.ts'
import css from './TeamView.module.css'

/** A node element by id, without building a selector from member ids. */
function nodeElement(root: ParentNode, id: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[data-team-node]')].find(element => element.dataset['teamNode'] === id)
}

/** Wide layout threshold (the view's own width). */
const WIDE = 600

type T = MembersViewProps['t']

function StatusDot({ node, t }: { readonly node: TeamNode; readonly t: T }): ReactNode {
  const label = node.status === 'running' ? t('members.status.running') : node.status === 'failed' ? t('members.status.failed') : t('members.status.idle')
  return <span className={css.status} data-status={node.status}><i aria-hidden />{label}</span>
}

function Avatar({ node }: { readonly node: TeamNode }): ReactNode {
  return <span className={css.avatar} style={{ '--member-color': memberColor(node.member.name) } as CSSProperties} aria-hidden>{node.member.name.slice(0, 1).toUpperCase()}</span>
}

/** Provider · model line. */
function configLine(node: TeamNode, t: T): string {
  const provider = node.member.kind === 'main-agent' ? t('member.kind.main')
    : node.member.kind === 'native' ? t('member.kind.native', { preset: node.member.preset ?? t('member.kind.defaultPreset') })
      : node.member.provider ?? ''
  return [provider, node.model].filter(Boolean).join(' · ')
}

function statsLine(node: TeamNode, t: T): string {
  return t('team.stats', { tokens: formatTokens(node.tokens), time: formatDurationMs(node.elapsedMs), rounds: node.rounds })
}

/** What flowed into a node: tasks and returned reports from its parent, FYIs, and work from elsewhere. */
function flowOf(team: Team, node: TeamNode, t: T): { readonly tasks: number; readonly reports: number; readonly notifies: number; readonly others: string | undefined } {
  const name = (id: string): string => id === TEAM_ROOT ? t('team.you') : team.nodes.find(entry => entry.id === id)?.member.name ?? id
  const into = team.edges.filter(edge => edge.to === node.id)
  const fromParent = into.find(edge => edge.from === node.parent)
  const others = into.filter(edge => edge.from !== node.parent && edge.tasks > 0)
    .map(edge => t('team.crossTask', { from: name(edge.from), count: edge.tasks }))
  return {
    tasks: fromParent?.tasks ?? 0,
    reports: fromParent?.reports ?? 0,
    notifies: into.reduce((sum, edge) => sum + edge.notifies, 0),
    others: others.length === 0 ? undefined : others.join(' · '),
  }
}

/** The counts pill: 「派 3 · 回 2 · 知会 1」, other sources in its tooltip. */
function FlowPill({ team, node, t, floating }: { readonly team: Team; readonly node: TeamNode; readonly t: T; readonly floating: boolean }): ReactNode {
  if (node.parent === TEAM_ROOT && node.coordinator) return null
  const flow = flowOf(team, node, t)
  if (flow.tasks === 0 && flow.notifies === 0 && flow.others === undefined) return null
  return (
    <span className={floating ? css.pillFloat : css.pill} title={flow.others === undefined ? undefined : t('team.alsoFrom', { list: flow.others })}>
      {t('team.pillTasks', { count: flow.tasks })}
      {flow.reports > 0 && <span className={css.pillReport}>{t('team.pillReports', { count: flow.reports })}</span>}
      {flow.notifies > 0 && <span className={css.pillNotify}>{t('team.pillNotify', { count: flow.notifies })}</span>}
      {flow.others !== undefined && <span>…</span>}
    </span>
  )
}

function Deliveries({ node, t }: { readonly node: TeamNode; readonly t: T }): ReactNode {
  if (node.deliveries.length === 0) return <p className={css.empty}>{t('team.noDeliveries')}</p>
  return (
    <ul className={css.deliveries}>
      {node.deliveries.slice(0, 20).map(delivery => (
        <li key={delivery.id}>
          <span className={css.msgId}>#m{delivery.seq}</span>
          <span className={css.from}>{delivery.kind === 'report'
            ? t('team.kind.report')
            : t(delivery.kind === 'notify' ? 'team.fromNotify' : 'team.from', { from: delivery.from === TEAM_ROOT ? t('team.you') : delivery.from })}</span>
          <span className={css.text} title={delivery.text}>{delivery.text}</span>
          <span className={css.outcome} data-status={delivery.status}>{t(`team.status.${delivery.status}`)}</span>
        </li>
      ))}
    </ul>
  )
}

function NodeCard({ team, node, selected, onSelect, t, compact }: {
  readonly team: Team; readonly node: TeamNode; readonly selected: boolean
  readonly onSelect: () => void; readonly t: T; readonly compact: boolean
}): ReactNode {
  return (
    <button type="button" className={css.node} data-selected={selected} data-team-node={node.id} onClick={onSelect} aria-expanded={compact ? selected : undefined}>
      {!compact && <FlowPill team={team} node={node} t={t} floating />}
      <span className={css.nodeHead}>
        <Avatar node={node} />
        <span className={css.nodeName}>{node.member.name}</span>
        {node.coordinator && <span className={css.chip}>{t('coordinator.label')}</span>}
        {node.member.role !== undefined && <span className={css.role}>{node.member.role}</span>}
        <StatusDot node={node} t={t} />
      </span>
      <span className={css.line}>{configLine(node, t)}</span>
      <span className={css.line}>
        {compact && <FlowPill team={team} node={node} t={t} floating={false} />}
        <span>{statsLine(node, t)}</span>
      </span>
      {node.current !== undefined && <span className={css.current}>▶ {node.current}</span>}
    </button>
  )
}

function Tree({ team, at, selected, onSelect, openSession, t }: {
  readonly team: Team; readonly at: string; readonly selected: string | undefined
  readonly onSelect: (id: string) => void; readonly openSession: (sessionId: SessionId) => void; readonly t: T
}): ReactNode {
  const children = team.nodes.filter(node => node.parent === at)
  if (children.length === 0) return null
  return (
    <ul className={css.tree}>
      {children.map(node => (
        <li key={node.id}>
          <NodeCard team={team} node={node} selected={selected === node.id} compact onSelect={() => { onSelect(node.id) }} t={t} />
          {selected === node.id && (
            <div className={css.expand}>
              <Deliveries node={node} t={t} />
              {node.member.childSessionId !== undefined && (
                <button type="button" className={css.open} onClick={() => { openSession(node.member.childSessionId!) }}>{t('team.openSession')}</button>
              )}
            </div>
          )}
          <Tree team={team} at={node.id} selected={selected} onSelect={onSelect} openSession={openSession} t={t} />
        </li>
      ))}
    </ul>
  )
}

/** Depth levels for the wide layout. */
function levels(team: Team): string[][] {
  const rows: string[][] = [[TEAM_ROOT]]
  let frontier = [TEAM_ROOT]
  while (frontier.length > 0) {
    const next = team.nodes.filter(node => frontier.includes(node.parent)).map(node => node.id)
    if (next.length > 0) rows.push(next)
    frontier = next
  }
  return rows
}

/** Node width plus gap in the wide layout (matches the stylesheet). */
const SLOT = 210 + 16

/**
 * The wide layout: one row per depth, connected trunk-and-branch — a trunk
 * down from each parent, one horizontal bus over its children, a short drop
 * to each child — so lines never cross and carry no text; the counts ride
 * each node's pill. A row wider than the panel folds its tail into 「+N」.
 */
function Graph({ team, selected, onSelect, t }: {
  readonly team: Team; readonly selected: string | undefined
  readonly onSelect: (id: string) => void; readonly t: T
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [paths, setPaths] = useState<readonly { readonly d: string; readonly drop: boolean }[]>([])
  const [width, setWidth] = useState(0)
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set())
  const rows = useMemo(() => levels(team), [team])
  const perRow = Math.max(2, Math.floor((width + 16) / SLOT))
  useLayoutEffect(() => {
    const root = ref.current
    if (root === null) return undefined
    const draw = (): void => {
      setWidth(root.clientWidth)
      const base = root.getBoundingClientRect()
      const box = (id: string) => {
        const element = nodeElement(root, id)
        if (element === undefined) return undefined
        const rect = element.getBoundingClientRect()
        return { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
      }
      const next: { d: string; drop: boolean }[] = []
      const parents = new Set(team.nodes.map(node => node.parent))
      for (const parent of parents) {
        const from = box(parent)
        const kids = team.nodes.filter(node => node.parent === parent).map(node => box(node.id)).filter(entry => entry !== undefined)
        const more = nodeElement(root, `more:${parent}`)
        if (more !== undefined) {
          const rect = more.getBoundingClientRect()
          kids.push({ x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height })
        }
        if (from === undefined || kids.length === 0) continue
        const top = Math.min(...kids.map(kid => kid.y))
        const bus = top - 16
        const px = from.x + from.w / 2
        next.push({ d: `M${px},${from.y + from.h} V${bus}`, drop: false })
        const xs = kids.map(kid => kid.x + kid.w / 2)
        next.push({ d: `M${Math.min(px, ...xs)},${bus} H${Math.max(px, ...xs)}`, drop: false })
        for (const [index, kid] of kids.entries()) next.push({ d: `M${xs[index]},${bus} V${kid.y - 2}`, drop: true })
      }
      setPaths(next)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [team, unfolded, perRow])
  return (
    <div className={css.graph} ref={ref}>
      <svg className={css.edges} aria-hidden>
        <defs>
          <marker id="room-team-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" className={css.arrow} /></marker>
        </defs>
        {paths.map((path, index) => <path key={index} d={path.d} className={css.edgeTask} markerEnd={path.drop ? 'url(#room-team-arrow)' : undefined} />)}
      </svg>
      {rows.map((row, index) => {
        const folds = row.length > perRow && !unfolded.has(index)
        const shown = folds ? row.slice(0, perRow - 1) : row
        // One 「+N」 per row, attached to the parent of the first hidden node (the bus already spans it).
        const hidden = folds ? row.slice(perRow - 1) : []
        const parentOfHidden = hidden.length === 0 ? undefined : team.nodes.find(node => node.id === hidden[0])?.parent
        return (
          <div key={index} className={css.level}>
            {shown.map((id) => {
              if (id === TEAM_ROOT) return <span key={id} className={css.root} data-team-node={TEAM_ROOT}>{t('team.you')}</span>
              const node = team.nodes.find(entry => entry.id === id)!
              return <NodeCard key={id} team={team} node={node} selected={selected === id} compact={false} onSelect={() => { onSelect(id) }} t={t} />
            })}
            {hidden.length > 0 && (
              <button type="button" className={css.more} data-team-node={`more:${parentOfHidden}`} onClick={() => { setUnfolded(current => new Set([...current, index])) }}>
                {t('team.more', { count: hidden.length })}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The team view body. */
export function TeamView({ state, focus, openSession, t }: {
  readonly state: RoomState
  /** A member name to select and reveal (the navigation param). */
  readonly focus?: { readonly member: string; readonly revision: number } | undefined
  readonly openSession: (sessionId: SessionId) => void
  readonly t: T
}): ReactNode {
  const team = useMemo(() => teamOf(state), [state])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return undefined
    const observer = new ResizeObserver(() => { setWide(root.clientWidth >= WIDE) })
    observer.observe(root)
    setWide(root.clientWidth >= WIDE)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    if (focus === undefined) return
    const node = team.nodes.find(entry => entry.member.name === focus.member)
    if (node === undefined) return
    setSelected(node.id)
    requestAnimationFrame(() => {
      const root = rootRef.current
      if (root !== null) nodeElement(root, node.id)?.scrollIntoView({ block: 'nearest' })
    })
    // Every navigation reveals again, even to the same member.
  }, [focus?.member, focus?.revision])
  const select = (id: string): void => { setSelected(current => current === id && !wide ? undefined : id) }
  const chosen = team.nodes.find(node => node.id === selected)
  return (
    <div className={css.team} ref={rootRef}>
      <p className={css.summary}>
        {t('team.summary', {
          members: team.totals.members, running: team.totals.running, deliveries: team.totals.deliveries,
          tokens: formatTokens(team.totals.tokens), time: formatDurationMs(team.totals.elapsedMs),
        })}
      </p>
      <p className={css.legend}>
        <span>{t('team.legend.pill')}</span>
      </p>
      {wide ? (
        <>
          <Graph team={team} selected={selected} onSelect={select} t={t} />
          {chosen === undefined ? <p className={css.empty}>{t('team.pick')}</p> : (
            <section className={css.detail}>
              <div className={css.nodeHead}>
                <Avatar node={chosen} />
                <span className={css.nodeName}>{chosen.member.name}</span>
                {chosen.member.role !== undefined && <span className={css.role}>{chosen.member.role}</span>}
                <StatusDot node={chosen} t={t} />
                {chosen.member.childSessionId !== undefined && (
                  <button type="button" className={css.open} onClick={() => { openSession(chosen.member.childSessionId!) }}>{t('team.openSession')}</button>
                )}
              </div>
              <p className={css.line}>{configLine(chosen, t)} · {statsLine(chosen, t)}</p>
              <Deliveries node={chosen} t={t} />
            </section>
          )}
        </>
      ) : (
        <>
          <span className={css.root}>{t('team.you')}</span>
          <Tree team={team} at={TEAM_ROOT} selected={selected} onSelect={select} openSession={openSession} t={t} />
        </>
      )}
    </div>
  )
}
