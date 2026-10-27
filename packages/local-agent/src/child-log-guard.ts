/**
 * The member child-log write guard. Every CLI provider (claude, codex, kimi,
 * dsh) mirrors its member's work into a dsh child session after the fact,
 * each with its own turn/step bookkeeping — and the host's stored-log reader
 * is all-or-nothing: one event outside the released V4 relationships (a turn
 * opened twice, a step out of order, a write into a closed turn, a tool
 * result with no advertised call) makes the whole log unreadable, so the
 * history view and Context Lens lose the member entirely.
 *
 * The guard wraps the child session's `append` once and decides each
 * relationship event before it gets a seq:
 *
 * - **Corrects** what has one right answer: a step takes the turn's next
 *   number (the provider's number is remembered as an alias, so the step's
 *   later events follow it); an event naming a turn the log never opened,
 *   while a turn is open, belongs to the open turn; a turn/start or step/start
 *   over an open one first closes it with the host's own crash-recovery
 *   closers (missing tool results, step/end, an `interrupted` turn/end); a
 *   step-bound event with no open step opens one; a tool result whose call
 *   was advertised but never started gets its tool/call first.
 * - **Diverts** what cannot be written anywhere valid — an event of a turn
 *   the log already closed (a late notice after a cancel, a backlog after a
 *   reattach), an event with no open turn, a tool event no call advertised —
 *   to the quarantine sink: nothing vanishes, the log stays readable.
 * - **Verifies** the corrected event against the host's own released-log
 *   validator when the host exposes it (`assertReleasedV4Relationships`), so
 *   the rules can never drift from the reader that enforces them; an event it
 *   still rejects is diverted too.
 *
 * Events without turn/step relationships pass through untouched.
 *
 * @module @khorsheed/dsh-local-agent/child-log-guard
 */
import * as sessionModule from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** One event the guard could not write, with why. */
export interface QuarantineEntry {
  at: number
  sessionId: string
  type: string
  data: unknown
  reason: string
}

export interface ChildLogGuardOptions {
  /** Receives every diverted event. */
  quarantine(entry: QuarantineEntry): void
  /**
   * The host's released-log check over a whole event list; returns the
   * failure message, or undefined when the list is valid. Absent: the guard
   * corrects and diverts by its own rules only.
   */
  validate?: ((session: Session, events: readonly SessionEvent[]) => string | undefined) | undefined
}

/** Events the released reader relates to turns and steps. */
const RELATIONAL = new Set([
  'turn/start', 'turn/end', 'step/start', 'step/end',
  'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result',
  'system/message', 'developer/message', 'request/header', 'request/context',
])
/** Events that must sit inside the open step. */
const STEP_BOUND = new Set(['assistant/message', 'assistant/attempt', 'tool/call', 'tool/result', 'system/message', 'developer/message'])
/** Events that only need an open turn. */
const TURN_BOUND = new Set(['request/header', 'request/context'])

const GUARDED = Symbol.for('@khorsheed/dsh-local-agent/child-log-guard')

type Data = Record<string, unknown>
type AppendOptions = { surfaceOp?: unknown; sourceEventSeqs?: number[] } | undefined
type RawAppend = (type: string, data: unknown, options?: AppendOptions) => SessionEvent

