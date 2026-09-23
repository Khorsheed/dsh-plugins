/**
 * The link view's pure half: which cards a lane holds, which ones a marquee
 * catches, where a lane may go, and what shape the wire between two cards takes.
 * No DOM and no store — every box arrives as four numbers, because the only
 * honest source of a card's size is the rendered element and this layer must be
 * able to answer the same questions in a node test.
 *
 * Three rules decide all the shapes here. Containment is tested on the card's
 * CENTER, not on area: a card that overhangs a lane's border still reads as
 * sitting in it, and an area rule would let a two-pixel lane resize orphan a card
 * nobody touched. A wire is ANCHORED ON EDGES, never on centres: a line that
 * starts at a card's middle runs through its own body on the way out, which is
 * the first thing a user points at and calls a bug. And a flick under 8px in BOTH
 * dimensions is a click, not a box: clearing the selected wire must not quietly
 * pick up whatever card corner the pointer happened to graze.
 *
 * Geometry ported from the link-view prototype,
 * `proposals/prototypes/canvas-link-compose-draw.html`.
 *
 * @module @khorsheed/dsh-canvas/client
 */

/** An axis-aligned box in layout units (top-left anchored). */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A lane: a box with an identity, since every gesture returns the one it moved. */
export interface LaneRect extends Rect {
  readonly id: string
}

