/**
 * The category page: one canvas's category list — rename in place, add,
 * retire or bring back, and the door to each kind's type page.
 *
 * It used to open as a panel under the board's chip strip; with card types
 * every row grew a style column and a 「设计」 door, and a panel over the
 * board was too narrow for that. It is now a page in the canvas's own row
 * (crumbs 画布 / 分类), drawn from the tab's loaded board and writing through
 * the tab's own catalog verb, so the selection and the filter stay the tab's.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  enabledCategories, isBoardCardKind, makeBoardId, sanitizeCategoryLabel,
  type BoardCategory, type CanvasBoard, type CardCategoryId,
} from '../../types.ts'
import type { CanvasDetailCrumbs } from '../contract.ts'
import { categoryColorOf, categoryLabelMap } from '../category-label.ts'
import { DetailCrumbs } from '../detail/DetailCrumbs.tsx'
import { IconPlusOutlineMedium } from '../icons.tsx'
import type {} from '../locales.ts'
import detailCss from '../detail/CanvasDetailView.module.css'
import css from './CategoriesView.module.css'

/** A fresh custom category id, minted where the page adds one. */
function newCategoryId(): string {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(8))
  const random = bytes === undefined
    ? Math.random().toString(36).slice(2).padEnd(12, '0')
    : [...bytes].map(byte => byte.toString(36).padStart(2, '0')).join('')
  return makeBoardId('cat', Date.now(), random)
}

/**
 * One row: rename in place, the kind's style, retire or bring back. The
 * parent keys this by id AND label, so a committed rename remounts the input
 * with the stored text and no local state ever disagrees with the board.
 */
