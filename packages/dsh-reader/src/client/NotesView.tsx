/**
 * The notes face of the detail view: the article's excerpts with their
 * comments, the conversations that discussed it, and the sheet a new note is
 * written in.
 *
 * One layout for every width (docs/panel-design.md): the list is a single
 * column that only tightens under the panel's compact container, and the
 * sheet rises from the bottom of the pane on a desk and on a phone alike.
 *
 * @module @khorsheed/dsh-reader/client/NotesView
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ReaderDiscussion, ReaderEntryNotes, ReaderNote, ReaderNoteReply } from '../notes-types.ts'
import type { ReaderPaneProps } from './contract.ts'
import type { NoteSelection } from './notes.ts'
import css from './NotesView.module.css'

type T = ReaderPaneProps['t']

/** True when the keystroke is ⌘⏎ / Ctrl+⏎ outside an IME composition. */
function isSubmit(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing
}

/** A one-field inline editor (a reply being added or rewritten). */
function LineEditor({ t, initial, onSave, onCancel }: {
  t: T
  initial: string
  onSave: (text: string) => Promise<boolean>
  onCancel: () => void
}): ReactNode {
  const [draft, setDraft] = useState(initial)
  const save = async (): Promise<void> => { if (draft.trim() !== '' && await onSave(draft)) onCancel() }
  return (
    <div className={css.editor}>
      <textarea
        autoFocus
        className={css.area}
        value={draft}
        placeholder={t('notes.replyPlaceholder')}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={event => {
          if (isSubmit(event)) { event.preventDefault(); void save() }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) onCancel()
        }}
      />
      <div className={css.row}>
        <span className={css.spacer} />
        <button type="button" className={css.ghost} onClick={onCancel}>{t('action.cancel')}</button>
        <button type="button" className={css.primary} onClick={() => { void save() }}>{t('notes.save')}</button>
      </div>
    </div>
  )
}

/** Who wrote a line under a note, as the thread labels it. */
function replyAuthor(t: T, reply: ReaderNoteReply): string {
  if (reply.by === 'agent') return t('notes.replyAgent')
  return reply.editedFrom === 'agent' ? t('notes.replyEdited') : t('notes.replyUser')
}

