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
 * turn; sent while that turn runs, the machine's busy admission enqueues it
 * exactly as the official bar's does. A structured rejection (unknown
 * targets) shows as an inline error line.
 *
 * Taking over the chain inherits the official bar's environment duties (the
 * member-channel rule, local-agent 84a2ed0): pending interactions yield (the
 * selector declines while `owner.interactions` is non-empty, so the priority-1
 * ApprovalPanel elects), and everything the hidden fallback tree carried is
 * re-homed INTO this component — the main agent's turn Stop (the send circle
 * swaps while `running`), the dock capsules (RoomDockCapsules), the main
 * agent's todo strip (RoomTodoStrip, the `todos` projection), the queued-
 * messages strip (RoomQueueStrip, the session snapshot's queue), and the
 * session stats row (RoomStatsLine below the card).
 */
import {
  useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseMentions } from '../journal.ts'
import type { RoomComposerMatch, RoomComposerProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import { RoomStatsLine } from './RoomStatsLine.tsx'
import { RoomDockCapsules } from './RoomDockCapsules.tsx'
import { RoomTodoStrip } from './RoomTodoStrip.tsx'
import { RoomQueueStrip } from './RoomQueueStrip.tsx'
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

/**
 * Pure composer-chain selector: elect exactly the cached-room sessions.
 * Pending interactions (questions/approvals) belong to the official
 * ApprovalPanel — a chain entry at priority 1. Election runs ascending, so
 * this -10 entry would shadow it: decline and let the interaction render
 * (the member-channel rule, local-agent 84a2ed0). A cache miss declines too —
 * the freshly opened room shows the official bar for the first pull's
 * duration (accepted, see room-store.ts).
 * @param owner - the composer chain currency dispatched by ConversationRoot.
 * @param isRoomCached - the room store's cache probe (injected: the selector
 *   must stay a pure function of the owner props plus stable state reads).
 * @returns the room match, or null to pass the election down the chain.
 */
export function selectRoomComposer(
  owner: ComposerChainProps,
  isRoomCached: (sessionId: SessionId) => boolean,
): RoomComposerMatch | null {
  if (owner.interactions.length > 0) return null
  const sessionId = owner.session?.sessionId
  return sessionId !== undefined && isRoomCached(sessionId) ? { room: true } : null
}

/** The room composer takeover component. */
export function RoomComposer({
  sessionId, inputActions, roomStore, submit, stop, addTask, closeTask, setGoal,
  roomCwd, invite, listProviders, browseDirectory, useSession, useProjection, t,
}: RoomComposerProps): ReactNode {
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
  // The inherited environment state: the room's own main-agent turn flag
  // (drives the Send/Stop swap) and the still-queued inbox rows (the official
  // queue dock's data, re-homed as a read-only strip).
  const running = useSession(snapshot => snapshot.running) ?? false
  const queued = (useSession(snapshot => snapshot.queue) ?? [])
    .filter(row => row.placement === 'queued')

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
      {/* The dock's slot seat is hidden with the official fallback, so the
          takeover renders the dock's surfaces itself, on the same card-width
          column axis: the main agent's todo strip (the official TodoPanel's
          seat), the goal/task capsules, and the queued-messages strip (the
          official QueueDock, read-only). */}
      <div className={css.dock}>
        {useProjection !== undefined && <RoomTodoStrip useProjection={useProjection} t={t} />}
        <RoomDockCapsules
          sessionId={sessionId}
          roomStore={roomStore}
          addTask={addTask}
          closeTask={closeTask}
          setGoal={setGoal}
          roomCwd={roomCwd}
          invite={invite}
          listProviders={listProviders}
          browseDirectory={browseDirectory}
          t={t}
        />
        <RoomQueueStrip
          items={queued.map(row => ({ id: String(row.id), preview: row.preview }))}
          t={t}
        />
      </div>
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
          {/* Send/Stop swap, the official InputBar's ordinary-session
              posture: while the room's own main-agent turn runs, the primary
              circle is Stop (the fallback bar's Stop hides with it), and a
              bare-message Enter still submits — the input machine's busy
              admission enqueues it. mousedown is suppressed so the click
              never steals focus from the draft. */}
          {running ? (
            <button
              type="button"
              className={css.primary}
              aria-label={t('composer.stop')}
              onMouseDown={(event) => { event.preventDefault() }}
              onClick={stop}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            </button>
          ) : (
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
          )}
        </div>
      </div>
      {/* The stats row's home (the official composer dock) is hidden with the
          fallback; re-rendered here from the same projections. The framework
          omits the seat entirely on a host without the projection subsystem —
          degrade to no row. */}
      {useProjection !== undefined && <RoomStatsLine useProjection={useProjection} t={t} />}
    </div>
  )
}
