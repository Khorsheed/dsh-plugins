/**
 * A member CLI's own subagents as grandchild sessions (member-cli-subagents
 * design, step M2). When a member's CLI runs a subagent of its own (Kimi
 * `Agent`/`AgentSwarm`, Claude Code `Agent`/`Task`), the provider mirrors it
 * into a session under the member's child session, built the same way the
 * member's own child session is built, so the host's lineage dropdown, the
 * subagent cards and Context Lens reach it with no reader change:
 *
 * - **One subagent = one grandchild session.** Its id is deterministic,
 *   `<member child id>.sub.<CLI subagent id>`, so a replay after a restart
 *   finds the same session without a mapping file. The header carries the
 *   host-native parent link (`parentSession` = the member's child session,
 *   `origin: 'subagent'`, the member's depth + 1, the member's cwd), the
 *   grandchild gets a one-shot `subagent/descriptor`, and the member's child
 *   session gets exactly one `subagent/catalog` row for it (the payload the
 *   host's `establishCatalogChild` writes).
 * - **One call (new or reused) = one execution.** Each `Agent` call that
 *   starts or resumes the subagent opens one `local-agent/execution` in the
 *   grandchild: caller `cli`, operation `prompt`, a `cli-subagent` cause
 *   naming the member's call (and the member execution it ran in), and the
 *   member execution's `task` copied verbatim, so a per-task sum includes the
 *   subagent unchanged. Reusing a subagent id reuses the session and opens
 *   one more execution; the same call id never opens a second one.
 * - **Steps go through the shared mirror writer** (`mirror-step.ts`), turn by
 *   turn, so the grandchild log reads exactly like a member log. The start
 *   record is written here, not through the member's turn hook: a grandchild
 *   has no admitted execution of the core's own.
 *
 * The grandchild's appends pass the core's child-log guard and persist
 * through the core's cached write handle (`LocalAgentRegistry`), exactly like
 * the member's. A provider bundles its own copy of this module, so the
 * in-flight registry for concurrent opens lives on `globalThis`.
 *
 * This module writes; it does not discover. Each provider (Kimi M3, Claude
 * Code M4) parses its own CLI's records and calls {@link openCliSubagent},
 * `beginExecution`, `mirror`/`closeTurn` and `end`. A throw is the provider's
 * to degrade: a missing subagent mirror must never fail the member's round.
 * @module @khorsheed/dsh-local-agent/cli-subagent
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SUBAGENT_DESCRIPTOR_VERSION, type SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { executionOfToolCall, executionReadingsOf } from './execution-read.ts'
import type { MirrorTransport } from './execution-records.ts'
import { appendMirrorStep, closeMirrorTurn, type MirrorSource, type MirrorUnit } from './mirror-step.ts'
import type {
  LocalAgentExecutionCause,
  LocalAgentExecutionEndEvent,
  LocalAgentExecutionEvent,
  LocalAgentExecutionOutcome,
  LocalAgentExecutionStartEvent,
  LocalAgentUnrecorded,
  LocalAgentUnrecordedDeclaration,
} from './types.ts'

const EXECUTION = 'local-agent/execution'

/** The separator between the member's child id and the CLI's subagent id. */
export const CLI_SUBAGENT_SESSION_SEPARATOR = '.sub.'

/**
 * The grandchild session id for one CLI subagent: deterministic, so a replay
 * after a restart finds the same session.
 * @param memberSessionId - the member's dsh child session id.
 * @param key - the CLI's own subagent id (Kimi `subagentId`, Claude `agentId`).
 * @returns `<memberSessionId>.sub.<key>`.
 */
export function cliSubagentSessionId(memberSessionId: string, key: string): string {
  return `${memberSessionId}${CLI_SUBAGENT_SESSION_SEPARATOR}${key}`
}

