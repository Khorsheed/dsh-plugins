/**
 * The pen's pure half, against numbers rather than screenshots: the box map
 * (including the two degenerate cases that would otherwise write `Infinity`
 * into a card), the sampler's spacing and its point cap, the velocity width
 * and its clamps, the eraser's one-stroke hit test, the append caps, and the
 * outline a stroke becomes.
 */
import { describe, expect, it } from 'vitest'
import { DRAW_BOX, MAX_DRAW_POINTS, MAX_DRAW_STROKES, MAX_DRAW_WIDTH, normalizeDraw, type CanvasStroke } from '../src/types.ts'
import {
  appendStroke, boxPointOf, outlinePathOf, sampleWidth, samplesNext, strokeAt, strokePathOf,
  strokePathsOf, unitsPerPixel,
} from '../src/client/draw.ts'

/** A pad 300 px wide, at the viewport origin: one screen px = two box units. */
const PAD = { left: 0, top: 0, width: 300, height: 200 }
/** The same box, but placed away from the origin. */
const OFFSET = { left: 120, top: 60, width: 600, height: 400 }

const point = (x: number, y: number, w = 5) => ({ x, y, w })

describe('boxPointOf', () => {
  it('maps a position into the logical box', () => {
    expect(boxPointOf(PAD, 150, 100)).toEqual({ x: DRAW_BOX.width / 2, y: DRAW_BOX.height / 2 })
  })

  it('subtracts the box offset before scaling', () => {
    expect(boxPointOf(OFFSET, 420, 260)).toEqual({ x: 300, y: 200 })
  })

  it('clamps a pointer that ran off the pad to the edge', () => {
    expect(boxPointOf(PAD, -40, 900)).toEqual({ x: 0, y: DRAW_BOX.height })
  })

  it('answers zero for a box that has no width yet, instead of Infinity', () => {
    expect(boxPointOf({ ...PAD, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0, y: 0 })
  })
})

describe('unitsPerPixel', () => {
  it('says how many box units one screen pixel spans', () => {
    expect(unitsPerPixel(PAD)).toBe(2)
  })

  it('falls back to one unit per pixel on an unmeasured box', () => {
    expect(unitsPerPixel({ ...PAD, width: 0 })).toBe(1)
  })
})

describe('samplesNext', () => {
  it('always takes the first point', () => {
    expect(samplesNext([], point(10, 10), 0)).toBe(true)
  })

  it('takes a position far enough from the head', () => {
    expect(samplesNext([point(0, 0)], point(20, 0), 8)).toBe(true)
  })

  it('drops a wiggle too close to the head to matter', () => {
    expect(samplesNext([point(0, 0)], point(1.5, 0), 8)).toBe(false)
  })

  it('keeps a slow stroke moving once enough time has passed', () => {
    expect(samplesNext([point(0, 0)], point(1.5, 0), 50)).toBe(true)
  })

  it('stops sampling at the stored point cap', () => {
    const full = Array.from({ length: MAX_DRAW_POINTS }, (_, index) => point(index * 10, 0))
    expect(samplesNext(full, point(9000, 9000), 100)).toBe(false)
  })
})

describe('sampleWidth', () => {
  /** The widest the pen stores, i.e. the pressure ceiling in half-width units. */
  const THICK = MAX_DRAW_WIDTH / 2

  it('puts a slow stroke at the pen’s full width', () => {
    expect(sampleWidth(point(0, 0), point(2, 0), 200, 2)).toBeGreaterThan(THICK - 0.05)
  })

  it('thins a quick sweep', () => {
    expect(sampleWidth(point(0, 0), point(400, 0), 8, 2)).toBeLessThan(
      sampleWidth(point(0, 0), point(40, 0), 80, 2),
    )
  })

  it('never goes below the thin end of the pen', () => {
    expect(sampleWidth(point(0, 0), point(600, 600), 1, 2)).toBe(2)
  })

  it('measures speed on the screen, so a small pad gives the same line', () => {
    const slow = sampleWidth(point(0, 0), point(60, 0), 40, 1)
    expect(sampleWidth(point(0, 0), point(30, 0), 40, 0.5)).toBeCloseTo(slow, 10)
  })
})

describe('strokeAt', () => {
  const strokes: CanvasStroke[] = [
    { pts: [point(50, 50), point(60, 50)], color: 'ink' },
    { pts: [point(400, 300), point(420, 320)], color: 'ink' },
  ]

  it('takes the whole stroke nearest the aim', () => {
    expect(strokeAt(strokes, point(421, 321), 12)).toBe(1)
  })

  it('takes the other stroke when the aim is closer to it', () => {
    expect(strokeAt(strokes, point(51, 52), 12)).toBe(0)
  })

  it('misses when nothing lies inside the tolerance', () => {
    expect(strokeAt(strokes, point(300, 200), 12)).toBe(-1)
  })

  it('misses on a card with no ink at all', () => {
    expect(strokeAt([], point(10, 10), 24)).toBe(-1)
  })
})

describe('appendStroke', () => {
  const stroke = (): CanvasStroke => ({ pts: [point(0, 0), point(10, 10)], color: 'ink' })

  it('adds a finished stroke and leaves the old list alone', () => {
    const before: CanvasStroke[] = [stroke()]
    expect(appendStroke(before, stroke())).toHaveLength(2)
    expect(before).toHaveLength(1)
  })

  it('drops a stroke with fewer than two points (a tap is not a line)', () => {
    expect(appendStroke([], { pts: [point(1, 1)], color: 'ink' })).toEqual([])
  })

  it('truncates a stroke to the stored point cap', () => {
    const long: CanvasStroke = {
      pts: Array.from({ length: MAX_DRAW_POINTS + 30 }, (_, index) => point(index, 0)),
      color: 'ink',
    }
    expect(appendStroke([], long)[0]!.pts).toHaveLength(MAX_DRAW_POINTS)
  })

  it('refuses a further stroke once the card is full', () => {
    const full = Array.from({ length: MAX_DRAW_STROKES }, stroke)
    expect(appendStroke(full, stroke())).toHaveLength(MAX_DRAW_STROKES)
  })
})

describe('strokePathOf', () => {
  it('inks a two-point stroke as a closed path', () => {
    const path = strokePathOf({ pts: [point(100, 100, 6), point(200, 140, 6)], color: 'ink' })
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(path).toContain(' Q ')
  })

  it('inks a lone point as a dot, though the pad never stores one', () => {
    // appendStroke refuses a stroke with fewer than two points, so this shape
    // only reaches the renderer from a hand-edited file — where a dot is the
    // honest reading, not a blank.
    expect(strokePathOf({ pts: [point(100, 100)], color: 'ink' }).length).toBeGreaterThan(0)
  })

  it('gives nothing for a stroke with no points at all', () => {
    expect(strokePathOf({ pts: [], color: 'ink' })).toBe('')
  })

  it('keeps a stroke inside the box, bar the bleed of its own width', () => {
    const path = strokePathOf({
      pts: Array.from({ length: 20 }, (_, index) => point(index * 25 + 50, Math.sin(index) * 100 + 200, 4)),
      color: 'ink',
    })
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
    // The outline sits half the pen outside the centre line, so the frame clips
    // it rather than letting ink bleed over the card's border.
    expect(Math.max(...numbers)).toBeLessThanOrEqual(DRAW_BOX.width + MAX_DRAW_WIDTH)
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-MAX_DRAW_WIDTH)
  })
})