/** A card as the view has placed it — the caller has measured it, so this layer never does. */
export interface PlacedCard {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** One line's two ends. There is no direction, and no id to keep up with. */
export interface LinkPair {
  readonly from: string
  readonly to: string
}

/** A stage's extent, the ceiling every gesture clamps against. */
export interface Size {
  readonly w: number
  readonly h: number
}

/** A point in layout units. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Where one wire's two ends actually land, and the axis its tails run along.
 * `dir` is the outward sign on that axis: +1 leaves through a right or bottom
 * edge, -1 through a left or top one.
 */
export interface WireAnchors {
  readonly axis: 'x' | 'y'
  readonly dir: 1 | -1
  readonly from: Point
  readonly to: Point
}

/** How far below the stage top a lane's title band must stay readable. */
export const LANE_MIN_Y = 24

/** The smallest lane a corner drag may leave: below it the title stops fitting. */
export const MIN_LANE = { w: 150, h: 80 } as const

/** A marquee this short in both dimensions was a tap, not a rubber band. */
export const MARQUEE_CLICK_THRESHOLD = 8

/** The least a wire's control point leaves its card, so near pairs still curve. */
const WIRE_MIN_PUSH = 24

/**
 * Clamp that prefers the low bound when a box does not fit at all: pinning it to
 * the near edge keeps the top-left in view instead of letting a drag oscillate
 * between two bounds that have crossed over.
 */
const fit = (value: number, low: number, high: number): number =>
  (high < low ? low : Math.max(low, Math.min(high, value)))

/** The point a lane's membership and a wire's endpoints are both decided by. */
const center = (box: Rect): { x: number; y: number } => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

/**
 * Whether two cards are already connected, read as an unordered pair — the same
 * identity a stored line is deduplicated by, so the view's probe and the board's
 * writer cannot disagree about what "already linked" means. A card is never
 * linked to itself, even against a hand-edited row that says otherwise.
 */
export function isLinked(links: readonly LinkPair[], a: string, b: string): boolean {
  if (a === b) return false
  return links.some(pair => (pair.from === a && pair.to === b) || (pair.from === b && pair.to === a))
}

/**
 * The wire's two anchor points and the axis it leaves on.
 *
 * A line that joins two cards has no business running through either of them, so
 * every anchor sits on an EDGE, on the side the neighbour is actually on: the
 * pair's centres pick the axis and the direction, the boxes pick the points.
 *
 * The one exception is the interesting one. When the two boxes overlap along the
 * axis their centres pick, a facing-edge line has to double back across the
 * cards to reach the far edge — which is the piercing the rule exists to stop.
 * So the other axis gets the pair whenever IT can leave a clean gap, and the
 * dominant axis only wins back when the boxes truly intersect and no clean answer
 * exists. A card dragged over its neighbour therefore never sees its line stab
 * through the card it came from.
 */
export function wireAnchorsOf(a: PlacedCard, b: PlacedCard): WireAnchors {
  const ac = center(a)
  const bc = center(b)
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y
  // The gap each axis would have to cross: negative means the boxes overlap on it.
  const xGap = dx >= 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
  const yGap = dy >= 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  // An axis can carry the line when it has a non-negative gap; when the dominant
  // one is overlapped and the other is not, the other one takes it.
  const onX = horizontal ? xGap >= 0 || yGap < 0 : xGap >= 0 && yGap < 0
  if (onX) {
    return dx >= 0
      ? { axis: 'x', dir: 1, from: { x: a.x + a.w, y: ac.y }, to: { x: b.x, y: bc.y } }
      : { axis: 'x', dir: -1, from: { x: a.x, y: ac.y }, to: { x: b.x + b.w, y: bc.y } }
  }
  return dy >= 0
    ? { axis: 'y', dir: 1, from: { x: ac.x, y: a.y + a.h }, to: { x: bc.x, y: b.y } }
    : { axis: 'y', dir: -1, from: { x: ac.x, y: a.y }, to: { x: bc.x, y: b.y + b.h } }
}

/**
 * The wire's `d` attribute. The tails leave both cards perpendicular to the edge
 * each one anchors on (the sign of {@link WireAnchors#dir}), so the curve reads
 * as coming out of a card and going into another one rather than as a knot; the
 * 24-unit floor makes near neighbours bulge instead of collapsing onto a straight
 * line that looks like a rendering error.
 */
export function wirePathOf(a: PlacedCard, b: PlacedCard): string {
  const { axis, dir, from, to } = wireAnchorsOf(a, b)
  const along = axis === 'x' ? to.x - from.x : to.y - from.y
  const push = Math.max(WIRE_MIN_PUSH, Math.abs(along) / 2) * dir
  return axis === 'x'
    ? `M ${from.x} ${from.y} C ${from.x + push} ${from.y}, ${to.x - push} ${to.y}, ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} C ${from.x} ${from.y + push}, ${to.x} ${to.y - push}, ${to.x} ${to.y}`
}

/**
 * Whether a card belongs to this lane, judged on the card's center. An edge
 * counts as inside here — a center has no area to overlap, and refusing a card
 * that sits flush would pop it out of the lane during the resize that caught up
 * with it.
 */
export function laneHolds(lane: Rect, card: PlacedCard): boolean {
  const point = center(card)
  return point.x >= lane.x && point.x <= lane.x + lane.w && point.y >= lane.y && point.y <= lane.y + lane.h
}

/**
 * The lane a card sits in. The first holder wins so that answer stays stable
 * across renders even when two lanes have been dragged to overlap: an ambiguous
 * membership is the board's to fix, never this read's to flip on.
 * @param lanes - the lanes as the caller holds them; whatever a lane carries
 * besides its box (its label, say) comes back unasked and untorn off.
 */
export function laneAt<Lane extends LaneRect>(lanes: readonly Lane[], card: PlacedCard): Lane | undefined {
  for (const lane of lanes) {
    if (laneHolds(lane, card)) return lane
  }
  return undefined
}

/**
 * Whether two boxes share ground. Chosen strict, i.e. boxes that only touch edge
 * to edge do NOT overlap: a touch has no area, so it would select a card nobody
 * could see was covered.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * The rubber band a drag from one corner to the opposite one describes,
 * normalized so all four drag directions give the same box.
 */
export function marqueeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

/**
 * Whether a band is too small to have meant anything: the threshold must be
 * missed on BOTH axes, because a deliberate flat swipe across a row is thin on
 * one axis and still means to catch cards.
 */
export function isMarqueeClick(box: Rect): boolean {
  return box.w < MARQUEE_CLICK_THRESHOLD && box.h < MARQUEE_CLICK_THRESHOLD
}

/**
 * The ids a band catches, in the order the cards were handed over — a band only
 * ever adds to a selection, so the caller unions these with what is picked.
 */
export function marqueeHits(box: Rect, cards: readonly PlacedCard[]): string[] {
  return cards.filter(card => rectsOverlap(box, card)).map(card => card.id)
}

/** Slide a box back into a stage without changing its size, top-left anchored. */
export function clampInside(rect: Rect, stage: Size): Rect {
  return {
    x: fit(rect.x, 0, stage.w - rect.w),
    y: fit(rect.y, 0, stage.h - rect.h),
    w: rect.w,
    h: rect.h,
  }
}

/**
 * Drag a lane and everything it holds as one rigid group: membership is read
 * from the lane as it stands now, and the carried cards tighten the limits until
 * the group cannot go further, so no card is ever torn out of the lane it came
 * with. Only the cards that actually moved come back — the rest are the caller's.
 */
export function dragLane(
  lane: LaneRect,
  cards: readonly PlacedCard[],
  dx: number,
  dy: number,
  stage: Size,
): {
  readonly lane: LaneRect
  readonly cards: ReadonlyArray<{ id: string; x: number; y: number }>
} {
  const carried = cards.filter(card => laneHolds(lane, card))
  let x = fit(dx, -lane.x, stage.w - lane.x - lane.w)
  // The title band is the one part of a lane a person always needs to see.
  let y = fit(dy, LANE_MIN_Y - lane.y, stage.h - lane.y - lane.h)
  for (const card of carried) {
    x = fit(x, -card.x, stage.w - card.w - card.x)
    y = fit(y, -card.y, stage.h - card.h - card.y)
  }
  if (x === 0 && y === 0) return { lane: { ...lane }, cards: [] }
  return {
    lane: { ...lane, x: lane.x + x, y: lane.y + y },
    cards: carried.map(card => ({ id: card.id, x: card.x + x, y: card.y + y })),
  }
}

/**
 * Pull a lane's corner: floored at {@link MIN_LANE} and ceilinged by whatever
 * stage is left beyond its top-left. A resize never carries cards — the group is
 * a lane *move* — so cards whose center the shrink uncovered simply leave the
 * lane, which the caller re-reads with {@link laneAt}.
 */
export function resizeLane(
  lane: LaneRect,
  cards: readonly PlacedCard[],
  dx: number,
  dy: number,
  stage: Size,
): LaneRect {
  // Taken for call-shape symmetry with {@link dragLane}; deliberately not moved.
  void cards
  return {
    ...lane,
    w: fit(lane.w + dx, MIN_LANE.w, stage.w - lane.x),
    h: fit(lane.h + dy, MIN_LANE.h, stage.h - lane.y),
  }
}

/** Ids a lane-mate scan may consider when the caller hands the board over no further. */
const reachableIds = (seeds: Iterable<string>, links: readonly LinkPair[]): string[] => {
  const seen = new Set<string>(seeds)
  for (const pair of links) {
    seen.add(pair.from)
    seen.add(pair.to)
  }
  return [...seen]
}

/**
 * 「顺线扩一圈」: the seeds, everything reachable through any number of lines,
 * then the lane mates of the SEEDS only — one hop, and never from a card the
 * lines pulled in, or one line would quietly take a whole chapter. A seed the
 * lookup cannot resolve drops out, which is how an archived card stays out.
 *
 * The default expansion has nothing to scan but the ids the lines already name;
 * a view that means the prototype's behaviour passes its live card ids as
 * `pool`, in board order, which is also the order mates surface in.
 * @param pool - candidate ids a seed's lane may be filled from; defaults to the
 * seeds and every line endpoint.
 */
export function groupOf(
  seeds: readonly string[],
  links: readonly LinkPair[],
  lanes: readonly LaneRect[],
  lookup: (id: string) => PlacedCard | undefined,
  pool?: readonly string[],
): {
  readonly seeds: readonly string[]
  readonly viaLine: readonly string[]
  readonly viaLane: readonly string[]
  readonly ids: readonly string[]
} {
  const seedCards = new Map<string, PlacedCard>()
  for (const id of seeds) {
    const card = lookup(id)
    if (card !== undefined) seedCards.set(id, card)
  }
  const members = new Set(seedCards.keys())
  const viaLine: string[] = []
  let grew = true
  while (grew) {
    grew = false
    for (const pair of links) {
      const other = members.has(pair.from) ? pair.to : members.has(pair.to) ? pair.from : null
      if (other === null || members.has(other) || lookup(other) === undefined) continue
      members.add(other)
      viaLine.push(other)
      grew = true
    }
  }
  const viaLane: string[] = []
  const candidates = pool ?? reachableIds(seedCards.keys(), links)
  for (const card of seedCards.values()) {
    const lane = laneAt(lanes, card)
    if (lane === undefined) continue
    for (const other of candidates) {
      if (members.has(other)) continue
      const mate = lookup(other)
      if (mate === undefined || !laneHolds(lane, mate)) continue
      members.add(other)
      viaLane.push(other)
    }
  }
  return { seeds: [...seedCards.keys()], viaLine, viaLane, ids: [...members] }
}