/** Who the subagent is: fixed for its session's lifetime. */
export interface CliSubagentIdentity {
  /** The member's delegation provider (`kimi-cli`, …): the grandchild descriptor's provider. */
  readonly provider: string
  /** The CLI's own subagent id (Kimi `subagentId`, Claude `agentId`): the session key. */
  readonly key: string
  /** The subagent type (`explore`, `coder`, `general-purpose`, …). */
  readonly name?: string | undefined
  /** The description the member gave the subagent. */
  readonly description?: string | undefined
}

/** One member call that starts (or resumes) the subagent. */
export interface CliSubagentCall {
  /** The member's `Agent`/`AgentSwarm`/`Task` tool call id (Kimi `parentToolCallId`, Claude `toolUseId`). */
  readonly callId: string
  /**
   * The member execution the call ran in. Omitted: resolved from the member
   * log — the execution whose turns hold the mirrored call, else the member's
   * open prompt execution (the call is being mirrored while its round runs).
   */
  readonly memberExecutionId?: string | undefined
  /** Its place in an `AgentSwarm` call. */
  readonly group?: { readonly index: number; readonly size: number } | undefined
  /** Started in the background (`runInBackground` / `run_in_background`). */
  readonly background?: boolean | undefined
  /** The call resumed an existing subagent (Kimi `resume`). */
  readonly resumed?: boolean | undefined
  /** How the member's round runs: picks the harness's `unrecorded` declaration for the end record. */
  readonly transport?: MirrorTransport | undefined
  /** When the CLI started the call (its own spawn time); omitted, now. */
  readonly admittedAt?: number | undefined
}

/** What the end record carries beyond the outcome. */
export interface CliSubagentEndOptions {
  /** The CLI's own total for this call (Kimi `subagent.completed.usage`): never added to the per-call usage. */
  readonly providerReportedUsage?: TokenUsage | undefined
  /** Overrides the harness declaration copied for the call's transport. */
  readonly unrecorded?: readonly LocalAgentUnrecorded[] | undefined
  /** When the CLI finished the call; omitted, now. */
  readonly endedAt?: number | undefined
  /** The error text a still-open turn closes with when the outcome is `failed`. */
  readonly errorMessage?: string | undefined
}

/** One execution of a CLI subagent: one member call, in the grandchild session. */
export interface CliSubagentExecution {
  readonly executionId: string
  /** The start record as written (or found, when an earlier open wrote it). */
  readonly start: LocalAgentExecutionStartEvent
  /** Whether the end record is written. Every write is a no-op once it is. */
  readonly ended: boolean
  /** The open turn, if any. */
  readonly openTurn: number | undefined
  /** The turns this execution opened, in order (its range so far). */
  turns(): number[]
  /**
   * Open the execution's next turn (one `turn/start`). An open turn is
   * returned as is.
   * @returns the open turn number.
   */
  beginTurn(): number
  /**
   * Write one mirrored model call as the open turn's next step (opening a
   * turn when none is open) through the shared mirror writer.
   * @returns the turn and step the unit landed at, or undefined once ended.
   */
  mirror(unit: MirrorUnit, source: MirrorSource): { turn: number; step: number } | undefined
  /** Close the open turn (`completed`, `aborted`, or `error` with the message); no-op without one. */
  closeTurn(stopReason: SubagentStopReason, errorMessage?: string): void
  /**
   * Write the end record (once): an open turn closes first (`done` →
   * completed, `failed` → error, `cancelled`/`uncertain` → aborted), the
   * range is the turns written after the start record, the harness's
   * declaration for the call's transport is copied, and the grandchild is
   * persisted.
   */
  end(outcome: LocalAgentExecutionOutcome, options?: CliSubagentEndOptions): void
}

/** One CLI subagent's grandchild session. */
export interface CliSubagentHandle {
  readonly sessionId: string
  readonly session: Session
  /** False when an earlier open (in this process, or stored before a restart) established it. */
  readonly created: boolean
  /**
   * Open (or find) the execution for one member call. The same call id
   * returns the execution its earlier begin wrote; a new call id first ends
   * an execution the log still holds open as `uncertain` (a CLI resumes only
   * an idle subagent, so it cannot still be running), then writes a start.
   */
  beginExecution(call: CliSubagentCall): CliSubagentExecution
  /** Make the grandchild's latest events durable (through the core's write handle). */
  persist(): Promise<void>
}

