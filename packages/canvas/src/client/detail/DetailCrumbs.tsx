/**
 * The card page's breadcrumb row and its category control (scheme B,
 * 2026-09-27 review).
 *
 * The strip above holds canvases only, so a card page needs its own way back
 * and a sense of where it sits: ‹ back · the canvas's name / the card's name,
 * then ‹n/m› through the board's order and the card's ⋯. The row reads as the
 * host's own toolbars do — borderless 28px icon buttons that stay pale at rest
 * and fill on hover (the sidebar browser's `.tool`), host `Tooltip`s — with the
 * canvas name set quieter than the card name, because the card is where you
 * are and the canvas is where you go back to. The category is no longer the
 * crumb's label (a card is named by its first line, not by its kind); it moves
 * to the meta row as a host `Tag` that opens a host `Menu` to re-file the card.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type ReactNode } from 'react'
import { Menu, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { enabledCategories, type BoardCategory, type CardCategoryId } from '../../types.ts'
import { categoryLabelOf, kindIconOf } from '../category-label.ts'
import type { CanvasDetailCrumbs } from '../contract.ts'
import {
  IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronLeftOutlineMedium, IconChevronRightOutlineMedium,
} from '../icons.tsx'
import type {} from '../locales.ts'
import css from './CanvasDetailView.module.css'

/**
 * The breadcrumb row.
 * @param props.here - the current card's name (or the draft's), truncated by CSS.
 * @param props.cardId - the card on show; `null` for the draft, which has no place in the order.
 * @param props.trailing - the card's ⋯, pinned to the row's end.
 */
export function DetailCrumbs({ t, crumbs, here, cardId, trailing }: {
  readonly t: TranslateNS<'canvas'>
  readonly crumbs: CanvasDetailCrumbs
  readonly here: string
  readonly cardId: string | null
  readonly trailing?: ReactNode
}): ReactNode {
  const count = crumbs.siblings.length
  const at = cardId === null ? -1 : crumbs.siblings.indexOf(cardId)
  const prev = at > 0 ? crumbs.siblings[at - 1] : undefined
  const next = at >= 0 && at < count - 1 ? crumbs.siblings[at + 1] : undefined
  return (
    <nav className={css.crumbs} aria-label={t('crumb.label')}>
      <Tooltip label={t('crumb.back')} side="bottom" portal>
        <button type="button" className={css.tool} aria-label={t('crumb.back')} onClick={crumbs.onBack}>
          <IconChevronLeftOutlineMedium size={16} />
        </button>
      </Tooltip>
      <span className={css.crumbTrail}>
        <button type="button" className={css.crumbCanvas} title={crumbs.canvasTitle} onClick={crumbs.onBack}>
          {crumbs.canvasTitle}
        </button>
        <span className={css.crumbSep} aria-hidden="true">/</span>
        <span className={css.crumbHere} title={here} aria-current="page">{here}</span>
      </span>
      {/* One card alone has nowhere to step, and a card the board is not
          showing (archived, or filtered away) has no neighbours to name. */}
      {at >= 0 && count > 1 && (
        <span className={css.stepper} role="group" aria-label={t('crumb.step', { at: String(at + 1), count: String(count) })}>
          <Tooltip label={t('crumb.prev')} side="bottom" portal disabled={prev === undefined}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('crumb.prev')}
              disabled={prev === undefined}
              onClick={() => { if (prev !== undefined) crumbs.onStep(prev) }}
            >
              <IconChevronLeftOutlineMedium size={14} />
            </button>
          </Tooltip>
          <span className={css.stepCount}>{`${at + 1}/${count}`}</span>
          <Tooltip label={t('crumb.next')} side="bottom" portal disabled={next === undefined}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('crumb.next')}
              disabled={next === undefined}
              onClick={() => { if (next !== undefined) crumbs.onStep(next) }}
            >
              <IconChevronRightOutlineMedium size={14} />
            </button>
          </Tooltip>
        </span>
      )}
      {trailing}
    </nav>
  )
}

/**
 * The card's category as a host `Tag`; when the card can be re-filed, the tag
 * is the trigger of a host `Menu` over this canvas's enabled categories.
 * @param props.kind - the card's current category.
 * @param props.onPick - re-file the card; omitted, the tag only reads.
 */
export function KindTag({ t, kind, categories, labels, suffix, onPick }: {
  readonly t: TranslateNS<'canvas'>
  readonly kind: CardCategoryId
  readonly categories: readonly BoardCategory[]
  readonly labels: ReadonlyMap<string, string>
  /** Quiet words after the category (「来自 Agent」). */
  readonly suffix?: string | undefined
  readonly onPick?: ((kind: CardCategoryId, label: string) => void) | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  const KindIcon = kindIconOf(kind)
  const tag = (
    <Tag tone="neutral" className={css.kindChip}>
      {KindIcon !== undefined && <KindIcon size={12} />}
      {labels.get(kind) ?? kind}
      {onPick !== undefined && <IconChevronDownOutlineMedium size={11} />}
    </Tag>
  )
  const quiet = suffix === undefined ? null : <span className={css.kindSuffix}>{suffix}</span>
  if (onPick === undefined) {
    return <span className={css.kindRow}>{tag}{quiet}</span>
  }
  const rows = enabledCategories(categories)
  return (
    <span className={css.kindRow}>
      <Menu
        open={open}
        portal
        dense
        items={rows.map(category => {
          const Icon = kindIconOf(category.id)
          return {
            id: category.id,
            label: categoryLabelOf(category, t),
            icon: category.id === kind
              ? <IconCheckOutlineMedium size={14} />
              : Icon === undefined ? <span className={css.menuIconSlot} /> : <Icon size={14} />,
          }
        })}
        onSelect={id => {
          setOpen(false)
          const picked = rows.find(category => category.id === id)
          if (picked === undefined || picked.id === kind) return
          onPick(picked.id, categoryLabelOf(picked, t))
        }}
        onClose={() => { setOpen(false) }}
        anchor={(
          <button
            type="button"
            className={css.kindTrigger}
            title={t('crumb.kind')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {tag}
          </button>
        )}
      />
      {quiet}
    </span>
  )
}
