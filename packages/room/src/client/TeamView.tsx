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
  const provider = node.member.kind === 'main-agent' ? t('member.kind.main') : node.member.provider ?? ''
  return [provider, node.model].filter(Boolean).join(' · ')
}

function statsLine(node: TeamNode, t: T): string {
  return t('team.stats', { tokens: formatTokens(node.tokens), time: formatDurationMs(node.elapsedMs), rounds: node.rounds })
}

/** The flow into a node from its parent: "派活 3 · 回报 2". */
function inboundLine(team: Team, node: TeamNode, t: T): string | undefined {
  const row = team.edges.find(edge => edge.from === node.parent && edge.to === node.id)
  if (row === undefined || row.tasks === 0) return undefined
  return row.reports > 0 ? t('team.inboundReports', { tasks: row.tasks, reports: row.reports }) : t('team.inbound', { tasks: row.tasks })
}

/** FYIs and tasks that are not tree edges, as one line per node. */
function crossLine(team: Team, node: TeamNode, t: T): string | undefined {
  const name = (id: string): string => id === TEAM_ROOT ? t('team.you') : team.nodes.find(entry => entry.id === id)?.member.name ?? id
  const parts = team.edges
    .filter(edge => edge.to === node.id && edge.from !== node.parent)
    .flatMap(edge => [
      ...edge.tasks > 0 ? [t('team.crossTask', { from: name(edge.from), count: edge.tasks })] : [],
      ...edge.notifies > 0 ? [t('team.crossNotify', { from: name(edge.from), count: edge.notifies })] : [],
    ])
  const notifiesFromParent = team.edges.find(edge => edge.from === node.parent && edge.to === node.id)?.notifies ?? 0
  if (notifiesFromParent > 0) parts.push(t('team.crossNotify', { from: name(node.parent), count: notifiesFromParent }))
  return parts.length === 0 ? undefined : parts.join(' · ')
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
  const inbound = inboundLine(team, node, t)
  const cross = crossLine(team, node, t)
  return (
    <button type="button" className={css.node} data-selected={selected} data-team-node={node.id} onClick={onSelect} aria-expanded={compact ? selected : undefined}>
      <span className={css.nodeHead}>
        <Avatar node={node} />
        <span className={css.nodeName}>{node.member.name}</span>
        {node.coordinator && <span className={css.chip}>{t('coordinator.label')}</span>}
        {node.member.role !== undefined && <span className={css.role}>{node.member.role}</span>}
        <StatusDot node={node} t={t} />
      </span>
      <span className={css.line}>{configLine(node, t)}</span>
      <span className={css.line}>
        {inbound !== undefined && <span className={css.inbound}>{inbound}</span>}
        <span>{statsLine(node, t)}</span>
      </span>
      {node.current !== undefined && <span className={css.current}>▶ {node.current}</span>}
      {cross !== undefined && <span className={css.cross}>{cross}</span>}
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

function Graph({ team, selected, onSelect, t }: {
  readonly team: Team; readonly selected: string | undefined
  readonly onSelect: (id: string) => void; readonly t: T
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [paths, setPaths] = useState<readonly { d: string; kind: 'task' | 'report' | 'notify'; label?: { x: number; y: number; text: string } }[]>([])
  const rows = useMemo(() => levels(team), [team])
  useLayoutEffect(() => {
    const root = ref.current
    if (root === null) return undefined
    const draw = (): void => {
      const base = root.getBoundingClientRect()
      const box = (id: string) => {
        const element = nodeElement(root, id)
        if (element === undefined) return undefined
        const rect = element.getBoundingClientRect()
        return { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
      }
      const next: { d: string; kind: 'task' | 'report' | 'notify'; label?: { x: number; y: number; text: string } }[] = []
      for (const node of team.nodes) {
        const from = box(node.parent)
        const to = box(node.id)
        if (from === undefined || to === undefined) continue
        const x1 = from.x + from.w / 2 - 5
        const y1 = from.y + from.h
        const x2 = to.x + to.w / 2 - 5
        const y2 = to.y
        const mid = (y1 + y2) / 2
        const inbound = inboundLine(team, node, t)
        next.push({ d: `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`, kind: 'task',
          ...inbound === undefined ? {} : { label: { x: (x1 + x2) / 2 + 8, y: mid - 3, text: inbound } } })
        const row = team.edges.find(edge => edge.from === node.parent && edge.to === node.id)
        if ((row?.reports ?? 0) > 0) next.push({ d: `M${x2 + 10},${y2} C${x2 + 10},${mid} ${x1 + 10},${mid} ${x1 + 10},${y1}`, kind: 'report' })
      }
      for (const edge of team.edges) {
        const tree = team.nodes.some(node => node.id === edge.to && node.parent === edge.from)
        if (tree && edge.notifies === 0) continue
        if (tree && edge.tasks > 0) continue
        const from = box(edge.from)
        const to = box(edge.to)
        if (from === undefined || to === undefined) continue
        const x1 = from.x + from.w
        const y1 = from.y + from.h / 2
        const x2 = to.x
        const y2 = to.y + to.h / 2
        next.push({ d: `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`, kind: 'notify' })
      }
      setPaths(next)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [team, t])
  return (
    <div className={css.graph} ref={ref}>
      <svg className={css.edges} aria-hidden>
        <defs>
          <marker id="room-team-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" className={css.arrow} /></marker>
          <marker id="room-team-arrow-report" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" className={css.arrowReport} /></marker>
        </defs>
        {paths.map((path, index) => (
          <g key={index}>
            <path d={path.d} className={path.kind === 'task' ? css.edgeTask : path.kind === 'report' ? css.edgeReport : css.edgeNotify}
              markerEnd={path.kind === 'notify' ? undefined : path.kind === 'report' ? 'url(#room-team-arrow-report)' : 'url(#room-team-arrow)'} />
            {path.label !== undefined && <text x={path.label.x} y={path.label.y} className={css.edgeLabel}>{path.label.text}</text>}
          </g>
        ))}
      </svg>
      {rows.map((row, index) => (
        <div key={index} className={css.level}>
          {row.map(id => {
            if (id === TEAM_ROOT) return <span key={id} className={css.root} data-team-node={TEAM_ROOT}>{t('team.you')}</span>
            const node = team.nodes.find(entry => entry.id === id)!
            return <NodeCard key={id} team={team} node={node} selected={selected === id} compact={false} onSelect={() => { onSelect(id) }} t={t} />
          })}
        </div>
      ))}
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
        <span><i className={css.legendTask} />{t('team.legend.task')}</span>
        <span><i className={css.legendReport} />{t('team.legend.report')}</span>
        <span><i className={css.legendNotify} />{t('team.legend.notify')}</span>
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
