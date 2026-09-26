/**
 * The link view: the board's other face (stage ⑥). The 卡板 answers "what is on
 * this canvas"; this surface answers "which of these belong together", because
 * every gesture here is about a GROUP — drag to place, drag a port to link, drag
 * a lane to carry the cards inside it, drag an empty box to pick a batch.
 *
 * Two rules hold the surface together, and both come from what the board already
 * does:
 *
 * - **A click here selects; it never edits.** Opening a card takes the pen
 *   button on hover or a double click, because a board you drag cards around
 *   must not send a card away every time you reach for it. The 卡板 keeps the
 *   opposite rule (a body click opens the detail tab), and the pair is spelled
 *   out under the stage so nobody has to guess which face they are on.
 * - **A line never picks for you.** The send set is what you clicked;
 *   「顺线扩一圈」 is the one explicit gesture that lets the graph add neighbours,
 *   and it is off by default and never remembered — the scope of a request is
 *   not a preference.
 *
 * The stage's numbers are the same 600-unit frame the pen draws in
 * (`LAYOUT_BOX`), used as a COORDINATE SPACE rather than a magnification: cards
 * carry real text, so scaling the board with the panel's width would scale the
 * type with it. The stage scrolls instead, and a card stays exactly where it was
 * put.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconEditOutlineMedium, IconPlusOutlineMedium } from '../icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { COMPOSE_SEND_TEXT, GROUP_ASK_SEND_TEXT } from '../../prompt.ts'
import { detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import { makeBoardId, type BoardCard, type BoardLane, type BoardLink, type CanvasBoard } from '../../types.ts'
import { DrawFigure } from '../detail/DrawFigure.tsx'
import {
  dragLane, groupOf, isLinked, isMarqueeClick, laneAt, marqueeHits, marqueeRect, resizeLane,
  wirePathOf,
  type LaneRect, type PlacedCard, type Rect, type Size,
} from './layout-geometry.ts'
import css from './link-view.module.css'

/**
 * The layout write this surface asks for. Every part is optional and `[]` means
 * *clear it* — the same absent/empty pair the store's `setLayout` verb is built
 * on, so 「删掉这条线」 can never be read as "leave the lines alone".
 */
export interface LayoutPatch {
  readonly positions?: readonly { id: string; x: number; y: number }[]
  readonly lanes?: readonly BoardLane[]
  readonly links?: readonly BoardLink[]
}

/** A lane as the view draws it: the geometry module's box, plus its words. */
interface LaneBox extends LaneRect {
  readonly label: string
}

/** A place while a drag is in flight, before it has been written. */
interface Spot {
  readonly x: number
  readonly y: number
}

/** What the current drag has moved, per card and per lane. */
interface Overlay {
  readonly places: ReadonlyMap<string, Spot>
  readonly laneBoxes: ReadonlyMap<string, Rect>
}

/** The link view's props: the loaded board, the selection, and the two verbs. */
export interface LinkViewProps {
  readonly t: TranslateNS<'canvas'>
  /** True when no session can fence writes — the stage then shows, never moves. */
  readonly readonly: boolean
  readonly board: CanvasBoard
  /** Category id → the words this canvas's own catalog spells it with. */
  readonly labels: ReadonlyMap<string, string>
  readonly selection: ReadonlySet<string>
  readonly onToggleSelect: (cardId: string) => void
  readonly onAddSelection: (cardIds: readonly string[]) => void
  readonly onClearSelection: () => void
  readonly onOpenDetail: (cardId: string) => void
  readonly chatAvailable: boolean
  /** Ask the canvas's agent over an explicit card set (the compose gestures). */
  readonly onAsk: (cardIds: readonly string[], text: string) => void
  /** One write per gesture (see {@link LayoutPatch}). */
  readonly onLayout: (patch: LayoutPatch) => void
  /** A note for the gestures whose result has no other visible home. */
  readonly onToast: (message: string) => void
}

/** A node's size before it has been measured (jsdom never measures, so: there). */
const UNMEASURED: Size = { w: 168, h: 64 }

/** Where a card nobody has placed yet lands: two columns, the stage's own slack. */
const SPOT = { x0: 14, y0: 14, dx: 184, dy: 96 }

