/**
 * Room composer: the `conversation.composer` chain takeover for room
 * sessions. Replaces the official input bar while the selector holds (the
 * official bar is display:none underneath), so it owns the whole interaction:
 * a textarea (Enter sends, Shift+Enter newlines), a send button, and the
 * @-completion menu listing ONLY existing roster members (pure addressing —
 * invitation lives in the members tab). Mention parsing mirrors the host's
 * parseMentions: only leading `@name` tokens address. A bare message is a
 * blackboard note and says so; a structured rejection (unknown targets)
 * shows as an inline error line.
 */
import {
  useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import type { RoomComposerProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import css from './RoomComposer.module.css'

/** The fade-out lifetime of the blackboard-note hint. */
const NOTICE_MS = 3_000

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
export function RoomComposer({ sessionId, roomStore, submit, t }: RoomComposerProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noted, setNoted] = useState(false)
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
      if (!outcome.dispatched) {
        // A bare message reaches nobody: say where it went, briefly.
        setNoted(true)
        setTimeout(() => { setNoted(false) }, NOTICE_MS)
      }
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
    <div className={css.frame}>
      {noted && <div className={css.notice} role="status">{t('composer.noted')}</div>}
      <div className={css.box}>
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
          className={css.area}
          rows={2}
          value={draft}
          placeholder={t('composer.placeholder')}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <div className={css.row}>
          <button
            type="button"
            className={css.send}
            disabled={busy || draft.trim() === ''}
            onClick={() => { void send() }}
          >
            {t('composer.send')}
          </button>
        </div>
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}
