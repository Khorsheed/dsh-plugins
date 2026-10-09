/**
 * Main-session history backfill: the session's own log reconstructs pre-mount
 * turns at log fidelity (system prompt as one unattributed block, request/header
 * config + tools, usage incl. cache reads, stream block timing, the
 * history/added chain, classification, delegation scope stubs) — merged with
 * live turns on the host's own turn numbers, budgeted behind live content, and
 * run at most once per session.
 *
 * The fixture is a real multi-turn slice of session-novel (turns 1–3, texts
 * truncated, paths sanitized) plus a synthetic turn 4 carrying a failed
 * one-shot delegation modeled on that log's real rows.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { InspectorService } from '../src/service.ts'
import { reconstructSession, type SessionLogHandle, type SessionLogReader, type SessionLogRow } from '../src/log-lane.ts'

const fixtureRows = JSON.parse(
  readFileSync(new URL('./fixtures/main-session.json', import.meta.url), 'utf8'),
) as SessionLogRow[]
const FIXTURE_SESSION = 'session-ab39b2b8-4101-4009-b4f2-e38f17fc3774'

/** The fixture log, served for the fixture session id only (children read as not-materialized). */
class MainLogReader implements SessionLogReader {
  readonly opens: string[] = []
  constructor(private readonly rows: SessionLogRow[] = fixtureRows) {}

  async open(id: string, _access: 'read'): Promise<SessionLogHandle> {
    this.opens.push(id)
    if (id !== FIXTURE_SESSION) {
      const notFound = new Error(`session "${id}" not found`)
      notFound.name = 'SessionPersistenceNotFoundError'
      throw notFound
    }
    const rows = this.rows
    return {
      read: (offset = 0) => Promise.resolve({ events: rows.slice(offset) }),
      close: () => Promise.resolve(),
    }
  }
}

async function mount(reader: SessionLogReader, config = {}): Promise<{ ctx: Context; service: InspectorService }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const service = new InspectorService(ctx, config, { persistence: reader })
  return { ctx, service }
}

/** Drive one live turn (turn/start → one text request → assistant/message → turn/end). */
async function liveTurn(ctx: Context, sessionId: string, hostTurn: number, text: string): Promise<void> {
  const session = ctx.sessions.get(sessionId as SessionId)
  if (session === undefined) throw new Error('session missing')
  session.append('turn/start', { turn: hostTurn })
  const user = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  session.append('user/message', user, { surfaceOp: 'append' })
  const options = deepFreeze({
    provider: 'deepseek',
    model: 'deepseek-chat',
    messages: [
      createSystemMessage('你是助手'),
      user,
    ],
    sessionId: session.id,
  }) as GenerateOptions
  const stream = ctx.waterfall({}, 'llm/stream', options, async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '现场答复' } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }) as AsyncIterable<StreamChunk>
  for await (const _chunk of stream) { /* drain */ }
  session.append('turn/end', { turn: hostTurn, reason: { kind: 'completed' } })
}

describe('reconstructSession (fold shape)', () => {
  it('reconstructs four turns with structure, delegations, and closing messages', () => {
    const turns = reconstructSession(structuredClone(fixtureRows))
    expect(turns.map(turn => turn.hostTurn)).toEqual([1, 2, 3, 4])
    expect(turns[0]?.query).toContain('三层世界')
    expect(turns[0]?.requests).toHaveLength(2)
    expect(turns[0]?.closingMessageId).toBeDefined()
    expect(turns[3]?.delegations).toHaveLength(1)
    expect(turns[3]?.delegations[0]).toMatchObject({
      callId: 'call_sub1',
      childId: 'child-fix-fail',
      catalogLabel: 'dsh: 对账子任务',
      isError: true,
    })
    expect(turns[3]?.requests).toHaveLength(2)
  })
})

