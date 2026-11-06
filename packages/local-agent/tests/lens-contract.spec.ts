/**
 * local-agent → Context Lens contract. Context Lens reads a member's child
 * log structurally (no dependency on this package), so this suite drives the
 * REAL core path — registry facade → admission (`withMemberConfigurationRound`)
 * → shared mirror writer (`openMirrorTurn`/`appendMirrorStep`) → execution
 * recorder → JSONL persistence — through one member's lifecycle and records
 * the stored child log as a checked-in fixture that lens's
 * `local-agent-contract.spec.ts` replays through its own parsers. The fixture
 * is stale when the core changes what it writes: this suite then fails;
 * regenerate it with
 * `UPDATE_LOCAL_AGENT_CONTRACT=1 pnpm --filter @khorsheed/dsh-local-agent test`
 * and let the lens suite say whether it still reads it.
 *
 * Last, a round that starts a background task (its tool result names the
 * task), then the round the CLI opens itself when the task ends, admitted
 * through `admitSelf` with the task's tool call: its start record carries
 * cause `self` with `startedBy` and the task copied, as lens reads it.
 *
 * The provider is a fake family provider (no CLI): its harness declares
 * codex exec's "not recorded" items for `exec`, `internal-calls` for `live`
 * and Claude Code's `compaction` for `compact`, so one log carries every
 * declaration lens shows. local-agent cannot import the codex package
 * (dependency direction), so the exec list is copied from `CODEX_UNRECORDED`.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SubagentActivationSpec, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE } from '../src/index.ts'
import type { LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentUnrecordedDeclaration } from '../src/index.ts'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../src/mirror-step.ts'

const FIXTURE = fileURLToPath(new URL('../../context-lens/tests/fixtures/local-agent-contract.json', import.meta.url))
const PROVIDER = 'fake-cli'
const PARENT = 'room-parent'
const TYPE = 'local-agent/execution'
/** Codex exec's declaration (CODEX_UNRECORDED.exec), live's, and Claude Code's compact one. */
const UNRECORDED: LocalAgentUnrecordedDeclaration = {
  exec: ['call-boundaries', 'per-call-usage', 'internal-calls'],
  live: ['internal-calls'],
  compact: ['compaction'],
}
const ROUND_TOTAL = { inputTokens: 900, outputTokens: 90 } as TokenUsage

type Round = (child: Session, turn: number) => SubagentResult
interface Script { round: Round; total?: TokenUsage }

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
})

/** The real stack with a fake family provider (see execution-records.spec.ts). */
async function mount() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const persistence = ctx.plugin(JsonlSessionPersistence, { root: mkdtempSync(join(tmpdir(), 'lens-contract-store-')), compression: 'none' })
  await persistence.await()
  const scripts: Script[] = []
  ctx.provide('subagents', {
    getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
    startActivation: async (spec: SubagentActivationSpec) => {
      const run = await providerStart({ ...spec.request, signal: spec.signal } as SubagentStartRequest, scripts.shift()!)
      return { childId: run.id, result: run.result, dispose: () => run.dispose() }
    },
  })
  const homes = mkdtempSync(join(tmpdir(), 'lens-contract-homes-'))
  const fiber = ctx.plugin(localAgent, { homesRoot: homes })
  await fiber.await()
  disposers.push(async () => { await fiber.dispose(); await persistence.dispose() })
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    unrecorded: UNRECORDED,
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)
  const agent = { id: SessionId(PARENT), session: { id: SessionId(PARENT), header: { id: SessionId(PARENT), cwd: '/home/user/work' } } } as unknown as Agent
  ctx.agents.enter(agent, undefined)

  async function providerStart(request: SubagentStartRequest, script: Script): Promise<SubagentRun> {
    const intent = registry.takeDelegationIntent(PARENT, PROVIDER) as LocalAgentDelegationIntent
    const childSessionId = intent.kind === 'resume' ? intent.childSessionId : intent.childSessionId!
    return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/work' }, async () => {
      const child = ctx.sessions.get(SessionId(childSessionId))
        ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(PARENT), origin: 'subagent', delegationDepth: 1 } } as never)
      if (intent.kind === 'fresh') child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
      const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      const settled = script.round(child, turn)
      await registry.syncChildSession(child)
      // Only a CLI-reported whole-round total is a providerReportedUsage (S1).
      registry.recordRoundSettled(childSessionId, { ...script.total === undefined ? {} : { usage: script.total, providerReportedUsage: script.total } })
      return { id: SessionId(`exec-${childSessionId}`), result: Promise.resolve(settled), dispose: async () => {} }
    }, request.signal, intent.onAdmitted, intent.execution)
  }

  return {
    ctx, registry, homes,
    next: (script: Script) => { scripts.push(script) },
    stored: async (childSessionId: string): Promise<readonly SessionEvent[]> => {
      const reader = await ctx.sessionPersistence.open(SessionId(childSessionId), 'read')
      try { return (await reader.read(0)).events } finally { await reader.close() }
    },
  }
}

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({ inputTokens, outputTokens } as TokenUsage)
const source = { provider: PROVIDER, model: 'm' }

