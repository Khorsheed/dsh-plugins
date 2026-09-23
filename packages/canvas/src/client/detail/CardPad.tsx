/**
 * The card's drawing pad (§11.4, demand ③): a pen field that lives on ONE
 * card, in the detail page — the board family's only editor, so the drawing
 * is edited where the words are.
 *
 * Three rules the clicked prototype settled and this honours: the tool strip
 * sits ABOVE the pad (below it, it scrolled out of the writer's view mid
 * gesture); the eraser takes one WHOLE stroke, and the stroke it would take
 * lights up under the pointer first (a partial erase of a vector line is a
 * different feature nobody asked for); and there are THREE exits back to
 * typing — press the pen again, press Esc, or leave the card — because a pen
 * mode the keyboard cannot leave traps a writer.
 *
 * After a stroke lands it is on disk (or in the tab's draft), so the pad
 * remains below the text as a read-only figure with 「点一下接着画」: the
 * drawing is card content, and content that disappears when you stop making
 * it reads as lost work. All coordinates are the logical box's units, mapped
 * in by {@link boxPointOf} — see `draw.ts`.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Button, IconEditOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { MAX_DRAW_STROKES, type CanvasDrawPoint, type CanvasStroke } from '../../types.ts'
import {
  appendStroke, boxPointOf, samplesNext, sampleWidth, strokeAt, unitsPerPixel,
  type PadTool,
} from '../draw.ts'
import type { CanvasDetailProps } from '../contract.ts'
import { IconEraserOutline16, IconUndoOutline16 } from '../icons.tsx'
import { DrawFigure } from './DrawFigure.tsx'
import css from './CardPad.module.css'

/** How far from a stroke the eraser still counts as aimed, in SCREEN pixels. */
const ERASE_TOLERANCE = 12

/** What the pad needs: the strokes, the tool, and where committed ink goes. */
export interface CardPadProps {
  readonly t: CanvasDetailProps['t']
  readonly strokes: readonly CanvasStroke[]
  readonly tool: PadTool
  readonly onTool: (tool: PadTool) => void
  /** A committed stroke list (a finished stroke, an erase, an undo, a clear). */
  readonly onStrokes: (strokes: readonly CanvasStroke[]) => void
  /** One line of news, said in the page's own toast. */
  readonly notify: (text: string) => void
  /** False on a card nobody may edit (archived, proposed, or a session-less seat). */
  readonly editing: boolean
  /**
   * The draft's save, on ⌘⏎ while the pen holds the page. The textarea that
   * normally carries the shortcut is hidden then, and a shortcut that quits
   * when a tool starts is a trap; a card already on the board needs none,
   * because its strokes save themselves.
   */
  readonly onSave?: () => void
}

