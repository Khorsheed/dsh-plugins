/**
 * The canvas board: the right side of the space page — the topic topbar, the
 * kind filter chips, the selection bar, the card grid (kept cards and the
 * ghost proposal affordance), and the archived well.
 *
 * v2.2 ②: the board is a READER. Every card body click — kept, ghost or
 * archived — opens the detail page, which is the only editor; the in-place
 * card textarea and the board's inline new-card draft are gone (the topbar's
 * ＋新卡 hands the draft to the detail page too). Selection stays a hover
 * checkbox in the card's corner, so the two gestures never fight.
 *
 * The one editor left on the board is the comment box under a card, which
 * follows the pad's invariants through CardTextarea (uncontrolled text, IME
 * composition as a hard stop, `.boardScroll` as the one scroll container).
 *
 * Kind is told by icon + words only, never by colour (the storyboard rule).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconArchiveOutlineMedium, IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronRightOutlineMedium, IconCloseOutlineMedium, IconCodeOutlineMedium, IconLightOutlineMedium, IconLinkOutlineMedium, IconNewChatOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconSparkleMedium, IconTrashOutlineMedium } from '../icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  documentHeadingOf, enabledCategories, isBoardCardKind, isLongCardText,
  makeBoardId, sanitizeCategoryLabel,
  type BoardCard, type BoardCardStatus, type BoardCategory,
  type CanvasBoard, type CardCategoryId,
} from '../../types.ts'
import type {} from '../locales.ts'
import { categoryLabelMap, kindIconOf } from '../category-label.ts'
import { basenameOf } from '../text.ts'
import { FollowUp } from '../follow-up.tsx'
import { firstDrawingOf, withoutDrawLines } from '../../blocks.ts'
import { detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import { DrawFigure } from '../detail/DrawFigure.tsx'
import { CardTextarea } from './CardTextarea.tsx'
import { useDismiss } from '../use-dismiss.ts'
import { MoreMenu } from '../more-menu.tsx'
import css from './board.module.css'

/** The mutations the board can ask for (the page wires them to the Remote). */
export interface BoardActions {
  /** Move one card to a status (kept = accept/restore, archived = reject/archive). */
  setCardStatus: (cardId: string, status: BoardCardStatus) => void
  /** Settle a question card answered (the user's call, always). */
  markAnswered: (cardId: string) => void
  /** Comment on one card. */
  comment: (cardId: string, text: string) => void
  /** Ask to delete one card for good (the page puts the confirmation in front). */
  deleteCard: (cardId: string) => void
  /** Archive every selected card. */
  archiveSelected: () => void
  /** Refile every selected card under another category (the batch bar's 「改分类」). */
  refileSelected: (kind: CardCategoryId) => void
  /**
   * Write this canvas's category catalog (stage ⑤). `archiveCardIds` is what
   * retiring a category costs: its cards go to the archive in the same write.
   */
  setCategories: (categories: readonly BoardCategory[], archiveCardIds: readonly string[]) => void
}

/** The board view's props: the loaded board plus the page-held UI state. */
export interface BoardViewProps {
  readonly t: TranslateNS<'canvas'>
  /** True when no session can fence writes (the board then shows, never mutates). */
  readonly readonly: boolean
  readonly board: CanvasBoard
  readonly filter: 'all' | CardCategoryId
  readonly onFilter: (next: 'all' | CardCategoryId) => void
  readonly selection: ReadonlySet<string>
  readonly onToggleSelect: (cardId: string) => void
  readonly onClearSelection: () => void
  /**
   * Open one card in the detail page — the ONLY editor (v2.2 ②). Kept, ghost
   * and archived cards all take this route; the board itself never edits text.
   */
  readonly onOpenDetail: (cardId: string) => void
  /** Whether the session has an input to quote into (与 Agent 对谈, 开始写作 and 追问 hide without it). */
  readonly talkAvailable: boolean
  /** Quote the current selection into the session's input. */
  readonly onTalk: () => void
  /** Quote the current selection plus the writing instruction (开始写作). */
  readonly onWrite: () => void
  /** Follow up on one comment (card id + the comment's text): quoted into the input too. */
  readonly onFollowUp: (cardId: string, commentText: string) => void
  readonly actions: BoardActions
  readonly showArchived: boolean
  readonly onToggleArchived: () => void
}