/** a. A live round: one turn, two model calls, each with its own usage. */
const liveRound: Round = (child, turn) => {
  openMirrorTurn(child, turn, 'live')
  appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: '先看一下文件' }], usage: usage(1000, 40) }, source)
  appendMirrorStep(child, turn, 2, { blocks: [{ kind: 'text', text: '看完了' }], usage: usage(1200, 60) }, source)
  // d. The CLI's own automatic compaction inside the round, its usage unstated (as codex live writes it).
  child.append('local-agent/compaction', { source: 'auto', outcome: 'completed', provider: PROVIDER, beforeTokens: 180_000,
    startedAt: Date.now(), endedAt: Date.now(), boundarySeq: child.snapshotEvents().length, unrecorded: ['usage'] } as never)
  closeMirrorTurn(child, turn, 'completed', '')
  return { stopReason: 'completed', output: [{ type: 'text', text: '看完了' }] }
}

/** b. An exec round written as codex exec writes it: one step per item, the whole round's usage on the last. */
const execRound: Round = (child, turn) => {
  openMirrorTurn(child, turn, 'exec')
  appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: '计划' }] }, source)
  appendMirrorStep(child, turn, 2, { blocks: [{ kind: 'text', text: '执行中' }] }, source)
  appendMirrorStep(child, turn, 3, { blocks: [{ kind: 'text', text: '完成' }], usage: ROUND_TOTAL }, source)
  closeMirrorTurn(child, turn, 'completed', '')
  return { stopReason: 'completed', output: [{ type: 'text', text: '完成' }] }
}

/** e. A live round that starts a background task: its tool call's result names the task. */
const backgroundRound: Round = (child, turn) => {
  openMirrorTurn(child, turn, 'live')
  appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'tool', id: 'call-bg', name: 'Shell', args: '{"command":"sleep 20","run_in_background":true}', result: 'Started background task bash-1' }], usage: usage(1300, 20) }, source)
  appendMirrorStep(child, turn, 2, { blocks: [{ kind: 'text', text: '已在后台运行，完成后继续' }], usage: usage(1400, 30) }, source)
  closeMirrorTurn(child, turn, 'completed', '')
  return { stopReason: 'completed', output: [{ type: 'text', text: '已在后台运行，完成后继续' }] }
}

