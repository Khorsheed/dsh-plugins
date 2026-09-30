/**
 * The board's new-card slot: a dashed ＋ tile at the end of the grid (the first
 * cell of an empty board). A click opens the draft page, the one full editor
 * with drawing and pictures (2026-09-30: the in-place draft it used to become
 * saw little use — nearly every new card went on to 展开 anyway).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CardCategoryId } from '../../types.ts'
import type {} from '../locales.ts'
import { IconPlusOutlineMedium } from '../icons.tsx'
import css from './board.module.css'

/** What the board needs to host the new-card slot; absent on a read-only board. */
export interface NewCardSlot {
  /** Open the draft page for a new card of this kind. */
  readonly onStart: (kind: CardCategoryId) => void
}

/** The ＋ tile. */
export function DraftTile({ t, slot, labels, defaultKind, empty }: {
  readonly t: TranslateNS<'canvas'>
  readonly slot: NewCardSlot
  readonly labels: ReadonlyMap<string, string>
  /** The kind a click starts with (the filter's, when one is on). */
  readonly defaultKind: CardCategoryId
  /** An empty board: the tile carries the first-card invitation. */
  readonly empty: boolean
}): ReactNode {
  return (
    <button
      type="button"
      className={css.newTile}
      data-empty={empty || undefined}
      onClick={() => { slot.onStart(defaultKind) }}
    >
      <span className={css.newTileLabel}>
        <IconPlusOutlineMedium size={14} />
        {t('board.newCardOf', { kind: labels.get(defaultKind) ?? defaultKind })}
      </span>
      {empty && <span className={css.newTileHint}>{t('board.empty')}</span>}
      {empty && <span className={css.newTileHint}>{t('board.emptyHint')}</span>}
    </button>
  )
}
