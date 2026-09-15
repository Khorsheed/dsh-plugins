import type {
  LocalAgentAppliedConfiguration, LocalAgentControlReceipt, LocalAgentMemberConfiguration,
  LocalAgentMemberControlState, LocalAgentResolvedConfiguration,
} from './types.ts'

export interface MemberControlRecord {
  state: LocalAgentMemberControlState
  requests: Record<string, { signature: string; receipt: LocalAgentControlReceipt }>
}

/** write must commit atomically or throw; no accepted receipt precedes durable storage. */
export interface MemberControlStorage {
  read(memberId: string): MemberControlRecord | undefined
  write(memberId: string, record: MemberControlRecord): void
}

export interface MemberConfigurationAdapter {
  /** Read-only validation. Unknown native values can fail later at the control boundary. */
  validate(selection: LocalAgentMemberConfiguration): Promise<void>
  /** No generation. Implementations must bound native controls and preserve session history. */
  apply(selection: LocalAgentMemberConfiguration, previous: LocalAgentAppliedConfiguration, operationId: string): Promise<LocalAgentResolvedConfiguration>
  /** Reconcile before retry/recovery; unknown never authorizes another round. */
  reconcile(state: LocalAgentMemberControlState): Promise<{
    active: boolean
    matches: 'current' | 'operation' | 'unknown'
    resolved: LocalAgentResolvedConfiguration
  }>
}

function normalize(selection: LocalAgentMemberConfiguration): LocalAgentMemberConfiguration {
  const choice = (value: LocalAgentMemberConfiguration['model']): LocalAgentMemberConfiguration['model'] => {
    if (value?.mode === 'inherit' || value?.mode === 'default') return { mode: value.mode }
    if (value?.mode === 'value' && typeof value.value === 'string' && value.value.trim() !== '' && !/[\r\n\0]/.test(value.value)) {
      return { mode: 'value', value: value.value.trim() }
    }
    throw new Error('Invalid model or effort selection')
  }
  return { model: choice(selection?.model), effort: choice(selection?.effort) }
}

/**
 * One durable, replaceable configuration slot. Intent acceptance never waits
 * for a running model turn or an in-flight native control. Native effects are
 * serialized separately and must converge before the next admission.
 */
export class MemberConfigurationController {
  private record: MemberControlRecord
  private recovering: boolean
  private worker: Promise<void> | undefined
  private activeLease = false
  private admitting = false
  private storageFailure: Error | undefined
  private readonly listeners = new Set<() => void>()

  constructor(
    readonly memberId: string,
    private readonly storage: MemberControlStorage,
    private readonly adapter: MemberConfigurationAdapter,
    initial: { selection: LocalAgentMemberConfiguration; resolved?: LocalAgentResolvedConfiguration; lockedReason?: string },
  ) {
    const existing = storage.read(memberId)
    this.recovering = existing !== undefined
    this.record = existing ?? {
      state: { memberId, revision: 0, current: { revision: 0, selection: normalize(initial.selection), resolved: initial.resolved ?? {} }, status: 'idle', ...initial.lockedReason === undefined ? {} : { lockedReason: initial.lockedReason } },
      requests: {},
    }
    if (this.record.state.memberId !== memberId) throw new Error('Member control identity mismatch')
    if (existing === undefined) storage.write(memberId, this.record)
  }

  read(): LocalAgentMemberControlState {
    const state = structuredClone(this.record.state)
    return this.storageFailure === undefined ? state : { ...state, status: 'failed', error: this.storageFailure.message }
  }

  private change(mutate: (record: MemberControlRecord) => void): void {
    const next = structuredClone(this.record)
    mutate(next)
    try { this.storage.write(this.memberId, next) } catch (error) {
      this.storageFailure = error instanceof Error ? error : new Error('Member configuration could not be persisted')
      throw this.storageFailure
    }
    this.storageFailure = undefined
    this.record = next
    for (const listener of this.listeners) listener()
  }

  private receipt(requestId: string, status: LocalAgentControlReceipt['status'], error?: string): LocalAgentControlReceipt {
    return { requestId, revision: this.record.state.revision, status, ...error === undefined ? {} : { error } }
  }