/** The registry surface this module uses (structural: no import of the core entry). */
interface RegistryFace {
  guardChildSession(session: Session): void
  syncChildSession(session: Session): Promise<void>
  ensureChildLive(childSessionId: string): Promise<void>
  harnessForProvider(provider: string): { readonly unrecorded?: LocalAgentUnrecordedDeclaration | undefined } | undefined
}

const IN_FLIGHT = Symbol.for('@khorsheed/dsh-local-agent/cli-subagent-opens')

function inFlight(): Map<string, Promise<CliSubagentHandle>> {
  const holder = globalThis as { [IN_FLIGHT]?: Map<string, Promise<CliSubagentHandle>> }
  holder[IN_FLIGHT] ??= new Map()
  return holder[IN_FLIGHT]
}

function registryOf(ctx: Context): RegistryFace | undefined {
  try { return ctx.get('localAgent') as RegistryFace | undefined } catch { return undefined }
}

/** The grandchild's descriptor and catalog label: `<type>: <description>`. */
export function cliSubagentLabel(identity: Pick<CliSubagentIdentity, 'name' | 'description'>): string | undefined {
  const name = identity.name?.trim() || undefined
  const description = identity.description?.trim() || undefined
  if (name !== undefined && description !== undefined) return `${name}: ${description}`
  return name ?? description
}

/**
 * Open (idempotently) one CLI subagent's grandchild session under a member.
 *
 * Live → reused; stored but cold (a restart) → reattached through the core;
 * absent → created with the host-native parent link and its one-shot
 * descriptor. The member's catalog row is appended when the member log does
 * not hold one for this child yet, and the member is persisted then.
 * @param ctx - the host context (sessions, sessionPersistence, localAgent).
 * @param member - the member's live dsh child session.
 * @param identity - the subagent's provider, key, type and description.
 * @returns the grandchild handle.
 */
export async function openCliSubagent(ctx: Context, member: Session, identity: CliSubagentIdentity): Promise<CliSubagentHandle> {
  const sessionId = cliSubagentSessionId(String(member.id), identity.key)
  const pending = inFlight().get(sessionId)
  if (pending !== undefined) return pending
  const opening = openNow(ctx, member, identity, sessionId)
  inFlight().set(sessionId, opening)
  try { return await opening } finally { inFlight().delete(sessionId) }
}

async function openNow(ctx: Context, member: Session, identity: CliSubagentIdentity, sessionId: string): Promise<CliSubagentHandle> {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('cli-subagent: the sessions service is not mounted')
  const registry = registryOf(ctx)
  const id = SessionId(sessionId)
  let session = sessions.get(id)
  let created = false
  if (session === undefined && registry !== undefined) {
    const stored = await ctx.get('sessionPersistence')?.stat(id)
    if (stored !== undefined && stored !== null) {
      await registry.ensureChildLive(sessionId)
      session = sessions.get(id)
    }
  }
  const label = cliSubagentLabel(identity)
  if (session === undefined) {
    session = sessions.create(id, {
      meta: {
        ...member.header.cwd === undefined ? {} : { cwd: member.header.cwd },
        parentSession: member.id,
        origin: 'subagent',
        delegationDepth: (member.header.delegationDepth ?? 0) + 1,
      },
    })
    created = true
  }
  registry?.guardChildSession(session)
  if (!session.snapshotEvents().some(event => event.type === 'subagent/descriptor')) {
    session.append('subagent/descriptor', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: identity.provider,
      ...label === undefined ? {} : { label },
    })
  }
  const grandchild = session
  const persist = async (): Promise<void> => { await registry?.syncChildSession(grandchild) }
  if (!member.snapshotEvents().some(event => event.type === 'subagent/catalog' && String((event.data as { childId?: unknown }).childId) === sessionId)) {
    // The same payload the host's establishCatalogChild (and the member's own
    // row, establishSubagentCatalogChild) writes: version 0, one-shot.
    member.append('subagent/catalog', {
      version: 0,
      childId: grandchild.header.id,
      childCreatedAt: grandchild.header.createdAt,
      mode: 'one-shot',
      ...label === undefined ? {} : { label },
    })
    // The grandchild is stored first, so a reader that follows the catalog
    // row finds the session.
    await persist()
    await registry?.syncChildSession(member)
  } else if (created) {
    await persist()
  }
  return {
    sessionId,
    session: grandchild,
    created,
    beginExecution: call => beginExecution(grandchild, member, identity, registry, call, persist),
    persist,
  }
}

