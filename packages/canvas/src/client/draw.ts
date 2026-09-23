/**
 * The pen's pure half: pointer geometry, stroke sampling, eraser hits, and the
 * outline an `<svg>` can fill. Kept free of React and of the DOM beyond plain
 * numbers, because every rule here is a rule a person can disagree with once
 * they have drawn one line with it — and each is cheaper to settle against a
 * number than against a screenshot.
 *
 * Storage is the POINT LIST, never an outline (§11.2 row 3, measured on the
 * clicked prototype: 24 sampled points cost 287 B as points and 834 B as a
 * tapered outline). The outline is derived at render by perfect-freehand, which
 * is also whose data shape the point list already is.
 *
 * Coordinates are the logical box's units (`DRAW_BOX`, 600×400), not screen
 * pixels: the pad maps a pointer position in on the way in and the renderer
 * scales the box back out with one `viewBox`, so a stroke drawn in a 378px
 * sidebar still lands in the same place on a wide panel.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { getStroke, type Vec2 } from 'perfect-freehand'
import {
  DRAW_BOX, MAX_DRAW_POINTS, MAX_DRAW_STROKES, MAX_DRAW_WIDTH,
  type CanvasDrawPoint, type CanvasStroke,
} from '../types.ts'

/** The tool the pad answers to. `text` means the pad is not taking strokes. */
export type PadTool = 'text' | 'pen' | 'erase'

/** Half the widest stroke, so a sampled width reads as pressure in [0,1]. */
const PEN_MAX = MAX_DRAW_WIDTH / 2

/** The rectangle a pointer position is mapped from (pad-local, in pixels). */
export interface PadRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Where in the logical box a pointer landed. Off-pad positions clamp to the
 * edge: a stroke that runs out of the pad keeps going to the border rather
 * than teleporting its tail when the pointer comes back.
 * @param rect - the pad's box on screen.
 * @param clientX - the pointer's viewport x.
 * @param clientY - the pointer's viewport y.
 * @returns the point in box units (no width yet).
 */
export function boxPointOf(rect: PadRect, clientX: number, clientY: number): { x: number; y: number } {
  // A zero-width rect (a hidden pane measured mid-transition) would divide to
  // Infinity, which normalizeDraw would then drop — answer the harmless case.
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
  return {
    x: Math.min(DRAW_BOX.width, Math.max(0, fx * DRAW_BOX.width)),
    y: Math.min(DRAW_BOX.height, Math.max(0, fy * DRAW_BOX.height)),
  }
}

/** How many box units one screen pixel spans at the pad's current width. */
export function unitsPerPixel(rect: PadRect): number {
  return rect.width > 0 ? DRAW_BOX.width / rect.width : 1
}

