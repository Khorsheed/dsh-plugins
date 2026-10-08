/**
 * The row that replaces the generic `canvas_open` tool row in the
 * conversation: which canvas the agent created or switched to, and one door
 * — 打开 → — to it in the right sidebar.
 *
 * A call that settles while the row is on screen (the row saw it running)
 * opens the canvas by itself, so the sidebar follows the agent's switch and
 * the person sees what the next cards land on. A row mounted already settled
 * is history — a reload, a scroll back — and only offers the door: replaying
 * an old switch would yank the sidebar away from whatever is open now.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import type { ProposeToolBlock } from '../type/propose-row.ts'
import { openRowModel } from './open-row.ts'
import css from '../type/ProposeTypeRow.module.css'

/** What the row reaches outside its own block. */
export interface OpenCanvasRowFace {
  /** Show the canvas tab with this canvas open. */
  openCanvas: (canvasId: string) => void
}

/** The props the keyed tool slot composes for this row. */
export interface OpenCanvasRowProps extends OpenCanvasRowFace {
  readonly block: ProposeToolBlock
  readonly phase?: string
  readonly t: TranslateNS<'canvas'>
}

/**
 * Render one `canvas_open` call.
 * @param props - the tool block, the face, the copy.
 */
export function OpenCanvasRow({ block, phase, t, openCanvas }: OpenCanvasRowProps): ReactNode {
  const row = openRowModel(block, phase)
  const sawRunning = useRef(false)
  const followed = useRef(false)
  if (row.state === 'running') sawRunning.current = true
  useEffect(() => {
    if (!sawRunning.current || followed.current || row.canvasId === null) return
    followed.current = true
    openCanvas(row.canvasId)
  }, [row.canvasId, openCanvas])
  return (
    <div className={css.row} data-tool="canvas_open" data-state={row.state}>
      <span className={css.kind}>{t('openrow.kind')}</span>
      {row.state === 'running' && <span className={css.note}>{t('openrow.running')}</span>}
      {row.state === 'failed' && <span className={css.warn} title={row.text}>{row.text.replace(/^失败：/, '') || t('openrow.failed')}</span>}
      {row.state === 'listed' && <span className={css.note} title={row.text}>{t('openrow.listed')}</span>}
      {(row.state === 'created' || row.state === 'switched') && (
        <>
          <span className={css.name}>
            {t(row.state === 'created' ? 'openrow.created' : 'openrow.switched', { title: row.title ?? '' })}
          </span>
          <button
            type="button"
            className={css.open}
            onClick={() => { if (row.canvasId !== null) openCanvas(row.canvasId) }}
          >
            {t('openrow.open')}
          </button>
        </>
      )}
    </div>
  )
}