describe('backfill (no live content)', () => {
  it('rebuilds the pre-mount turns at log fidelity on the first query', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader)
    ctx.sessions.create(FIXTURE_SESSION as SessionId)

    const { turns } = await service.listTurns(FIXTURE_SESSION)
    expect(turns.map(turn => turn.turnSeq)).toEqual([1, 2, 3, 4])
    expect(turns.every(turn => turn.hostTurn === turn.turnSeq)).toBe(true)
    expect(turns[0]?.requestCount).toBe(2)
    expect(turns[3]?.failedScopeCount).toBe(1)

    // Turn 1 request 1: the tool-calling step — config/tools from the header,
    // system as ONE unattributed block, six-bucket timing from the stream.
    const overview = await service.getTurn(FIXTURE_SESSION, 1)
    const main = overview?.scopes.find(scope => scope.kind === 'main')
    expect(main?.config).toEqual({ provider: 'kimi-coding', model: 'k3', maxTokens: 131_072 })
    const first = await service.getRequest(FIXTURE_SESSION, main?.requests[0]?.seq ?? -1)
    expect(first?.status).toBe('ok')
    expect(first?.usage).toEqual({ inputTokens: 6388, outputTokens: 304, totalTokens: 6692 })
    expect(first?.responseSummary).toEqual({ kind: 'tool', name: 'skill' })
    expect(first?.timing.waitMs).toBe(1791454740735 - 1791454729260)
    expect(first?.timing.reasoningMs).toBe(1791454743146 - 1791454740735)
    expect(first?.timing.toolArgsMs).toBe(1)
    expect(first?.timing.toolExecMs).toBe(1791454759263 - 1791454743150)
    expect(first?.timing.totalMs).toBe(1791454743148 - 1791454729260)
    // Log-lane fidelity: the system prompt is one block, no section names.
    expect(first?.segments.system).toHaveLength(1)
    expect(first?.segments.system[0]?.source).toBe('system-prompt')
    expect(first?.segments.system[0]?.chars).toBeGreaterThan(200)
    expect(first?.segments.tools.map(tool => tool.name)).toEqual(['ask_user_question', 'bash', 'canvas_open', 'novel_bind'])

    // The chain across turn 1's two requests: added = the first response + its tool result.
    // (The history rows classify: the human ask, the runtime-context snapshot, the skill catalog.)
    const second = await service.getRequest(FIXTURE_SESSION, main?.requests[1]?.seq ?? -1)
    expect(second?.segments.history.map(item => item.category)).toEqual(['user', 'runtime-snapshot', 'skill-injection'])
    expect(second?.segments.added.map(item => item.category)).toEqual(['assistant', 'tool-result'])
    expect(second?.segments.added[0]?.durationMs).toBe(1791454743148 - 1791454729260)
    expect(second?.usage?.cacheReadTokens).toBe(6144)
    expect(second?.responseSummary).toEqual({ kind: 'text' })
    service.dispose()
  })

  it('reconstructs turn 3’s header change: new tools flagged, the tool-change row classified', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader)
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    const overview = await service.getTurn(FIXTURE_SESSION, 3)
    const main = overview?.scopes.find(scope => scope.kind === 'main')
    // The header change at seq 47 lands mid-turn: the request built from the
    // assistant message right after it carries the new tools as added and the
    // developer message as a tool-change row.
    const requests = main?.requests ?? []
    const withNewTools = await service.getRequest(FIXTURE_SESSION, requests[1]?.seq ?? -1)
    expect(withNewTools?.segments.tools.filter(tool => tool.added).map(tool => tool.name))
      .toEqual(['novel_extract', 'novel_read', 'novel_write'])
    expect(withNewTools?.segments.added.some(item => item.category === 'tool-change')).toBe(true)
    service.dispose()
  })

  it('stubs the failed delegation scope (0 requests) and refreshes it honestly', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader)
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    const overview = await service.getTurn(FIXTURE_SESSION, 4)
    const child = overview?.scopes.find(scope => scope.kind === 'subagent')
    expect(child).toMatchObject({
      scopeId: 'child-fix-fail',
      kind: 'subagent',
      status: 'failed',
      label: 'dsh: 对账子任务',
      requests: [],
    })
    expect(child?.error).toBe('Error: subagent run failed')
    service.dispose()
  })
})

describe('merge with the live lane', () => {
  it('live turn wins whole-turn and no duplicate appears across the boundary', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader)
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    // The live lane captures turn 5 BEFORE the first panel query.
    await liveTurn(ctx, FIXTURE_SESSION, 5, '现场的问题')

    const { turns } = await service.listTurns(FIXTURE_SESSION)
    expect(turns.map(turn => turn.turnSeq)).toEqual([1, 2, 3, 4, 5])
    // Turn 5 is the live capture: its request came through the waterfall.
    const overview = await service.getTurn(FIXTURE_SESSION, 5)
    const main = overview?.scopes.find(scope => scope.kind === 'main')
    expect(main?.requests).toHaveLength(1)
    const detail = await service.getRequest(FIXTURE_SESSION, main?.requests[0]?.seq ?? -1)
    expect(detail?.segments.added.map(item => item.category)).toEqual(['user'])
    expect(detail?.segments.added[0]?.full).toBe('现场的问题')
    expect(detail?.config).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    // …and the log's own turn-1..4 content stays reconstructed, once each.
    const { turns: again } = await service.listTurns(FIXTURE_SESSION)
    expect(again.map(turn => turn.turnSeq)).toEqual([1, 2, 3, 4, 5])
    service.dispose()
  })

  it('never re-runs the backfill (one read per session) and keeps seqs stable', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader)
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    const first = await service.listTurns(FIXTURE_SESSION)
    const second = await service.listTurns(FIXTURE_SESSION)
    expect(reader.opens.filter(id => id === FIXTURE_SESSION)).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first.backfill.state).toBe('complete')
    service.dispose()
  })
})

describe('budget discipline', () => {
  it('fills backwards from the mount point, newest first, behind live turns', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader, { maxTurnsPerSession: 3 })
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    await liveTurn(ctx, FIXTURE_SESSION, 5, '现场的问题')

    const { turns } = await service.listTurns(FIXTURE_SESSION)
    // 3-slot budget, 1 live turn → only the newest two historical turns (4, 3).
    expect(turns.map(turn => turn.turnSeq)).toEqual([3, 4, 5])
    service.dispose()
  })

  it('backfills nothing when live turns already fill the budget (and never evicts them)', async () => {
    const reader = new MainLogReader()
    const { ctx, service } = await mount(reader, { maxTurnsPerSession: 2 })
    ctx.sessions.create(FIXTURE_SESSION as SessionId)
    await liveTurn(ctx, FIXTURE_SESSION, 5, '现场一')
    await liveTurn(ctx, FIXTURE_SESSION, 6, '现场二')

    const { turns } = await service.listTurns(FIXTURE_SESSION)
    expect(turns.map(turn => turn.turnSeq)).toEqual([5, 6])
    expect(turns.every(turn => turn.hostTurn !== undefined)).toBe(true)
    service.dispose()
  })
})
