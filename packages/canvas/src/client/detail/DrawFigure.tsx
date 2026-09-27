/**
 * The vector figure a card's drawing makes — one component, two seats: the
 * pad draws on it, the board shrinks it to a thumbnail. Strokes are stored as
 * point lists, so the outline is derived here, at render, and never written
 * back to the card (§11.4's measured 287 B vs 834 B).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useMemo } from 'react'
import { DRAW_BOX, type CanvasDrawPoint, type CanvasStroke, type CanvasStrokeSize } from '../../types.ts'
import { strokePathOf, strokePathsOf } from '../draw.ts'
import css from './DrawFigure.module.css'

export interface DrawFigureProps {
  readonly strokes: readonly CanvasStroke[]
  /** The index the eraser is aimed at — the pad's only, a thumbnail has none. */
  readonly hovered?: number
  /** The stroke still under construction, drawn over the saved ones. */
  readonly live?: readonly CanvasDrawPoint[]
  /** The pen width the live stroke is being drawn with. */
  readonly liveSize?: CanvasStrokeSize
}

/** The strokes of a card, as one SVG in the logical box's units. */
export function DrawFigure({ strokes, hovered = -1, live, liveSize }: DrawFigureProps) {
  const paths = useMemo(() => strokePathsOf(strokes), [strokes])
  const livePath = useMemo(
    () => (live !== undefined && live.length > 1 ? strokePathOf({ pts: live, color: 'ink', ...(liveSize === undefined ? {} : { size: liveSize }) }) : ''),
    [live, liveSize],
  )
  return (
    <svg
      className={css.figure}
      viewBox={`0 0 ${DRAW_BOX.width} ${DRAW_BOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path, index) => (
        path.length === 0 ? null : (
          <path
            key={index}
            d={path}
            className={index === hovered ? css.inkHit : strokes[index]?.color === 'faint' ? css.inkFaint : css.ink}
          />
        )
      ))}
      {livePath.length > 0 && <path d={livePath} className={css.ink} />}
    </svg>
  )
}
