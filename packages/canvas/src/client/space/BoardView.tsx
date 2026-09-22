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
import { useState, type ReactNode } from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconCodeOutline16, IconDatabaseOutline16, IconEditOutline16,
  IconLightOutline16, IconLinkOutline14, IconListPenOutline16,
  IconNewChatOutline16, IconQuestionOutline14, IconRefreshOutline14,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  BOARD_CARD_KINDS, CANVAS_LENS_IDS, documentHeadingOf, isLongCardText,
  type BoardCard, type BoardCardKind, type BoardCardStatus, type CanvasBoard, type CanvasLensId,
} from '../../types.ts'
import type {} from '../locales.ts'
import { detectCardFormat, htmlTitleOf } from '../../card-format.ts'
import { DrawFigure } from '../detail/DrawFigure.tsx'
import { CardTextarea } from './CardTextarea.tsx'
import css from './board.module.css'

/** The mutations the board can ask for (the page wires them to the Remote). */
export interface BoardActions {
  /** Move one card to a status (kept = accept/restore, archived = reject/archive). */
  setCardStatus: (cardId: string, status: BoardCardStatus) => void
  /** Settle a question card answered (the user's call, always). */
  markAnswered: (cardId: string) => void
  /** Comment on one card. */
  comment: (cardId: string, text: string) => void
  /** Archive every selected card. */
  archiveSelected: () => void
}

/** The board view's props: the loaded board plus the page-held UI state. */
export interface BoardViewProps {
  readonly t: TranslateNS<'canvas'>
  /** True when no session can fence writes (the board then shows, never mutates). */
  readonly readonly: boolean
  readonly board: CanvasBoard
  readonly filter: 'all' | BoardCardKind
  readonly onFilter: (next: 'all' | BoardCardKind) => void
  readonly selection: ReadonlySet<string>
  readonly onToggleSelect: (cardId: string) => void
  readonly onClearSelection: () => void
  /**
   * Open one card in the detail page — the ONLY editor (v2.2 ②). Kept, ghost
   * and archived cards all take this route; the board itself never edits text.
   */
  readonly onOpenDetail: (cardId: string) => void
  /** Whether the side-chat seam answered the probe (the lens bar and 追问 hide without it). */
  readonly chatAvailable: boolean
  /** Ask the canvas's agent through one lens over the current selection. */
  readonly onAsk: (lens: CanvasLensId) => void
  /** Follow up on one comment (card id + the comment's text). */
  readonly onFollowUp: (cardId: string, commentText: string) => void
  readonly actions: BoardActions
  readonly showArchived: boolean
  readonly onToggleArchived: () => void
}

/** The kind icon set (icon + words; the storyboard's kind vocabulary). */
const KIND_ICONS = {
  fragment: IconListPenOutline16,
  question: IconQuestionOutline14,
  grounding: IconDatabaseOutline16,
  reference: IconLinkOutline14,
  document: IconCodeOutline16,
} as const

/** The last path segment, separators from either platform (display only). */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(segment => segment.length > 0)
  return parts[parts.length - 1] ?? path
}

/** One comment thread under a card (badge toggle + list + the user's form). */
function CommentThread({ t, card, readonly, chatAvailable, onComment, onFollowUp }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly chatAvailable: boolean
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
          {comment.author === 'agent' && chatAvailable && (
            <>
              {' '}
              <button
                type="button"
                className={css.followUp}
                onClick={() => { onFollowUp(comment.text) }}
              >
                {t('chat.followup')} →
              </button>
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

/** A card's summary: the clamped text, the fade for long texts, the word count. */
function CardSummary({ t, card }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
}): ReactNode {
  // A drawing is content, so the board shows it (demand ④): a card whose body
  // is ink would otherwise read as a card with nothing in it.
  const ink = card.draw ?? []
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
            <IconCodeOutline16 size={12} />
            <span>{htmlTitleOf(card.text) ?? t('card.htmlDocument')}</span>
            <span className={css.cardWords}>{t('meta.words', { count: String(card.text.length) })}</span>
          </div>
        </div>
      </>
    )
  }
  const long = isLongCardText(card.text)
  // Document cards lead with their derived heading (never the raw `#` opener)
  // and summarize the body that remains after it.
  const heading = card.kind === 'document' ? documentHeadingOf(card.text) : undefined
  return (
    <>
      {thumb}
      {heading !== undefined && <div className={css.docTitle}>{heading.title}</div>}
      <div className={css.cardTextWrap} data-clamped={long || undefined}>
        <div className={css.cardText}>{heading?.body ?? card.text}</div>
      </div>
      {long && <div className={css.cardWords}>{t('meta.words', { count: String(card.text.length) })}</div>}
    </>
  )
}