const released = (events: readonly SessionEvent[]): string | undefined => {
  try {
    assertReleasedV4Relationships({
      header: { version: 4, id: 'member', createdAt: 0, isSeeded: false, delegationDepth: 1 },
      inheritedEventCount: 0,
      events,
    } as unknown as Parameters<typeof assertReleasedV4Relationships>[0], KNOWN_SESSION_EVENT_TYPES)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const records = (events: readonly SessionEvent[]): Array<LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent> =>
  events.filter(event => event.type === TYPE).map(event => event.data as LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent)

/** UUIDs (execution ids, session ids) → stable placeholders by first appearance. */
function normalize(value: unknown): unknown {
  const ids = new Map<string, string>()
  const text = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
    if (!ids.has(uuid)) ids.set(uuid, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
    return ids.get(uuid)!
  })
  return JSON.parse(text)
}

/** Drive one member through a live round, an exec round, an unreported /compact, a background task and the round the CLI opens itself; returns the stored log as rows. */
async function produce(): Promise<{ readonly childSessionId: string; readonly rows: readonly SessionEvent[] }> {
  // A deterministic clock: every Date.now() call advances 10 ms.
  let now = 1_800_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
  const h = await mount()
  const room = 'room-session'
  h.next({ round: liveRound })
  const first = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: '看一下文件' }], {
    caller: 'room', callerRef: '5:m-ada',
    cause: { kind: 'human', sessionId: room, dispatchSeq: 5, via: 'room', messageId: 'u-5' },
    task: { sessionId: room, id: 'u-5' },
  })
  await first.result
  const child = String(first.id)
  h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
  h.next({ round: execRound, total: ROUND_TOTAL })
  const second = await h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: '接着做' }], {
    caller: 'room', callerRef: '9:m-ada',
    cause: { kind: 'member', sessionId: room, fromMemberId: 'm-lead', dispatchSeq: 9 },
    task: { sessionId: room, id: 'u-5' },
  })
  await second.result
  h.next({ round: () => ({ stopReason: 'completed', output: [] }) })
  const compaction = await h.registry.compact(PARENT, PROVIDER, child, { cause: { kind: 'human', sessionId: room, dispatchSeq: 12, via: 'room' } })
  await compaction.result
  h.next({ round: backgroundRound })
  const background = await h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: '后台跑一下' }], {
    caller: 'room', callerRef: '14:m-ada',
    cause: { kind: 'human', sessionId: room, dispatchSeq: 14, via: 'room', messageId: 'u-14' },
    task: { sessionId: room, id: 'u-14' },
  })
  await background.result
  // f. The task ended while the member was idle: its CLI opens a round on its own.
  const self = await h.registry.admitSelf({
    childSessionId: child, provider: PROVIDER, taskCallId: 'call-bg',
    cause: { kind: 'self', reason: 'background-task', taskId: 'bash-1', taskStatus: 'completed', notificationId: 'task:bash-1:completed' },
    follow: async ({ session }) => {
      const turn = session.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      openMirrorTurn(session, turn, 'live')
      appendMirrorStep(session, turn, 1, { blocks: [{ kind: 'text', text: '后台任务完成了' }], usage: usage(1500, 40) }, source)
      closeMirrorTurn(session, turn, 'completed', '')
      h.registry.recordRoundSettled(child, {})
      return { stopReason: 'completed', output: [{ type: 'text', text: '后台任务完成了' }] }
    },
  })
  expect(self).toBeDefined()
  await self!.settled
  let rows: readonly SessionEvent[] = []
  await vi.waitFor(async () => {
    rows = await h.stored(child)
    expect(records(rows).filter(record => record.phase === 'end')).toHaveLength(5)
  })
  expect(released(rows)).toBeUndefined()
  expect(existsSync(join(h.homes, 'quarantine', `${child}.jsonl`))).toBe(false)
  return { childSessionId: child, rows }
}

/** The fixture: the rows as lens's log reader sees them, and the execution summary for readability. */
function fixtureOf(produced: Awaited<ReturnType<typeof produce>>): unknown {
  const ends = new Map(records(produced.rows).flatMap(record => record.phase === 'end' ? [[record.executionId, record] as const] : []))
  return normalize({
    note: 'Generated by packages/local-agent/tests/lens-contract.spec.ts from the core\'s real writers; do not edit by hand.',
    childSessionId: produced.childSessionId,
    executions: records(produced.rows).flatMap(record => record.phase !== 'start' ? [] : [{
      executionId: record.executionId,
      operation: record.operation,
      turns: ends.get(record.executionId)?.turns ?? [],
      unrecorded: ends.get(record.executionId)?.unrecorded ?? [],
    }]),
    rows: produced.rows.map(event => {
      const row = event as unknown as Record<string, unknown>
      return {
        type: row['type'], seq: row['seq'], time: row['time'], data: row['data'],
        ...row['surfaceOp'] === undefined ? {} : { surfaceOp: row['surfaceOp'] },
        ...row['ignorable'] === undefined ? {} : { ignorable: row['ignorable'] },
      }
    }),
  })
}