/** Distance between two sampled points, in box units. */
function distance(a: CanvasDrawPoint, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The spacing the sampler keeps: fine enough to follow a curve, coarse enough
 *  that a slow wiggle does not become a thousand points. */
const SAMPLE_STEP = 4

/**
 * Should the in-flight stroke take this position as a new point? The first
 * point always lands; after that a position must be far enough from the last
 * one, or enough time has passed that a slow stroke is still moving.
 * @param pts - the stroke sampled so far.
 * @param next - the candidate position, in box units.
 * @param elapsed - milliseconds since the last accepted point.
 * @returns whether to append.
 */
export function samplesNext(pts: readonly CanvasDrawPoint[], next: { x: number; y: number }, elapsed: number): boolean {
  if (pts.length === 0) return true
  if (pts.length >= MAX_DRAW_POINTS) return false
  const last = pts[pts.length - 1]!
  return distance(last, next) >= SAMPLE_STEP || (elapsed >= 32 && distance(last, next) >= 1)
}

/**
 * The pen's width at one instant, from how fast it moved: a quick sweep is thin,
 * a slow push is thick — the behaviour a hand expects, and the reason a stroke
 * reads as ink rather than as a polyline. Speed is measured in SCREEN pixels per
 * millisecond so a small pad and a wide one give the same line.
 * @param from - the previous sampled point (the stroke's head).
 * @param to - the new position, in box units.
 * @param elapsed - milliseconds between the two.
 * @param scale - box units per screen pixel at the pad's current width.
 * @returns the half-width to store, inside the pen's own range.
 */
export function sampleWidth(
  from: CanvasDrawPoint, to: { x: number; y: number }, elapsed: number, scale: number,
): number {
  const pixels = scale > 0 ? distance(from, to) / scale : distance(from, to)
  const speed = pixels / Math.max(1, elapsed)
  return Math.min(PEN_MAX, Math.max(2, PEN_MAX - speed * 1.6))
}

/**
 * Which stroke the eraser would take, if any. It answers one stroke at a time
 * (the clicked prototype's ruling: a stroke is the unit a person thinks in, and
 * a partial erase of a vector line is a different feature). The tolerance is
 * measured on screen — 12 px, a fingertip's honest target — and converted to box
 * units by the caller's current scale.
 * @param strokes - the card's strokes.
 * @param at - where the pointer is, in box units.
 * @param tolerance - hit radius in box units.
 * @returns the index to remove, or -1.
 */
export function strokeAt(strokes: readonly CanvasStroke[], at: { x: number; y: number }, tolerance: number): number {
  let best = -1
  let nearest = tolerance
  strokes.forEach((stroke, index) => {
    for (const point of stroke.pts) {
      const gap = Math.hypot(point.x - at.x, point.y - at.y)
      if (gap < nearest) {
        nearest = gap
        best = index
      }
    }
  })
  return best
}

/** Stroke count and point count are capped by the host's normalizer; say so here too. */
const STROKE_LIMIT = MAX_DRAW_STROKES
const POINT_LIMIT = MAX_DRAW_POINTS

/**
 * Add a finished stroke to a drawing, inside the bounds the host will enforce
 * anyway: the pad refuses a further stroke rather than letting the user watch a
 * line vanish on save.
 * @param strokes - the card's strokes so far.
 * @param stroke - the stroke just drawn.
 * @returns the new list (truncated to the point cap), or the input when full.
 */
export function appendStroke(strokes: readonly CanvasStroke[], stroke: CanvasStroke): CanvasStroke[] {
  if (strokes.length >= STROKE_LIMIT) return [...strokes]
  const pts = stroke.pts.slice(0, POINT_LIMIT)
  if (pts.length < 2) return [...strokes]
  return [...strokes, { pts, color: stroke.color }]
}

/** One coordinate per decimal place: enough for a screen, short enough to store. */
function placed(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

/**
 * The filled outline of one stroke, as an SVG path in box units. perfect-freehand
 * turns the stored points (their widths become pressure) into the polygon; the
 * walk around it then gets quadratic smoothing so the tail of a curve does not
 * show the polygon's corners.
 * @param stroke - the stroke to ink.
 * @returns the path's `d` value, or '' when there is nothing to draw.
 */
export function strokePathOf(stroke: CanvasStroke): string {
  const outline = getStroke(
    stroke.pts.map(point => [
      point.x, point.y, Math.min(1, Math.max(0.05, point.w / PEN_MAX)),
    ]),
    {
      size: MAX_DRAW_WIDTH,
      thinning: 0.55,
      smoothing: 0.5,
      streamline: 0.35,
      simulatePressure: false,
      // Rounded ends on both sides: a bare polygon taper reads as a cut line.
      start: { cap: true },
      end: { cap: true },
      last: true,
    },
  )
  return outlinePathOf(outline)
}

/** The polygon-to-path walk (perfect-freehand returns points, not a path). */
export function outlinePathOf(outline: readonly Vec2[]): string {
  if (outline.length < 2) return ''
  const first = outline[0]!
  const parts: string[] = ['M', placed(first[0] ?? 0), placed(first[1] ?? 0), 'Q']
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length]!
    parts.push(
      placed(point[0] ?? 0), placed(point[1] ?? 0),
      placed(((point[0] ?? 0) + (next[0] ?? 0)) / 2), placed(((point[1] ?? 0) + (next[1] ?? 0)) / 2),
    )
  })
  parts.push('Z')
  return parts.join(' ')
}

/** Every stroke of a drawing, as the paths one `<svg>` renders. */
export function strokePathsOf(strokes: readonly CanvasStroke[]): string[] {
  return strokes.map(strokePathOf).filter(path => path.length > 0)
}
