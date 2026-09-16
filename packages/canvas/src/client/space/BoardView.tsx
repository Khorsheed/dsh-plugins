/**
 * The canvas board: the right side of the space page — the topic topbar, the
 * kind filter chips, the selection bar, the card grid (kept cards, the ghost
 * proposal affordance, the new-card draft), and the archived well.
 *
 * M1.5's summary/detail split: every card renders a SUMMARY — clamped at
 * ~6 lines with a fade and a word count for long texts, and document cards
 * lead with their derived heading instead of the raw `#` opener. Clicking a
 * card body opens the card in the right-Sidebar detail reader; selection is
 * a hover checkbox in the card's corner, so the two gestures never fight.
 *
 * Text editing follows the pad's three invariants exactly (see
 * CardTextarea.tsx): uncontrolled textareas, IME composition as a hard stop,
 * and `.boardScroll` as the one scroll container.
 *
 * Kind is told by icon + words only, never by colour (the storyboard rule).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type ReactNode } from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconCodeOutline16, IconDatabaseOutline16, IconEditOutline16,
  IconFolderOpenOutline16, IconLightOutline16, IconLinkOutline14, IconListPenOutline16,
  IconNewChatOutline16, IconPlusOutline16, IconQuestionOutline14, IconRefreshOutline14,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  BOARD_CARD_KINDS, documentHeadingOf, isLongCardText,
  type BoardCard, type BoardCardKind, type BoardCardStatus, type CanvasBoard,
} from '../../types.ts'
import type {} from '../locales.ts'
import { CardTextarea } from './CardTextarea.tsx'
import css from './CanvasSpacePage.module.css'

/** The mutations the board can ask for (the page wires them to the Remote). */
export interface BoardActions {
  /** Create the draft card (the ＋新卡 flow); an empty text discards instead. */
  submitDraft: (text: string) => void
  /** Save one card's edited text. */
  saveCard: (cardId: string, text: string) => void
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
  /** Open one card in the right-Sidebar detail reader (a body click). */
  readonly onOpenDetail: (cardId: string) => void
  readonly editingId: string | null
  readonly onEditingChange: (cardId: string | null) => void
  readonly draftKind: BoardCardKind | null
  readonly onDraftKindChange: (kind: BoardCardKind | null) => void
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
function CommentThread({ t, card, readonly, onComment }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly onComment: (text: string) => void
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
  const long = isLongCardText(card.text)
  // Document cards lead with their derived heading (never the raw `#` opener)
  // and summarize the body that remains after it.
  const heading = card.kind === 'document' ? documentHeadingOf(card.text) : undefined
  return (
    <>
      {heading !== undefined && <div className={css.docTitle}>{heading.title}</div>}
      <div className={css.cardTextWrap} data-clamped={long || undefined}>
        <div className={css.cardText}>{heading?.body ?? card.text}</div>
      </div>
      {long && <div className={css.cardWords}>{t('meta.words', { count: String(card.text.length) })}</div>}
    </>
  )
}

/** One board card: kept, ghost (proposed), or archived-in-the-well. */
function CardItem({ t, card, readonly, selected, editing, archivedWell, onToggleSelect, onOpenDetail, onEditingChange, actions }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly selected: boolean
  readonly editing: boolean
  /** Rendered inside the archived well (restore is the only gesture). */
  readonly archivedWell?: boolean
  readonly onToggleSelect: () => void
  readonly onOpenDetail: () => void
  readonly onEditingChange: (cardId: string | null) => void
  readonly actions: BoardActions
}): ReactNode {
  const [threadOpen, setThreadOpen] = useState(false)
  const KindIcon = KIND_ICONS[card.kind]
  const proposed = card.status === 'proposed'

  return (
    <div
      className={`${css.card}${proposed ? ` ${css.cardGhost}` : ''}`}
      data-selected={selected || undefined}
      onClick={archivedWell || editing ? undefined : onOpenDetail}
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

      {editing ? (
        <div onClick={event => { event.stopPropagation() }}>
          <CardTextarea
            defaultValue={card.text}
            submitOn="mod-enter"
            autoFocus
            onSubmit={text => {
              const trimmed = text.trim()
              if (trimmed.length > 0 && trimmed !== card.text) actions.saveCard(card.id, trimmed)
              onEditingChange(null)
            }}
            onCancel={() => { onEditingChange(null) }}
          />
          <span className={css.editHint}>{t('card.editHint')}</span>
        </div>
      ) : (
        <CardSummary t={t} card={card} />
      )}

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
        !readonly && !editing && (
          <div className={css.cardActions}>
            <button
              type="button"
              className={css.iconButton}
              title={t('card.edit')}
              aria-label={t('card.edit')}
              onClick={event => { event.stopPropagation(); onEditingChange(card.id) }}
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
            <CommentThread t={t} card={card} readonly={readonly} onComment={text => { actions.comment(card.id, text) }} />
          )}
        </>
      )}
    </div>
  )
}