describe('local-agent → Context Lens contract fixture', () => {
  it('the core\'s writers still produce the checked-in fixture lens replays', async () => {
    const produced = fixtureOf(await produce())
    if (process.env['UPDATE_LOCAL_AGENT_CONTRACT'] === '1') writeFileSync(FIXTURE, `${JSON.stringify(produced, null, 2)}\n`)
    const checkedIn: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    // Stale: regenerate with UPDATE_LOCAL_AGENT_CONTRACT=1 and rerun the context-lens suite.
    expect(checkedIn).toEqual(produced)
  })

  it('the log holds what lens reads: three executions with their turns, declarations and the core-written compaction', async () => {
    const { rows } = await produce()
    const [liveStart, liveEnd, execStart, execEnd, compactStart, compactEnd] = records(rows) as [
      LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent,
      LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(liveStart).toMatchObject({ operation: 'prompt', caller: 'room', cause: { kind: 'human', dispatchSeq: 5 }, task: { id: 'u-5' } })
    expect(liveEnd).toMatchObject({ executionId: liveStart.executionId, outcome: 'done', turns: [1], unrecorded: ['internal-calls'] })
    expect(liveEnd.providerReportedUsage).toBeUndefined()
    expect(execStart).toMatchObject({ operation: 'prompt', cause: { kind: 'member', fromMemberId: 'm-lead' } })
    expect(execEnd).toMatchObject({ executionId: execStart.executionId, turns: [2], unrecorded: ['call-boundaries', 'per-call-usage', 'internal-calls'], providerReportedUsage: ROUND_TOTAL })
    expect(compactStart).toMatchObject({ operation: 'compact' })
    expect(compactEnd).toMatchObject({ executionId: compactStart.executionId, turns: [], unrecorded: ['compaction'] })
    // The self-opened round: caller cli, cause self naming the round that started the task, whose task it copies.
    const [backgroundStart, backgroundEnd, selfStart, selfEnd] = records(rows).slice(6) as [
      LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(backgroundEnd).toMatchObject({ executionId: backgroundStart.executionId, turns: [3] })
    expect(selfStart).toMatchObject({
      caller: 'cli', operation: 'prompt', task: { id: 'u-14' },
      cause: { kind: 'self', reason: 'background-task', taskId: 'bash-1', taskStatus: 'completed', startedBy: backgroundStart.executionId },
    })
    expect(selfEnd).toMatchObject({ executionId: selfStart.executionId, outcome: 'done', turns: [4] })
    const facts = rows.filter(event => event.type === 'local-agent/compaction').map(event => event.data as localAgent.LocalAgentCompactionEvent)
    expect(facts).toMatchObject([{ source: 'auto', unrecorded: ['usage'] }, { source: 'manual', unrecorded: ['usage', 'before-after', 'summary'] }])
    // Two calls with usage in the live turn; three steps in the exec turn, usage on the last only.
    const steps = rows.filter(event => event.type === 'assistant/message').map(event => {
      const data = event.data as { turn: number; usage?: unknown }
      return [data.turn, data.usage !== undefined]
    })
    expect(steps).toEqual([[1, true], [1, true], [2, false], [2, false], [2, true], [3, true], [3, true], [4, true]])
    // The core's compaction fact sits inside its execution's range.
    const seqOf = (predicate: (event: SessionEvent) => boolean): number => rows.findIndex(predicate)
    const factAt = seqOf(event => event.type === 'local-agent/compaction' && (event.data as { source?: string }).source === 'manual')
    expect(factAt).toBeGreaterThan(seqOf(event => event.type === TYPE && (event.data as { executionId?: string }).executionId === compactStart.executionId))
  })
})