function CategoryRow({ t, category, color, count, readonly, onRename, onToggle, onDesign }: {
  readonly t: TranslateNS<'canvas'>
  readonly category: BoardCategory
  readonly color: string
  readonly count: number
  readonly readonly: boolean
  readonly onRename: (label: string) => void
  readonly onToggle: () => void
  /** Open the category's type page. */
  readonly onDesign: () => void
}): ReactNode {
  const [text, setText] = useState(category.label)
  const commit = (): void => {
    const label = sanitizeCategoryLabel(text) ?? ''
    setText(label)
    if (label !== category.label) onRename(label)
  }
  const definition = category.definition
  const pending = category.proposal !== undefined || category.draft === true
  return (
    <div className={css.row} data-off={category.enabled ? undefined : true}>
      <span className={css.dot} style={{ background: color }} />
      <input
        className={css.input}
        type="text"
        value={text}
        readOnly={readonly}
        placeholder={isBoardCardKind(category.id) ? t(`kind.${category.id}`) : category.id}
        aria-label={t('cat.rename')}
        onChange={event => { setText(event.target.value) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
      <span className={css.count}>
        {t('cat.count', { count: String(count) })}
        {isBoardCardKind(category.id) && <span className={css.builtin}>{t('cat.builtin')}</span>}
      </span>
      <span className={css.style} data-pending={pending || undefined}>
        {pending ? (
          <>
            <span className={css.pendingDot} />
            {t('cat.stylePending')}
          </>
        ) : definition === undefined || definition.layout === 'note' ? t('cat.styleNote') : t('cat.styleTyped', {
          layout: t(`type.layout.${definition.layout}` as const),
          count: String(definition.fields.length),
        })}
      </span>
      <button type="button" className={css.link} title={t('type.designTip')} onClick={onDesign}>
        {t('type.design')} ›
      </button>
      {readonly ? <span /> : (
        <button
          type="button"
          className={category.enabled ? css.toggle : `${css.toggle} ${css.toggleOn}`}
          onClick={onToggle}
        >
          {category.enabled ? t('cat.disable') : t('cat.enable')}
        </button>
      )}
    </div>
  )
}

/** The category page. */
export function CategoriesView({ t, board, readonly, crumbs, onWrite, onDesign }: {
  readonly t: TranslateNS<'canvas'>
  readonly board: CanvasBoard
  /** No session, or an archived canvas: the list shows, never changes. */
  readonly readonly: boolean
  readonly crumbs: CanvasDetailCrumbs
  /**
   * Write the whole catalog (stage ⑤). `archiveCardIds` is what retiring a
   * category costs: its cards go to the archive in the same write.
   */
  readonly onWrite: (categories: readonly BoardCategory[], archiveCardIds: readonly string[]) => void
  /** Open one category's type page. */
  readonly onDesign: (kind: CardCategoryId, heading: string) => void
}): ReactNode {
  const [newCat, setNewCat] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  /** The retire question: the category awaiting confirmation, or none. */
  const [retireAsk, setRetireAsk] = useState<BoardCategory | null>(null)

  const visible = board.cards.filter(card => card.status !== 'archived')
  const labels = categoryLabelMap(board.categories, t)
  const counts = new Map<CardCategoryId, number>()
  for (const card of visible) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1)
  const enabled = enabledCategories(board.categories)
  const retired = board.categories.filter(category => !category.enabled)
  /** The cards a retired category would take with it (its visible ones). */
  const cardsOf = (id: CardCategoryId): string[] => visible.filter(card => card.kind === id).map(card => card.id)

  const renameCat = (id: CardCategoryId, label: string): void => {
    onWrite(board.categories.map(category => (category.id === id ? { ...category, label } : category)), [])
  }
  const addCat = (): void => {
    const label = sanitizeCategoryLabel(newCat)
    if (label === undefined) return
    const lastOrder = board.categories.reduce((max, category) => Math.max(max, category.order), 0)
    onWrite([...board.categories, { id: newCategoryId(), label, order: lastOrder + 10, enabled: true }], [])
    setNewCat('')
  }
  const toggleCat = (category: BoardCategory): void => {
    if (category.enabled && cardsOf(category.id).length > 0) {
      setRetireAsk(category)
      return
    }
    onWrite(board.categories.map(row => (row.id === category.id ? { ...row, enabled: !row.enabled } : row)), [])
  }
  const confirmRetire = (): void => {
    if (retireAsk === null) return
    const id = retireAsk.id
    onWrite(board.categories.map(row => (row.id === id ? { ...row, enabled: false } : row)), cardsOf(id))
    setRetireAsk(null)
  }

  const row = (category: BoardCategory): ReactNode => (
    <CategoryRow
      // id AND label: a landed rename remounts the input with the stored
      // text, so nothing here ever disagrees with the board.
      key={`${category.id}:${category.label}`}
      t={t}
      category={category}
      color={categoryColorOf(board.categories, category.id)}
      count={counts.get(category.id) ?? 0}
      readonly={readonly}
      onRename={label => { renameCat(category.id, label) }}
      onToggle={() => { toggleCat(category) }}
      onDesign={() => { onDesign(category.id, labels.get(category.id) ?? category.id) }}
    />
  )

  return (
    <div className={detailCss.root}>
      <div className={detailCss.header}>
        <DetailCrumbs t={t} crumbs={crumbs} here={t('cat.title')} cardId={null} />
        <div className={detailCss.title}>{t('cat.title')}</div>
        {/* Where the list lives is a tooltip, not a line: the meta says only
            what matters while editing — it is this canvas's own. */}
        <div className={detailCss.meta} title={t('cat.stored')}>
          <span>{t('cat.scope')}</span>
          <span>{t('cat.enabledCount', { count: String(enabled.length) })}</span>
        </div>
      </div>

      <div className={css.list}>
        {enabled.length === 0 && <div className={css.empty}>{t('cat.allRetired')}</div>}
        {enabled.map(row)}
        {!readonly && (
          <div className={css.add}>
            <input
              className={css.input}
              type="text"
              value={newCat}
              placeholder={t('cat.addPlaceholder')}
              aria-label={t('cat.add')}
              onChange={event => { setNewCat(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCat()
                }
              }}
            />
            <button
              type="button"
              className={css.toggle}
              disabled={sanitizeCategoryLabel(newCat) === undefined}
              onClick={addCat}
            >
              <IconPlusOutlineMedium size={12} />
              {t('cat.add')}
            </button>
          </div>
        )}
      </div>

      {retired.length > 0 && (
        <>
          <button
            type="button"
            className={css.disclosure}
            aria-expanded={showRetired}
            onClick={() => { setShowRetired(open => !open) }}
          >
            {showRetired ? '▾' : '▸'} {t('cat.retiredSection', { count: String(retired.length) })}
          </button>
          {showRetired && <div className={css.list}>{retired.map(row)}</div>}
        </>
      )}

      {/* The two rules the page acts on, one line each: a rename touches no
          card, and retiring files the cards away (there is deliberately no
          "move them somewhere" picker — the board's 改分类 is). */}
      <ul className={css.tips}>
        <li>{t('cat.tipRename')}</li>
        <li>{t('cat.tipRetire')}</li>
      </ul>

      {/* Retiring a category that still holds cards is the one catalog
          gesture that moves content out of sight, so it asks — with §10.7's
          exact words: kept, restorable, never deleted. */}
      <Modal
        open={retireAsk !== null}
        onClose={() => { setRetireAsk(null) }}
        title={t('confirm.retireTitle')}
        closeLabel={t('confirm.close')}
        description={t('confirm.retireBody', { count: String(retireAsk === null ? 0 : cardsOf(retireAsk.id).length) })}
        footer={
          <>
            <Button size="sm" onClick={() => { setRetireAsk(null) }}>
              {t('confirm.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={confirmRetire}>
              {t('confirm.retire')}
            </Button>
          </>
        }
      />
    </div>
  )
}
