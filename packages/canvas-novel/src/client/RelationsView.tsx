import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import { PTS_PER_LEVEL, type CodexRelation, type NovelCodexResult } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { relationAt, relationViewBox, type RelationHistoryState } from './relation-history.ts'
import { NodeActions } from './NodeActions.tsx'
import css from './codex.module.css'

type T = NovelSurfaceProps['t']
type Del = (node: string) => ReactNode
interface Point { readonly x: number; readonly y: number }

const W = 560, H = 320, R = 120

function basePositions(ids: readonly string[]): Record<string, Point> {
  return Object.fromEntries(ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 + Math.PI
    return [id, { x: W / 2 + R * Math.cos(angle) * 1.5, y: H / 2 + R * Math.sin(angle) }]
  }))
}

function savedPositions(canvasId: string): Record<string, Point> {
  try {
    const raw = window.localStorage.getItem(`novel-relations:${canvasId}`)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as Record<string, { x?: unknown; y?: unknown }>
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, point]) => typeof point.x === 'number' && typeof point.y === 'number' ? [[id, { x: point.x, y: point.y }]] : []))
  } catch { return {} }
}

function trendText(state: RelationHistoryState, t: T): string {
  return t(`relation.trend.${state.trend}`)
}

/** The relations face: a chapter replay, an ego graph and list, and one pair's full history. */
export function RelationsView({ data, del, openCard, canvasId, t }: {
  readonly data: NovelCodexResult
  readonly del: Del
  readonly openCard: (cardId: string, heading: string) => void
  readonly canvasId: string
  readonly t: T
}): ReactNode {
  const relations = data.relations ?? []
  const current = Math.max(1, data.current ?? 1)
  const [at, setAt] = useState(current)
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null)
  const names = useMemo(() => new Map((data.characters ?? []).map(row => [row.cardId, row.name])), [data.characters])
  const ids = useMemo(() => [...new Set(relations.flatMap(row => row.pair))], [relations])
  const [mode, setMode] = useState<'graph' | 'list'>(ids.length <= 12 ? 'graph' : 'list')
  const [moved, setMoved] = useState<Record<string, Point>>(() => savedPositions(canvasId))
  const [scale, setScale] = useState(1)
  const [center, setCenter] = useState<Point>({ x: W / 2, y: H / 2 })
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ id?: string; pan: boolean; last: Point; moved: boolean } | null>(null)
  const base = useMemo(() => basePositions(ids), [ids])
  const positions = { ...base, ...moved }
  const live = relations.flatMap(relation => {
    const state = relationAt(relation, at)
    return state === undefined ? [] : [{ relation, state }]
  })
  const scoped = selectedPerson === null ? live : live.filter(row => row.relation.pair.includes(selectedPerson))
  const picked = scoped.find(row => row.relation.cardId === selectedRelation) ?? scoped[0]
  useEffect(() => {
    try { window.localStorage.setItem(`novel-relations:${canvasId}`, JSON.stringify(moved)) } catch { /* A private window keeps the in-memory layout. */ }
  }, [canvasId, moved])
  if (relations.length === 0) return <p className={css.empty}>{t('codex.noRelations')}</p>

  const point = (event: { clientX: number; clientY: number }): Point | undefined => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()?.inverse()
    if (svg === null || matrix === undefined) return undefined
    const p = svg.createSVGPoint()
    p.x = event.clientX; p.y = event.clientY
    const local = p.matrixTransform(matrix)
    return { x: local.x, y: local.y }
  }
  const startNode = (event: ReactPointerEvent<SVGGElement>, id: string): void => {
    event.stopPropagation()
    const last = point(event)
    if (last === undefined) return
    gesture.current = { id, pan: false, last, moved: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startPan = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.target !== svgRef.current) return
    const last = point(event)
    if (last === undefined) return
    gesture.current = { pan: true, last, moved: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const active = gesture.current
    const next = point(event)
    if (active === null || next === undefined) return
    const dx = next.x - active.last.x, dy = next.y - active.last.y
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return
    active.moved = true
    if (active.id !== undefined) {
      const id = active.id
      setMoved(currentPositions => ({ ...currentPositions, [id]: { x: positions[id]!.x + dx, y: positions[id]!.y + dy } }))
    } else if (active.pan) setCenter(currentCenter => ({ x: currentCenter.x - dx, y: currentCenter.y - dy }))
    active.last = next
  }
  const end = (): void => {
    const active = gesture.current
    if (active?.id !== undefined && !active.moved) setSelectedPerson(currentPerson => currentPerson === active.id ? null : active.id!)
    gesture.current = null
  }
  const zoom = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
    setScale(value => Math.max(0.6, Math.min(2.5, value + (event.deltaY < 0 ? 0.15 : -0.15))))
  }
  const reset = (): void => { setMoved({}); setScale(1); setCenter({ x: W / 2, y: H / 2 }); setSelectedPerson(null) }

  return (
    <div className={css.relationsPage}>
      <div className={css.relationToolbar}>
        <label className={css.slider}>
          <span>{t('codex.upTo')}</span>
          <input type="range" min={1} max={current} value={Math.min(at, current)} onChange={event => { setAt(Number(event.target.value)) }} />
          <b>{t('card.inChapter', { n: at })}</b>
        </label>
        <span className={css.grow} />
        <div className={css.seg} role="group" aria-label={t('relation.viewMode')}>
          <button type="button" aria-pressed={mode === 'graph'} onClick={() => { setMode('graph') }}>{t('relation.graph')}</button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => { setMode('list') }}>{t('relation.list')}</button>
        </div>
        <button type="button" className={css.small} onClick={reset}>{t('relation.reset')}</button>
      </div>
      <div className={css.selectedPerson}>
        <span>{selectedPerson === null ? t('relation.pickPerson') : t('relation.centered', { name: names.get(selectedPerson) ?? selectedPerson, count: scoped.length })}</span>
        {selectedPerson !== null && <button type="button" className={css.link} onClick={() => { setSelectedPerson(null) }}>{t('relation.clear')}</button>}
      </div>
      <div className={css.relBox} data-mode={mode}>
        {mode === 'graph' && (
          <div className={css.graphPane}>
            <svg ref={svgRef} className={css.graph} viewBox={relationViewBox(scale, center)} role="img" aria-label={t('codex.relations')}
              onPointerDown={startPan} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onWheel={zoom}>
              {live.map(({ relation, state }) => {
                const [a, b] = relation.pair
                const p = positions[a ?? ''], q = positions[b ?? '']
                if (p === undefined || q === undefined) return null
                const active = picked?.relation.cardId === relation.cardId
                const dim = selectedPerson !== null && !relation.pair.includes(selectedPerson)
                return (
                  <g key={relation.cardId} className={css.edge} data-picked={active || undefined} data-dim={dim || undefined} onClick={() => { setSelectedRelation(relation.cardId) }}>
                    <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                    <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 10} textAnchor="middle" className={css.edgeLabel}>{`${state.type} · ${state.stage}`}</text>
                  </g>
                )
              })}
              {ids.map(id => {
                const p = positions[id]!
                const connected = selectedPerson === null || id === selectedPerson || scoped.some(row => row.relation.pair.includes(id))
                return (
                  <g key={id} className={css.node} data-center={selectedPerson === id || undefined} data-dim={!connected || undefined} role="button" tabIndex={0}
                    aria-label={names.get(id) ?? id} onPointerDown={event => { startNode(event, id) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedPerson(currentPerson => currentPerson === id ? null : id) }}>
                    <circle cx={p.x} cy={p.y} r={28} />
                    <text x={p.x} y={p.y + 5} textAnchor="middle">{(names.get(id) ?? id).slice(0, 4)}</text>
                  </g>
                )
              })}
            </svg>
          </div>
        )}
        <div className={css.relList}>
          {scoped.length === 0 && <p className={css.empty}>{t('relation.emptyAtChapter')}</p>}
          {scoped.map(({ relation, state }) => (
            <div key={relation.cardId} className={css.relItem} data-picked={picked?.relation.cardId === relation.cardId || undefined}>
              <button type="button" className={css.relMain} onClick={() => { setSelectedRelation(relation.cardId) }}>
                <span className={css.relHead}><b>{relation.pair.map(id => names.get(id) ?? id).join(' × ')}</b><span className={css.relTrend} data-trend={state.trend}>{trendText(state, t)}</span></span>
                <span className={css.muted}>{state.type} · {state.stage}{state.latest === undefined ? '' : ` · ${t('card.inChapter', { n: state.latest.chapter })} ${state.latest.label}`}</span>
                {relation.now !== undefined && <span>{relation.now}</span>}
              </button>
              <NodeActions node={relation.cardId} name={relation.pair.map(id => names.get(id) ?? id).join(' × ')} openCard={openCard} del={del} t={t} />
            </div>
          ))}
        </div>
      </div>
      {picked !== undefined && <RelationDetail relation={picked.relation} state={picked.state} at={at} names={names} openCard={openCard} t={t} />}
    </div>
  )
}

