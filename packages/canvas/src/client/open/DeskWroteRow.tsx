/**
 * The line for what a room member wrote on one canvas in a turn
 * (`desk-write.ts`): 「《潜梦者》 新增人物卡「数据标注员」 · 批注 1 张卡  查看 →」.
 * Inside the member's card it names only the canvas; on a row of its own it
 * names the member too. A member's write seen arriving puts the canvas on the
 * strip beside the one being read (choice A); a coordinator's needs nothing —
 * it writes on the canvas the room already shows.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { shouldFollow } from './desk-row.ts'
import { onlyCardOf, writeSummaryParts, type DeskWriteGroup } from './desk-write.ts'
import css from '../type/ProposeTypeRow.module.css'

/** What the line reaches outside itself. */
export interface DeskWroteRowFace {
  /** Show the canvas tab with this canvas open. */
  openCanvas: (canvasId: string) => void
  /** Show the canvas tab on one card. */
  openCard: (canvasId: string, cardId: string, heading: string) => void
  /** Put the canvas on the strip without showing it. */
  addCanvas: (canvasId: string) => void
}

export interface DeskWroteRowProps extends DeskWroteRowFace {
  readonly group: DeskWriteGroup
  readonly sessionId: string
  readonly t: TranslateNS<'canvas'>
  /** Whether the card is live (a settled reply only offers the door). */
  readonly follow: boolean
  /** Inside the member's own card: the member goes unnamed. */
  readonly own: boolean
}

/**
 * Render one canvas's writes of a turn.
 * @param props - the folded group, the face, the copy.
 */
export function DeskWroteRow({ group, sessionId, t, follow, own, openCanvas, openCard, addCanvas }: DeskWroteRowProps): ReactNode {
  const { last } = group
  useEffect(() => {
    if (!follow || last.role !== 'member' || !shouldFollow(`${sessionId}:wrote`, { seq: last.seq, time: last.time })) return
    addCanvas(group.canvasId)
  }, [follow, last, sessionId, group.canvasId, addCanvas])
  const copy = t as unknown as (key: string, params?: Record<string, string>) => string
  const parts = writeSummaryParts(group.items, copy)
  if (parts.length === 0) return null
  const where = own ? t('deskwrite.canvas', { title: group.title }) : t('deskwrite.memberCanvas', { member: last.member, title: group.title })
  const said = `${where} ${parts.join(' · ')}`
  const card = onlyCardOf(group.items)
  return (
    <div className={css.row} data-desk-write={group.canvasId}>
      <span className={css.kind}>{t('openrow.kind')}</span>
      <span className={css.name} title={said}>{said}</span>
      <button
        type="button"
        className={css.open}
        onClick={() => { if (card?.cardId !== undefined) openCard(group.canvasId, card.cardId, card.title); else openCanvas(group.canvasId) }}
      >
        {t('deskwrite.view')}
      </button>
    </div>
  )
}
