/**
 * The canvas board: the right side of the space page — the topic topbar, the
 * kind filter chips, the selection bar, the card grid (kept cards, the ghost
 * proposal affordance, the new-card draft), and the archived well.
 *
 * Text editing follows the pad's three invariants exactly: every editor is an
 * UNCONTROLLED textarea (nothing ever writes its value back), IME composition
 * is a hard stop for submit handlers (a candidate window must never be torn
 * down mid-word), and `.boardScroll` is the one scroll container — card
 * textareas auto-size and never scroll themselves.
 *
 * Kind is told by icon + words only, never by colour (the storyboard rule).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import {
  IconArchiveOutline20, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconCodeOutline16, IconDatabaseOutline16, IconEditOutline16,
  IconFolderOpenOutline16, IconLightOutline16, IconLinkOutline14, IconListPenOutline16,
  IconNewChatOutline16, IconPlusOutline16, IconQuestionOutline14, IconRefreshOutline14,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  BOARD_CARD_KINDS,
  type BoardCard, type BoardCardKind, type BoardCardStatus, type CanvasBoard,
} from '../../types.ts'
import type {} from '../locales.ts'
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

/**
 * The board's one textarea shape: uncontrolled, auto-sizing (never its own
 * scroller), IME-hard-stopped submits. `submitOn` picks the chord:
 * 'mod-enter' for card text (⌘⏎, plus blur), 'enter' for comments (⏎).
 */
function CardTextarea({ defaultValue, placeholder, submitOn, autoFocus, onSubmit, onCancel }: {
  readonly defaultValue?: string
  readonly placeholder?: string
  readonly submitOn: 'mod-enter' | 'enter'
  readonly autoFocus?: boolean
  readonly onSubmit: (text: string) => void
  readonly onCancel?: () => void
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)

  const autosize = useCallback(() => {
    const element = ref.current
    if (element === null) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  useEffect(() => { autosize() }, [autosize])

  const submit = useCallback(() => {
    const element = ref.current
    if (element === null || composingRef.current) return
    onSubmit(element.value)
  }, [onSubmit])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel?.()
      return
    }
    if (event.key !== 'Enter' || composingRef.current) return
    const chord = submitOn === 'enter'
      ? !event.shiftKey && !event.metaKey && !event.ctrlKey
      : event.metaKey || event.ctrlKey
    if (chord) {
      event.preventDefault()
      submit()
    }
  }, [submitOn, submit, onCancel])

  return (
    <textarea
      ref={element => {
        ref.current = element
        if (element !== null) {
          element.style.height = '0px'
          element.style.height = `${element.scrollHeight}px`
        }
      }}
      className={css.cardEditor}
      defaultValue={defaultValue}
      placeholder={placeholder}
      spellCheck={false}
      autoFocus={autoFocus}
      rows={1}
      onInput={autosize}
      onKeyDown={onKeyDown}
      onBlur={submitOn === 'mod-enter' ? submit : undefined}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
    />
  )
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

/** One board card: kept, ghost (proposed), or archived-in-the-well. */
function CardItem({ t, card, readonly, selected, editing, archivedWell, onToggleSelect, onEditingChange, actions }: {
  readonly t: TranslateNS<'canvas'>
  readonly card: BoardCard
  readonly readonly: boolean
  readonly selected: boolean
  readonly editing: boolean
  /** Rendered inside the archived well (restore is the only gesture). */
  readonly archivedWell?: boolean
  readonly onToggleSelect: () => void
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
      onClick={proposed || archivedWell || editing ? undefined : onToggleSelect}
    >
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
        <div className={css.cardText}>{card.text}</div>
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
          <button type="button" className={css.accept} onClick={() => { actions.setCardStatus(card.id, 'kept') }}>
            <IconCheckOutline16 size={12} />
            {t('card.accept')}
          </button>
          <button type="button" onClick={() => { actions.setCardStatus(card.id, 'archived') }}>
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
  t, readonly, board, filter, onFilter, selection, onToggleSelect, onClearSelection,
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
