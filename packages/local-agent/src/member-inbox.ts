/**
 * The per-member execution ledger (batch 5 S4): the one durable queue every
 * member execution passes through — the member composer's human input, the
 * host `subagent` tool, room, and plugin facade calls alike. It grew out of
 * the member composer's inbox (same directory, same atomic write, same file
 * per member) and still reads that inbox's version-1 files.
 *
 * - **Order.** Rows dispatch strictly one at a time per member, in ledger
 *   order: the next row starts only after the previous row's run settled.
 *   `MemberControls`' in-memory FIFO stays below it as the executor (it then
 *   never holds more than the one row the ledger dispatched).
 * - **Key dedup.** A caller's idempotency key names at most one row per
 *   member; the registry checks it before submitting.
 * - **Persistence split.** Composer rows carry their text and replay after a
 *   restart. Every other caller's row carries no input (room assembles its
 *   prompt at admission; a tool call's host turn is gone): a queued one is
 *   dropped on load and its caller resubmits under the same key.
 * - **Restart recovery, in one place.** A row still `running` when the file
 *   is loaded becomes `uncertain`, whoever submitted it; an uncertain row
 *   blocks every later admission of that member until it is reconciled. The
 *   exception is a round the CLI opened itself (caller `cli`, {@link MemberInbox.runNow}):
 *   it ends `failed` with {@link SELF_ROUND_RESTARTED} and blocks nothing.
 * @module @khorsheed/dsh-local-agent/member-inbox
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { LocalAgentExecutionCaller, LocalAgentMemberInbox, LocalAgentMemberInput } from './types.ts'

/** Run one ledger row: called when the row reaches the head of its member's queue. */
export type LedgerDispatch = (signal: AbortSignal, admitted: () => void, row: LocalAgentMemberInput) => Promise<SubagentRun>

/** How a composer row (and a composer row replayed after a restart) runs. */
type ComposerDispatch = (memberId: string, row: LocalAgentMemberInput, signal: AbortSignal, admitted: () => void) => Promise<SubagentRun>

/** A submitted row's in-memory companion: how it runs and who waits for its end. */
interface Pending {
  readonly dispatch?: LedgerDispatch
  /** Called once when the row reaches a terminal status (or the ledger is disposed). */
  readonly final?: (row: LocalAgentMemberInput, run: SubagentRun | undefined, error: unknown) => void
}

/** The ledger file format this build writes; version 1 is the old member inbox. */
const LEDGER_VERSION = 2
const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled', 'uncertain']
const CALLERS: readonly LocalAgentExecutionCaller[] = ['tool', 'composer', 'room', 'api', 'cli']
const TERMINAL = new Set(['done', 'failed', 'cancelled'])
/** Terminal rows kept per member (key dedup reaches back this far). */
const KEEP_TERMINAL = 200
const QUEUE_LIMIT = 100
/** The error a self-opened round's row ends with when a restart cut it off (see load). */
export const SELF_ROUND_RESTARTED = 'Host restarted during a round the member\'s CLI opened itself; its outcome is unknown'

function validRow(row: Partial<LocalAgentMemberInput> | undefined, version: number): boolean {
  if (typeof row?.id !== 'string' || !STATUSES.includes(row.status as string)) return false
  if (!Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt)) return false
  if (row.error !== undefined && typeof row.error !== 'string') return false
  if (version === 1) return typeof row.text === 'string'
  if (!CALLERS.includes(row.caller as LocalAgentExecutionCaller)) return false
  if (row.text !== undefined && typeof row.text !== 'string') return false
  if (row.key !== undefined && typeof row.key !== 'string') return false
  return row.caller !== 'composer' || typeof row.text === 'string'
}

/** One member execution ledger per member; see the module comment. */
export class MemberInbox {
  private readonly states = new Map<string, LocalAgentMemberInbox>()
  /** The row each member has dispatched (at most one), and its abort lever. */
  private readonly active = new Map<string, { id: string; controller: AbortController }>()
  private readonly pending = new Map<string, Pending>()
  private readonly storageErrors = new Map<string, string>()
  /** Rows this process found `running` on load (the restart that started it cut them off), per member. */
  private readonly cutOffThisBoot = new Map<string, Set<string>>()
  private closed = false
  constructor(private readonly directory: string, private readonly composer: ComposerDispatch, private readonly onError: (error: unknown) => void) {}

