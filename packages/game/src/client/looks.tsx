/**
 * Element looks in the panel: the same pixel rows the game draws through
 * `dshDraw`, painted onto a small canvas. The canvas is the content here
 * (the element's own colors), so no theme token applies to the pixels.
 */
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { LOOK_CHARS, type ElementLook } from '../types.ts'
import css from './GameTab.module.css'

/** Rows of one state (the first state when the name is unknown). */
export function rowsOf(look: ElementLook, state: string): readonly string[] {
  return look.states[state] ?? Object.values(look.states)[0] ?? []
}

/** Paint one state of a look into a 2D context, cell by cell. */
export function paintLook(g: CanvasRenderingContext2D, look: ElementLook, state: string, cell: number, grid = false): void {
  const rows = rowsOf(look, state)
  const w = rows[0]?.length ?? 0
  g.clearRect(0, 0, w * cell, rows.length * cell)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = look.palette[LOOK_CHARS.indexOf(row[x]!)]
      if (color === undefined) continue
      g.fillStyle = color
      g.fillRect(x * cell, y * cell, cell, cell)
    }
  })
  if (grid && cell >= 6) {
    g.strokeStyle = 'rgba(127,127,127,0.18)' /* panel-check: allow-color — editor grid over the element's own pixels */
    g.lineWidth = 1
    for (let x = 0; x <= w; x++) { g.beginPath(); g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, rows.length * cell); g.stroke() }
    for (let y = 0; y <= rows.length; y++) { g.beginPath(); g.moveTo(0, y * cell + 0.5); g.lineTo(w * cell, y * cell + 0.5); g.stroke() }
  }
}

/** Props of {@link LookCanvas}. */
export interface LookCanvasProps {
  readonly look: ElementLook
  readonly state?: string
  /** Box edge in CSS px; the look scales to the largest whole cell that fits. */
  readonly box: number
  readonly grid?: boolean
  readonly className?: string | undefined
  /** Editor mode: called with the cell under the pointer while painting. */
  readonly onPaint?: (x: number, y: number) => void
}

/** One look on a checkerboard, crisp at any size. */
export function LookCanvas({ look, state = 'idle', box, grid = false, className, onPaint }: LookCanvasProps): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const rows = rowsOf(look, state)
  const w = Math.max(1, rows[0]?.length ?? 1)
  const h = Math.max(1, rows.length)
  const cell = Math.max(1, Math.floor(box / Math.max(w, h)))
  const painting = useRef(false)

  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (g) paintLook(g, look, state, cell, grid)
  }, [look, state, cell, grid])

  const cellAt = (event: PointerEvent<HTMLCanvasElement>): [number, number] | undefined => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / rect.width * w)
    const y = Math.floor((event.clientY - rect.top) / rect.height * h)
    return x >= 0 && y >= 0 && x < w && y < h ? [x, y] : undefined
  }
  const paint = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = cellAt(event)
    if (at && onPaint) onPaint(at[0], at[1])
  }

  return <canvas
    ref={ref}
    className={[css.look, className].filter(Boolean).join(' ')}
    width={w * cell}
    height={h * cell}
    data-editable={onPaint ? 'true' : 'false'}
    {...(onPaint ? {
      onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => { painting.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e) },
      onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => { if (painting.current) paint(e) },
      onPointerUp: () => { painting.current = false },
      onPointerCancel: () => { painting.current = false },
    } : {})}
  />
}

/** Replace one cell of one state; returns a new look. */
export function setCell(look: ElementLook, state: string, x: number, y: number, char: string): ElementLook {
  const name = look.states[state] ? state : Object.keys(look.states)[0]!
  const rows = [...rowsOf(look, name)]
  const row = rows[y]
  if (row === undefined || row[x] === char) return look
  rows[y] = row.slice(0, x) + char + row.slice(x + 1)
  return { ...look, states: { ...look.states, [name]: rows } }
}

/** Swap one palette color for another everywhere (整体换色). */
export function recolor(look: ElementLook, index: number, color: string): ElementLook {
  if (index < 0 || index >= look.palette.length) return look
  return { ...look, palette: look.palette.map((c, i) => (i === index ? color : c)) }
}

/** The palette index for a color, appending it when new; returns the new look and the row char. */
export function ensureColor(look: ElementLook, color: string): { look: ElementLook; char: string } {
  const at = look.palette.findIndex(c => c.toLowerCase() === color.toLowerCase())
  if (at >= 0) return { look, char: LOOK_CHARS[at]! }
  if (look.palette.length >= LOOK_CHARS.length) return { look, char: LOOK_CHARS[0]! }
  return { look: { ...look, palette: [...look.palette, color] }, char: LOOK_CHARS[look.palette.length]! }
}

/** A blank 16×16 look in a palette, for elements that have none yet. */
export function blankLook(palette: readonly string[]): ElementLook {
  return { palette: palette.slice(0, 16), states: { idle: Array.from({ length: 16 }, () => '.'.repeat(16)) } }
}