/** A new lane is born in the empty corner of what the user is looking at. */
const NEW_LANE = { w: 190, h: 120 }

/** How far the pointer must travel before a press stops being a click. */
const DRAG_THRESHOLD = 3

const IDLE: Overlay = { places: new Map(), laneBoxes: new Map() }

/** Ids in the shape `makeBoardId` mints, so a lane is a sibling of a card. */
function newLaneId(): string {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(8))
  const random = bytes === undefined
    ? Math.random().toString(36).slice(2).padEnd(12, '0')
    : [...bytes].map(byte => byte.toString(36).padStart(2, '0')).join('')
  return makeBoardId('lane', Date.now(), random)
}

/** One node's preview: the most a placed card can show in a couple of lines. */
function previewOf(card: BoardCard): string {
  if (detectCardFormat(card.text) === 'html') return htmlTitleOf(card.text) ?? ''
  const first = card.text.split('\n').find(line => line.trim().length > 0) ?? ''
  return first.replace(/^#+\s*/, '').trim()
}

/** The four geometry numbers of a lane, without its identity or words. */
function rectOf(box: Rect): Rect {
  return { x: box.x, y: box.y, w: box.w, h: box.h }
}

/** Keep a number inside a range that may itself have crossed over. */
function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value))
}

/** Places are stored whole (§11.3): a drag's sub-pixel jitter is not a decimal. */
function whole(value: number): number {
  return Math.round(value)
}

/** Replace one lane's rectangle in the whole list (the write takes the list). */
function mergeLane(lanes: readonly BoardLane[], id: string, rect: Rect): BoardLane[] {
  return lanes.map(lane => (lane.id === id ? { ...lane, ...rect } : lane))
}

/**
 * Run one drag: window listeners for the gesture's lifetime, detached on
 * release. Each handler re-derives its result from the release event rather
 * than remembering it, so a gesture can never commit a stale frame, and the
 * values it closes over are exactly the ones the render grabbed: a drag is
 * measured from the geometry the pointer took hold of.
 */