/** A fresh custom category id, minted where the panel adds one. */
function newCategoryId(): string {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(8))
  const random = bytes === undefined
    ? Math.random().toString(36).slice(2).padEnd(12, '0')
    : [...bytes].map(byte => byte.toString(36).padStart(2, '0')).join('')
  return makeBoardId('cat', Date.now(), random)
}

/** One comment thread under a card (badge toggle + list + the user's form). */
function CommentThread({ t, card, readonly, talkAvailable, onComment, onFollowUp }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly talkAvailable: boolean
  readonly onComment: (text: string) => void
  readonly onFollowUp: (commentText: string) => void
}): ReactNode {
  return (
    <div className={css.commentThread} onClick={event => { event.stopPropagation() }}>
      {card.comments.map(comment => (
        <span key={comment.id}>
          <span className={comment.author === 'agent' ? css.commentAuthor : undefined}>
            {comment.author === 'agent' ? t('comment.agent') : t('comment.user')}
          </span>
          {'：'}
          {comment.text}
          {comment.author === 'agent' && talkAvailable && (
            <>
              {' '}
              <FollowUp t={t} className={css.followUp} onFollowUp={() => { onFollowUp(comment.text) }} />
            </>
          )}
        </span>
      ))}
      {!readonly && (
        <div className={css.commentForm}>
          <CardTextarea
            // Remounted per comment count, so a sent comment clears the box.
            key={card.comments.length}
            placeholder={t('comment.placeholder')}
            submitOn="enter"
            onSubmit={text => {
              if (text.trim().length === 0) return
              onComment(text)
            }}
          />
        </div>
      )}
    </div>
  )
}

/** A markdown image, anywhere in a line: `![alt](dest)`. */
const IMAGE_MARKDOWN = /!\[[^\]\n]*\]\([^)\n]*\)/g

/** The card's words for the summary: no drawing lines, each image one mark. */
function summaryTextOf(text: string, imageMark: string): string {
  return withoutDrawLines(text).replace(IMAGE_MARKDOWN, imageMark)
}

/** A card's summary: the drawing, the derived heading, the clamped text.
 *  The word count is NOT here — it belongs to the pinned footer, which is
 *  `CardItem`'s (an html card keeps its count inside the placeholder instead). */
function CardSummary({ t, card }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
}): ReactNode {
  // A drawing is content, so the board shows it (demand ④): a card whose body
  // is ink would otherwise read as a card with nothing in it.
  const ink = firstDrawingOf(card.text, card.drawings)
  const thumb = ink.length === 0 ? null : (
    <div className={css.cardDraw}><DrawFigure strokes={ink} /></div>
  )
  // Format wins over kind: an HTML card renders a compact placeholder on the
  // board (the full sandbox render is the detail page's), never the raw markup.
  if (detectCardFormat(card.text) === 'html') {
    return (
      <>
        {thumb}
        <div className={css.cardText}>
          <div className={css.htmlPlaceholder}>
            <IconCodeOutlineMedium size={12} />
            <span>{htmlTitleOf(card.text) ?? t('card.htmlDocument')}</span>
            <span className={css.cardWords}>{t('meta.words', { count: String(card.text.length) })}</span>
          </div>
        </div>
      </>
    )
  }
  // Document cards lead with their derived heading (never the raw `#` opener)
  // and summarize the body that remains after it.
  // The thumbnail stands for the drawings, and an image pointer is not words:
  // the summary reads the text with both said plainly.
  const words = summaryTextOf(card.text, t('card.imageMark'))
  const heading = card.kind === 'document' ? documentHeadingOf(words) : undefined
  return (
    <>
      {thumb}
      {heading !== undefined && <div className={css.docTitle}>{heading.title}</div>}
      <div className={css.cardTextWrap} data-clamped={isLongCardText(card.text) || undefined}>
        <div className={css.cardText}>{heading?.body ?? words}</div>
      </div>
    </>
  )
}

