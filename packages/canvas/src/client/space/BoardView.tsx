/**
 * The canvas board: the right side of the space page — the topic topbar, the
 * kind filter chips, the selection bar, the card grid (kept cards and the
 * ghost proposal affordance), and the archived well.
 *
 * v2.2 ②: the board is a READER. Every card body click — kept, ghost or
 * archived — opens the detail page, which is the only editor; the in-place
 * card textarea is gone. A new card too: the dashed ＋ tile at the end of the
 * grid (`DraftTile`) opens the draft page. Selection stays a hover
 * checkbox in the card's corner, so the two gestures never fight.
 *
 * The one editor left on the board is the comment box under a card, which
 * follows the pad's invariants through CardTextarea (uncontrolled text, IME
 * composition as a hard stop, `.boardScroll` as the one scroll container).
 *
 * Kind is told by icon + words first; each category also carries a colour dot,
 * an added cue that never names a kind on its own.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useRef, useState, type ReactNode } from 'react'
import { IconArchiveOutlineMedium, IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronRightOutlineMedium, IconCloseOutlineMedium, IconCodeOutlineMedium, IconLinkOutlineMedium, IconListPenOutlineMedium, IconNewChatOutlineMedium, IconRefreshOutlineMedium, IconSparkleMedium, IconTrashOutlineMedium } from '../icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  documentHeadingOf, enabledCategories, isLongCardText,
  type BoardCard, type BoardCardStatus, type BoardCategory,
  type CanvasBoard, type CardCategoryId,
} from '../../types.ts'
import type {} from '../locales.ts'
import { categoryColorOf, categoryLabelMap, kindIconOf } from '../category-label.ts'
import { basenameOf } from '../text.ts'
import { FollowUp } from '../follow-up.tsx'
import { firstDrawingOf, withoutDrawLines } from '../../blocks.ts'
import { cardNameOf, detectCardFormat, htmlTitleOf, opensWithHeading } from '../../card-format.ts'
import { typedTitleOf, type TypeDefinition } from '../../card-types.ts'
import { TypedFace, type CardNameOf } from '../type/fields.tsx'
import { withHtmlBlocksMarked } from '../../html-blocks.ts'
import { DrawFigure } from '../detail/DrawFigure.tsx'
import { CardTextarea } from './CardTextarea.tsx'
import { DraftTile, type NewCardSlot } from './DraftTile.tsx'
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
  /** Open one category's type page (card types, P1a): its brief, proposal and definition. */
  openType: (kind: CardCategoryId, heading: string) => void
  /** Open this canvas's category page (rename, add, retire, each kind's type page). */
  openCategories: () => void
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
  /** The new-card slot at the end of the grid; absent on a read-only board. */
  readonly newCard?: NewCardSlot | undefined
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

/** The card's words for the summary: no drawing lines, each image and each HTML block one mark. */
function summaryTextOf(text: string, imageMark: string, htmlMark: string): string {
  return withHtmlBlocksMarked(withoutDrawLines(text), htmlMark).replace(IMAGE_MARKDOWN, imageMark)
}

/**
 * What a typed face shows under its title while the card's fields are still
 * empty: the body, minus the name the title already says. Shared with the
 * type page's card grid, so the two draw one face.
 */
export function typedExcerptOf(t: TranslateNS<'canvas'>, card: BoardCard): string {
  const words = summaryTextOf(card.text, t('card.imageMark'), t('card.htmlMark'))
  const name = cardNameOf(card)
  return words.startsWith(name) ? words.slice(name.length).trim() : words
}

/** Whether the first non-empty line is a markdown heading (`# …` to `###### …`). */

/** A card's summary: the drawing, the derived heading, the clamped text.
 *  The word count is NOT here — it belongs to the pinned footer, which is
 *  `CardItem`'s (an html card keeps its count inside the placeholder instead). */
function CardSummary({ t, card, definition, nameOf }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  /** The card's type, when its category has an adopted one. */
  readonly definition?: TypeDefinition | undefined
  readonly nameOf: CardNameOf
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
  // Every card of a profile or entry kind draws the one face — a card whose
  // fields are still empty (filed before the type) lets its body stand in, so
  // a kind never shows two looks at once.
  const values = card.fields ?? {}
  if (definition !== undefined && definition.layout !== 'note') {
    return (
      <>
        {thumb}
        <TypedFace t={t} definition={definition} values={values} nameOf={nameOf} fallbackTitle={cardNameOf(card)} excerpt={typedExcerptOf(t, card)} />
      </>
    )
  }
  const typedTitle = typedTitleOf(definition, values)
  // The thumbnail stands for the drawings, and an image pointer is not words:
  // the summary reads the text with both said plainly.
  const words = summaryTextOf(card.text, t('card.imageMark'), t('card.htmlMark'))
  // Document cards lead with their derived heading (never the raw `#` opener)
  // and summarize the body that remains after it; any other card does the
  // same when it OPENS with a markdown heading, so a note never shows `# `.
  const heading = card.kind === 'document' || opensWithHeading(words) ? documentHeadingOf(words) : undefined
  return (
    <>
      {thumb}
      {typedTitle !== '' ? <div className={css.docTitle}>{typedTitle}</div>
        : heading !== undefined && <div className={css.docTitle}>{heading.title}</div>}
      <div className={css.cardTextWrap} data-clamped={isLongCardText(card.text) || undefined}>
        <div className={css.cardText}>{heading?.body ?? words}</div>
      </div>
    </>
  )
}

