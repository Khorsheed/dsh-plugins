/**
 * The line for what a room member wrote on one canvas in a turn
 * (`desk-write.ts`): 「《潜梦者》 新增人物卡「数据标注员」 · 批注 1 张卡  查看 →」.
 * Inside the member's card it names only the canvas; on a row of its own it
 * names the member too. A member's live write puts the canvas on the strip
 * beside the one being read (choice A) — the destination follower's call
 * (`deskDestinationsOf`); a coordinator's needs nothing — it writes on the
 * canvas the room already shows. The door lands where the
 * writes are (`deskWritePlace`): the chapter, the one card, or every card the
 * turn touched under the board's 「本轮改动」 chip.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { deskWritePlace, writeSummaryParts, type DeskWriteGroup } from './desk-write.ts'
import type { CanvasNavParams } from '../slots.ts'
import css from '../type/ProposeTypeRow.module.css'

/** What the line reaches outside itself. */
export interface DeskWroteRowFace {
  /** Put the canvas on the strip without showing it. */
  addCanvas: (canvasId: string) => void
  /** Open the canvas tab at one address (the line's door). */
  go: (params: CanvasNavParams) => void
}

export interface DeskWroteRowProps extends DeskWroteRowFace {
  readonly group: DeskWriteGroup
  readonly sessionId: string
  readonly t: TranslateNS<'canvas'>
  /** Kept for the seats that pass it; following is the destination follower's (`deskDestinationsOf`). */
  readonly follow: boolean
  /** Inside the member's own card: the member goes unnamed. */
  readonly own: boolean
}

/**
 * Render one canvas's writes of a turn.
 * @param props - the folded group, the face, the copy.
 */
export function DeskWroteRow({ group, t, own, go }: DeskWroteRowProps): ReactNode {
  const { last } = group
  const copy = t as unknown as (key: string, params?: Record<string, string>) => string
  const parts = writeSummaryParts(group.items, copy)
  if (parts.length === 0) return null
  const where = own ? t('deskwrite.canvas', { title: group.title }) : t('deskwrite.memberCanvas', { member: last.member, title: group.title })
  const said = `${where} ${parts.join(' · ')}`
  return (
    <div className={css.row} data-desk-write={group.canvasId}>
      <span className={css.kind}>{t('openrow.kind')}</span>
      <span className={css.name} title={said}>{said}</span>
      <button
        type="button"
        className={css.open}
        onClick={() => { go(deskWritePlace(group.canvasId, group.items)) }}
      >
        {t('deskwrite.view')}
      </button>
    </div>
  )
}
