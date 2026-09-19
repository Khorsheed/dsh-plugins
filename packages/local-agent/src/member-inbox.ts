import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { LocalAgentMemberInbox, LocalAgentMemberInput } from './types.ts'

type Execute = (memberId: string, text: string, signal: AbortSignal, admitted: () => void) => Promise<SubagentRun>

/** Durable human input; the provider FIFO remains the sole execution order. */
export class MemberInbox {
  private readonly states = new Map<string, LocalAgentMemberInbox>()
  private readonly active = new Map<string, { memberId: string; controller: AbortController }>()
  private readonly storageErrors = new Map<string, string>()
  private closed = false
  constructor(private readonly directory: string, private readonly execute: Execute, private readonly onError: (error: unknown) => void) {}

  private path(memberId: string): string { return join(this.directory, createHash('sha256').update(memberId).digest('hex') + '.json') }
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
    const statuses = ['queued', 'running', 'done', 'failed', 'cancelled', 'uncertain']
    if (stored?.version !== 1 || state?.memberId !== memberId || typeof state.paused !== 'boolean' || !Array.isArray(state.messages)
      || state.messages.some(row => typeof row?.id !== 'string' || typeof row.text !== 'string' || !statuses.includes(row.status)
        || !Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt) || (row.error !== undefined && typeof row.error !== 'string'))
      || new Set(state.messages.map(row => row.id)).size !== state.messages.length) throw new Error('Invalid member inbox; admission is blocked')
    const recovered = structuredClone(state)
    for (const row of recovered.messages) if (row.status === 'running') { row.status = 'uncertain'; row.error = 'Host restarted before durable settlement; reconcile this input before continuing' }
    if (recovered.messages.some(row => row.status === 'queued' || row.status === 'uncertain')) recovered.paused = true
    this.save(recovered)
    return recovered
  }

  private save(state: LocalAgentMemberInbox): void {
    const path = this.path(state.memberId)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const fd = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify({ version: 1, state })); fsyncSync(fd) } finally { closeSync(fd) }
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
  assertAdmission(memberId: string): void {
    if (this.storageErrors.has(memberId)) throw new Error('Member inbox persistence failed; reconcile storage before admission')
    const state = this.load(memberId)
    if (state.messages.some(row => row.status === 'uncertain')) throw new Error('A member input has an uncertain outcome; reconcile before continuing')
    if (state.paused && state.messages.some(row => row.status === 'queued')) throw new Error('Member inbox is paused; resume or cancel queued inputs first')
  }
  enqueue(memberId: string, text: string, requestId: string): LocalAgentMemberInput {
    if (this.closed) throw new Error('Member inbox is closed')
    if (text.trim() === '' || requestId.trim() === '') throw new Error('Member input and request ID must be non-empty')
    const state = this.read(memberId)
    const previous = state.messages.find(row => row.id === requestId)
    if (previous !== undefined) {
      if (previous.text !== text) throw new Error('Member input request ID was already used for different text')
      return previous
    }
    if (state.messages.filter(row => row.status === 'queued').length >= 100) throw new Error('Member inbox has reached its 100 queued input limit')
    const row: LocalAgentMemberInput = { id: requestId, text, status: 'queued', createdAt: Date.now(), updatedAt: Date.now() }
    state.messages.push(row)
    this.save(state)
    this.pump(memberId)
    return structuredClone(row)
  }
  pause(memberId: string): void {
    const state = this.read(memberId)
    state.paused = true
    this.save(state)
    for (const row of state.messages) if (row.status === 'queued') this.active.get(`${memberId}:${row.id}`)?.controller.abort(new Error('Inbox paused'))
  }
  resume(memberId: string): void {
    if (this.storageErrors.has(memberId)) { this.states.delete(memberId); this.storageErrors.delete(memberId) }
    const state = this.read(memberId)
    if (state.messages.some(row => row.status === 'uncertain')) throw new Error('Reconcile uncertain inputs before resuming')
    state.paused = false
    this.save(state)
    this.pump(memberId)
  }
  cancelStarting(memberId: string): boolean {
    const row = this.load(memberId).messages.find(input => input.status === 'running')
    const entry = row === undefined ? undefined : this.active.get(`${memberId}:${row.id}`)
    if (entry === undefined) return false
    entry.controller.abort(new Error('Member input stopped'))
    return true
  }
  cancel(memberId: string, id: string): void {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === id)
    if (row?.status !== 'queued') throw new Error('Only a queued input can be cancelled here; use member Stop for a running turn')
    row.status = 'cancelled'; row.updatedAt = Date.now()
    this.save(state)
    this.active.get(`${memberId}:${id}`)?.controller.abort(new Error('Queued input cancelled'))
  }
  reconcile(memberId: string, id: string, outcome: 'done' | 'cancelled', evidence: string): void {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === id)
    if (row?.status !== 'uncertain' || evidence.trim() === '') throw new Error('Reconciliation requires an uncertain input and evidence')
    row.status = outcome; row.error = evidence.trim(); row.updatedAt = Date.now()
    this.save(state)
  }
  private update(memberId: string, id: string, update: (row: LocalAgentMemberInput) => void): void {
    const state = this.read(memberId)
    const row = state.messages.find(row => row.id === id)
    if (row === undefined) throw new Error('Member input disappeared')
    update(row); row.updatedAt = Date.now()
    this.save(state)
  }
  private pump(memberId: string): void {
    if (this.closed || this.storageErrors.has(memberId)) return
    const state = this.load(memberId)
    if (state.paused || state.messages.some(row => row.status === 'uncertain')) return
    for (const row of state.messages) {
      const key = `${memberId}:${row.id}`
      if (row.status !== 'queued' || this.active.has(key)) continue
      const controller = new AbortController()
      this.active.set(key, { memberId, controller })
      void (async () => {
        try {
          const run = await this.execute(memberId, row.text, controller.signal, () => {
            controller.signal.throwIfAborted()
            this.assertAdmission(memberId)
            this.update(memberId, row.id, input => { if (input.status !== 'queued') throw new Error('Input is no longer queued'); input.status = 'running' })
          })
          const result = await run.result
          if (!this.closed) this.update(memberId, row.id, input => { input.status = result.stopReason === 'aborted' ? 'cancelled' : result.stopReason === 'completed' ? 'done' : 'failed' })
        } catch (error) {
          if (!this.closed) {
            const current = this.load(memberId)
            const status = current.messages.find(input => input.id === row.id)?.status
            if (!(controller.signal.aborted && current.paused && status === 'queued') && status !== 'cancelled') {
              this.update(memberId, row.id, input => { input.status = controller.signal.aborted ? 'cancelled' : 'failed'; input.error = String(error) })
            }
          }
        } finally { this.active.delete(key); if (!this.closed) this.pump(memberId) }
      })().catch(this.onError)
    }
  }
  dispose(): void { this.closed = true; for (const entry of this.active.values()) entry.controller.abort(new Error('Inbox disposed')); this.active.clear() }
}