function records(events: readonly SessionEvent[]): Array<{ index: number; data: LocalAgentExecutionEvent }> {
  const out: Array<{ index: number; data: LocalAgentExecutionEvent }> = []
  events.forEach((event, index) => {
    if (event.type === EXECUTION) out.push({ index, data: event.data as LocalAgentExecutionEvent })
  })
  return out
}

/** The member execution a call ran in: the recorded call's execution, else the open prompt execution. */
function memberExecution(member: Session, call: CliSubagentCall): LocalAgentExecutionStartEvent | undefined {
  const events = member.snapshotEvents()
  const all = records(events)
  const startOf = (executionId: string): LocalAgentExecutionStartEvent | undefined =>
    all.find(record => record.data.phase === 'start' && record.data.executionId === executionId)?.data as LocalAgentExecutionStartEvent | undefined
  if (call.memberExecutionId !== undefined) return startOf(call.memberExecutionId)
  const viaCall = executionOfToolCall(events, call.callId, executionReadingsOf(events))
  if (viaCall !== undefined) return startOf(viaCall)
  const ended = new Set(all.flatMap(record => record.data.phase === 'end' ? [record.data.executionId] : []))
  return all.findLast(record => record.data.phase === 'start' && record.data.operation === 'prompt' && !ended.has(record.data.executionId))?.data as LocalAgentExecutionStartEvent | undefined
}