  private duplicate(requestId: string, signature: string): LocalAgentControlReceipt | undefined {
    const existing = Object.hasOwn(this.record.requests, requestId) ? this.record.requests[requestId] : undefined
    return existing === undefined ? undefined : existing.signature === signature
      ? structuredClone(existing.receipt) : this.receipt(requestId, 'conflict', 'Request ID was already used for a different operation')
  }

  private validRequestId(requestId: string): boolean {
    return typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 160
      && !Object.hasOwn(Object.prototype, requestId) && !/[\r\n\0]/.test(requestId)
  }

  async select(requestId: string, expectedRevision: number, selection: LocalAgentMemberConfiguration): Promise<LocalAgentControlReceipt> {
    if (!this.validRequestId(requestId)) return this.receipt(requestId, 'unsupported', 'Invalid control request ID')
    let next: LocalAgentMemberConfiguration
    try { next = normalize(selection) } catch (error) { return this.receipt(requestId, 'unsupported', String(error)) }
    const signature = JSON.stringify(['select', next])
    const duplicate = this.duplicate(requestId, signature)
    if (duplicate !== undefined) return duplicate
    const locked = this.record.state.lockedReason
    if (locked !== undefined) return this.receipt(requestId, 'locked', locked)
    if (this.record.state.revision !== expectedRevision) return this.receipt(requestId, 'conflict', 'Configuration changed; refresh before submitting')
    try { await this.adapter.validate(next) } catch (error) { return this.receipt(requestId, 'unsupported', error instanceof Error ? error.message : String(error)) }
    // Validation yields; admission or another entrance may have changed state.
    const repeated = this.duplicate(requestId, signature)
    if (repeated !== undefined) return repeated
    if (this.record.state.revision !== expectedRevision) return this.receipt(requestId, 'conflict', 'Configuration changed during validation')
    this.change(record => {
      const state = record.state
      const previous = state.pending
      if (previous !== undefined && previous.revision !== state.operation?.revision) {
        const receipt = record.requests[previous.requestId]?.receipt
        if (receipt !== undefined) { receipt.status = 'cancelled'; receipt.error = 'Replaced by a newer selection' }
      }
      state.revision++
      state.pending = { revision: state.revision, requestId, kind: 'selection', selection: next }
      state.status = 'pending'
      delete state.error
      record.requests[requestId] = { signature, receipt: { requestId, revision: state.revision, status: 'pending' } }
    })
    this.kick()
    return structuredClone(this.record.requests[requestId]!.receipt)
  }

  cancel(requestId: string, expectedRevision: number): LocalAgentControlReceipt {
    if (!this.validRequestId(requestId)) return this.receipt(requestId, 'unsupported', 'Invalid control request ID')
    const signature = JSON.stringify(['cancel', expectedRevision])
    const duplicate = this.duplicate(requestId, signature)
    if (duplicate !== undefined) return duplicate
    if (this.record.state.revision !== expectedRevision) return this.receipt(requestId, 'conflict', 'Pending selection changed; refresh before cancelling')
    if (this.record.state.pending === undefined) return this.receipt(requestId, 'applied', 'The selection has already applied')
    this.change(record => {
      const state = record.state
      const previous = state.pending!
      const old = record.requests[previous.requestId]?.receipt
      if (old !== undefined) old.status = 'cancelled'
      state.revision++
      delete state.error
      if (state.operation === undefined) {
        delete state.pending
        state.status = 'idle'
      } else {
        // An older control is already on the wire. Restore the last applied
        // selection before releasing admission, even if that older ack lands.
        state.pending = { revision: state.revision, requestId, kind: 'cancel', selection: structuredClone(state.current.selection) }
        state.status = 'pending'
      }
      record.requests[requestId] = { signature, receipt: { requestId, revision: state.revision, status: state.pending === undefined ? 'cancelled' : 'pending' } }
    })
    this.kick()
    return structuredClone(this.record.requests[requestId]!.receipt)
  }

  /** Failed intent stays in place. Retry first reconciles the uncertain operation. */
  retry(expectedRevision: number): Promise<void> {
    if (this.record.state.revision !== expectedRevision) return Promise.reject(new Error('Configuration revision conflict'))
    if (this.record.state.status !== 'failed' && this.storageFailure === undefined) return this.worker ?? Promise.resolve()
    this.change(record => { record.state.status = record.state.pending === undefined ? 'idle' : 'pending'; delete record.state.error })
    this.recovering = true
    return this.work()
  }

  private kick(): void {
    if (!this.activeLease) void this.work().catch(() => {})
  }