/** One board card: kept, ghost (proposed), or archived-in-the-well. */
function CardItem({ t, card, definition, nameOf, kindLabel, kindColor, readonly, selected, archivedWell, talkAvailable, onToggleSelect, onOpenDetail, onFollowUp, actions }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly definition?: TypeDefinition | undefined
  readonly nameOf: CardNameOf
  /** The category's display text (the user's name for it, stage ⑤). */
  readonly kindLabel: string
  /** The category's dot colour (`categoryColorOf`). */
  readonly kindColor: string
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
        <span className={css.catDot} style={{ background: kindColor }} />
        {KindIcon !== undefined && <KindIcon size={12} />}
        {kindLabel}
        {card.createdBy === 'agent' && !proposed ? ` · ${t('card.fromAgent')}` : ''}
      </span>

      <CardSummary t={t} card={card} definition={definition} nameOf={nameOf} />

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
  talkAvailable, onTalk, onWrite, onFollowUp, actions, showArchived, onToggleArchived, newCard,
}: BoardViewProps): ReactNode {
  /** The batch bar's 「改分类」 row is open (it replaces the action row). */
  const [refile, setRefile] = useState(false)
  const selBarRef = useRef<HTMLDivElement | null>(null)
  useDismiss(selBarRef, refile, () => { setRefile(false) })

  const visible = board.cards.filter(card => card.status !== 'archived')
  const archived = board.cards.filter(card => card.status === 'archived')
  const labels = categoryLabelMap(board.categories, t)
  const counts = new Map<CardCategoryId, number>()
  for (const card of visible) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1)
  const chips = enabledCategories(board.categories)
  const shown = shownCardsOf(board, filter)
  const draftKind: CardCategoryId = filter !== 'all' && chips.some(category => category.id === filter)
    ? filter
    : chips[0]?.id ?? 'fragment'
  // A move only means "somewhere else": when the whole selection already shares
  // one category, that one is the single target worth hiding. A mixed selection
  // hides nothing, because every chip is somewhere for at least one card.
  const selectionKinds = new Set(
    visible.filter(card => selection.has(card.id)).map(card => card.kind),
  )
  const refileTargets = selectionKinds.size === 1
    ? chips.filter(category => category.id !== [...selectionKinds][0])
    : chips

  const definitionOf = (kind: CardCategoryId): TypeDefinition | undefined =>
    board.categories.find(category => category.id === kind)?.definition
  const nameOf: CardNameOf = cardId => {
    const card = board.cards.find(row => row.id === cardId)
    if (card === undefined) return undefined
    return typedTitleOf(definitionOf(card.kind), card.fields) || cardNameOf(card) || card.id
  }

  return (
    <section className={css.main}>
      <div className={css.boardScroll} data-canvas-scroll="board">
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
                <span className={css.catDot} style={{ background: categoryColorOf(board.categories, category.id) }} />
                {KindIcon !== undefined && <KindIcon size={12} />}
                {labels.get(category.id) ?? category.id}{' '}
                <span className={css.chipCount}>{counts.get(category.id) ?? 0}</span>
                {(category.proposal !== undefined || category.draft === true) && (
                  <span className={css.chipPending} title={t('type.pending')} />
                )}
              </button>
            )
          })}
          {!readonly && (
            <button
              type="button"
              className={`${css.chip} ${css.chipMgr}`}
              title={t('cat.mgrTitle')}
              onClick={() => { actions.openCategories() }}
            >
              {t('board.manageCats')}
            </button>
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
                    <span className={css.catDot} style={{ background: categoryColorOf(board.categories, category.id) }} />
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

        {/* A board or filter that can take a card says so in the ＋ tile alone
            (one empty style to keep); the notice is for the ones that cannot. */}
        {shown.length === 0 && !(newCard !== undefined && chips.length > 0) && (
          <div className={css.notice}>
            {visible.length === 0 ? (
              <>
                <IconListPenOutlineMedium size={16} />
                <br />
                {t('board.empty')}
              </>
            ) : (
              t('board.emptyFilter', { kind: filter === 'all' ? '' : labels.get(filter) ?? filter })
            )}
          </div>
        )}
        {(shown.length > 0 || newCard !== undefined) && (
          <div className={css.grid}>
            {shown.map(card => (
              <CardItem
                key={card.id}
                t={t}
                card={card}
                definition={definitionOf(card.kind)}
                nameOf={nameOf}
                kindLabel={labels.get(card.kind) ?? card.kind}
                kindColor={categoryColorOf(board.categories, card.kind)}
                readonly={readonly}
                selected={selection.has(card.id)}
                talkAvailable={talkAvailable}
                onToggleSelect={() => { onToggleSelect(card.id) }}
                onOpenDetail={() => { onOpenDetail(card.id) }}
                onFollowUp={commentText => { onFollowUp(card.id, commentText) }}
                actions={actions}
              />
            ))}
            {newCard !== undefined && chips.length > 0 && (
              <DraftTile
                t={t}
                slot={newCard}
                labels={labels}
                defaultKind={draftKind}
                empty={visible.length === 0}
              />
            )}
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
                    definition={definitionOf(card.kind)}
                    nameOf={nameOf}
                    kindLabel={labels.get(card.kind) ?? card.kind}
                    kindColor={categoryColorOf(board.categories, card.kind)}
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

    </section>
  )
}