/** The relationship state of a log, as the released reader would see it after its last event. */
interface LogState {
  turn: number | null
  nextTurn: number
  step: number | null
  nextStep: number
  closed: Set<number>
  /** Calls advertised in the open step: id → whether its tool/call landed. */
  tools: Map<string, { name: unknown; arguments: unknown; started: boolean; callSeq?: number }>
  lastSeq: number
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function scan(events: readonly SessionEvent[]): LogState {
  const state: LogState = { turn: null, nextTurn: 1, step: null, nextStep: 1, closed: new Set(), tools: new Map(), lastSeq: -1 }
  for (const event of events) {
    state.lastSeq = Math.max(state.lastSeq, Number(event.seq))
    const data = (event.data ?? {}) as Data
    switch (event.type as string) {
      case 'turn/start':
        state.turn = num(data['turn']) ?? state.nextTurn
        state.nextStep = 1
        state.step = null
        state.tools.clear()
        break
      case 'turn/end':
        if (state.turn !== null) state.closed.add(state.turn)
        state.nextTurn = (state.turn ?? state.nextTurn - 1) + 1
        state.turn = null
        state.step = null
        break
      case 'step/start':
        state.step = num(data['step']) ?? state.nextStep
        break
      case 'step/end':
        state.nextStep = (state.step ?? state.nextStep - 1) + 1
        state.step = null
        state.tools.clear()
        break
      case 'assistant/message': {
        const message = data['message'] as { content?: unknown[] } | undefined
        for (const block of message?.content ?? []) {
          const b = block as Data
          if (b['type'] === 'tool-call' && typeof b['id'] === 'string') {
            state.tools.set(b['id'], { name: b['name'], arguments: b['arguments'], started: false })
          }
        }
        break
      }
      case 'tool/call': {
        const tool = typeof data['callId'] === 'string' ? state.tools.get(data['callId']) : undefined
        if (tool !== undefined) { tool.started = true; tool.callSeq = Number(event.seq) }
        break
      }
      case 'tool/result': {
        if ((event as { surfaceOp?: unknown }).surfaceOp !== 'append') break
        const id = (data['message'] as Data | undefined)?.['toolCallId']
        if (typeof id === 'string') state.tools.delete(id)
        break
      }
    }
  }
  return state
}

/** The host's crash-recovery closers, when this host exports them. */
const hostClosers = (sessionModule as { interruptedTurnClosers?: (events: readonly SessionEvent[]) => SessionEvent[] }).interruptedTurnClosers

/**
 * Install the guard on one member child session (idempotent).
 * @param session - the dsh child session a provider mirrors into.
 * @param options - the quarantine sink and the optional host validator.
 */
export function guardChildLog(session: Session, options: ChildLogGuardOptions): void {
  const target = session as unknown as { [GUARDED]?: true; append: RawAppend }
  if (target[GUARDED] === true || typeof target.append !== 'function' || typeof session.snapshotEvents !== 'function') return
  target[GUARDED] = true
  const raw: RawAppend = target.append.bind(session)
  /** Provider turn number → the logged turn it was written as. */
  const turnAlias = new Map<number, number>()
  /** `${loggedTurn}:${providerStep}` → the logged step it was written as. */
  const stepAlias = new Map<string, number>()

  const divert = (type: string, data: unknown, reason: string): SessionEvent => {
    options.quarantine({ at: Date.now(), sessionId: String(session.id), type, data, reason })
    // Callers may read the returned event (a tool/call's seq feeds its
    // result's sourceEventSeqs): a seq no event carries keeps that result
    // from passing as valid by accident.
    return { type, seq: -1, time: Date.now(), data } as unknown as SessionEvent
  }
  const appendClosers = (scope: 'step' | 'turn'): void => {
    const events = session.snapshotEvents()
    let closers = hostClosers?.(events) ?? []
    if (hostClosers === undefined) {
      const state = scan(events)
      if (state.step !== null) closers.push({ type: 'step/end', data: { turn: state.turn, step: state.step } } as unknown as SessionEvent)
      if (state.turn !== null) closers.push({ type: 'turn/end', data: { turn: state.turn, reason: { kind: 'interrupted' } } } as unknown as SessionEvent)
    }
    if (scope === 'step') closers = closers.filter(event => event.type !== 'turn/end')
    for (const closer of closers) {
      const extra = closer as unknown as { surfaceOp?: unknown; sourceEventSeqs?: number[] }
      const opts: AppendOptions = {
        ...extra.surfaceOp === undefined ? {} : { surfaceOp: extra.surfaceOp },
        ...extra.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: extra.sourceEventSeqs },
      }
      raw(closer.type, closer.data, Object.keys(opts).length === 0 ? undefined : opts)
    }
  }
  /**
   * The log length last known to pass the host's check. The check judges a
   * new event only against a log that passes it already: a log that was
   * invalid before the guard (an unrepaired history) would otherwise make
   * every later write fail and divert the whole round.
   */
  let validThrough = -1
  /** The final word: the host's own check of the log with this event appended. */
  const verified = (type: string, data: Data, opts: AppendOptions): string | undefined => {
    if (options.validate === undefined) return undefined
    const events = session.snapshotEvents()
    if (validThrough !== events.length) {
      if (options.validate(session, events) !== undefined) return undefined
      validThrough = events.length
    }
    const candidate = {
      type, data, time: Date.now(), seq: scan(events).lastSeq + 1,
      ...opts?.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp },
      ...opts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs },
    } as unknown as SessionEvent
    return options.validate(session, [...events, candidate])
  }
  const write = (type: string, data: Data, opts: AppendOptions): SessionEvent => {
    const failure = verified(type, data, opts)
    if (failure !== undefined) return divert(type, data, `rejected by the released-log check: ${failure}`)
    const event = raw(type, data, opts)
    if (validThrough >= 0) validThrough = session.snapshotEvents().length
    return event
  }

  target.append = (type: string, input: unknown, opts?: AppendOptions): SessionEvent => {
    if (!RELATIONAL.has(type) || typeof input !== 'object' || input === null) return raw(type, input, opts)
    const data: Data = { ...input as Data }
    let state = scan(session.snapshotEvents())
    const providerTurn = num(data['turn'])
    const loggedTurn = providerTurn === undefined ? undefined : turnAlias.get(providerTurn) ?? providerTurn

    if (type === 'turn/start') {
      if (state.turn !== null) { appendClosers('turn'); state = scan(session.snapshotEvents()) }
      if (providerTurn !== undefined) turnAlias.set(providerTurn, state.nextTurn)
      data['turn'] = state.nextTurn
      return write(type, data, opts)
    }
    // Every other relational event needs an open turn it may belong to.
    if (state.turn === null) return divert(type, input, 'no open turn')
    if (loggedTurn !== undefined && loggedTurn !== state.turn) {
      if (state.closed.has(loggedTurn) || loggedTurn < state.turn) return divert(type, input, `turn ${loggedTurn} is already closed`)
      // A turn the log never opened, while another is open: the open turn's content.
      if (providerTurn !== undefined) turnAlias.set(providerTurn, state.turn)
    }
    if ('turn' in data) data['turn'] = state.turn

    if (type === 'turn/end') {
      if (state.step !== null) appendClosers('step')
      return write(type, data, opts)
    }
    if (TURN_BOUND.has(type)) return write(type, data, opts)

    const providerStep = num(data['step'])
    const aliasKey = providerStep === undefined ? undefined : `${state.turn}:${providerStep}`
    if (type === 'step/start') {
      if (state.step !== null) { appendClosers('step'); state = scan(session.snapshotEvents()) }
      if (aliasKey !== undefined) stepAlias.set(aliasKey, state.nextStep)
      data['step'] = state.nextStep
      return write(type, data, opts)
    }
    const loggedStep = aliasKey === undefined ? undefined : stepAlias.get(aliasKey)
    if (type === 'step/end') {
      if (state.step === null || (loggedStep !== undefined && loggedStep !== state.step)) return divert(type, input, 'no matching open step')
      data['step'] = state.step
      return write(type, data, opts)
    }
    if (STEP_BOUND.has(type)) {
      const isReplacement = type === 'tool/result' && opts?.surfaceOp !== undefined && opts.surfaceOp !== 'append'
      if (isReplacement) return write(type, data, opts)
      if (loggedStep !== undefined && loggedStep !== state.step) return divert(type, input, `step ${loggedStep} is already closed`)
      if (state.step === null) {
        // A step-bound event with no step open: open the step it names.
        raw('step/start', { turn: state.turn, step: state.nextStep })
        if (aliasKey !== undefined) stepAlias.set(aliasKey, state.nextStep)
        state = scan(session.snapshotEvents())
      } else if (aliasKey !== undefined && loggedStep === undefined) {
        stepAlias.set(aliasKey, state.step as number)
      }
      if ('step' in data) data['step'] = state.step
      if (type === 'tool/call') {
        const id = data['callId']
        const tool = typeof id === 'string' ? state.tools.get(id) : undefined
        if (tool === undefined || tool.started) return divert(type, input, 'tool/call with no advertised, unstarted call')
      }
      if (type === 'tool/result') {
        const id = (data['message'] as Data | undefined)?.['toolCallId']
        const tool = typeof id === 'string' ? state.tools.get(id) : undefined
        if (tool === undefined) return divert(type, input, 'tool/result with no advertised call')
        if (!tool.started) {
          // Its call never landed: write it first, as advertised, so the
          // result resolves a real lifecycle.
          const call = raw('tool/call', { turn: state.turn, step: state.step, callId: id, name: tool.name, arguments: tool.arguments })
          return write(type, data, { ...opts, sourceEventSeqs: [Number(call.seq)] })
        }
        if (tool.callSeq !== undefined) return write(type, data, { ...opts, sourceEventSeqs: [tool.callSeq] })
      }
      return write(type, data, opts)
    }
    return write(type, data, opts)
  }
}