/** One board card: kept, ghost (proposed), or archived-in-the-well. */
function CardItem({ t, card, kindLabel, readonly, selected, archivedWell, talkAvailable, onToggleSelect, onOpenDetail, onFollowUp, actions }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  /** The category's display text (the user's name for it, stage ⑤). */
  readonly kindLabel: string
  readonly readonly: boolean
  readonly selected: boolean
  /** Rendered inside the archived well (open + restore are the only gestures). */
  readonly archivedWell?: boolean
  readonly talkAvailable: boolean
  readonly onToggleSelect: () => void
  readonly onOpenDetail: () => void
  readonly onFollowUp: (commentText: string) => void
  readonly actions: BoardActions
}): ReactNode {
  const [threadOpen, setThreadOpen] = useState(false)
  const KindIcon = kindIconOf(card.kind)
  const proposed = card.status === 'proposed'
  // The pinned footer's word count: the html placeholder already carries its
  // own, so showing it here too would count the same card twice.
  const words = detectCardFormat(card.text) !== 'html' && isLongCardText(card.text)
    ? t('meta.words', { count: String(card.text.length) })
    : null

  return (
    <div
      className={`${css.card}${proposed ? ` ${css.cardGhost}` : ''}`}
      data-selected={selected || undefined}
      onClick={onOpenDetail}
    >
      {!proposed && !archivedWell && !readonly && (
        <button
          type="button"
          className={css.selectBox}
          role="checkbox"
          aria-checked={selected}
          title={t('card.select')}
          aria-label={t('card.select')}
          onClick={event => { event.stopPropagation(); onToggleSelect() }}
        >
          {selected && <IconCheckOutlineMedium size={11} />}
        </button>
      )}
      {proposed && (
        <span className={css.ghostFlag}>
          <IconSparkleMedium size={12} />
          {t('card.proposed')}
        </span>
      )}
      <span className={css.kindTag}>
        {KindIcon !== undefined && <KindIcon size={12} />}
        {kindLabel}
        {card.createdBy === 'agent' && !proposed ? ` · ${t('card.fromAgent')}` : ''}
      </span>

      <CardSummary t={t} card={card} />

      {card.source !== undefined && (
        <div className={css.cardSrc}>
          <IconLinkOutlineMedium size={11} />
          {card.source.type === 'url' ? (
            <a
              href={card.source.ref}
              target="_blank"
              rel="noreferrer"
              onClick={event => { event.stopPropagation() }}
            >
              {card.source.title ?? card.source.ref}
            </a>
          ) : (
            <span title={card.source.ref}>{card.source.title ?? basenameOf(card.source.ref)}</span>
          )}
        </div>
      )}

      {card.kind === 'question' && card.question !== undefined && (
        <div className={css.qState} data-state={card.question.state}>
          <span className={css.qDot} />
          {card.question.state === 'open'
            ? t('q.open')
            : card.question.state === 'exploring'
              ? t('q.exploring')
              : t('q.answered')}
        </div>
      )}

      {readonly ? null : proposed ? (
        <div className={css.ghostActions}>
          <button type="button" className={css.accept} onClick={event => { event.stopPropagation(); actions.setCardStatus(card.id, 'kept') }}>
            <IconCheckOutlineMedium size={12} />
            {t('card.accept')}
          </button>
          <button type="button" onClick={event => { event.stopPropagation(); actions.setCardStatus(card.id, 'archived') }}>
            <IconCloseOutlineMedium size={12} />
            {t('card.reject')}
          </button>
        </div>
      ) : archivedWell ? (
        <div className={css.ghostActions}>
          <button type="button" onClick={() => { actions.setCardStatus(card.id, 'kept') }}>
            <IconRefreshOutlineMedium size={12} />
            {t('card.restore')}
          </button>
          <button type="button" onClick={event => { event.stopPropagation(); actions.deleteCard(card.id) }}>
            <IconTrashOutlineMedium size={12} />
            {t('action.delete')}
          </button>
        </div>
      ) : (
        <div className={css.cardActions}>
          {card.kind === 'question' && card.question?.state !== 'answered' && (
            <button
              type="button"
              className={css.iconButton}
              title={t('card.markAnswered')}
              aria-label={t('card.markAnswered')}
              onClick={event => { event.stopPropagation(); actions.markAnswered(card.id) }}
            >
              <IconCheckOutlineMedium size={13} />
            </button>
          )}
          <MoreMenu
            label={t('action.more')}
            className={css.iconButton}
            items={[
              { id: 'archive', label: t('card.archive'), icon: <IconArchiveOutlineMedium size={13} /> },
              { id: 'delete', label: t('action.delete'), icon: <IconTrashOutlineMedium size={13} />, danger: true },
            ]}
            onSelect={id => {
              if (id === 'archive') actions.setCardStatus(card.id, 'archived')
              else actions.deleteCard(card.id)
            }}
          />
        </div>
      )}

      {/* No comments, no badge: writing the first one is the detail page's job
          (the card opens on a click), so an empty 💬 is only noise. */}
      {(words !== null || (!archivedWell && card.comments.length > 0)) && (
        <div className={css.cardFoot}>
          {words !== null && <span className={css.cardWords}>{words}</span>}
          {!archivedWell && card.comments.length > 0 && (
            <button
              type="button"
              className={css.commentBadge}
              aria-expanded={threadOpen}
              onClick={event => { event.stopPropagation(); setThreadOpen(open => !open) }}
            >
              <IconNewChatOutlineMedium size={11} />
              {card.comments.length === 1
                  ? t('comment.one')
                  : t('comment.many', { count: String(card.comments.length) })}
            </button>
          )}
        </div>
      )}
      {!archivedWell && threadOpen && card.comments.length > 0 && (
        <CommentThread
          t={t}
          card={card}
          readonly={readonly}
          talkAvailable={talkAvailable}
          onComment={text => { actions.comment(card.id, text) }}
          onFollowUp={onFollowUp}
        />
      )}
    </div>
  )
}

