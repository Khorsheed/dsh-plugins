/**
 * Room composer: the `conversation.composer` chain takeover for room
 * sessions. Replaces the official input bar while the selector holds (the
 * official bar is display:none underneath), so it owns the whole interaction:
 * a textarea (Enter sends, Shift+Enter newlines), a send button, and the
 * @-completion menu listing ONLY existing roster members (pure addressing —
 * invitation lives in the members tab). Addressing is the union of two
 * channels: leading `@name` tokens (the host's parseMentions grammar,
 * stripped from the dispatched text) and the mention menu's picks (a pick
 * records explicit addressing wherever the `@name` sits in the sentence —
 * the text is dispatched verbatim, the picks ride the postMessage request's
 * `targets`). Hand-typed mid-sentence mentions without a menu pick stay
 * prose: they address nobody. A bare message (neither channel) is NOT room
 * business: it is released to the official submit
 * path — the takeover writes the text into the session's official input
 * machine (`inputActions.setDraft` + `inputActions.submit()`, the same entry
 * the InputBar's Enter key drives), so it becomes an ordinary main-agent
 * turn; sent while that turn runs, the machine's busy admission enqueues it
 * exactly as the official bar's does. A structured rejection (unknown
 * targets) shows as an inline error line.
 *
 * Taking over the chain inherits the official bar's environment duties (the
 * member-channel rule, local-agent 84a2ed0): a pending interaction yields (the
 * selector declines while `owner.pendingInteraction` is set, so the priority-1
 * ApprovalPanel elects), and everything the hidden fallback tree carried is
 * re-homed INTO this component — the main agent's turn Stop (the send circle
 * swaps while `running`), the dock capsules (RoomDockCapsules), the main
 * agent's todo strip (RoomTodoStrip, the `todos` projection), the queued-
 * messages strip (RoomQueueStrip, the `inbox` projection — the 0.1.5 session
 * snapshot's queue on the old line), the session
 * stats row (RoomStatsLine below the card), and the main agent's model seat
 * (RoomModelPicker over the official per-session ModelDirectory — the seat
 * itself is single-owner and cannot be re-hosted, so the picker is our own
 * trigger on the same directory; a host without ui-model-selection gets no
 * picker).
 */