describe('normalizeDraw — pen widths', () => {
  const pts = [{ x: 1, y: 1, w: 5 }, { x: 9, y: 9, w: 5 }]

  it('keeps 细 and 粗, and reads 中, a missing width or an unknown one as no field at all', () => {
    const read = normalizeDraw([
      { pts, color: 'ink', size: 'thin' },
      { pts, color: 'ink', size: 'bold' },
      { pts, color: 'ink', size: 'medium' },
      { pts, color: 'ink' },
      { pts, color: 'ink', size: 'huge' },
    ])
    expect(read.map(stroke => stroke.size)).toEqual(['thin', 'bold', undefined, undefined, undefined])
    expect(read.slice(2).every(stroke => !('size' in stroke))).toBe(true)
  })
})

describe('strokePathOf — pen widths', () => {
  /** The outline's spread across the line, a stand-in for how broad it inks. */
  const spread = (size?: CanvasStroke['size']): number => {
    const path = strokePathOf({
      pts: [point(100, 200, 6), point(300, 200, 6), point(500, 200, 6)],
      color: 'ink',
      ...(size === undefined ? {} : { size }),
    })
    const ys = path.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, index) => index % 2 === 1)
    return Math.max(...ys) - Math.min(...ys)
  }

  it('inks 细 narrower and 粗 broader than 中, and a stroke with no width as 中', () => {
    expect(spread('thin')).toBeLessThan(spread('medium'))
    expect(spread('bold')).toBeGreaterThan(spread('medium'))
    expect(spread()).toBe(spread('medium'))
  })
})

describe('outlinePathOf', () => {
  it('gives nothing for a polygon it cannot close', () => {
    expect(outlinePathOf([[1, 2]])).toBe('')
    expect(outlinePathOf([])).toBe('')
  })
})

describe('strokePathsOf', () => {
  it('renders one path per stroke and skips the ones with nothing to draw', () => {
    const paths = strokePathsOf([
      { pts: [point(10, 10, 6), point(80, 60, 6)], color: 'ink' },
      { pts: [], color: 'ink' },
      { pts: [point(200, 200, 3), point(300, 250, 3)], color: 'faint' },
    ])
    expect(paths).toHaveLength(2)
    expect(paths.every(path => path.length > 0)).toBe(true)
  })

  it('gives an empty drawing for a card with no strokes', () => {
    expect(strokePathsOf([])).toEqual([])
  })
})