/** The pad: the tool strip, and the field the strokes live on. */
export function CardPad({ t, strokes, tool, onTool, onStrokes, notify, editing, onSave }: CardPadProps): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null)
  /** The stroke under construction. A ref, so a fast drag never waits on a render. */
  const liveRef = useRef<CanvasDrawPoint[]>([])
  const stampRef = useRef(0)
  const [live, setLive] = useState<readonly CanvasDrawPoint[]>([])
  const [hover, setHover] = useState(-1)

  const drawing = editing && tool !== 'text'
  const hasInk = strokes.length > 0

  // The eraser has nothing to aim at on a card with no ink: never enter the mode.
  useEffect(() => {
    if (tool === 'erase' && !hasInk) onTool('text')
  }, [tool, hasInk, onTool])

  // Esc is one of the three exits, and the pointer may be anywhere in the page
  // when it is pressed — the pad owns the window listener while it is drawing.
  // ⌘⏎ comes along for the ride, so the pen never swallows the draft's save.
  useEffect(() => {
    if (!drawing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onTool('text')
        return
      }
      if (onSave !== undefined && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [drawing, onTool, onSave])

  /** Where in the logical box this pointer is, and how wide one pixel is there. */
  const aimOf = (event: ReactPointerEvent<HTMLDivElement>):
    { x: number; y: number; scale: number } | undefined => {
    const box = boxRef.current
    if (box === null) return undefined
    const rect = box.getBoundingClientRect()
    const at = boxPointOf(rect, event.clientX, event.clientY)
    return { ...at, scale: unitsPerPixel(rect) }
  }

  const dropLive = (): void => {
    liveRef.current = []
    setLive([])
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editing) return
    const aim = aimOf(event)
    if (aim === undefined) return
    event.preventDefault()
    // The pad keeps the gesture even when the hand drags past its edge.
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'erase') {
      const index = strokeAt(strokes, aim, ERASE_TOLERANCE * aim.scale)
      if (index < 0) {
        notify(t('draw.eraseMiss'))
        return
      }
      onStrokes(strokes.filter((_, position) => position !== index))
      setHover(-1)
      return
    }
    if (tool !== 'pen') return
    liveRef.current = [{ x: aim.x, y: aim.y, w: 5 }]
    stampRef.current = event.timeStamp
    setLive(liveRef.current)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const aim = aimOf(event)
    if (aim === undefined) return
    if (tool === 'erase') {
      // Hover says which single stroke the click would take.
      const index = strokeAt(strokes, aim, ERASE_TOLERANCE * aim.scale)
      if (index !== hover) setHover(index)
      return
    }
    if (tool !== 'pen' || liveRef.current.length === 0) return
    const elapsed = Math.max(1, event.timeStamp - stampRef.current)
    const head = liveRef.current[liveRef.current.length - 1]!
    if (!samplesNext(liveRef.current, aim, elapsed)) return
    const next = [...liveRef.current, { x: aim.x, y: aim.y, w: sampleWidth(head, aim, elapsed, aim.scale) }]
    liveRef.current = next
    stampRef.current = event.timeStamp
    setLive(next)
  }

  const onPointerUp = (): void => {
    const pts = liveRef.current
    dropLive()
    if (pts.length < 2) return
    if (strokes.length >= MAX_DRAW_STROKES) {
      notify(t('draw.full'))
      return
    }
    onStrokes(appendStroke(strokes, { pts, color: 'ink' }))
  }

  const undo = (): void => {
    if (!hasInk) return
    onStrokes(strokes.slice(0, Math.max(0, strokes.length - 1)))
  }

  const figure = <DrawFigure strokes={strokes} hovered={hover} live={live} />

  return (
    <div className={css.pad} data-tool={drawing ? tool : 'text'}>
      {editing && (
        <div className={css.bar} role="group" aria-label={t('draw.tools')}>
          <Button
            size="sm"
            variant={tool === 'pen' ? 'primary' : 'toolbar'}
            aria-pressed={tool === 'pen'}
            icon={<IconEditOutline16 size={12} />}
            onClick={() => { onTool(tool === 'pen' ? 'text' : 'pen') }}
          >
            {t('draw.pen')}
          </Button>
          <Button
            size="sm"
            variant={tool === 'erase' ? 'primary' : 'toolbar'}
            aria-pressed={tool === 'erase'}
            disabled={!hasInk}
            icon={<IconEraserOutline16 size={12} />}
            onClick={() => { onTool(tool === 'erase' ? 'text' : 'erase') }}
          >
            {t('draw.erase')}
          </Button>
          {hasInk && (
            <Button size="sm" icon={<IconUndoOutline16 size={12} />} onClick={undo}>
              {t('draw.undo')}
            </Button>
          )}
          {hasInk && (
            <Button
              size="sm"
              icon={<IconTrashOutline16 size={12} />}
              onClick={() => {
                onStrokes([])
                onTool('text')
              }}
            >
              {t('draw.clear')}
            </Button>
          )}
          {drawing && <span className={css.hint}>{t(onSave === undefined ? 'draw.hintOn' : 'draw.hintDraft')}</span>}
          {!drawing && !hasInk && <span className={css.hint}>{t('draw.hint')}</span>}
        </div>
      )}
      {drawing || hasInk ? (
        <div className={css.field}>
          {drawing ? (
            <div
              ref={boxRef}
              className={css.box}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={dropLive}
              onPointerLeave={() => { setHover(-1) }}
            >
              {figure}
            </div>
          ) : (
            <div className={css.box} data-readonly="true">
              {figure}
            </div>
          )}
          {!drawing && hasInk && editing && (
            <Button
              size="sm"
              variant="toolbar"
              className={css.continue}
              icon={<IconEditOutline16 size={12} />}
              onClick={() => { onTool('pen') }}
            >
              {t('draw.continue')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