  private path(memberId: string): string { return join(this.directory, createHash('sha256').update(memberId).digest('hex') + '.json') }
  private pendingKey(memberId: string, id: string): string { return `${memberId}\u0000${id}` }

  private load(memberId: string): LocalAgentMemberInbox {
    const known = this.states.get(memberId)
    if (known !== undefined) return known
    let raw: string
    try { raw = readFileSync(this.path(memberId), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const empty: LocalAgentMemberInbox = { memberId, paused: false, messages: [] }
      this.states.set(memberId, empty)
      return empty
    }
    const stored = JSON.parse(raw) as { version: number; state: LocalAgentMemberInbox }
    const state = stored?.state
    const version = stored?.version
    if ((version !== 1 && version !== LEDGER_VERSION) || state?.memberId !== memberId || typeof state.paused !== 'boolean' || !Array.isArray(state.messages)
      || state.messages.some(row => !validRow(row, version))
      || new Set(state.messages.map(row => row.id)).size !== state.messages.length) throw new Error('Invalid member inbox; admission is blocked')
    const recovered = structuredClone(state)
    // Version 1 held only member-composer input, keyed by its request id.
    if (version === 1) recovered.messages = recovered.messages.map(row => ({ ...row, caller: 'composer' as const, key: row.id }))
    // A queued row without its input cannot replay; its caller resubmits it.
    recovered.messages = recovered.messages.filter(row => row.status !== 'queued' || row.text !== undefined)
    const cutOff = new Set<string>()
    for (const row of recovered.messages) {
      if (row.status !== 'running') continue
      // A round the CLI opened itself is nobody's request: there is no
      // delivery to reconcile, so it never blocks the member — it ends here,
      // and its execution's end record reads `uncertain` (core).
      if (row.caller === 'cli') { row.status = 'failed'; row.error = SELF_ROUND_RESTARTED; row.updatedAt = row.settledAt = Date.now(); continue }
      row.status = 'uncertain'; row.error = 'Host restarted before durable settlement; reconcile this input before continuing'
      cutOff.add(row.id)
    }
    if (cutOff.size > 0) this.cutOffThisBoot.set(memberId, cutOff)
    if (!recovered.paused && recovered.messages.some(row => row.status === 'queued' || row.status === 'uncertain')) { recovered.paused = true; recovered.pausedBy = 'restart' }
    this.save(recovered)
    return recovered
  }

  private save(state: LocalAgentMemberInbox): void {
    const path = this.path(state.memberId)
    const temporary = `${path}.${randomUUID()}.tmp`
    const terminal = state.messages.filter(row => TERMINAL.has(row.status))
    if (terminal.length > KEEP_TERMINAL) {
      const drop = new Set(terminal.slice(0, terminal.length - KEEP_TERMINAL))
      state.messages = state.messages.filter(row => !drop.has(row))
    }
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const fd = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify({ version: LEDGER_VERSION, state })); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, path)
      const directory = openSync(this.directory, 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
      this.states.set(state.memberId, state)
      this.storageErrors.delete(state.memberId)
    } catch (error) { this.storageErrors.set(state.memberId, String(error)); throw error } finally { try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  }
  read(memberId: string): LocalAgentMemberInbox {
    const state = structuredClone(this.load(memberId))
    const error = this.storageErrors.get(memberId)
    return error === undefined ? state : { ...state, error }
  }
  /**
   * Members the restart that started THIS process cut off (M10, the startup
   * room load): a row still written `running` in a ledger file nobody has
   * loaded since the restart, or a row this process converted from
   * `running` to `uncertain` on load and that is still unreconciled. A row
   * that was already `uncertain` on disk is an older restart's leftover and
   * does not count — those wait for the human, never for a startup load.
   * Read-only: nothing is loaded, converted or saved; an unreadable
   * directory or file is skipped.
   * @returns the member ids (dsh child session ids), each once.
   */
  interruptedMembers(): string[] {
    const members = new Set<string>()
    for (const [memberId, state] of this.states) {
      const cutOff = this.cutOffThisBoot.get(memberId)
      if (cutOff !== undefined && state.messages.some(row => row.status === 'uncertain' && cutOff.has(row.id))) members.add(memberId)
    }
    let names: string[]
    try { names = readdirSync(this.directory) } catch { return [...members] }
    const loaded = new Set([...this.states.keys()].map(memberId => this.path(memberId)))
    for (const name of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue
      const path = join(this.directory, name)
      if (loaded.has(path)) continue
      try {
        const stored = JSON.parse(readFileSync(path, 'utf8')) as { state?: { memberId?: unknown; messages?: unknown } }
        const memberId = stored?.state?.memberId
        const rows = stored?.state?.messages
        if (typeof memberId !== 'string' || !Array.isArray(rows) || this.path(memberId) !== path) continue
        // A round the CLI opened itself ends `failed` on load (nothing to continue).
        if (rows.some((row: { status?: unknown; caller?: unknown } | null) => row?.status === 'running' && row?.caller !== 'cli')) members.add(memberId)
      } catch { /* an unreadable ledger is reported when its member is next read */ }
    }
    return [...members]
  }
  /** A row by its id (the execution id) or, failing that, by its caller key. */
  find(memberId: string, idOrKey: string): LocalAgentMemberInput | undefined {
    const rows = this.load(memberId).messages
    const row = rows.find(row => row.id === idOrKey) ?? rows.find(row => row.key === idOrKey)
    return row === undefined ? undefined : structuredClone(row)
  }
  /**
   * Whether the member may admit another execution now: storage works, no
   * row is uncertain, and the queue is not paused with composer input
   * waiting (the row the ledger itself dispatched does not count).
   */
  assertAdmission(memberId: string): void {
    if (this.storageErrors.has(memberId)) throw new Error('Member inbox persistence failed; reconcile storage before admission')
    const state = this.load(memberId)
    if (state.messages.some(row => row.status === 'uncertain')) throw new Error('A member input has an uncertain outcome; reconcile before continuing')
    const dispatched = this.active.get(memberId)?.id
    if (state.paused && state.messages.some(row => row.status === 'queued' && row.id !== dispatched)) throw new Error('Member inbox is paused; resume or cancel queued inputs first')
  }

