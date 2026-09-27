/**
 * The board's new-card slot: a dashed tile at the end of the grid (the first
 * cell of an empty board) that turns into the draft in place. A new card then
 * appears where it will live, not on a page of its own (2026-09-28 review: the
 * detail-page draft read as a jump away from the board).
 *
 * The tile holds words only. A drawing or a picture takes the full editor, and
 * 展开 carries the words there, so nothing typed is lost on the way.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { BoardCategory, CardCategoryId } from '../../types.ts'
import type {} from '../locales.ts'
import { IconPlusOutlineMedium, IconRightUpOutlineMedium } from '../icons.tsx'
import { CardTextarea } from './CardTextarea.tsx'
import css from './board.module.css'

/** What the board needs to host the new-card slot; absent on a read-only board. */
export interface NewCardSlot {
  /** The open draft's kind, or null while the slot is the ＋ tile. */
  readonly draft: CardCategoryId | null
  /** Open the draft (or re-kind the open one). */
  readonly onStart: (kind: CardCategoryId) => void
  /** File the draft; resolves false when nothing was saved (the words stay). */
  readonly onSave: (kind: CardCategoryId, text: string) => Promise<boolean>
  readonly onCancel: () => void
  /** Move the draft to the full editor, words and all. */
  readonly onExpand: (kind: CardCategoryId, text: string) => void
}

/** The ＋ tile, or the draft it became. */
export function DraftTile({ t, slot, kinds, labels, defaultKind, empty }: {
  readonly t: TranslateNS<'canvas'>
  readonly slot: NewCardSlot
  readonly kinds: readonly BoardCategory[]
  readonly labels: ReadonlyMap<string, string>
  /** The kind a click on the ＋ tile starts with (the filter's, when one is on). */
  readonly defaultKind: CardCategoryId
  /** An empty board: the tile carries the first-card invitation. */
  readonly empty: boolean
}): ReactNode {
  const textRef = useRef('')
  const [saving, setSaving] = useState(false)

  if (slot.draft === null) {
    return (
      <button
        type="button"
        className={css.newTile}
        data-empty={empty || undefined}
        onClick={() => { slot.onStart(defaultKind) }}
      >
        <span className={css.newTileLabel}>
          <IconPlusOutlineMedium size={14} />
          {t('board.newCard')}
        </span>
        {empty && <span className={css.newTileHint}>{t('board.empty')}</span>}
        {empty && <span className={css.newTileHint}>{t('board.emptyHint')}</span>}
      </button>
    )
  }

  const kind = slot.draft
  const save = async (text: string): Promise<void> => {
    if (saving || text.trim().length === 0) return
    setSaving(true)
    const ok = await slot.onSave(kind, text)
    setSaving(false)
    if (ok) textRef.current = ''
  }

  return (
    <div className={css.draftTile} data-draft="">
      <div className={css.draftHead}>
        <select
          className={css.draftKind}
          aria-label={t('draft.kind')}
          value={kind}
          onChange={event => { slot.onStart(event.currentTarget.value) }}
        >
          {kinds.map(category => (
            <option key={category.id} value={category.id}>{labels.get(category.id) ?? category.id}</option>
          ))}
        </select>
        <button
          type="button"
          className={css.draftExpand}
          title={t('draft.expandTitle')}
          onClick={() => { slot.onExpand(kind, textRef.current) }}
        >
          <IconRightUpOutlineMedium size={12} />
          {t('draft.expand')}
        </button>
      </div>
      <CardTextarea
        className={css.draftWords}
        placeholder={t('board.newCardPlaceholder')}
        submitOn="auto-enter"
        autoFocus
        onTextChange={text => { textRef.current = text }}
        onSubmit={text => { void save(text) }}
        // Esc gives up an empty draft only: typed words are one 取消 away,
        // never one stray key.
        onCancel={() => { if (textRef.current.trim().length === 0) slot.onCancel() }}
      />
      <div className={css.draftFoot}>
        <span className={css.draftHint}>{t('draft.hint')}</span>
        <button type="button" className={css.draftGhost} onClick={slot.onCancel}>
          {t('block.cancel')}
        </button>
        <button
          type="button"
          className={css.draftAdd}
          disabled={saving}
          onClick={() => { void save(textRef.current) }}
        >
          {t('draft.add')}
        </button>
      </div>
    </div>
  )
}
