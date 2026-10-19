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
import type { ReaderEntryNotes, ReaderNote } from '../notes-types.ts'
import type { ReaderPaneProps } from './contract.ts'
import type { NoteSelection } from './notes.ts'
import css from './NotesView.module.css'

type T = ReaderPaneProps['t']

/** True when the keystroke is ⌘⏎ / Ctrl+⏎ outside an IME composition. */
function isSubmit(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing
}

/** One note row: excerpt, comment, and the gestures on it. */
function NoteRow({ t, note, missing, selecting, selected, onToggle, onJump, onEdit, onDelete }: {
  t: T
  note: ReaderNote
  missing: boolean
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onJump: () => void
  onEdit: (comment: string) => Promise<boolean>
  onDelete: () => void
}): ReactNode {
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
}

/** The article's notes, and the conversations that discussed it. */
export function NotesView(props: NotesViewProps): ReactNode {
  const { t, entry } = props
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const notes = entry?.notes ?? []
  const sessions = entry?.sessions ?? []
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
            <button type="button" className={`${css.primary} ${css.wide}`} disabled={notes.length === 0} onClick={() => { props.onDiscuss([]) }}>
              {t('notes.discussAll')}
            </button>
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