/** One note row: excerpt, comment, the conclusions under it, and the gestures on it. */
function NoteRow({ t, note, missing, selecting, selected, canOpenSession, onToggle, onJump, onEdit, onDelete, onAddReply, onEditReply, onOpenSession }: {
  t: T
  note: ReaderNote
  missing: boolean
  selecting: boolean
  selected: boolean
  canOpenSession: boolean
  onToggle: () => void
  onJump: () => void
  onEdit: (comment: string) => Promise<boolean>
  onDelete: () => void
  onAddReply: (text: string) => Promise<boolean>
  onEditReply: (index: number, text: string) => Promise<boolean>
  onOpenSession: (sessionId: string) => void
}): ReactNode {
  const [adding, setAdding] = useState(false)
  const [rewriting, setRewriting] = useState<number | null>(null)
  const replies = note.replies ?? []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.comment ?? '')
  const [confirming, setConfirming] = useState(false)
  const save = async (): Promise<void> => {
    if (await onEdit(draft)) setEditing(false)
  }
  return (
    <div className={css.note} data-selected={selected ? 'true' : undefined}>
      <div className={css.noteHead}>
        {selecting && (
          <input
            type="checkbox"
            className={css.check}
            checked={selected}
            aria-label={note.anchor.quote}
            onChange={onToggle}
          />
        )}
        <button type="button" className={css.excerpt} onClick={selecting ? onToggle : onJump} title={missing ? t('notes.notFound') : undefined}>
          {note.anchor.quote}
        </button>
      </div>
      {note.anchor.translated !== undefined && (
        <div className={css.translated}><span className={css.label}>{t('notes.inTranslation')}</span>{note.anchor.translated}</div>
      )}
      {editing
        ? (
          <div className={css.editor}>
            <textarea
              autoFocus
              className={css.area}
              value={draft}
              placeholder={t('notes.commentPlaceholder')}
              onChange={event => { setDraft(event.target.value) }}
              onKeyDown={event => {
                if (isSubmit(event)) { event.preventDefault(); void save() }
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) { setEditing(false); setDraft(note.comment ?? '') }
              }}
            />
            <div className={css.row}>
              <span className={css.spacer} />
              <button type="button" className={css.ghost} onClick={() => { setEditing(false); setDraft(note.comment ?? '') }}>{t('action.cancel')}</button>
              <button type="button" className={css.primary} onClick={() => { void save() }}>{t('notes.save')}</button>
            </div>
          </div>
        )
        : note.comment !== undefined && <div className={css.comment}>{note.comment}</div>}
      {!selecting && (replies.length > 0 || adding) && (
        <div className={css.thread}>
          {replies.map((reply, index) => rewriting === index
            ? (
              <LineEditor
                key={`${reply.at}-${String(index)}`}
                t={t}
                initial={reply.text}
                onSave={text => onEditReply(index, text)}
                onCancel={() => { setRewriting(null) }}
              />
            )
            : (
              <div key={`${reply.at}-${String(index)}`} className={css.reply}>
                <div className={css.replyWho} data-agent={reply.by === 'agent' ? 'true' : undefined}>
                  <span>{replyAuthor(t, reply)}</span>
                  {reply.sessionId !== undefined && canOpenSession && (
                    <button type="button" className={css.link} onClick={() => { onOpenSession(reply.sessionId as string) }}>↗ {t('notes.backToSession')}</button>
                  )}
                  <span className={css.spacer} />
                  <button type="button" className={css.link} onClick={() => { setRewriting(index) }}>{t('notes.replyEdit')}</button>
                  <button type="button" className={css.link} onClick={() => { void onEditReply(index, '') }}>{t('notes.replyRemove')}</button>
                </div>
                <div className={css.replyText}>{reply.text}</div>
              </div>
            ))}
          {adding && <LineEditor t={t} initial="" onSave={onAddReply} onCancel={() => { setAdding(false) }} />}
        </div>
      )}
      <div className={css.foot}>
        <span>¶{note.anchor.block + 1}</span>
        {missing && <span className={css.missing}>{t('notes.notFound')}</span>}
        <span className={css.spacer} />
        {!selecting && !editing && (
          confirming
            ? (
              <>
                <span>{t('notes.deleteConfirm')}</span>
                <button type="button" className={css.link} onClick={() => { setConfirming(false) }}>{t('action.cancel')}</button>
                <button type="button" className={`${css.link} ${css.danger}`} onClick={onDelete}>{t('notes.delete')}</button>
              </>
            )
            : (
              <>
                <button type="button" className={css.link} onClick={() => { setAdding(true) }}>{t('notes.replyAdd')}</button>
                <button type="button" className={css.link} onClick={() => { setDraft(note.comment ?? ''); setEditing(true) }}>{t('notes.edit')}</button>
                <button type="button" className={css.link} onClick={() => { setConfirming(true) }}>{t('notes.delete')}</button>
              </>
            )
        )}
      </div>
    </div>
  )
}

/** The notes view's props. */
export interface NotesViewProps {
  readonly t: T
  readonly entry: ReaderEntryNotes | undefined
  /** Notes whose excerpt is no longer in the article on screen. */
  readonly missing: ReadonlySet<string>
  /** A conversation's live title, when the session list knows it. */
  readonly sessionTitle: (sessionId: string) => string | undefined
  /** Whether a conversation can be opened from here. */
  readonly canOpenSession: boolean
  readonly onJump: (note: ReaderNote) => void
  readonly onEdit: (note: ReaderNote, comment: string) => Promise<boolean>
  readonly onDelete: (note: ReaderNote) => void
  /** Bring these notes (all of them when empty) into the conversation draft. */
  readonly onDiscuss: (noteIds: readonly string[]) => void
  readonly onOpenSession: (sessionId: string) => void
  readonly onAddReply: (note: ReaderNote, text: string) => Promise<boolean>
  readonly onEditReply: (note: ReaderNote, index: number, text: string) => Promise<boolean>
  readonly onDeleteDiscussion: (discussion: ReaderDiscussion) => void
  /** Show the article at this paragraph (1-based ¶). */
  readonly onJumpPara: (para: number) => void
  /** Put the 「让Agent考考我」 request into the conversation draft. */
  readonly onCheck: () => void
}