/** One board card: kept, ghost (proposed), or archived-in-the-well. */
function CardItem({ t, card, readonly, selected, archivedWell, chatAvailable, onToggleSelect, onOpenDetail, onFollowUp, actions }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly selected: boolean
  /** Rendered inside the archived well (open + restore are the only gestures). */
  readonly archivedWell?: boolean
  readonly chatAvailable: boolean
  readonly onToggleSelect: () => void
  readonly onOpenDetail: () => void
  readonly onFollowUp: (commentText: string) => void
  readonly actions: BoardActions
}): ReactNode {
  const [threadOpen, setThreadOpen] = useState(false)
  const KindIcon = KIND_ICONS[card.kind]
  const proposed = card.status === 'proposed'

  return (
    <div
      className={`${css.card}${proposed ? ` ${css.cardGhost}` : ''}`}
      data-selected={selected || undefined}
      onClick={onOpenDetail}
    >
      {!proposed && !archivedWell && (
        <button
          type="button"
          className={css.selectBox}
          role="checkbox"
          aria-checked={selected}
          title={t('card.select')}
          aria-label={t('card.select')}
          onClick={event => { event.stopPropagation(); onToggleSelect() }}
        >
          {selected && <IconCheckOutline16 size={11} />}
        </button>
      )}
      {proposed && (
        <span className={css.ghostFlag}>
          <IconSparkle16 size={12} />
          {t('card.proposed')}
        </span>
      )}
      <span className={css.kindTag}>
        <KindIcon size={12} />
        {t(`kind.${card.kind}`)}
        {card.createdBy === 'agent' && !proposed ? ` · ${t('card.fromAgent')}` : ''}
      </span>

      <CardSummary t={t} card={card} />

      {card.source !== undefined && (
        <div className={css.cardSrc}>
          <IconLinkOutline14 size={11} />
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

      {proposed ? (
        <div className={css.ghostActions}>
          <button type="button" className={css.accept} onClick={event => { event.stopPropagation(); actions.setCardStatus(card.id, 'kept') }}>
            <IconCheckOutline16 size={12} />
            {t('card.accept')}
          </button>
          <button type="button" onClick={event => { event.stopPropagation(); actions.setCardStatus(card.id, 'archived') }}>
            <IconCloseOutline16 size={12} />
            {t('card.reject')}
          </button>
        </div>
      ) : archivedWell ? (
        <div className={css.ghostActions}>
          <button type="button" onClick={() => { actions.setCardStatus(card.id, 'kept') }}>
            <IconRefreshOutline14 size={12} />
            {t('card.restore')}
          </button>
        </div>
      ) : (
        !readonly && (
          <div className={css.cardActions}>
            <button
              type="button"
              className={css.iconButton}
              title={t('card.enterDetail')}
              aria-label={t('card.enterDetail')}
              onClick={event => { event.stopPropagation(); onOpenDetail() }}
            >
              <IconEditOutline16 size={13} />
            </button>
            {card.kind === 'question' && card.question?.state !== 'answered' && (
              <button
                type="button"
                className={css.iconButton}
                title={t('card.markAnswered')}
                aria-label={t('card.markAnswered')}
                onClick={event => { event.stopPropagation(); actions.markAnswered(card.id) }}
              >
                <IconCheckOutline16 size={13} />
              </button>
            )}
            <button
              type="button"
              className={css.iconButton}
              title={t('card.archive')}
              aria-label={t('card.archive')}
              onClick={event => { event.stopPropagation(); actions.setCardStatus(card.id, 'archived') }}
            >
              <IconArchiveOutline20 size={13} />
            </button>
          </div>
        )
      )}

      {!archivedWell && (
        <>
          <button
            type="button"
            className={css.commentBadge}
            aria-expanded={threadOpen}
            onClick={event => { event.stopPropagation(); setThreadOpen(open => !open) }}
          >
            <IconNewChatOutline16 size={11} />
            {card.comments.length === 0
              ? t('comment.write')
              : card.comments.length === 1
                ? t('comment.one')
                : t('comment.many', { count: String(card.comments.length) })}
          </button>
          {threadOpen && (
            <CommentThread
              t={t}
              card={card}
              readonly={readonly}
              chatAvailable={chatAvailable}
              onComment={text => { actions.comment(card.id, text) }}
              onFollowUp={onFollowUp}
            />
          )}
        </>
      )}
    </div>
  )
}

/** The board view. */
export function BoardView({
  t, readonly, board, filter, onFilter, selection, onToggleSelect, onClearSelection, onOpenDetail,
  chatAvailable, onAsk, onFollowUp, actions, showArchived, onToggleArchived,
}: BoardViewProps): ReactNode {

  const visible = board.cards.filter(card => card.status !== 'archived')
  const archived = board.cards.filter(card => card.status === 'archived')
  const counts = new Map<BoardCardKind, number>()
  for (const card of visible) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1)
  const shown = filter === 'all' ? visible : visible.filter(card => card.kind === filter)

  return (
    <section className={css.main}>
      <div className={css.boardScroll}>
        <div className={css.chips}>
          <button
            type="button"
            className={css.chip}
            data-active={filter === 'all' || undefined}
            onClick={() => { onFilter('all') }}
          >
            {t('board.filter.all')} <span className={css.chipCount}>{visible.length}</span>
          </button>
          {BOARD_CARD_KINDS.map(kind => {
            const KindIcon = KIND_ICONS[kind]
            return (
              <button
                key={kind}
                type="button"
                className={css.chip}
                data-active={filter === kind || undefined}
                onClick={() => { onFilter(kind) }}
              >
                <KindIcon size={12} />
                {t(`kind.${kind}`)} <span className={css.chipCount}>{counts.get(kind) ?? 0}</span>
              </button>
            )
          })}
        </div>

        {selection.size > 0 && (
          <div className={css.selBar}>
            <span className={css.selCount}>{t('board.selected', { count: String(selection.size) })}</span>
            {chatAvailable && CANVAS_LENS_IDS.map(lens => (
              <button
                key={lens}
                type="button"
                className={lens === 'ask' ? css.lensPrimary : css.lens}
                onClick={() => { onAsk(lens) }}
              >
                {t(`lens.${lens}`)}
              </button>
            ))}
            {!readonly && (
              <button type="button" className={css.ghostButton} onClick={() => { actions.archiveSelected() }}>
                <IconArchiveOutline20 size={12} />
                {t('board.archiveSelected')}
              </button>
            )}
            <span className={css.spacer} />
            <button
              type="button"
              className={css.iconButton}
              title={t('board.clearSelection')}
              aria-label={t('board.clearSelection')}
              onClick={() => { onClearSelection() }}
            >
              <IconCloseOutline16 size={13} />
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className={css.notice}>
            {visible.length === 0 ? (
              <>
                <IconLightOutline16 size={16} />
                <br />
                {t('board.empty')}
                <br />
                {t('board.emptyHint')}
              </>
            ) : (
              t('board.emptyFilter', { kind: filter === 'all' ? '' : t(`kind.${filter}`) })
            )}
          </div>
        ) : (
          <div className={css.grid}>
            {shown.map(card => (
              <CardItem
                key={card.id}
                t={t}
                card={card}
                readonly={readonly}
                selected={selection.has(card.id)}
                chatAvailable={chatAvailable}
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
              {showArchived ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
              {t('board.archivedCards', { count: String(archived.length) })}
            </button>
            {showArchived && (
              <div className={css.grid}>
                {archived.map(card => (
                  <CardItem
                    key={card.id}
                    t={t}
                    card={card}
                    readonly={readonly}
                    selected={false}
                    archivedWell
                    chatAvailable={chatAvailable}
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