  /**
   * Accept one row, durably, before anything runs: queued at the end of the
   * member's ledger. `dispatch` runs it at the head of the queue (a composer
   * row without one runs through the composer dispatch); `final` hears its
   * terminal status.
   */
  submit(memberId: string, row: { id: string; key?: string; caller: LocalAgentExecutionCaller; text?: string; operation?: 'compact' }, pending: Pending = {}): LocalAgentMemberInput {
    if (this.closed) throw new Error('Member inbox is closed')
    const state = this.read(memberId)
    if (state.messages.some(existing => existing.id === row.id || (row.key !== undefined && existing.key === row.key))) throw new Error('Member execution id or key already exists')
    if (state.messages.filter(existing => existing.status === 'queued').length >= QUEUE_LIMIT) throw new Error(`Member inbox has reached its ${QUEUE_LIMIT} queued input limit`)
    const now = Date.now()
    const accepted: LocalAgentMemberInput = {
      id: row.id, caller: row.caller, status: 'queued', createdAt: now, updatedAt: now,
      ...row.key === undefined ? {} : { key: row.key },
      ...row.text === undefined ? {} : { text: row.text },
      ...row.operation === undefined ? {} : { operation: row.operation },
    }
    state.messages.push(accepted)
    this.save(state)
    this.pending.set(this.pendingKey(memberId, row.id), pending)
    this.pump(memberId)
    return structuredClone(accepted)
  }