function runGesture(
  event: ReactPointerEvent<Element>,
  onMove: (dx: number, dy: number, move: PointerEvent) => void,
  onEnd: (dx: number, dy: number, release: PointerEvent) => void,
): void {
  const startX = event.clientX
  const startY = event.clientY
  const move = (next: PointerEvent): void => {
    onMove(next.clientX - startX, next.clientY - startY, next)
  }
  const release = (last: PointerEvent): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    onEnd(last.clientX - startX, last.clientY - startY, last)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/** The link view. */
export function LinkView({
  t, readonly, board, labels, selection, onToggleSelect, onAddSelection, onClearSelection,
  onOpenDetail, chatAvailable, onAsk, onLayout, onToast,
}: LinkViewProps): ReactNode {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(IDLE)
  const [box, setBox] = useState<Rect | null>(null)
  const [temp, setTemp] = useState<{ readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | null>(null)
  const [wireSel, setWireSel] = useState<BoardLink | null>(null)
  const [expand, setExpand] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')

  const cards = useMemo(() => board.cards.filter(card => card.status !== 'archived'), [board.cards])
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map())

  /** Where one card sits right now: a drag's live value wins over the file's. */
  const placeOf = (card: BoardCard, index: number): PlacedCard => {
    const stored = card.x !== undefined && card.y !== undefined ? { x: card.x, y: card.y } : undefined
    const at = overlay.places.get(card.id) ?? stored ?? {
      x: SPOT.x0 + (index % 2) * SPOT.dx,
      y: SPOT.y0 + Math.floor(index / 2) * SPOT.dy,
    }
    const size = sizes.get(card.id) ?? UNMEASURED
    return { id: card.id, x: at.x, y: at.y, w: size.w, h: size.h }
  }

  const placed = useMemo(
    () => cards.map((card, index) => placeOf(card, index)),
    [cards, sizes, overlay.places],
  )
  const byId = useMemo(() => new Map(placed.map(node => [node.id, node])), [placed])
  /** The render loop's card lookup (a `find` per node would square the list). */
  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards])
  const lanes = useMemo<readonly LaneBox[]>(() => board.lanes.map(lane => {
    const moved = overlay.laneBoxes.get(lane.id)
    return moved === undefined
      ? { id: lane.id, label: lane.label, x: lane.x, y: lane.y, w: lane.w, h: lane.h }
      : { id: lane.id, label: lane.label, ...moved }
  }), [board.lanes, overlay.laneBoxes])
  // A line whose card has left the visible set is not drawn — and the next write
  // that touches the lines drops it, exactly as the store's read does.
  const visibleLinks = useMemo(
    () => board.links.filter(link => byId.has(link.from) && byId.has(link.to)),
    [board.links, byId],
  )
  const world = useMemo(() => {
    const right = Math.max(
      ...placed.map(node => node.x + node.w),
      ...lanes.map(lane => lane.x + lane.w),
      NEW_LANE.w,
    )
    const bottom = Math.max(
      ...placed.map(node => node.y + node.h),
      ...lanes.map(lane => lane.y + lane.h),
      NEW_LANE.h,
    )
    return { w: right + 24, h: bottom + 24 }
  }, [placed, lanes])

  /** What a drag may clamp against: the visible stage, never the whole world. */
  const stageBox = (): Size => {
    const el = stageRef.current
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 }
  }

  /** A pointer position in world units (the stage scrolls; the world does not). */
  const worldPoint = (clientX: number, clientY: number): Spot => {
    const el = stageRef.current
    const rect = el?.getBoundingClientRect()
    return {
      x: clientX - (rect?.left ?? 0) + (el?.scrollLeft ?? 0),
      y: clientY - (rect?.top ?? 0) + (el?.scrollTop ?? 0),
    }
  }

  // Nodes are sized by the text they carry, so the geometry can only settle
  // after paint: one measurement pass per layout, then the wires and the lane
  // containment read real numbers instead of the fallback.
  useEffect(() => {
    const el = stageRef.current
    if (el === null) return
    const next = new Map<string, Size>()
    for (const node of el.querySelectorAll<HTMLElement>('[data-node]')) {
      const id = node.dataset.node
      // A zero measurement means "no layout yet" (jsdom, a hidden tab), which is
      // exactly what the fallback is for — storing it would collapse the wires.
      if (id !== undefined && node.offsetWidth > 0 && node.offsetHeight > 0) {
        next.set(id, { w: node.offsetWidth, h: node.offsetHeight })
      }
    }
    setSizes(current => {
      for (const [id, size] of next) {
        const before = current.get(id)
        if (before === undefined || before.w !== size.w || before.h !== size.h) return next
      }
      return current.size === next.size ? current : next
    })
  }, [placed, lanes])

  const group = useMemo(
    () => groupOf([...selection], visibleLinks, lanes, id => byId.get(id), [...byId.keys()]),
    [selection, visibleLinks, lanes, byId],
  )
  const send = expand ? group.ids : group.seeds

  /** Finish a gesture: the move is written once, the live overlay is dropped. */
  const commit = (patch: LayoutPatch, note?: string): void => {
    setOverlay(IDLE)
    if (patch.positions !== undefined || patch.lanes !== undefined || patch.links !== undefined) {
      onLayout(patch)
    }
    if (note !== undefined) onToast(note)
  }

  const setSpot = (id: string, spot: Spot): void => {
    setOverlay(current => ({
      places: new Map(current.places).set(id, spot),
      laneBoxes: current.laneBoxes,
    }))
  }

  const setLaneBox = (id: string, rect: Rect, places?: ReadonlyMap<string, Spot>): void => {
    setOverlay(current => ({
      places: places ?? current.places,
      laneBoxes: new Map(current.laneBoxes).set(id, rect),
    }))
  }

  const onNodeDown = (event: ReactPointerEvent<HTMLDivElement>, node: PlacedCard): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('[data-port]') !== null || target.closest('[data-open]') !== null) return
    event.stopPropagation()
    // Read-only closes the stage's WRITE half only. Picking a card costs the
    // board nothing, and 「就这一组提问」 needs a selection to ask about — a
    // read-only canvas that could not be selected would be a read-only canvas
    // that could not be read at all.
    if (readonly) {
      onToggleSelect(node.id)
      return
    }
    const stage = stageBox()
    let moved = false
    runGesture(event, (dx, dy) => {
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true
      if (!moved) return
      setSpot(node.id, {
        x: whole(clamp(node.x + dx, 0, stage.w - node.w)),
        y: whole(clamp(node.y + dy, 0, stage.h - node.h)),
      })
    }, (dx, dy) => {
      if (!moved) {
        // The press never travelled: it is a click, and a click selects.
        setOverlay(IDLE)
        onToggleSelect(node.id)
        return
      }
      const x = whole(clamp(node.x + dx, 0, stage.w - node.w))
      const y = whole(clamp(node.y + dy, 0, stage.h - node.h))
      // The drop's result is visible where the card landed — a lane badge on
      // the node — so the gesture commits silently.
      commit({ positions: [{ id: node.id, x, y }] })
    })
  }

  const onLaneDown = (event: ReactPointerEvent<Element>, lane: LaneBox, mode: 'move' | 'resize'): void => {
    if (readonly || event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-lane-title]') !== null) return
    event.stopPropagation()
    const stage = stageBox()
    const cardsAtStart = placed
    let moved = false
    const mark = (dx: number, dy: number): void => {
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true
    }
    if (mode === 'resize') {
      runGesture(event, (dx, dy) => {
        mark(dx, dy)
        setLaneBox(lane.id, rectOf(resizeLane(lane, cardsAtStart, dx, dy, stage)))
      }, (dx, dy) => {
        if (!moved) return
        commit({ lanes: mergeLane(board.lanes, lane.id, rectOf(resizeLane(lane, cardsAtStart, dx, dy, stage))) })
      })
      return
    }
    runGesture(event, (dx, dy) => {
      mark(dx, dy)
      const dragged = dragLane(lane, cardsAtStart, dx, dy, stage)
      const places = new Map(overlay.places)
      for (const card of dragged.cards) places.set(card.id, { x: whole(card.x), y: whole(card.y) })
      setLaneBox(lane.id, rectOf(dragged.lane), places)
    }, (dx, dy) => {
      if (!moved) return
      const dragged = dragLane(lane, cardsAtStart, dx, dy, stage)
      const carried = dragged.cards.map(card => ({ id: card.id, x: whole(card.x), y: whole(card.y) }))
      commit({
        lanes: mergeLane(board.lanes, lane.id, rectOf(dragged.lane)),
        ...(carried.length === 0 ? {} : { positions: carried }),
      })
    })
  }

  const onWorldDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.button !== 0) return
    const begin = worldPoint(event.clientX, event.clientY)
    runGesture(event, (_dx, _dy, move) => {
      const now = worldPoint(move.clientX, move.clientY)
      setBox(marqueeRect(begin.x, begin.y, now.x, now.y))
    }, (_dx, _dy, release) => {
      const now = worldPoint(release.clientX, release.clientY)
      const band = marqueeRect(begin.x, begin.y, now.x, now.y)
      setBox(null)
      // A sub-8px band is a click on empty ground: it drops the line selection
      // and nothing else — no card is picked, none is dropped.
      if (isMarqueeClick(band)) {
        setWireSel(null)
        return
      }
      const hits = marqueeHits(band, placed)
      if (hits.length === 0) return
      // The box's catch lights up selected on the spot — no toast repeats it.
      onAddSelection(hits)
    })
  }

  /**
   * Start a wire from one of a card's two ports. Which port the hand found
   * decides where the LIVE line starts — a drag should leave the card the way it
   * was grabbed — but the stored pair is still just `{from,to}`: which edge a
   * finished line uses is geometry, re-derived from where the two cards sit, so
   * dragging a card afterwards can never strand a tail on the wrong side.
   */
  const startWire = (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: PlacedCard,
    side: 'left' | 'right',
  ): void => {
    if (readonly || event.button !== 0) return
    event.stopPropagation()
    const anchor = { x1: side === 'right' ? node.x + node.w : node.x, y1: node.y + node.h / 2 }
    setTemp({ ...anchor, x2: anchor.x1, y2: anchor.y1 })
    runGesture(event, (_dx, _dy, move) => {
      const now = worldPoint(move.clientX, move.clientY)
      setTemp({ ...anchor, x2: now.x, y2: now.y })
    }, (_dx, _dy, release) => {
      setTemp(null)
      // A release can land on the window or the document, neither of which is an
      // element to search; both mean the same thing here: released on nothing.
      const target = release.target instanceof Element ? release.target.closest('[data-node]') : null
      const other = target instanceof HTMLElement ? target.dataset.node : undefined
      if (other === undefined || other === node.id || isLinked(board.links, node.id, other)) return
      // The finished wire is the confirmation: it appears between the cards.
      commit({ links: [...board.links, { from: node.id, to: other }] })
    })
  }

  const addLane = (): void => {
    if (readonly) return
    const el = stageRef.current
    const lane: BoardLane = {
      id: newLaneId(),
      label: '',
      x: (el?.scrollLeft ?? 0) + 24,
      y: (el?.scrollTop ?? 0) + 24,
      ...NEW_LANE,
    }
    // The new lane appears with its name field already open — that focus is
    // the announcement, so no toast follows it.
    commit({ lanes: [...board.lanes, lane] })
    setRenaming(lane.id)
    setDraftLabel('')
  }

  const commitLaneLabel = (): void => {
    if (renaming === null) return
    const target = renaming
    setRenaming(null)
    const lane = board.lanes.find(candidate => candidate.id === target)
    const label = draftLabel.trim()
    if (lane === undefined || lane.label === label) return
    onLayout({ lanes: board.lanes.map(candidate => (candidate.id === target ? { ...candidate, label } : candidate)) })
  }

  return (
    <div className={css.wrap}>
      <div className={css.stage} ref={stageRef} data-readonly={readonly || undefined}>
        <div
          className={css.world}
          data-world
          style={{ width: `${world.w}px`, height: `${world.h}px` }}
          onPointerDown={onWorldDown}
        >
          <svg className={css.wires} width={world.w} height={world.h} aria-hidden="true" focusable="false">
            {visibleLinks.map(link => {
              const a = byId.get(link.from)
              const b = byId.get(link.to)
              if (a === undefined || b === undefined) return null
              const d = wirePathOf(a, b)
              const on = link === wireSel
              return (
                <g key={`${link.from}:${link.to}`}>
                  <path
                    className={on ? `${css.wireHit} ${css.wireHitOn}` : css.wireHit}
                    d={d}
                    data-wire={`${link.from}:${link.to}`}
                    onClick={() => { setWireSel(on ? null : link) }}
                  />
                  <path className={on ? `${css.wire} ${css.wireOn}` : css.wire} d={d} />
                </g>
              )
            })}
            {temp !== null && (
              <path className={css.wireTemp} d={`M ${temp.x1} ${temp.y1} L ${temp.x2} ${temp.y2}`} />
            )}
          </svg>

          {lanes.map(lane => (
            <div
              key={lane.id}
              className={css.lane}
              data-lane={lane.id}
              style={{ left: `${lane.x}px`, top: `${lane.y}px`, width: `${lane.w}px`, height: `${lane.h}px` }}
              onPointerDown={event => { onLaneDown(event, lane, 'move') }}
            >
              {renaming === lane.id ? (
                <input
                  className={css.laneInput}
                  autoFocus
                  value={draftLabel}
                  aria-label={t('link.laneRename')}
                  onChange={event => { setDraftLabel(event.target.value) }}
                  onBlur={commitLaneLabel}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitLaneLabel()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={css.laneTitle}
                  data-lane-title={lane.id}
                  title={t('link.laneRename')}
                  onClick={() => {
                    if (readonly) return
                    setRenaming(lane.id)
                    setDraftLabel(lane.label)
                  }}
                >
                  {laneName(lane, t)}
                </button>
              )}
              {!readonly && (
                <span
                  className={css.laneSize}
                  data-lane-size={lane.id}
                  title={t('link.laneResize')}
                  onPointerDown={event => { onLaneDown(event, lane, 'resize') }}
                />
              )}
            </div>
          ))}

          {placed.map(node => {
            const card = cardById.get(node.id)
            if (card === undefined) return null
            const ink = card.draw ?? []
            const lane = laneAt(lanes, node)
            const text = previewOf(card)
            // 「顺线扩一圈」 on: the neighbours the graph adds are marked, because a
            // send set the user did not click has to be visible to be honest.
            const inCluster = expand && !selection.has(node.id) && group.ids.includes(node.id)
            return (
              <div
                key={node.id}
                className={css.node}
                data-node={node.id}
                data-picked={selection.has(node.id) || undefined}
                data-cluster={inCluster || undefined}
                data-ghost={card.status === 'proposed' || undefined}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
                onPointerDown={event => { onNodeDown(event, node) }}
                onDoubleClick={() => { onOpenDetail(node.id) }}
              >
                <span className={css.nodeKind}>
                  {labels.get(card.kind) ?? card.kind}
                  {lane === undefined ? '' : ` · ${laneName(lane, t)}`}
                </span>
                {ink.length > 0 && <span className={css.nodeInk}><DrawFigure strokes={ink} /></span>}
                <span className={css.nodeText}>{text === '' ? t('link.nodeEmpty') : text}</span>
                {!readonly && (
                  <>
                    <span
                      className={css.port}
                      data-port={`${node.id}:left`}
                      title={t('link.portTitle')}
                      onPointerDown={event => { startWire(event, node, 'left') }}
                    />
                    <span
                      className={css.port}
                      data-port={`${node.id}:right`}
                      title={t('link.portTitle')}
                      onPointerDown={event => { startWire(event, node, 'right') }}
                    />
                  </>
                )}
                <button
                  type="button"
                  className={css.nodeOpen}
                  data-open={node.id}
                  title={t('link.openDetail')}
                  aria-label={t('link.openDetail')}
                  onPointerDown={event => { event.stopPropagation() }}
                  onClick={() => { onOpenDetail(node.id) }}
                >
                  <IconEditOutlineMedium size={11} />
                </button>
              </div>
            )
          })}

          {box !== null && (
            <div
              className={css.marquee}
              style={{
                left: `${box.x}px`,
                top: `${box.y}px`,
                width: `${box.w}px`,
                height: `${box.h}px`,
              }}
            />
          )}
        </div>
      </div>

      <div className={css.bar}>
        <span className={css.barInfo}>
          {send.length === 0
            ? t('link.boardTotals', { links: String(visibleLinks.length), lanes: String(lanes.length) })
            : expand
              ? t('link.infoExpanded', {
                count: String(send.length),
                seeds: String(group.seeds.length),
                lines: String(group.viaLine.length),
                lanes: String(group.viaLane.length),
              })
              : t('link.infoPlain', { count: String(send.length) })}
        </span>
        <span className={css.spacer} />
        {wireSel !== null && !readonly && (
          <button
            type="button"
            className={css.barButton}
            onClick={() => {
              const gone = wireSel
              setWireSel(null)
              // A wire is its endpoints — matching by identity would silently
              // no-op the moment the board re-reads and the object is fresh.
              // And a deletion reports itself: the line is 1.6px of feedback.
              commit({
                links: board.links.filter(link => !(link.from === gone.from && link.to === gone.to)),
              }, t('link.wireDropped'))
            }}
          >
            {t('link.delWire')}
          </button>
        )}
        <button
          type="button"
          className={css.barButton}
          data-on={expand || undefined}
          title={t('link.expandTitle')}
          onClick={() => { setExpand(value => !value) }}
        >
          {`${t('link.expand')} ${expand ? t('link.on') : t('link.off')}`}
        </button>
        {!readonly && (
          <button type="button" className={css.barButton} onClick={addLane}>
            <IconPlusOutlineMedium size={12} />
            {t('link.addLane')}
          </button>
        )}
        {chatAvailable && send.length > 0 && (
          <button
            type="button"
            className={css.barButton}
            onClick={() => { onAsk(send, GROUP_ASK_SEND_TEXT) }}
          >
            {t('link.askGroup', { count: String(send.length) })}
          </button>
        )}
        {chatAvailable && send.length > 0 && (
          <button type="button" className={css.barButton} onClick={() => { onAsk(send, COMPOSE_SEND_TEXT) }}>
            {t('compose.article')}
          </button>
        )}
        {(selection.size > 0 || wireSel !== null || expand) && (
          <button
            type="button"
            className={css.barGhost}
            onClick={() => {
              onClearSelection()
              setWireSel(null)
              setExpand(false)
            }}
          >
            {t('board.clearSelection')}
          </button>
        )}
      </div>
    </div>
  )
}

/** A lane's words: an unnamed one is the client's placeholder, never the store's. */
function laneName(lane: LaneBox, t: TranslateNS<'canvas'>): string {
  return lane.label === '' ? t('link.laneUnnamed') : lane.label
}
