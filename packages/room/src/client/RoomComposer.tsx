/**
 * Room composer: the `conversation.composer` chain takeover for room
 * sessions. Replaces the official input bar while the selector holds (the
 * official bar is display:none underneath), so it owns the whole interaction:
 * a textarea (Enter sends, Shift+Enter newlines), a send button, and the
 * @-completion menu listing ONLY existing roster members (pure addressing —
 * invitation lives in the members tab). Mention parsing mirrors the host's
 * parseMentions: only leading `@name` tokens address. A bare message (no
 * leading @) is NOT room business: it is released to the official submit
 * path — the takeover writes the text into the session's official input
 * machine (`inputActions.setDraft` + `inputActions.submit()`, the same entry
 * the InputBar's Enter key drives), so it becomes an ordinary main-agent
 * turn. A structured rejection (unknown targets) shows as an inline error
 * line.
 */
import {
  useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import { parseMentions } from '../journal.ts'
import type { RoomComposerProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import css from './RoomComposer.module.css'

interface ActiveMention {
  /** The partial name after the trailing `@`. */
  readonly query: string
  /** Offset of the trailing `@` in the draft. */
  readonly start: number
}

/**
 * Detect an active mention being typed: the text before the caret is a run of
 * completed `@name ` tokens followed by a trailing `@partial` — the exact
 * leading-token grammar the host's parseMentions accepts.
 */
function detectMention(draft: string, caret: number): ActiveMention | null {
  const head = draft.slice(0, caret)
  const match = /^(?:@\S+\s+)*@(\S*)$/.exec(head)
  if (match === null) return null
  return { query: match[1]!, start: caret - match[1]!.length - 1 }
}

/** The room composer takeover component. */
export function RoomComposer({ sessionId, inputActions, roomStore, submit, t }: RoomComposerProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mention, setMention] = useState<(ActiveMention & { index: number }) | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const members = state?.members ?? []
  const candidates = mention === null
    ? []
    : members.filter(member => member.name.startsWith(mention.query))

  const resize = (area: HTMLTextAreaElement): void => {
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    setDraft(value)
    resize(event.target)
    const active = detectMention(value, event.target.selectionStart ?? value.length)
    setMention(active === null ? null : { ...active, index: 0 })
  }

  const applyMention = (name: string): void => {
    if (mention === null) return
    const caret = areaRef.current?.selectionStart ?? draft.length
    const next = `${draft.slice(0, mention.start)}@${name} ${draft.slice(caret)}`
    setDraft(next)
    setMention(null)
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || busy) return
    // Bare message: release to the official submit path — a normal turn of
    // the room's own main agent. The takeover never journals it; the official
    // pipeline (queue admission, adjudication, delivery) owns it from here.
    if (parseMentions(text).targets.length === 0) {
      inputActions.setDraft(text)
      inputActions.submit()
      setDraft('')
      setMention(null)
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await submit(sessionId, text)
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      setDraft('')
      setMention(null)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention !== null) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
      if (candidates.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setMention({ ...mention, index: (mention.index + 1) % candidates.length })
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setMention({ ...mention, index: (mention.index + candidates.length - 1) % candidates.length })
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          applyMention(candidates[mention.index]!.name)
          return
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className={css.root}>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      <div className={css.card}>
        {mention !== null && candidates.length > 0 && (
          <ul className={css.menu} role="listbox" aria-label="members">
            {candidates.map((member, index) => (
              <li key={member.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === mention.index}
                  className={index === mention.index ? css.itemActive : css.item}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    applyMention(member.name)
                  }}
                >
                  <span className={css.dot} style={{ background: memberColor(member.name) }} aria-hidden />
                  <span>{member.name}</span>
                  <span className={css.hint}>
                    {member.kind === 'main-agent' ? t('member.kind.main') : member.provider ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={areaRef}
          className={css.input}
          rows={2}
          value={draft}
          placeholder={t('composer.placeholder')}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <div className={css.row}>
          {/* The official send circle (InputBar .primary): same up-arrow
              glyph, info-fill blue, 0.4 opacity while empty. mousedown is
              suppressed so the click never steals focus from the draft. */}
          <button
            type="button"
            className={css.primary}
            aria-label={t('composer.send')}
            disabled={busy || draft.trim() === ''}
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={() => { void send() }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