function RelationDetail({ relation, state, at, names, openCard, t }: {
  readonly relation: CodexRelation
  readonly state: RelationHistoryState
  readonly at: number
  readonly names: ReadonlyMap<string, string>
  readonly openCard: (cardId: string, heading: string) => void
  readonly t: T
}): ReactNode {
  const title = relation.pair.map(id => names.get(id) ?? id).join(' × ')
  return (
    <section className={css.relationDetail}>
      <header className={css.detailHead}>
        <div><h3>{title}</h3><b>{state.type} · {state.stage}</b><span className={css.relTrend} data-trend={state.trend}>{trendText(state, t)}</span></div>
        <span className={css.grow} />
        <button type="button" className={css.ghost} onClick={() => { openCard(relation.cardId, title) }}>{t('codex.edit')}</button>
      </header>
      <div className={css.muted}>{t('relation.progress', { value: state.progress, full: PTS_PER_LEVEL, n: at })}</div>
      <div className={css.progressTrack}><i style={{ width: `${Math.min(100, state.progress / PTS_PER_LEVEL * 100)}%` }} /></div>
      <ol className={css.historySteps}>
        {relation.steps.filter(step => step.chapter <= at).map((step, index) => (
          <li key={`${step.chapter}:${index}`}>
            <span className={css.historyChapter}>{t('card.inChapter', { n: step.chapter })}</span>
            <b>{step.label}</b>
            {step.evidence !== undefined && <q>{step.evidence}</q>}
          </li>
        ))}
      </ol>
    </section>
  )
}