/**
 * One row of the category panel: rename in place, retire or bring back. The
 * parent keys this by id AND label, so a committed rename remounts the input
 * with the stored text and no local state ever disagrees with the board.
 */
function CategoryRow({ t, category, count, onRename, onToggle }: {
  readonly t: TranslateNS<'canvas'>
  readonly category: BoardCategory
  readonly count: number
  readonly onRename: (label: string) => void
  readonly onToggle: () => void
}): ReactNode {
  const [text, setText] = useState(category.label)
  const commit = (): void => {
    const label = sanitizeCategoryLabel(text) ?? ''
    setText(label)
    if (label !== category.label) onRename(label)
  }
  return (
    <div className={css.catRow} data-off={category.enabled ? undefined : true}>
      <input
        className={css.catInput}
        type="text"
        value={text}
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
      <span className={css.catCount}>
        {isBoardCardKind(category.id) ? `${t('cat.builtin')} · ` : ''}
        {t('cat.count', { count: String(count) })}
      </span>
      <button
        type="button"
        className={category.enabled ? css.catToggle : `${css.catToggle} ${css.catToggleOn}`}
        onClick={onToggle}
      >
        {category.enabled ? t('cat.disable') : t('cat.enable')}
      </button>
    </div>
  )
}

/**
 * The cards the board shows under one filter, in the order it shows them:
 * the live (non-archived) cards, narrowed to one category unless the filter
 * is 全部. The detail's ‹n/m› steps through exactly this list, so stepping
 * past a card means the card that sat next to it on the board.
 */
export function shownCardsOf(board: CanvasBoard, filter: 'all' | CardCategoryId): readonly BoardCard[] {
  const visible = board.cards.filter(card => card.status !== 'archived')
  return filter === 'all' ? visible : visible.filter(card => card.kind === filter)
}

