/**
 * A test double of local-agent's execution entry `run()` (batch 5 S4) laid
 * over a spec's scripted `start`/`resume` mocks, so room specs keep scripting
 * provider rounds the way they always did while room itself only calls
 * `run()`.
 *
 * It keeps the entry's observable contract: one strict queue per member (the
 * next round starts after the previous round's result), first round vs
 * continuation decided by the double (a member that published a run
 * continues), the lazy input evaluated at the head of the queue, key dedup,
 * `on.admitted` at admission, and a settlement whose `turns` are the
 * `turn/start`s the child wrote since admission. It also keeps a ledger the
 * way the core does (batch 5 S7): one row per execution with its key and
 * status, readable through `readMemberInbox` and settled through
 * `reconcileExecution` — unless the spec scripts those itself. A stub whose
 * `supportsMemberConfiguration(provider)` answers true admits through the
 * mock's own `onAdmitted` (a provider's admission point); otherwise the double
 * admits just before calling the mock.
 */
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { LocalAgentExecutionHandle, LocalAgentExecutionRequest, LocalAgentExecutionSettlement } from '@khorsheed/dsh-local-agent/types'

type Mock = (...args: never[]) => unknown

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The stub shape the double reads (the spec's scripted facade). */
interface ScriptedStub {
  start?: Mock
  resume?: Mock
  run?: unknown
  supportsMemberConfiguration?: (provider: string) => boolean
  isPreparedMember?: (id: string) => boolean
  [key: string]: unknown
}

/**
 * Add a `run` vi.fn to a scripted facade stub (mutates and returns it).
 * @param stub - the object the room's probe reads.
 * @param ctx - the composition, when settlements should carry the child's turns.
 * @returns the same stub.
 */
/** A ledger row a spec seeds (an execution from a previous process, say). */
export interface SeededRow { id: string; key?: string; caller: string; status: string; text?: string; error?: string }

export function withRunEntry<T extends ScriptedStub>(stub: T, ctx?: Context): T & { run: ReturnType<typeof vi.fn>; seedLedgerRow: (child: string, row: SeededRow) => void } {
  /** Requested child id → the child that published (a member with a record continues). */
  const published = new Map<string, string>()
  const tails = new Map<string, Promise<unknown>>()
  const keys = new Map<string, LocalAgentExecutionHandle>()
  /** The core's ledger, per requested child id (a published child shares its requester's rows). */
  const ledger = new Map<string, Array<SeededRow & { createdAt: number; updatedAt: number }>>()
  const rowsOf = (child: string) => {
    const queue = published.get(child) ?? child
    const rows = ledger.get(queue) ?? []
    ledger.set(queue, rows)
    return rows
  }
  const mark = (child: string, id: string, status: string, error?: string): void => {
    const row = rowsOf(child).find(entry => entry.id === id)
    if (row !== undefined) { row.status = status; if (error !== undefined) row.error = error }
  }
  if (stub.readMemberInbox === undefined) {
    stub.readMemberInbox = (child: string) => ({ memberId: child, paused: false, messages: rowsOf(child).map(row => ({ ...row })) })
  }
  if (stub.reconcileExecution === undefined) {
    stub.reconcileExecution = (child: string, id: string, outcome: string, evidence: string) => {
      const row = rowsOf(child).find(entry => entry.id === id || entry.key === id)
      if (row?.status !== 'uncertain' || evidence.trim() === '') throw new Error('Reconciliation requires an uncertain input and evidence')
      row.status = outcome; row.error = evidence.trim()
    }
  }
  const seqOf = (child: string): number => {
    const last = ctx?.sessions.get(SessionId(child))?.snapshotEvents().at(-1)
    return last === undefined ? 0 : Number(last.seq) + 1
  }
  const turnsOf = (child: string, from: number): number[] => (ctx?.sessions.get(SessionId(child))?.snapshotEvents() ?? [])
    .flatMap(event => event.type === 'turn/start' && event.seq >= from ? [event.data.turn] : [])
  const run = vi.fn(async (request: LocalAgentExecutionRequest): Promise<LocalAgentExecutionHandle> => {
    const requested = request.member.childSessionId
    const keyId = request.key === undefined ? undefined : `${requested} ${request.key}`
    if (keyId !== undefined && keys.has(keyId)) return keys.get(keyId)!
    // The core refuses every caller but the composer while a row is uncertain.
    if (rowsOf(requested).some(row => row.status === 'uncertain')) throw new Error('A member input has an uncertain outcome; reconcile before continuing')
    const executionId = randomUUID()
    rowsOf(requested).push({ id: executionId, ...request.key === undefined ? {} : { key: request.key }, caller: request.caller ?? 'api', status: 'queued', createdAt: 0, updatedAt: 0 })
    let resolveStarted!: (run: SubagentRun) => void
    let rejectStarted!: (error: unknown) => void
    const started = new Promise<SubagentRun>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject })
    void started.catch(() => {})
    let resolveSettled!: (settlement: LocalAgentExecutionSettlement) => void
    const settled = new Promise<LocalAgentExecutionSettlement>((resolve) => { resolveSettled = resolve })
    const queue = published.get(requested) ?? requested
    const tail = tails.get(queue) ?? Promise.resolve()
    const finish = (settlement: LocalAgentExecutionSettlement): void => {
      request.on?.settled?.(settlement)
      resolveSettled(settlement)
    }
    const job = tail.then(async () => {
      let from = 0
      try {
        request.signal?.throwIfAborted()
        const prompt = (typeof request.input === 'function' ? [...await request.input()] : [...request.input]) as ContentBlock[]
        request.signal?.throwIfAborted()
        // The core continues a member it has a record for. Here: one that
        // published a run, or one a spec seated with a child handle of its own
        // (`child-…`; room names a member without one by its UUID room id).
        const prepared = !published.has(requested) && stub.isPreparedMember?.(requested) === true
        const continuing = published.get(requested) ?? (prepared || UUID.test(requested) ? undefined : requested)
        const controlled = stub.supportsMemberConfiguration?.(request.provider) === true
        const admit = async (): Promise<void> => {
          from = seqOf(continuing ?? requested)
          const admittedAt = Date.now()
          // The core's start record, in a child that exists at admission.
          ctx?.sessions.get(SessionId(continuing ?? requested))?.append('local-agent/execution', {
            phase: 'start', executionId, caller: request.caller ?? 'api', operation: request.operation ?? 'prompt',
            parentSessionId: request.parentSessionId, admittedAt,
            ...request.callerRef === undefined ? {} : { callerRef: request.callerRef },
            ...request.cause === undefined ? {} : { cause: request.cause },
            ...request.task === undefined ? {} : { task: request.task },
          } as never)
          mark(requested, executionId, 'running')
          await request.on?.admitted?.({ executionId, admittedAt, childFromSeq: from })
        }
        const options = {
          ...controlled ? { onAdmitted: admit } : {},
          ...request.on?.progress === undefined ? {} : { onProgress: request.on.progress },
          ...request.operation === 'compact' ? { operation: 'compact' as const } : {},
          ...request.signal === undefined ? {} : { signal: request.signal },
        }
        if (!controlled) await admit()
        const create = request.member.create
        const handle = (continuing !== undefined
          ? await (stub.resume as unknown as (...args: unknown[]) => Promise<SubagentRun>)(request.parentSessionId, request.provider, continuing, prompt, options)
          : await (stub.start as unknown as (...args: unknown[]) => Promise<SubagentRun>)(request.parentSessionId, request.provider, prompt, {
            ...options,
            ...create?.label === undefined ? {} : { label: create.label },
            ...prepared ? { preparedMemberId: requested } : {
              ...create?.model === undefined ? {} : { model: create.model },
              ...create?.effort === undefined ? {} : { effort: create.effort },
              ...create?.cwd === undefined ? {} : { cwd: create.cwd },
            },
          }))
        if (!published.has(requested) && String(handle.id) !== requested) ledger.set(String(handle.id), rowsOf(requested))
        published.set(requested, String(handle.id))
        published.set(String(handle.id), String(handle.id))
        ledger.set(String(handle.id), ledger.get(String(handle.id)) ?? rowsOf(requested))
        // Later rounds name the published child: they queue on this chain.
        if (tails.get(String(handle.id)) === undefined) tails.set(String(handle.id), tails.get(queue)!)
        resolveStarted(handle)
        const result = await handle.result.catch((error: unknown) => ({ stopReason: 'error' as const, output: [], diagnostic: String(error) }))
        const outcome = result.stopReason === 'completed' ? 'done' as const : result.stopReason === 'aborted' ? 'cancelled' as const : 'failed' as const
        mark(requested, executionId, outcome)
        const turns = turnsOf(String(handle.id), from)
        ctx?.sessions.get(SessionId(String(handle.id)))?.append('local-agent/execution', { phase: 'end', executionId, outcome, turns, endedAt: Date.now() } as never)
        // The next round starts once this one's result is in (the ledger's order).
        void Promise.resolve().then(() => finish({ executionId, outcome, run: handle, turns }))
      } catch (error) {
        rejectStarted(error)
        const aborted = request.signal?.aborted === true
        mark(requested, executionId, aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error))
        finish({ executionId, outcome: aborted ? 'cancelled' : 'failed', turns: [], error: error instanceof Error ? error.message : String(error) })
      }
    })
    tails.set(queue, job)
    const handle: LocalAgentExecutionHandle = { executionId, settled, started }
    if (keyId !== undefined) keys.set(keyId, handle)
    return handle
  })
  const target = stub as T & { run: ReturnType<typeof vi.fn>; seedLedgerRow: (child: string, row: SeededRow) => void }
  target.run = run
  target.seedLedgerRow = (child, row) => { rowsOf(child).push({ createdAt: 0, updatedAt: 0, ...row }) }
  return target
}