/** The board view. */
export function BoardView({
  t, readonly, board, filter, onFilter, selection, onToggleSelect, onClearSelection, onOpenDetail,
  editingId, onEditingChange, draftKind, onDraftKindChange, actions, showArchived, onToggleArchived,
}: BoardViewProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)

  const visible = board.cards.filter(card => card.status !== 'archived')
  const archived = board.cards.filter(card => card.status === 'archived')
  const counts = new Map<BoardCardKind, number>()
  for (const card of visible) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1)
  const shown = filter === 'all' ? visible : visible.filter(card => card.kind === filter)

  return (
    <section className={css.main}>
      <header className={css.topbar}>
        <span className={css.topic}>{board.title}</span>
        {board.attachedWorkspaces.map(workspace => (
          <span key={workspace} className={css.attachChip} title={workspace}>
            <IconFolderOpenOutline16 size={12} />
            <b>{basenameOf(workspace)}</b>
          </span>
        ))}
        <span className={css.spacer} />
        {readonly && <span className={css.readonlyHint}>{t('space.readonly')}</span>}
      </header>

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
          <span className={css.spacer} />
          {!readonly && (
            <span style={{ position: 'relative' }}>
              <button
                type="button"
                className={css.newButton}
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(open => !open) }}
              >
                <IconPlusOutline16 size={12} />
                {t('board.newCard')}
              </button>
              {menuOpen && (
                <div className={css.menu}>
                  {BOARD_CARD_KINDS.map(kind => {
                    const KindIcon = KIND_ICONS[kind]
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={css.menuItem}
                        onClick={() => { setMenuOpen(false); onDraftKindChange(kind) }}
                      >
                        <KindIcon size={12} />
                        {t(`kind.${kind}`)}
                      </button>
                    )
                  })}
                </div>
              )}
            </span>
          )}
        </div>

        {selection.size > 0 && (
          <div className={css.selBar}>
            <span className={css.selCount}>{t('board.selected', { count: String(selection.size) })}</span>
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

        {shown.length === 0 && draftKind === null ? (
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
            {draftKind !== null && (
              <div className={css.card}>
                <span className={css.kindTag}>
                  {(() => {
                    const DraftIcon = KIND_ICONS[draftKind]
                    return <DraftIcon size={12} />
                  })()}
                  {t(`kind.${draftKind}`)}
                </span>
                <CardTextarea
                  placeholder={t('board.newCardPlaceholder')}
                  submitOn="mod-enter"
                  autoFocus
                  onSubmit={text => {
                    const trimmed = text.trim()
                    if (trimmed.length > 0) actions.submitDraft(trimmed)
                    onDraftKindChange(null)
                  }}
                  onCancel={() => { onDraftKindChange(null) }}
                />
                <span className={css.editHint}>{t('card.editHint')}</span>
              </div>
            )}
            {shown.map(card => (
              <CardItem
                key={card.id}
                t={t}
                card={card}
                readonly={readonly}
                selected={selection.has(card.id)}
                editing={editingId === card.id}
                onToggleSelect={() => { onToggleSelect(card.id) }}
                onOpenDetail={() => { onOpenDetail(card.id) }}
                onEditingChange={onEditingChange}
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
                    editing={false}
                    archivedWell
                    onToggleSelect={() => {}}
                    onOpenDetail={() => {}}
                    onEditingChange={() => {}}
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