import { coordinatorMember } from '../journal.ts'
import {
  useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: InboxState plus the `inbox` key merge into SessionProjectionMap.
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { RoomComposerMatch, RoomComposerProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import { RoomStatsLine } from './RoomStatsLine.tsx'
import { RoomDockCapsules } from './RoomDockCapsules.tsx'
import { RoomTodoStrip } from './RoomTodoStrip.tsx'
import { RoomActivityDock } from './RoomActivityDock.tsx'
import { RoomQueueStrip, type RoomQueueItem } from './RoomQueueStrip.tsx'
import { RoomRecoveryView } from './RoomRecoveryView.tsx'
import { RoomModelPicker } from './RoomModelPicker.tsx'
import css from './RoomComposer.module.css'

/** The 0.1.5 session-snapshot queue row (alpha.2 deleted the snapshot queue for the inbox projection). */
interface LegacyQueuedMessage {
  readonly id: unknown
  readonly placement: string
  readonly preview: string
}

const EMPTY_LEGACY_QUEUE: readonly LegacyQueuedMessage[] = []
const QUEUE_PREVIEW_CHARS = 200

/** The queue row's flat preview: attachment blocks dropped, the rest joined and whitespace-collapsed, 200 chars max (the official QueueDock's rule). */
function previewOf(content: InboxState['next-turn'][number]['content']): string {
  const flat = content
    .filter(block => block.type !== 'image' && block.type !== 'file')
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

interface ActiveMention {
  /** The partial name after the trailing `@`. */
  readonly query: string
  /** Offset of the trailing `@` in the draft. */
  readonly start: number
}

/**
 * Detect an active mention being typed: the text before the caret ends with
 * `@partial` whose `@` follows the line start or whitespace — a mid-sentence
 * mention completes as happily as a leading one. `\S` covers CJK member
 * names (K酱). A menu pick of one of these candidates is explicit addressing
 * even though the host's parseMentions reads only leading tokens.
 */
function detectMention(draft: string, caret: number): ActiveMention | null {
  const head = draft.slice(0, caret)
  const match = /(?:^|\s)@(\S*)$/.exec(head)
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
  if (owner.pendingInteraction !== undefined) return null
  const sessionId = owner.sessionId ?? owner.session?.sessionId
  return sessionId !== undefined && isRoomCached(sessionId) ? { room: true } : null
}

/** The room composer takeover component. */
export function RoomComposer({
  sessionId, roomStore, submit, stop, addTask, closeTask, setGoal, planCommand, openPlanSession, openPlan, stopExecution, backgroundSessions, activeChildren, stopChild, reconcileDelivery,
  roomCwd, invite, listProviders, listNames, browseDirectory, modelSurface, renderHarnessModelPicker, roomChrome,
  modelDirectory, renderMemberConfiguration, renderMemberInbox, stopMember, useSession, useProjection, t,
}: RoomComposerProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mention, setMention] = useState<(ActiveMention & { index: number }) | null>(null)
  /** Menu-picked addressees: a pick is explicit addressing wherever the
      `@name` sits (see the module header); cleared with the draft on send. */
  const [picked, setPicked] = useState<readonly string[]>([])
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const members = state?.members ?? []
  const candidates = mention === null
    ? []
    : members.filter(member => member.name.startsWith(mention.query))
  // The inherited environment state: the room's own main-agent turn flag
  // (drives the Send/Stop swap) and the still-queued inbox rows (the official
  // queue dock's data, re-homed as a read-only strip). alpha.2 moved the
  // queue off the session snapshot into the `inbox` projection; 0.1.5 serves
  // no `inbox` key — the undefined read falls back to the legacy snapshot
  // queue.
  const nativeRunning = useSession(snapshot => snapshot.running) ?? false
  const coordinator = state === undefined ? undefined : coordinatorMember(state)
  const external = coordinator?.kind === 'cli'
  const running = external ? state?.runs.some(run => run.member === coordinator.name && run.state === 'running') ?? false : nativeRunning
  const legacyQueue = useSession(snapshot => (snapshot as { queue?: readonly LegacyQueuedMessage[] }).queue)
    ?? EMPTY_LEGACY_QUEUE
  const inbox = (useProjection === undefined ? undefined : useProjection('inbox')) as unknown as InboxState | undefined
  const nextTurn = inbox?.['next-turn']
  const queued: readonly RoomQueueItem[] = nextTurn === undefined
    ? legacyQueue
      .filter(row => row.placement === 'queued')
      .map(row => ({ id: String(row.id), preview: row.preview }))
    : nextTurn.map(row => ({ id: String(row.id), preview: previewOf(row.content) }))

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
    setPicked(picked.includes(name) ? picked : [...picked, name])
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      // Two-argument form while nothing was menu-picked: the injected face's
      // third parameter is the pick channel only.
      const outcome = picked.length > 0
        ? await submit(sessionId, text, picked)
        : await submit(sessionId, text)
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      setDraft('')
      setMention(null)
      setPicked([])
    } catch {
      setError(t('composer.error.generic'))
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
        {!external && useProjection !== undefined && <RoomTodoStrip useProjection={useProjection} t={t} />}
        {(state === undefined || (state.plan === undefined && (state.executions?.length ?? 0) === 0)) && <RoomDockCapsules
          sessionId={sessionId}
          roomStore={roomStore}
          addTask={addTask}
          closeTask={closeTask}
          setGoal={setGoal}
          formalPlans={planCommand !== undefined}
          roomCwd={roomCwd}
          invite={invite}
          listProviders={listProviders}
          listNames={listNames}
          browseDirectory={browseDirectory}
          modelSurface={modelSurface}
          renderHarnessModelPicker={renderHarnessModelPicker}
          roomChrome={roomChrome}
          t={t}
        />}
        {state !== undefined && reconcileDelivery !== undefined && <RoomRecoveryView deliveries={state.deliveries ?? []} members={state.members} reconcile={reconcileDelivery} openSession={openPlanSession} t={t} />}
        <RoomQueueStrip
          items={[...external ? [] : queued, ...(state?.deliveries ?? []).filter(row => row.memberId === coordinator?.id && (row.status === 'queued' || row.status === 'uncertain')).map(row => ({ id: row.id, preview: row.status === 'uncertain' ? `${row.error ?? 'Outcome unknown'}: ${row.text}` : row.text }))]}
          t={t}
        />
        {state !== undefined && <RoomActivityDock key={sessionId} sessionId={sessionId} state={state} backgroundSessions={backgroundSessions} activeChildren={activeChildren} stopChild={stopChild} openSession={openPlanSession} stopExecution={stopExecution} planCommand={planCommand} openPlan={openPlan} stopMember={stopMember} t={t} />}
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {external && coordinator.childSessionId !== undefined && renderMemberInbox?.(coordinator.childSessionId)}
      <div className={css.card}>
        <div className={css.coordinator}>{t('coordinator.label')} · {coordinator?.name ?? 'dsh'}{external ? ` · ${coordinator.provider}` : ' · DSH'}</div>
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
          {/* The main agent's model seat: the official per-session directory's
              own trigger, immediately before the Send/Stop circle (the
              official composer's order: model seat → send). It writes the
              SESSION selection only — an @-addressed member dispatch rides
              room's own submit remote and is never touched. Absent service =
              no picker. */}
          {external && coordinator.childSessionId !== undefined && renderMemberConfiguration?.(coordinator.childSessionId)}
          {!external && modelDirectory !== undefined && (
            <RoomModelPicker directory={modelDirectory} onError={setError} t={t} />
          )}
          {/* Sending queues a whole turn; stopping affects only the active coordinator. */}
          {running && (
            <button
              type="button"
              className={css.primary}
              aria-label={t('composer.stop')}
              onMouseDown={(event) => { event.preventDefault() }}
              onClick={() => { if (external) stopMember?.(coordinator.name); else stop() }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            </button>
          )}
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
      {/* The stats row's home (the official composer dock) is hidden with the
          fallback; re-rendered here from the same projections. The framework
          omits the seat entirely on a host without the projection subsystem —
          degrade to no row. */}
      {!external && useProjection !== undefined && <RoomStatsLine useProjection={useProjection} t={t} />}
    </div>
  )
}