  private work(): Promise<void> {
    if (this.worker !== undefined) return this.worker
    const worker = this.drain()
    this.worker = worker
    const clear = (): void => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.record.state.pending !== undefined && this.record.state.status !== 'failed' && !this.activeLease && this.storageFailure === undefined) this.kick()
    }
    void worker.then(clear, clear)
    return worker
  }

  private completeOperation(record: MemberControlRecord, resolved: LocalAgentResolvedConfiguration): void {
    const operation = record.state.operation!
    record.state.current = { revision: operation.revision, selection: operation.selection, resolved }
    const receipt = record.requests[operation.requestId]?.receipt
    if (receipt !== undefined) receipt.status = operation.kind === 'cancel' ? 'cancelled' : 'applied'
    if (record.state.pending?.revision === operation.revision) delete record.state.pending
    delete record.state.operation
    record.state.status = record.state.pending === undefined ? 'idle' : 'pending'
    delete record.state.error
  }

  private async reconcile(): Promise<void> {
    this.change(record => { record.state.status = 'reconciling' })
    const inspected = await this.adapter.reconcile(this.read())
    if (inspected.active) throw new Error('The native session still has an active round')
    if (inspected.matches === 'unknown' || (inspected.matches === 'operation' && this.record.state.operation === undefined)) {
      throw new Error('Native configuration could not be reconciled; admission remains blocked')
    }
    this.change(record => {
      if (inspected.matches === 'operation') this.completeOperation(record, inspected.resolved)
      else {
        record.state.current.resolved = inspected.resolved
        delete record.state.operation
        record.state.status = record.state.pending === undefined ? 'idle' : 'pending'
      }
      delete record.state.round
      delete record.state.error
    })
    this.recovering = false
  }

  private async drain(): Promise<void> {
    if (this.activeLease) return
    if (this.storageFailure !== undefined) throw this.storageFailure
    if (this.record.state.status === 'failed') throw new Error(this.record.state.error ?? 'Configuration requires retry or cancellation')
    try {
      if (this.recovering || this.record.state.operation !== undefined) await this.reconcile()
      while (!this.activeLease && this.record.state.pending !== undefined) {
        this.change(record => {
          const pending = record.state.pending!
          record.state.operation = { ...pending, previous: structuredClone(record.state.current) }
          record.state.status = 'applying'
          record.requests[pending.requestId]!.receipt.status = 'applying'
        })
        const operation = structuredClone(this.record.state.operation!)
        const resolved = await this.adapter.apply(operation.selection, operation.previous, `${this.memberId}:${operation.revision}`)
        this.change(record => { this.completeOperation(record, resolved) })
      }
    } catch (error) {
      this.recovering = true
      this.change(record => {
        record.state.status = 'failed'
        record.state.error = error instanceof Error ? error.message : String(error)
        const requestId = record.state.pending?.requestId
        if (requestId !== undefined) record.requests[requestId]!.receipt.status = 'failed'
      })
      throw error
    }
  }

  /** The returned immutable lease belongs to one entire model/tool round. */
  async admit(roundId: string): Promise<{ configuration: LocalAgentAppliedConfiguration; release: () => void }> {
    if (this.activeLease || this.admitting) throw new Error('The member already has an active or admitting round')
    this.admitting = true
    try {
      do { await this.work() } while (this.record.state.pending !== undefined)
      if (this.record.state.status === 'failed') throw new Error(this.record.state.error)
      const configuration = structuredClone(this.record.state.current)
      this.change(record => { record.state.round = { id: roundId, configuration: structuredClone(configuration) } })
      Object.freeze(configuration.selection.model)
      Object.freeze(configuration.selection.effort)
      Object.freeze(configuration.selection)
      Object.freeze(configuration.resolved)
      Object.freeze(configuration)
      this.activeLease = true
      let released = false
      return { configuration, release: () => {
        if (released) return
        this.change(record => { delete record.state.round })
        released = true
        this.activeLease = false
        this.kick()
      } }
    } finally { this.admitting = false }
  }

  async *follow(signal: AbortSignal): AsyncIterable<LocalAgentMemberControlState> {
    let changed = true
    let wake: (() => void) | undefined
    const notify = (): void => { changed = true; wake?.(); wake = undefined }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted) {
        if (changed) { changed = false; yield this.read() }
        else await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }
}
