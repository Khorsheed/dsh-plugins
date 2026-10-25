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
 * prose: they address nobody. EVERY send — bare text included — routes
 * through room's own dispatch (the postMessage Remote; the host routes bare
 * text to the current coordinator), never through `inputActions.submit()`:
 * the machine's busy admission would enqueue behind a running coordinator
 * and serialize what the dispatch engine deliberately runs in parallel. A
 * structured rejection (unknown targets) shows as an inline error line.
 *
 * The DRAFT, though, lives in the session's official input machine: the
 * chain occupant's standard session kit (`useInput`/`inputActions`) is this
 * component's draft store, so the takeover and the display:none fallback
 * share one draft — text typed during the first-pull election window
 * carries over, drafts persist across navigation, and external draft
 * writers (quote-anything's 引用到当前会话) land here with zero
 * room-specific code. Reference chips in the machine (a quote, any trigger
 * source's pick) render as their own row above the textarea — label, click
 * to preview through the chip's source, × to remove — and the textarea holds
 * only the typed text around them; edits map back as detect-span
 * replacements, so typing never flattens a chip (draft-chips.ts). A host
 * without the machine's chip view or `insertText` keeps the old plain form:
 * chips project to their clipboard text and editing flattens them.
 *
 * Taking over the chain inherits the official bar's environment duties (the
 * member-channel rule, local-agent 84a2ed0): a pending interaction yields (the
 * selector declines while `owner.pendingInteraction` is set, so the priority-1
 * ApprovalPanel elects), and everything the hidden fallback tree carried is
 * re-homed INTO this component — the main agent's turn Stop (the send circle
 * swaps while `running`), the task capsule (RoomTaskCapsule), the main
 * agent's todo strip (RoomTodoStrip, the `todos` projection), the queued-
 * messages strip (RoomQueueStrip, the `inbox` projection — the 0.1.5 session
 * snapshot's queue on the old line), the session
 * stats row (RoomStatsLine below the card), and the main agent's model seat
 * (RoomModelPicker over the official per-session ModelDirectory — the seat
 * itself is single-owner and cannot be re-hosted, so the picker is our own
 * trigger on the same directory; a host without ui-model-selection gets no
 * picker).
 *
 * The task page's 「追问」 / 「＋ 新任务」 put a removable chip on the card
 * (「任务 N」 / 「新任务」, the shared RoomTaskTags store) and focus the
 * textarea; the next send carries it as postMessage's `task` and clears it.
 * Removing the chip leaves the filing to dsh.
 */
import { coordinatorMember } from '../journal.ts'
import {
  useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: InboxState plus the `inbox` key merge into SessionProjectionMap.
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { RoomComposerMatch, RoomComposerProps } from './slots.ts'
import { chipDetectIndex, freeText, planFreeEdit, type DraftChip } from './draft-chips.ts'
import { memberColor } from './member-color.ts'
import { RoomStatsLine } from './RoomStatsLine.tsx'
import { RoomTaskCapsule } from './RoomTaskCapsule.tsx'
import { RoomTodoStrip } from './RoomTodoStrip.tsx'
import { RoomQueueStrip, type RoomQueueItem } from './RoomQueueStrip.tsx'
import { RoomModelPicker } from './RoomModelPicker.tsx'
import css from './RoomComposer.module.css'

/** The 0.1.5 session-snapshot queue row (alpha.2 deleted the snapshot queue for the inbox projection). */
interface LegacyQueuedMessage {
  readonly id: unknown
  readonly placement: string
  readonly preview: string
}

const NO_TAGS = (): (() => void) => () => {}
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

/** The chip-mode slice of the input action face (newer hosts), mirrored. */
interface ChipEditActions {
  captureInsertion(): { readonly start: number; readonly end: number; readonly draftRev: number }
  insertText(text: string, span: { readonly start: number; readonly end: number; readonly draftRev: number }): boolean
}

const NO_CHIPS: readonly DraftChip[] = []

/** The room composer takeover component. */
export function RoomComposer({
  sessionId, roomStore, submit, stop, openTasks, taskTags, openPlanSession, reconcileDelivery,
  roomCwd, invite, listProviders, browseDirectory, modelSurface, renderHarnessModelPicker,
  modelDirectory, renderMemberConfiguration, renderMemberInbox, stopMember, openReference, useSession, useProjection, useInput, inputActions, t,
}: RoomComposerProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const tag = useSyncExternalStore(taskTags?.subscribe ?? NO_TAGS, () => taskTags?.get(sessionId))
  // The draft is the session's official input machine (the module header):
  // shared with the hidden fallback bar, persistent across navigation, and
  // writable by external drafters (quote) with zero room-specific code.
  const draft = useInput(input => input.draft)
  // The machine's chips (absent before the occurrence view shipped) and the
  // span-guarded text edit (absent on older faces): both present = chip mode.
  const occurrences = useInput(input => (input as { occurrences?: readonly DraftChip[] }).occurrences)
  const chipEdit = inputActions as Partial<ChipEditActions>
  const chipMode = occurrences !== undefined && occurrences.length > 0
    && chipEdit.insertText !== undefined && chipEdit.captureInsertion !== undefined
  const chips = chipMode ? occurrences : NO_CHIPS
  // What the textarea shows: the typed text around the chips.
  const value = chipMode ? freeText(draft, chips) : draft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mention, setMention] = useState<(ActiveMention & { index: number }) | null>(null)
  /** Menu-picked addressees: a pick is explicit addressing wherever the
      `@name` sits (see the module header); cleared with the draft on send. */
  const [picked, setPicked] = useState<readonly string[]>([])
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  // IME composition (the official ui-primitives observeComposition rule):
  // Enter while composing, or the one that closes a composition (Safari
  // fires compositionend before its keydown), commits the candidate — it
  // never sends. keyCode 229 covers engines without isComposing.
  const composing = useRef(false)
  const justComposed = useRef(false)
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

  // The coordinator's own room deliveries: a round a restart interrupted
  // blocks the ones after it until the human reconciles or stops its task —
  // say so, instead of a silent queue.
  const coordinatorRows = (state?.deliveries ?? []).filter(row => row.memberId === coordinator?.id && (row.status === 'queued' || row.status === 'uncertain'))
  const blocked = coordinatorRows.some(row => row.status === 'uncertain')
  const coordinatorQueue: readonly RoomQueueItem[] = coordinatorRows.map(row => ({
    id: row.id,
    preview: row.status === 'uncertain' ? t('job.queueUncertain', { text: row.text }) : blocked ? t('job.queueBlocked', { text: row.text }) : row.text,
  }))

  const resize = (area: HTMLTextAreaElement): void => {
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }

  // A new tag (the task page's 追问 / 新任务) hands the textarea focus.
  useEffect(() => {
    if (tag !== undefined) areaRef.current?.focus()
  }, [tag?.revision])

  // External draft writes (a quote insertion, the election window's
  // carry-over) never fire onChange — keep the height in sync with the draft.
  useEffect(() => {
    if (areaRef.current !== null) resize(areaRef.current)
  }, [draft])

  // Write the textarea's text back: chip mode maps the change onto the
  // machine as span edits (each against the then-current revision, last
  // first), so the chips survive; otherwise the whole draft is replaced.
  const writeText = (next: string): void => {
    if (!chipMode) {
      inputActions.setDraft(next)
      return
    }
    for (const edit of planFreeEdit(draft, chips, next)) {
      const draftRev = chipEdit.captureInsertion!().draftRev
      if (!chipEdit.insertText!(edit.text, { start: edit.start, end: edit.end, draftRev })) return
    }
  }

  // Remove one chip: delete its single detect placeholder.
  const removeChip = (k: number): void => {
    const start = chipDetectIndex(draft, chips, k)
    chipEdit.insertText?.('', { start, end: start + 1, draftRev: chipEdit.captureInsertion!().draftRev })
    areaRef.current?.focus()
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = event.target.value
    writeText(next)
    resize(event.target)
    const active = detectMention(next, event.target.selectionStart ?? next.length)
    setMention(active === null ? null : { ...active, index: 0 })
  }

  const applyMention = (name: string): void => {
    if (mention === null) return
    const caret = areaRef.current?.selectionStart ?? value.length
    const next = `${value.slice(0, mention.start)}@${name} ${value.slice(caret)}`
    writeText(next)
    setMention(null)
    setPicked(picked.includes(name) ? picked : [...picked, name])
    // The machine tracks no caret: restore it behind the spliced pick once
    // the store round-trip has re-rendered the textarea.
    const restored = mention.start + name.length + 2
    requestAnimationFrame(() => areaRef.current?.setSelectionRange(restored, restored))
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      // Two-argument form while nothing was menu-picked: the injected face's
      // third parameter is the pick channel only.
      const outcome = tag !== undefined
        ? await submit(sessionId, text, picked, tag.task)
        : picked.length > 0
          ? await submit(sessionId, text, picked)
          : await submit(sessionId, text)
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      inputActions.setDraft('')
      // Persist the cleared draft when the host's kit exposes the flush (the
      // send bypasses the machine's own submit, which would do it).
      const flushDraft = (inputActions as { persistDraft?: () => void }).persistDraft
      flushDraft?.()
      setMention(null)
      setPicked([])
      taskTags?.set(sessionId, undefined)
    } catch {
      setError(t('composer.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // oxlint-disable-next-line typescript/no-deprecated -- IME 229 covers engines without isComposing.
    const ime = composing.current || justComposed.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
    justComposed.current = false
    if (ime) return
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
          seat), the task capsule, and the queued-messages strip (the
          official QueueDock, read-only). */}
      <div className={css.dock}>
        {!external && useProjection !== undefined && <RoomTodoStrip useProjection={useProjection} t={t} />}
        {state !== undefined && <RoomTaskCapsule
          state={state}
          openTasks={openTasks}
          reconcileDelivery={reconcileDelivery}
          openPlanSession={openPlanSession}
          roomCwd={roomCwd}
          invite={invite}
          listProviders={() => listProviders(sessionId)}
          browseDirectory={browseDirectory}
          modelSurface={modelSurface}
          renderHarnessModelPicker={renderHarnessModelPicker}
          t={t}
        />}
        <RoomQueueStrip
          items={[...external ? [] : queued, ...coordinatorQueue]}
          t={t}
        />
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {external && coordinator.childSessionId !== undefined && renderMemberInbox?.(coordinator.childSessionId)}
      <div className={css.card}>
        {/* Who a bare message goes to: the coordinator's name in its member colour. */}
        <div className={css.coordinator} style={{ '--member-color': memberColor(coordinator?.name ?? 'dsh') } as CSSProperties}>
          <span className={css.coordinatorDot} aria-hidden />
          <span className={css.coordinatorName}>{coordinator?.name ?? 'dsh'}</span>
          <span>· {t('coordinator.label')} · {external ? coordinator.provider : 'DSH'}</span>
        </div>
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
        {tag !== undefined && (
          <div className={css.tagRow}>
            <span className={css.tag} data-new={tag.task === 'new' ? '' : undefined}>
              {tag.label}
              <button
                type="button"
                className={css.tagRemove}
                aria-label={t('job.tagRemove')}
                title={t('job.tagRemove')}
                onClick={() => { taskTags?.set(sessionId, undefined) }}
              >✕</button>
            </span>
          </div>
        )}
        {chips.length > 0 && (
          <div className={css.chipRow}>
            {chips.map((chip, k) => (
              <span key={chip.occurrenceId} className={css.chip}>
                <button
                  type="button"
                  className={css.chipLabel}
                  title={chip.label}
                  onClick={() => { openReference?.(chip.source, chip.ref) }}
                >
                  <span aria-hidden className={css.chipAt}>@</span>
                  <span className={css.chipText}>{chip.label}</span>
                </button>
                <button
                  type="button"
                  className={css.tagRemove}
                  aria-label={t('composer.chipRemove', { label: chip.label })}
                  title={t('composer.chipRemove', { label: chip.label })}
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={() => { removeChip(k) }}
                >✕</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          className={css.input}
          rows={2}
          value={value}
          placeholder={tag === undefined ? t('composer.placeholder', { name: coordinator?.name ?? 'dsh' }) : tag.task === 'new' ? t('job.tagPlaceholderNew') : t('job.tagPlaceholder', { label: tag.label })}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false; justComposed.current = true }}
          onKeyUp={() => { justComposed.current = false }}
          onBlur={() => { composing.current = false; justComposed.current = false }}
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
      {!external && useProjection !== undefined && <RoomStatsLine useProjection={useProjection} state={state} t={t} />}
    </div>
  )
}
