/**
 * The category catalog read from the client side: the words a `kind` is spelled
 * with, and the icon it carries.
 *
 * Stage ⑤ moved the category set from a compile-time five to a per-canvas
 * list, so `t('kind.fragment')` alone can no longer answer "what is this card
 * filed under" — the user may have renamed it, or invented it. The catalog
 * stays the only source of the name; the dictionary is the fallback for a
 * built-in row nobody renamed (which is what keeps the labels switching with
 * the host language).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  IconCodeOutlineMedium, IconDatabaseOutlineMedium, IconLinkOutlineMedium, IconListPenOutlineMedium,
  IconQuestionOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  defaultCategories, isBoardCardKind, type BoardCardKind, type BoardCategory, type CardCategoryId,
} from '../types.ts'
import type {} from './locales.ts'

/** The built-in kind icon set (icon + words; the storyboard's kind vocabulary).
 *  A custom category carries NO icon: an invented row has no shape to borrow,
 *  and a wrong icon reads as a meaning the user never gave it. */
const KIND_ICONS: Record<BoardCardKind, typeof IconListPenOutlineMedium> = {
  fragment: IconListPenOutlineMedium,
  question: IconQuestionOutlineMedium,
  grounding: IconDatabaseOutlineMedium,
  reference: IconLinkOutlineMedium,
  document: IconCodeOutlineMedium,
}

/** The icon for a category id, when it is one of the built-ins. */
export function kindIconOf(kind: CardCategoryId): typeof IconListPenOutlineMedium | undefined {
  return isBoardCardKind(kind) ? KIND_ICONS[kind] : undefined
}

/** One category's display text: what the user named it, else the dictionary's name. */
export function categoryLabelOf(
  category: BoardCategory,
  t: TranslateNS<'canvas'>,
): string {
  if (category.label !== '') return category.label
  // A custom row always carries its own label (the read fills in the id when a
  // hand-edited file left it blank), so only a built-in can reach here.
  return isBoardCardKind(category.id) ? t(`kind.${category.id}`) : category.id
}

/**
 * The whole catalog as an id → text map, for the views that render a card's
 * kind tag without holding the row itself. The five built-ins are always in
 * the answer (the store's read guarantees a row per card kind, but a board
 * object built in-memory — a test, a future import path — need not have gone
 * through it, and a card that reads as `cat_01j…` is a bug, not a display).
 * @param categories - the board's catalog, any order.
 * @param t - the canvas namespace.
 * @returns one entry per row, retired rows included (their cards still show).
 */
export function categoryLabelMap(
  categories: readonly BoardCategory[],
  t: TranslateNS<'canvas'>,
): Map<CardCategoryId, string> {
  const map = new Map(defaultCategories().map(category => [category.id, categoryLabelOf(category, t)]))
  for (const category of categories) map.set(category.id, categoryLabelOf(category, t))
  return map
}
