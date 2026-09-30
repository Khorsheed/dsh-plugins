/**
 * The row that replaces the generic `canvas_propose_type` tool row in the
 * conversation: what the agent proposed, for which category, and one door —
 * 去类型页看看 → — to the type page where the person adopts or rejects it.
 *
 * The row decides nothing itself: adopting is the person's call, taken on the
 * type page beside the preview and the impact line. The row is a pointer.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { proposeRowModel, type ProposeToolBlock } from './propose-row.ts'
import css from './ProposeTypeRow.module.css'

/** What the row reaches outside its own block. */
export interface ProposeTypeRowFace {
  /** Show the canvas tab and put its row on the kind's type page. */
  openType: (canvasId: string, kind: string, heading: string) => void
}

/** The props the keyed tool slot composes for this row. */
export interface ProposeTypeRowProps extends ProposeTypeRowFace {
  readonly block: ProposeToolBlock
  readonly phase?: string
  readonly t: TranslateNS<'canvas'>
}

/**
 * Render one `canvas_propose_type` call.
 * @param props - the tool block, the face, the copy.
 */
export function ProposeTypeRow({ block, phase, t, openType }: ProposeTypeRowProps): ReactNode {
  const row = proposeRowModel(block, phase)
  const name = row.label ?? row.kind
  return (
    <div className={css.row} data-tool="canvas_propose_type" data-state={row.state}>
      <span className={css.kind}>{t('toolview.kind')}</span>
      {row.state === 'running' && <span className={css.note}>{t('toolview.running')}</span>}
      {row.state === 'failed' && <span className={css.warn} title={row.text}>{row.text || t('toolview.failed')}</span>}
      {row.state === 'unreadable' && <span className={css.note} title={row.text}>{row.text}</span>}
      {row.state === 'ready' && (
        <>
          <span className={css.name}>{t('toolview.ready', { name: name ?? '' })}</span>
          <button
            type="button"
            className={css.open}
            onClick={() => {
              if (row.canvasId !== null && row.kind !== null) openType(row.canvasId, row.kind, name ?? row.kind)
            }}
          >
            {t('toolview.open')}
          </button>
        </>
      )}
    </div>
  )
}