/** The board view. */
export function BoardView({
  t, readonly, board, filter, onFilter, selection, onToggleSelect, onClearSelection, onOpenDetail,
  talkAvailable, onTalk, onWrite, onFollowUp, actions, showArchived, onToggleArchived,
}: BoardViewProps): ReactNode {
  const [catPanel, setCatPanel] = useState(false)
  /** The batch bar's 「改分类」 row is open (it replaces the action row). */
  const [refile, setRefile] = useState(false)
  const [newCat, setNewCat] = useState('')
  /** The retire question: the category awaiting confirmation, or none. */
  const [retireAsk, setRetireAsk] = useState<BoardCategory | null>(null)
  const catRef = useRef<HTMLDivElement | null>(null)
  const selBarRef = useRef<HTMLDivElement | null>(null)
  // The panel closes like every other floating surface. A rename commits on
  // blur, so the focused field is blurred FIRST — unmounting a focused input
  // does not reliably fire its blur, and the rename would be lost.
  useDismiss(catRef, catPanel && retireAsk === null, () => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && catRef.current?.contains(focused) === true) focused.blur()
    setCatPanel(false)
  })
  useDismiss(selBarRef, refile, () => { setRefile(false) })

  const visible = board.cards.filter(card => card.status !== 'archived')
  const archived = board.cards.filter(card => card.status === 'archived')
  const labels = categoryLabelMap(board.categories, t)
  const counts = new Map<CardCategoryId, number>()
  for (const card of visible) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1)
  const chips = enabledCategories(board.categories)
  const retired = board.categories.filter(category => !category.enabled)
  const shown = shownCardsOf(board, filter)
  // A move only means "somewhere else": when the whole selection already shares
  // one category, that one is the single target worth hiding. A mixed selection
  // hides nothing, because every chip is somewhere for at least one card.
  const selectionKinds = new Set(
    visible.filter(card => selection.has(card.id)).map(card => card.kind),
  )
  const refileTargets = selectionKinds.size === 1
    ? chips.filter(category => category.id !== [...selectionKinds][0])
    : chips

  /** Write a catalog derived from the board's, one row changed. */
  const writeCats = (categories: readonly BoardCategory[], archiveCardIds: readonly string[] = []): void => {
    actions.setCategories(categories, archiveCardIds)
  }

  const renameCat = (id: CardCategoryId, label: string): void => {
    writeCats(board.categories.map(category => (category.id === id ? { ...category, label } : category)))
  }

  const addCat = (): void => {
    const label = sanitizeCategoryLabel(newCat)
    if (label === undefined) return
    const lastOrder = board.categories.reduce((max, category) => Math.max(max, category.order), 0)
    writeCats([...board.categories, { id: newCategoryId(), label, order: lastOrder + 10, enabled: true }])
    setNewCat('')
  }

  /** The cards a retired category would take with it (its visible ones). */
  const cardsOf = (id: CardCategoryId): BoardCard[] => visible.filter(card => card.kind === id)

  const toggleCat = (category: BoardCategory): void => {
    if (category.enabled && cardsOf(category.id).length > 0) {
      setRetireAsk(category)
      return
    }
    writeCats(board.categories.map(row => (row.id === category.id ? { ...row, enabled: !row.enabled } : row)))
  }

  const confirmRetire = (): void => {
    if (retireAsk === null) return
    const id = retireAsk.id
    writeCats(
      board.categories.map(row => (row.id === id ? { ...row, enabled: false } : row)),
      cardsOf(id).map(card => card.id),
    )
    setRetireAsk(null)
    if (filter === id) onFilter('all')
  }

  return (
    <section className={css.main}>
      <div className={css.boardScroll} data-canvas-scroll="board">
        {/* One dismissal root for the chip row AND the panel it opens: the
            manage chip is the panel's trigger, so a click on it toggles. */}
        <div ref={catRef} style={{ display: 'contents' }}>
        <div className={css.chips}>
          <button
            type="button"
            className={css.chip}
            data-active={filter === 'all' || undefined}
            onClick={() => { onFilter('all') }}
          >
            {t('board.filter.all')} <span className={css.chipCount}>{visible.length}</span>
          </button>
          {chips.map(category => {
            const KindIcon = kindIconOf(category.id)
            return (
              <button
                key={category.id}
                type="button"
                className={css.chip}
                data-active={filter === category.id || undefined}
                data-empty={(counts.get(category.id) ?? 0) === 0 || undefined}
                onClick={() => { onFilter(category.id) }}
              >
                {KindIcon !== undefined && <KindIcon size={12} />}
                {labels.get(category.id) ?? category.id}{' '}
                <span className={css.chipCount}>{counts.get(category.id) ?? 0}</span>
              </button>
            )
          })}
          {!readonly && (
            <button
              type="button"
              className={`${css.chip} ${css.chipMgr}`}
              title={t('cat.mgrTitle')}
              aria-expanded={catPanel}
              onClick={() => { setCatPanel(open => !open) }}
            >
              {catPanel ? t('cat.collapse') : t('board.manageCats')}
            </button>
          )}
        </div>

        {catPanel && !readonly && (
          <div className={css.catPanel}>
            <div className={css.catHead}>
              <b>{t('cat.title')}</b>
              <span>
                {t('cat.scope')}
                {' · '}
                <code className={css.catCode}>{t('cat.stored')}</code>
              </span>
            </div>
            {chips.length === 0 && <div className={css.catEmpty}>{t('cat.allRetired')}</div>}
            {chips.map(category => (
              <CategoryRow
                // id AND label: a landed rename remounts the input with the
                // stored text, so nothing here ever disagrees with the board.
                key={`${category.id}:${category.label}`}
                t={t}
                category={category}
                count={counts.get(category.id) ?? 0}
                onRename={label => { renameCat(category.id, label) }}
                onToggle={() => { toggleCat(category) }}
              />
            ))}
            {retired.length > 0 && (
              <div className={css.catEmpty}>
                {t('cat.retiredSection', { count: String(retired.length) })}
              </div>
            )}
            {retired.map(category => (
              <CategoryRow
                key={`${category.id}:${category.label}`}
                t={t}
                category={category}
                count={counts.get(category.id) ?? 0}
                onRename={label => { renameCat(category.id, label) }}
                onToggle={() => { toggleCat(category) }}
              />
            ))}
            <div className={css.catAdd}>
              <input
                className={css.catInput}
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
                className={css.catToggle}
                disabled={sanitizeCategoryLabel(newCat) === undefined}
                onClick={addCat}
              >
                <IconPlusOutlineMedium size={12} />
                {t('cat.add')}
              </button>
            </div>
            {/* The three rules the panel acts on, spelled where they apply:
                a rename touches no card, retiring files the cards away, and
                there is deliberately no "move them somewhere" picker. */}
            <p className={css.catTip}>{t('cat.tip')}</p>
          </div>
        )}
        </div>

        {selection.size > 0 && (
          <div className={css.selBar} ref={selBarRef}>
            <span className={css.selCount}>{t('board.selected', { count: String(selection.size) })}</span>
            {/* The Agent gestures quote the picked cards into the session's
                input; the user says what they want in their own words. */}
            {talkAvailable && !refile && (
              <button type="button" className={css.lensPrimary} onClick={onTalk}>
                {t('talk.action')}
              </button>
            )}
            {talkAvailable && !refile && (
              <button type="button" className={css.lens} onClick={onWrite}>
                {t('talk.write')}
              </button>
            )}
            {!readonly && !refile && (
              <button type="button" className={css.ghostButton} onClick={() => { actions.archiveSelected() }}>
                <IconArchiveOutlineMedium size={12} />
                {t('board.archiveSelected')}
              </button>
            )}
            {!readonly && !refile && (
              <button type="button" className={css.lens} onClick={() => { setRefile(true) }}>
                {t('board.refile')}
              </button>
            )}
            {!readonly && refile && (
              <span className={css.refileTo}>
                {t('board.refileTo', { count: String(selection.size) })}
                {refileTargets.map(category => (
                  <button
                    key={category.id}
                    type="button"
                    className={css.chip}
                    onClick={() => {
                      setRefile(false)
                      actions.refileSelected(category.id)
                    }}
                  >
                    {labels.get(category.id) ?? category.id}
                  </button>
                ))}
                <button type="button" className={css.chip} onClick={() => { setRefile(false) }}>
                  {t('confirm.cancel')}
                </button>
              </span>
            )}
            <span className={css.spacer} />
            <button
              type="button"
              className={css.iconButton}
              title={t('board.clearSelection')}
              aria-label={t('board.clearSelection')}
              onClick={() => { setRefile(false); onClearSelection() }}
            >
              <IconCloseOutlineMedium size={13} />
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className={css.notice}>
            {visible.length === 0 ? (
              <>
                <IconLightOutlineMedium size={16} />
                <br />
                {t('board.empty')}
                <br />
                {t('board.emptyHint')}
              </>
            ) : (
              t('board.emptyFilter', { kind: filter === 'all' ? '' : labels.get(filter) ?? filter })
            )}
          </div>
        ) : (
          <div className={css.grid}>
            {shown.map(card => (
              <CardItem
                key={card.id}
                t={t}
                card={card}
                kindLabel={labels.get(card.kind) ?? card.kind}
                readonly={readonly}
                selected={selection.has(card.id)}
                talkAvailable={talkAvailable}
                onToggleSelect={() => { onToggleSelect(card.id) }}
                onOpenDetail={() => { onOpenDetail(card.id) }}
                onFollowUp={commentText => { onFollowUp(card.id, commentText) }}
                actions={actions}
              />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div>
            <button type="button" className={css.archiveHeader} aria-expanded={showArchived} onClick={() => { onToggleArchived() }}>
              {showArchived ? <IconChevronDownOutlineMedium size={12} /> : <IconChevronRightOutlineMedium size={12} />}
              {t('board.archivedCards', { count: String(archived.length) })}
            </button>
            {showArchived && (
              <div className={css.grid}>
                {archived.map(card => (
                  <CardItem
                    key={card.id}
                    t={t}
                    card={card}
                    kindLabel={labels.get(card.kind) ?? card.kind}
                    readonly={readonly}
                    selected={false}
                    archivedWell
                    talkAvailable={talkAvailable}
                    onToggleSelect={() => {}}
                    onOpenDetail={() => { onOpenDetail(card.id) }}
                    onFollowUp={() => {}}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Retiring a category that still holds cards is the one board gesture
          that moves content out of sight, so it asks — with §10.7's exact
          words: kept, restorable, never deleted. */}
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
    </section>
  )
}