function turnOf(event: SessionEvent): number | undefined {
  const turn = (event.data as { turn?: unknown }).turn
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/** The turn the log holds open (its last `turn/start` without a `turn/end`). */
function openTurnOf(session: Session): number | undefined {
  let open: number | undefined
  for (const event of session.snapshotEvents()) {
    if (event.type === 'turn/start') open = turnOf(event)
    else if (event.type === 'turn/end' && turnOf(event) === open) open = undefined
  }
  return open
}

function beginExecution(
  session: Session,
  member: Session,
  identity: CliSubagentIdentity,
  registry: RegistryFace | undefined,
  call: CliSubagentCall,
  persist: () => Promise<void>,
): CliSubagentExecution {
  const existing = records(session.snapshotEvents())
    .find(record => record.data.phase === 'start' && record.data.cause?.kind === 'cli-subagent' && record.data.cause.callId === call.callId)
  let start: LocalAgentExecutionStartEvent
  if (existing !== undefined) {
    start = existing.data as LocalAgentExecutionStartEvent
  } else {
    // A start the log still holds open belongs to a call the CLI no longer
    // runs: it resumes only an idle subagent.
    const all = records(session.snapshotEvents())
    const ended = new Set(all.flatMap(record => record.data.phase === 'end' ? [record.data.executionId] : []))
    for (const record of all) {
      if (record.data.phase !== 'start' || ended.has(record.data.executionId)) continue
      handleFor(session, record.data, identity, registry, undefined, persist).end('uncertain')
    }
    const owner = memberExecution(member, call)
    const cause: LocalAgentExecutionCause = {
      kind: 'cli-subagent',
      sessionId: String(member.id),
      callId: call.callId,
      ...owner === undefined ? {} : { executionId: owner.executionId },
      ...identity.name === undefined ? {} : { name: identity.name },
      ...call.group === undefined ? {} : { group: { index: call.group.index, size: call.group.size } },
      ...call.background === true ? { background: true } : {},
      ...call.resumed === true ? { resumed: true } : {},
    }
    start = {
      phase: 'start',
      executionId: randomUUID(),
      caller: 'cli',
      callerRef: call.callId,
      operation: 'prompt',
      cause,
      ...owner?.task === undefined ? {} : { task: structuredClone(owner.task) },
      parentSessionId: String(member.id),
      admittedAt: call.admittedAt ?? Date.now(),
    }
    session.append(EXECUTION, start)
  }
  return handleFor(session, start, identity, registry, call.transport, persist)
}

function handleFor(
  session: Session,
  start: LocalAgentExecutionStartEvent,
  identity: CliSubagentIdentity,
  registry: RegistryFace | undefined,
  transport: MirrorTransport | undefined,
  persist: () => Promise<void>,
): CliSubagentExecution {
  const isEnded = (): boolean => session.snapshotEvents().some(event => event.type === EXECUTION
    && (event.data as LocalAgentExecutionEvent).phase === 'end'
    && (event.data as LocalAgentExecutionEvent).executionId === start.executionId)
  const turns = (): number[] => {
    const events = session.snapshotEvents()
    const at = events.findIndex(event => event.type === EXECUTION
      && (event.data as LocalAgentExecutionEvent).phase === 'start'
      && (event.data as LocalAgentExecutionEvent).executionId === start.executionId)
    if (at < 0) return []
    const out: number[] = []
    for (const event of events.slice(at + 1)) {
      // The next execution's start bounds the range.
      if (event.type === EXECUTION && (event.data as LocalAgentExecutionEvent).phase === 'start') break
      const turn = event.type === 'turn/start' ? turnOf(event) : undefined
      if (turn !== undefined) out.push(turn)
    }
    return out
  }
  /** The open turn when it is this execution's. */
  const ownOpenTurn = (): number | undefined => {
    const open = openTurnOf(session)
    return open !== undefined && turns().includes(open) ? open : undefined
  }
  const beginTurn = (): number => {
    const open = ownOpenTurn()
    if (open !== undefined) return open
    let last = 0
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start') last = Math.max(last, turnOf(event) ?? 0)
    }
    const turn = last + 1
    session.append('turn/start', { turn })
    return turn
  }
  const closeTurn = (stopReason: SubagentStopReason, errorMessage = 'the subagent failed'): void => {
    const open = ownOpenTurn()
    if (open !== undefined) closeMirrorTurn(session, open, stopReason, errorMessage)
  }
  return {
    executionId: start.executionId,
    start,
    get ended() { return isEnded() },
    get openTurn() { return ownOpenTurn() },
    turns,
    beginTurn,
    mirror(unit, source) {
      if (isEnded()) return undefined
      const turn = beginTurn()
      const step = session.snapshotEvents().filter(event => event.type === 'step/start' && turnOf(event) === turn).length + 1
      appendMirrorStep(session, turn, step, unit, source)
      return { turn, step }
    },
    closeTurn,
    end(outcome, options = {}) {
      if (isEnded()) return
      if (outcome === 'done') closeTurn('completed')
      else if (outcome === 'failed') closeTurn('error', options.errorMessage)
      else closeTurn('aborted')
      const unrecorded = options.unrecorded
        ?? (transport === undefined ? undefined : registry?.harnessForProvider(identity.provider)?.unrecorded?.[transport])
      const end: LocalAgentExecutionEndEvent = {
        phase: 'end',
        executionId: start.executionId,
        outcome,
        turns: turns(),
        endedAt: options.endedAt ?? Date.now(),
        ...unrecorded === undefined || unrecorded.length === 0 ? {} : { unrecorded: [...unrecorded] },
        ...options.providerReportedUsage === undefined ? {} : { providerReportedUsage: structuredClone(options.providerReportedUsage) },
      }
      session.append(EXECUTION, end)
      void persist().catch(() => undefined)
    },
  }
}