  pause(memberId: string): void {
    const state = this.read(memberId)
    state.paused = true
    delete state.pausedBy
    this.save(state)
    // The dispatched composer row that is not admitted yet goes back to waiting.
    const active = this.active.get(memberId)
    const row = active === undefined ? undefined : state.messages.find(input => input.id === active.id)
    if (row?.status === 'queued' && row.caller === 'composer') active!.controller.abort(new Error('Inbox paused'))
  }
  resume(memberId: string): void {
    if (this.storageErrors.has(memberId)) { this.states.delete(memberId); this.storageErrors.delete(memberId) }
    const state = this.read(memberId)
    if (state.messages.some(row => row.status === 'uncertain')) throw new Error('Reconcile uncertain inputs before resuming')
    state.paused = false
    delete state.pausedBy
    this.save(state)
    this.pump(memberId)
  }
  /** Stop the member's dispatched row before its run published (the facade's cancel when no run is tracked). */
  cancelStarting(memberId: string): boolean {
    const active = this.active.get(memberId)
    if (active === undefined) return false
    const row = this.load(memberId).messages.find(input => input.id === active.id)
    if (row?.status !== 'running' && row?.status !== 'queued') return false
    active.controller.abort(new Error('Member input stopped'))
    return true
  }
  /** Cancel one queued row (by execution id or key); a running one is stopped through the member's Stop. */
  cancel(memberId: string, idOrKey: string): void {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === idOrKey) ?? state.messages.find(row => row.key === idOrKey)
    if (row?.status !== 'queued') throw new Error('Only a queued input can be cancelled here; use member Stop for a running turn')
    row.status = 'cancelled'; row.updatedAt = Date.now(); row.settledAt = row.updatedAt
    liftRestartPause(state)
    this.save(state)
    const active = this.active.get(memberId)
    if (active?.id === row.id) active.controller.abort(new Error('Queued input cancelled'))
    else this.finish(memberId, row, undefined, new Error('Queued input cancelled'))
  }
  /** Settle an uncertain row with the operator's evidence (reconcileExecution). */
  reconcile(memberId: string, idOrKey: string, outcome: 'done' | 'failed' | 'cancelled', evidence: string): void {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === idOrKey) ?? state.messages.find(row => row.key === idOrKey)
    if (row?.status !== 'uncertain' || evidence.trim() === '') throw new Error('Reconciliation requires an uncertain input and evidence')
    row.status = outcome; row.error = evidence.trim(); row.updatedAt = Date.now(); row.settledAt = row.updatedAt; row.reconciledAt = row.updatedAt
    liftRestartPause(state)
    this.save(state)
    this.pump(memberId)
  }
  private update(memberId: string, id: string, update: (row: LocalAgentMemberInput) => void): LocalAgentMemberInput {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === id)
    if (row === undefined) throw new Error('Member input disappeared')
    update(row); row.updatedAt = Date.now()
    if (TERMINAL.has(row.status)) row.settledAt = row.updatedAt
    this.save(state)
    return structuredClone(row)
  }
  /** Tell a row's waiter it ended (once). */
  private finish(memberId: string, row: LocalAgentMemberInput, run: SubagentRun | undefined, error: unknown): void {
    const key = this.pendingKey(memberId, row.id)
    const pending = this.pending.get(key)
    this.pending.delete(key)
    try { pending?.final?.(structuredClone(row), run, error) } catch (failure) { this.onError(failure) }
  }
  private pump(memberId: string): void {
    if (this.closed || this.storageErrors.has(memberId) || this.active.has(memberId)) return
    const state = this.load(memberId)
    if (state.messages.some(row => row.status === 'uncertain')) return
    const row = state.messages.find(input => input.status === 'queued')
    if (row === undefined || (state.paused && row.caller === 'composer')) return
    const pending = this.pending.get(this.pendingKey(memberId, row.id))
    const admitted = (controller: AbortController) => (): void => {
      controller.signal.throwIfAborted()
      this.assertAdmission(memberId)
      this.update(memberId, row.id, input => { if (input.status !== 'queued') throw new Error('Input is no longer queued'); input.status = 'running'; input.admittedAt = Date.now() })
    }
    this.drive(memberId, row, pending, admitted)
  }

  /**
   * A round the member's CLI already runs (a self-opened round, caller
   * `cli`): recorded `running` at once and holding the member's slot — the
   * rows queued meanwhile wait for it — never queued itself. Refused
   * (undefined) while another row holds the slot, while a row is uncertain,
   * or when storage failed; a paused queue does not refuse it (it consumes
   * no queued input).
   * @param memberId - the member.
   * @param row - the row's id and caller.
   * @param pending - how it runs (`dispatch`, whose `admitted` is a no-op) and who hears its end.
   * @returns the accepted row, or undefined when refused.
   */
  runNow(memberId: string, row: { id: string; caller: LocalAgentExecutionCaller }, pending: Pending): LocalAgentMemberInput | undefined {
    if (this.closed || this.storageErrors.has(memberId) || this.active.has(memberId)) return undefined
    const state = this.read(memberId)
    if (state.messages.some(existing => existing.status === 'uncertain' || existing.id === row.id)) return undefined
    const now = Date.now()
    const accepted: LocalAgentMemberInput = { id: row.id, caller: row.caller, status: 'running', createdAt: now, updatedAt: now, admittedAt: now }
    state.messages.push(accepted)
    try { this.save(state) } catch { return undefined }
    this.pending.set(this.pendingKey(memberId, row.id), pending)
    this.drive(memberId, accepted, pending, () => () => {})
    return structuredClone(accepted)
  }

  /** Run one row as the member's active row, then settle it and pump the next. */
  private drive(memberId: string, row: LocalAgentMemberInput, pending: Pending | undefined, admittedFor: (controller: AbortController) => () => void): void {
    const controller = new AbortController()
    this.active.set(memberId, { id: row.id, controller })
    void (async () => {
      let run: SubagentRun | undefined
      let failure: unknown
      try {
        const admitted = admittedFor(controller)
        if (pending?.dispatch !== undefined) run = await pending.dispatch(controller.signal, admitted, structuredClone(row))
        else if (row.caller === 'composer') run = await this.composer(memberId, structuredClone(row), controller.signal, admitted)
        else throw new Error('Member execution has no dispatcher (its caller must resubmit it)')
        // A provider that never reported its admission: the run published, so it was admitted.
        if (this.load(memberId).messages.find(input => input.id === row.id)?.status === 'queued') {
          this.update(memberId, row.id, input => { input.status = 'running'; input.admittedAt = Date.now() })
        }
        const result = await run.result
        if (!this.closed) {
          const settled = this.update(memberId, row.id, input => { input.status = result.stopReason === 'aborted' ? 'cancelled' : result.stopReason === 'completed' ? 'done' : 'failed' })
          this.finish(memberId, settled, run, undefined)
        }
      } catch (error) {
        failure = error
        if (!this.closed) {
          const current = this.load(memberId)
          const status = current.messages.find(input => input.id === row.id)?.status
          // A paused composer row goes back to waiting; everything else ends here.
          if (controller.signal.aborted && current.paused && status === 'queued' && row.caller === 'composer') return
          const settled = status === 'cancelled'
            ? current.messages.find(input => input.id === row.id)!
            : this.update(memberId, row.id, input => { input.status = controller.signal.aborted ? 'cancelled' : 'failed'; input.error = String(error) })
          this.finish(memberId, structuredClone(settled), run, failure)
        }
      } finally { if (this.active.get(memberId)?.controller === controller) this.active.delete(memberId); if (!this.closed) this.pump(memberId) }
    })().catch(this.onError)
  }
  /** Composer input (the members page): dedup by request id, then one ledger row. */
  enqueue(memberId: string, text: string, requestId: string, submit: (row: { text: string; key: string }) => void): LocalAgentMemberInput {
    if (this.closed) throw new Error('Member inbox is closed')
    if (text.trim() === '' || requestId.trim() === '') throw new Error('Member input and request ID must be non-empty')
    const previous = this.read(memberId).messages.find(row => row.key === requestId || (row.caller === 'composer' && row.id === requestId))
    if (previous !== undefined) {
      if (previous.text !== text) throw new Error('Member input request ID was already used for different text')
      return previous
    }
    submit({ text, key: requestId })
    const row = this.find(memberId, requestId)
    if (row === undefined) throw new Error('Member input was not accepted')
    return row
  }
  dispose(): void {
    this.closed = true
    for (const entry of this.active.values()) entry.controller.abort(new Error('Inbox disposed'))
    this.active.clear()
    const waiting = [...this.pending.entries()]
    this.pending.clear()
    // Waiters hear the end of their wait; the file keeps the rows as they
    // are (the next load recovers them).
    for (const [key, pending] of waiting) {
      const [memberId, id] = key.split('\u0000') as [string, string]
      const row = this.states.get(memberId)?.messages.find(input => input.id === id)
      const now = Date.now()
      const ended: LocalAgentMemberInput = row === undefined
        ? { id, caller: 'api', status: 'cancelled', createdAt: now, updatedAt: now, error: 'Inbox disposed' }
        : { ...structuredClone(row), status: TERMINAL.has(row.status) ? row.status : 'cancelled', error: 'Inbox disposed' }
      try { pending.final?.(ended, undefined, new Error('Inbox disposed')) } catch (error) { this.onError(error) }
    }
  }
}

/** The ledger under its batch-5 name. */
export { MemberInbox as MemberLedger }

/**
 * The boot pause exists so nothing replays before its lost round is decided.
 * Once no row is uncertain and no composer input waits, nothing is left to
 * decide: it lifts (an operator's own pause never does).
 */
function liftRestartPause(state: LocalAgentMemberInbox): void {
  if (!state.paused || state.pausedBy !== 'restart') return
  if (state.messages.some(row => row.status === 'uncertain' || (row.status === 'queued' && row.caller === 'composer'))) return
  state.paused = false
  delete state.pausedBy
}