/** One discussion note: what a conversation (or a quiz-me round) came to. */
function DiscussionCard({ t, discussion, canOpenSession, onOpenSession, onJumpPara, onDelete }: {
  t: T
  discussion: ReaderDiscussion
  canOpenSession: boolean
  onOpenSession: (sessionId: string) => void
  onJumpPara: (para: number) => void
  onDelete: () => void
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const check = discussion.kind === 'check'
  return (
    <div className={css.discussion}>
      <div className={css.discussionHead}>
        <span className={css.kind} data-kind={discussion.kind}>{check ? t('notes.kindCheck') : t('notes.kindDiscussion')}</span>
        <b className={css.discussionTitle}>{discussion.title !== '' ? discussion.title : discussion.createdAt.slice(0, 10)}</b>
        {discussion.sessionId !== undefined && canOpenSession && (
          <button type="button" className={css.link} onClick={() => { onOpenSession(discussion.sessionId as string) }}>{t('notes.backToSession')} ↗</button>
        )}
      </div>
      <div className={css.pointsLabel} data-kind={discussion.kind}>{check ? t('notes.pointsCheck') : t('notes.pointsDiscussion')}</div>
      <ul className={css.points}>
        {discussion.points.map((point, index) => (
          <li key={String(index)}>
            {point.text}
            {point.para !== undefined && (
              <>{' '}<button type="button" className={css.link} onClick={() => { onJumpPara(point.para as number) }}>¶{point.para} ↗</button></>
            )}
          </li>
        ))}
      </ul>
      {discussion.aside !== undefined && <div className={css.aside}>{discussion.aside}</div>}
      <div className={css.foot}>
        <span>{discussion.title !== '' ? discussion.createdAt.slice(0, 10) : ''}</span>
        <span className={css.spacer} />
        {confirming
          ? (
            <>
              <span>{t('notes.deleteConfirm')}</span>
              <button type="button" className={css.link} onClick={() => { setConfirming(false) }}>{t('action.cancel')}</button>
              <button type="button" className={`${css.link} ${css.danger}`} onClick={onDelete}>{t('notes.delete')}</button>
            </>
          )
          : <button type="button" className={css.link} onClick={() => { setConfirming(true) }}>{t('notes.delete')}</button>}
      </div>
    </div>
  )
}

/** The article's notes, and the conversations that discussed it. */
export function NotesView(props: NotesViewProps): ReactNode {
  const { t, entry } = props
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const notes = entry?.notes ?? []
  const sessions = entry?.sessions ?? []
  const discussions = entry?.discussions ?? []
  const toggle = (id: string): void => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const endSelecting = (): void => { setSelecting(false); setSelected(new Set()) }
  return (
    <div className={css.view}>
      <div className={css.body}>
        <div className={css.section}>
          <span>{t('notes.excerpts')}</span>
          <span className={css.spacer} />
          {notes.length > 0 && (
            <button type="button" className={css.link} onClick={() => { if (selecting) endSelecting(); else setSelecting(true) }}>
              {selecting ? t('notes.selectDone') : t('notes.select')}
            </button>
          )}
        </div>
        {notes.length === 0 && <p className={css.empty}>{t('notes.empty')}</p>}
        {notes.map(note => (
          <NoteRow
            key={note.id}
            t={t}
            note={note}
            missing={props.missing.has(note.id)}
            selecting={selecting}
            selected={selected.has(note.id)}
            onToggle={() => { toggle(note.id) }}
            onJump={() => { props.onJump(note) }}
            onEdit={comment => props.onEdit(note, comment)}
            onDelete={() => { props.onDelete(note) }}
            canOpenSession={props.canOpenSession}
            onAddReply={text => props.onAddReply(note, text)}
            onEditReply={(index, text) => props.onEditReply(note, index, text)}
            onOpenSession={props.onOpenSession}
          />
        ))}
        <div className={css.section}><span>{t('notes.discussionNotes')}</span></div>
        {discussions.length === 0 && <p className={css.empty}>{t('notes.noDiscussionNotes')}</p>}
        {discussions.map(discussion => (
          <DiscussionCard
            key={discussion.id}
            t={t}
            discussion={discussion}
            canOpenSession={props.canOpenSession}
            onOpenSession={props.onOpenSession}
            onJumpPara={props.onJumpPara}
            onDelete={() => { props.onDeleteDiscussion(discussion) }}
          />
        ))}
        <div className={css.section}><span>{t('notes.discussions')}</span></div>
        {sessions.length === 0 && <p className={css.empty}>{t('notes.noDiscussions')}</p>}
        {sessions.map(session => (
          <div key={session.sessionId} className={css.session}>
            <span className={css.sessionTitle}>{props.sessionTitle(session.sessionId) ?? session.title ?? t('notes.untitledSession')}</span>
            {props.canOpenSession && (
              <button type="button" className={css.link} onClick={() => { props.onOpenSession(session.sessionId) }}>
                {t('notes.discussedIn')} ↗
              </button>
            )}
          </div>
        ))}
      </div>
      <div className={css.bar}>
        {selecting
          ? (
            <>
              <span>{t('notes.selected', { count: selected.size })}</span>
              <span className={css.spacer} />
              <button
                type="button"
                className={css.primary}
                disabled={selected.size === 0}
                onClick={() => { props.onDiscuss([...selected]); endSelecting() }}
              >
                {t('notes.discuss')}
              </button>
            </>
          )
          : (
            <>
              <button type="button" className={`${css.secondary} ${css.wide}`} disabled={notes.length === 0} onClick={() => { props.onDiscuss([]) }}>
                {t('notes.discussAll')}
              </button>
              <button type="button" className={`${css.primary} ${css.wide}`} onClick={props.onCheck}>
                {t('notes.check')}
              </button>
            </>
          )}
      </div>
    </div>
  )
}

/** The sheet a new note is written in. */
export function NoteSheet({ t, selection, saving, failed, onSave, onCancel }: {
  t: T
  selection: NoteSelection
  saving: boolean
  failed: boolean
  onSave: (comment: string) => void
  onCancel: () => void
}): ReactNode {
  const [comment, setComment] = useState('')
  return (
    <>
      <div className={css.scrim} onClick={onCancel} />
      <div className={css.sheet} role="dialog" aria-label={t('notes.sheetTitle')}>
        <div className={css.grab} />
        <div className={css.sheetHead}>
          <b>{t('notes.sheetTitle')}</b>
          <span className={css.chip}>{t('notes.excerpt')}</span>
        </div>
        <div className={css.sheetExcerpt}>{selection.translated ?? selection.quote}</div>
        <textarea
          autoFocus
          className={css.area}
          value={comment}
          placeholder={t('notes.commentPlaceholder')}
          onChange={event => { setComment(event.target.value) }}
          onKeyDown={event => {
            if (isSubmit(event)) { event.preventDefault(); onSave(comment) }
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) onCancel()
          }}
        />
        <div className={css.row}>
          <span className={failed ? css.failed : css.hint}>{failed ? t('notes.saveFailed') : t('notes.commentOptional')}</span>
          <span className={css.spacer} />
          <button type="button" className={css.ghost} onClick={onCancel}>{t('action.cancel')}</button>
          <button type="button" className={css.primary} disabled={saving} onClick={() => { onSave(comment) }}>{t('notes.save')} ⌘⏎</button>
        </div>
      </div>
    </>
  )
}
