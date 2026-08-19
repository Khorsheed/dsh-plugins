import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import type { LocalAgentFacade } from '../src/adapter.ts'
import { stubAgents } from './agents-stub.ts'

interface BenchOptions {
  /** false: no localAgent service at all (facade probe misses). */
  facade?: boolean
  /** Full override of the localAgent stub (roster slice etc.); wins over facade. */
  localAgent?: Record<string, unknown>
}

/**
 * The REAL composition: a cordis root, the real SessionStore plugin, and the
 * package's own service plugin. `agents` and `localAgent` are external
 * services to this package; their faces are stubbed. The facade stub's runs
 * never settle (service-surface tests assert the journal, not the run).
 */
async function boot(options: BenchOptions = {}) {
  const ctx = new Context()
  const agents = stubAgents(ctx)
  const facade: LocalAgentFacade = {
    start: vi.fn(async (): Promise<SubagentRun> => ({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: new Promise(() => {}),
      dispose: async () => {},
    })),
    resume: vi.fn(async (): Promise<SubagentRun> => ({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: new Promise(() => {}),
      dispose: async () => {},
    })),
    cancel: vi.fn(() => false),
  }
  const localAgent = options.localAgent ?? (options.facade === false ? undefined : facade)
  if (localAgent !== undefined) ctx.provide('localAgent', localAgent as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  return { ctx, service: ctx.get('room') as RoomService, facade, agents }
}

/** Boot with one room created; returns its id. */
async function bootRoom(options: BenchOptions = {}) {
  const { ctx, service, facade, agents } = await boot(options)
  const { sessionId } = await service.createRoom({})
  return { ctx, service, facade, agents, sessionId }
}

/** The roster row every fresh room seats: its own main agent. */
const MAIN_MEMBER = { name: 'main', kind: 'main-agent', invitedBy: 'human' }

/**
 * Flush the task queue so the engine's queued run reaches the delivery point.
 * (The facade stub's runs never SETTLE, so engine.idle() would hang — the
 * relay's sent edge is journaled when the prompt is delivered, long before
 * the run's result resolves.)
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('RoomService Remote surface (real composition)', () => {
  it('getState replays a fresh room (main agent seated), and rejects plain/unknown sessions', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    const state = await service.getState({ sessionId })
    expect(state).toEqual({ ok: true, value: { members: [MAIN_MEMBER], relays: [], tasks: [], runs: [] } })

    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await service.getState({ sessionId: plain.id }))
      .toEqual({ ok: false, error: { code: 'not-a-room' } })
    expect(await service.getState({ sessionId: SessionId('nope') }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
  })

  it('createRoom publishes the session through the agent factory (a live main agent)', async () => {
    const { service, agents, sessionId } = await bootRoom()
    expect(agents.create).toHaveBeenCalledTimes(1)
    // The dispatch anchor: the delegation facade resolves the parent through
    // agents.get — a room born without a live agent cannot dispatch at all.
    expect(agents.get(sessionId)).toBeDefined()
  })

  it('invite lands a cli member on the roster and acknowledges a dispatched first task', async () => {
    const { service, sessionId } = await bootRoom()
    const invited = await service.invite({
      sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '搭骨架', cwd: '/home/user/api',
    })
    expect(invited).toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: true } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        members: [
          MAIN_MEMBER,
          { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端', cwd: '/home/user/api' },
        ],
        // The first task is journaled as a dispatch record and auto-opens the
        // member's in_progress task.
        tasks: [{ member: 'ada', title: '搭骨架', status: 'in_progress' }],
      },
    })

    const idle = await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    expect(idle).toEqual({ ok: true, value: { name: 'bill', pendingFirstTask: false } })
  })

  it('invite rejects bad names, duplicates, blank providers, and blank texts', async () => {
    const { service, sessionId } = await bootRoom()
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'a b' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'a@b' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: '' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: '  ', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'empty-provider' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: ' ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada', firstTask: '' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.invite({ sessionId, provider: 'codex', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
    // The room's own main agent is seated at creation; its name is taken too.
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'main' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
  })

  it('invite degrades to local-agent-unavailable without the facade', async () => {
    const { service, sessionId } = await bootRoom({ facade: false })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'local-agent-unavailable' } })
    // The room itself and its main-agent member are unaffected.
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
  })

  it('updateMember rewrites instructions and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: '后端' })
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: '后端 + 评审' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER, { name: 'ada', instructions: '后端 + 评审' }] } })

    expect(await service.updateMember({ sessionId, name: 'ghost', instructions: 'x' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
    expect(await service.updateMember({ sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'nothing-to-update' } })
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: ' ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
  })

  it('removeMember drops the member from the roster and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.removeMember({ sessionId, name: 'ada' })).toEqual({ ok: true, value: { name: 'ada' } })
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
    expect(await service.removeMember({ sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
  })

  it('postMessage without a mention is a structured no-targets rejection (bare messages belong to the official path)', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    expect(await service.postMessage({ sessionId, text: '今天先讨论方向' }))
      .toEqual({ ok: false, error: { code: 'no-targets' } })
    // Nothing is journaled: the rejection is pure defense.
    const events = ctx.sessions.get(sessionId)!.events
    expect(events.filter(event => event.type.startsWith('room/'))).toHaveLength(2)
    expect(events.some(event => event.type === 'user/message')).toBe(false)
    expect(await service.postMessage({ sessionId, text: '   ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
  })

  it('postMessage with mentions logs a standard user/message (the official bubble) plus the dispatch bookkeeping, auto-opens tasks, and validates the roster', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })

    const single = await service.postMessage({ sessionId, text: '@ada 出方案' })
    expect(single).toMatchObject({ ok: true, value: { parsed: { targets: ['ada'], text: '出方案' } } })
    const fanout = await service.postMessage({ sessionId, text: '@ada @bill 对齐接口' })
    expect(fanout).toMatchObject({ ok: true, value: { parsed: { targets: ['ada', 'bill'], text: '对齐接口' } } })

    expect(await service.postMessage({ sessionId, text: '@ada @ghost 干活' }))
      .toEqual({ ok: false, error: { code: 'unknown-targets', names: ['ghost'] } })
    expect(await service.postMessage({ sessionId, text: '@ada' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    const events = ctx.sessions.get(sessionId)!.events
    // The human's raw text (mentions included) lands as a human-sourced
    // append-surface user/message — the official user bubble claims it, and
    // the main agent's next turn reads it. The append wakes nothing.
    const messages = events.filter(event => event.type === 'user/message')
    expect(messages.map(event => ({
      text: (event.data as { content: Array<{ text: string }> }).content[0]!.text,
      source: (event.data as { source: unknown }).source,
      surfaceOp: (event as { surfaceOp?: unknown }).surfaceOp,
    }))).toEqual([
      { text: '@ada 出方案', source: { kind: 'user' }, surfaceOp: 'append' },
      { text: '@ada @bill 对齐接口', source: { kind: 'user' }, surfaceOp: 'append' },
    ])
    // The dispatch record stays as bookkeeping (tasks, cursors, replay).
    const dispatches = events.filter(event => event.type === 'room/dispatch')
    expect(dispatches.map(event => event.data)).toEqual([
      { targets: ['ada'], text: '出方案' },
      { targets: ['ada', 'bill'], text: '对齐接口' },
    ])
    // The user/message precedes its dispatch record (bubble above bookkeeping).
    expect(events.indexOf(messages[0]!)).toBeLessThan(events.indexOf(dispatches[0]!))

    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        tasks: [
          { member: 'ada', title: '出方案', status: 'in_progress' },
          { member: 'ada', title: '对齐接口', status: 'in_progress' },
          { member: 'bill', title: '对齐接口', status: 'in_progress' },
        ],
      },
    })
  })

  it('receiveMemberMessage journals a pending relay and always receipts pending-confirm (phase-1 gate)', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    const receipt = await service.receiveMemberMessage({
      from: 'ada', to: 'main', content: '接口定稿', parentSessionId: sessionId,
      provenance: { kind: 'bridge', delegationId: 'd-1' },
    })
    expect(receipt).toBe('pending-confirm')
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        relays: [{ from: 'ada', to: 'main', content: '接口定稿', state: 'pending', provenance: { kind: 'bridge', delegationId: 'd-1' } }],
      },
    })
  })

  it('receiveMemberMessage throws on a non-room parent session (the bridge falls back to direct delivery)', async () => {
    const { ctx, service } = await bootRoom()
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    await expect(service.receiveMemberMessage({
      from: 'ada', to: 'bill', content: 'x', parentSessionId: plain.id,
    })).rejects.toThrow('not a room')
    await expect(service.receiveMemberMessage({
      from: 'ada', to: 'bill', content: 'x', parentSessionId: SessionId('ghost'),
    })).rejects.toThrow()
  })

  it('receiveMemberMessage resolves child-session-id endpoints to roster names and rejects malformed messages', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    // The bridge addresses the sender by its child session id (only room owns
    // the roster); the dispatch engine records it through member-updated.
    ctx.sessions.get(sessionId)!.append('room/member-updated', { name: 'ada', childSessionId: SessionId('child-ada') })
    ctx.sessions.get(sessionId)!.append('room/member-updated', { name: 'bill', childSessionId: SessionId('child-bill') })

    const receipt = await service.receiveMemberMessage({
      from: SessionId('child-ada'), to: 'child-bill', content: '接口定稿', parentSessionId: sessionId,
    })
    expect(receipt).toBe('pending-confirm')
    expect(await service.getState({ sessionId })).toMatchObject({
      ok: true,
      value: { relays: [{ from: 'ada', to: 'bill', state: 'pending' }] },
    })

    // A malformed message (the untyped bridge boundary) throws instead of
    // poisoning the journal — the bridge falls back to direct delivery.
    await expect(service.receiveMemberMessage({
      from: { childSessionId: 'child-ada' }, to: 'bill', content: 'x', parentSessionId: sessionId,
    } as never)).rejects.toThrow('malformed member message')
    expect((await service.getState({ sessionId }))).toMatchObject({ ok: true, value: { relays: [{ content: '接口定稿' }] } })
  })

  it('confirmRelay dispatches the notification to the recipient; dismissRelay drops it', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    await service.receiveMemberMessage({ from: 'ada', to: 'bill', content: '接口定稿', parentSessionId: sessionId })
    await service.receiveMemberMessage({ from: 'ada', to: 'main', content: '抄送', parentSessionId: sessionId })
    const state = await service.getState({ sessionId })
    if (!state.ok) throw new Error('narrowing')
    const [first, second] = state.value.relays

    expect(await service.confirmRelay({ sessionId, relayId: first!.id }))
      .toEqual({ ok: true, value: { relayId: first!.id } })
    expect(await service.dismissRelay({ sessionId, relayId: second!.id }))
      .toEqual({ ok: true, value: { relayId: second!.id } })
    await tick()
    await tick()

    // The confirm dispatched bill: his run started (the facade stub never
    // settles, so he stays running) and the relay was marked sent once the
    // member's session received the prompt; the dismiss journaled nothing.
    const session = ctx.sessions.get(sessionId)!
    const edges = session.events.filter(event => event.type === 'room/run-state')
    expect(edges.map(event => (event.data as { member: string }).member)).toEqual(['bill'])
    const after = await service.getState({ sessionId })
    expect(after).toMatchObject({
      ok: true,
      value: { relays: [{ state: 'sent' }, { state: 'dismissed' }] },
    })

    // Resolved relays reject further resolution; unknown ids too.
    expect(await service.confirmRelay({ sessionId, relayId: first!.id }))
      .toEqual({ ok: false, error: { code: 'relay-not-pending' } })
    expect(await service.dismissRelay({ sessionId, relayId: 'ghost' }))
      .toEqual({ ok: false, error: { code: 'relay-not-found' } })
  })

  it('confirmRelay rejects a relay whose recipient left the roster', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.receiveMemberMessage({ from: 'main', to: 'ada', content: 'x', parentSessionId: sessionId })
    await service.removeMember({ sessionId, name: 'ada' })
    const state = await service.getState({ sessionId })
    if (!state.ok) throw new Error('narrowing')
    expect(await service.confirmRelay({ sessionId, relayId: state.value.relays[0]!.id }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
  })

  it('addTask opens a pending task; closeTask closes it exactly once', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    const added = await service.addTask({ sessionId, member: 'ada', title: '补测试' })
    expect(added).toMatchObject({ ok: true })
    if (!added.ok) throw new Error('narrowing')
    expect(await service.getState({ sessionId })).toMatchObject({
      ok: true,
      value: { tasks: [{ id: added.value.id, member: 'ada', title: '补测试', status: 'pending' }] },
    })

    expect(await service.closeTask({ sessionId, taskId: added.value.id }))
      .toEqual({ ok: true, value: { id: added.value.id } })
    expect(await service.getState({ sessionId })).toMatchObject({
      ok: true,
      value: { tasks: [{ id: added.value.id, status: 'done' }] },
    })
    expect(await service.closeTask({ sessionId, taskId: added.value.id }))
      .toEqual({ ok: false, error: { code: 'task-closed' } })
    expect(await service.closeTask({ sessionId, taskId: 'ghost' }))
      .toEqual({ ok: false, error: { code: 'task-not-found' } })
    expect(await service.addTask({ sessionId, member: 'ghost', title: 'x' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
    expect(await service.addTask({ sessionId, member: 'ada', title: ' ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
  })

  it('cancel reports a miss when the member never ran (and nothing is journaled)', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.cancel({ sessionId, name: 'ada' })).toEqual({ ok: true, value: { cancelled: false } })
    expect(await service.cancel({ sessionId, name: 'ghost' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { runs: [] } })
  })

  it('listProviders reflects the roster, auth state, and delegation capability', async () => {
    const localAgent = {
      start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false),
      roster: () => [
        { name: 'kimi', displayName: 'Kimi Code' },
        { name: 'rec', displayName: 'Record Only' },
      ],
      statusOf: vi.fn(async (name: string) => name === 'kimi'
        ? { authenticated: true, delegationProvider: 'kimi' as const }
        : { authenticated: false }),
    }
    const { service } = await boot({ localAgent })
    expect(await service.listProviders({})).toEqual({
      localAgentAvailable: true,
      // The record-only harness (no delegationProvider) is not invitable.
      providers: [{ provider: 'kimi', displayName: 'Kimi Code', authenticated: true }],
    })
  })

  it('listProviders degrades: no facade → unavailable; facade without roster slice → empty list', async () => {
    const without = await boot({ facade: false })
    expect(await without.service.listProviders({})).toEqual({ localAgentAvailable: false, providers: [] })

    // The default facade stub carries no roster/statusOf.
    const partial = await boot()
    expect(await partial.service.listProviders({})).toEqual({ localAgentAvailable: true, providers: [] })
  })
})
