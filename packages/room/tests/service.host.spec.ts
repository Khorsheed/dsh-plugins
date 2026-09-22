import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import type { LocalAgentFacade } from '../src/adapter.ts'
import { stubAgents } from './agents-stub.ts'
import { createRoom } from './promote.ts'

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
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, facade, agents, sessionId }
}

/** The roster row every fresh room seats: its own main agent. */
const MAIN_MEMBER = { id: 'legacy:1', name: 'dsh', kind: 'main-agent', invitedBy: 'human' }

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

  it('ensureRoom promotes a plain session in place (marker + main seat, idempotent)', async () => {
    const { ctx, service, agents } = await boot()
    // Mint a plain session through the factory stub, as any session is born.
    const sessionId = SessionId(`session-${randomUUID()}`)
    await agents.create({ sessionId, meta: {} })
    const session = ctx.sessions.get(sessionId)!
    expect(session.snapshotEvents().some(event => event.type === 'room/created')).toBe(false)

    const promoted = await service.ensureRoom(sessionId)
    expect(promoted.ok).toBe(true)
    // The marker and the main-agent seat journal onto the SAME session.
    expect(session.snapshotEvents().filter(event => event.type.startsWith('room/')).map(event => event.type))
      .toEqual(['room/created', 'room/member-added'])
    const state = await service.getState({ sessionId })
    expect(state).toEqual({ ok: true, value: { members: [MAIN_MEMBER], relays: [], tasks: [], runs: [] } })

    // Idempotent: a second promotion journals nothing more.
    const again = await service.ensureRoom(sessionId)
    expect(again.ok).toBe(true)
    expect(session.snapshotEvents().filter(event => event.type === 'room/created')).toHaveLength(1)
  })

  it('invite into a PLAIN session promotes it and lands the member', async () => {
    const { ctx, service, agents } = await boot()
    const sessionId = SessionId(`session-${randomUUID()}`)
    await agents.create({ sessionId, meta: {} })
    const invited = await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(invited).toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: false } })
    const events = ctx.sessions.get(sessionId)!.snapshotEvents()
    expect(events.filter(event => event.type.startsWith('room/')).map(event => event.type))
      .toEqual(['room/created', 'room/member-added', 'room/member-added'])
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { members: [MAIN_MEMBER, { name: 'ada', kind: 'cli', invitedBy: 'human' }] },
    })
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

  it('invite records the optional model on the roster (trimmed; absent when omitted)', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', model: ' kimi-k2 ' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        members: [
          MAIN_MEMBER,
          { name: 'ada', kind: 'cli', provider: 'kimi', model: 'kimi-k2' },
          { name: 'bill', kind: 'cli', provider: 'codex' },
        ],
      },
    })
    // The omitted case records NO model key at all.
    const bill = state.ok
      ? state.value.members.find(member => member.name === 'bill')
      : undefined
    expect(bill !== undefined && 'model' in bill).toBe(false)
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
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada', model: '  ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.invite({ sessionId, provider: 'codex', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
    // The room's own main agent is seated at creation; its name is taken too.
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'dsh' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
  })

  it('invite degrades to local-agent-unavailable without the facade', async () => {
    const { service, sessionId } = await bootRoom({ facade: false })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'local-agent-unavailable' } })
    // The room itself and its main-agent member are unaffected.
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
  })

  it('rechecks invitation names after asynchronous provider readiness', async () => {
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const localAgent = {
      start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false),
      roster: () => [{ name: 'kimi', displayName: 'Kimi' }],
      statusOf: vi.fn(async () => { await ready; return { authenticated: true, delegationProvider: 'kimi-cli' } }),
    }
    const { service, sessionId } = await bootRoom({ localAgent })
    const request = { sessionId, provider: 'kimi-cli', name: 'same-name' }
    const first = service.invite(request)
    const second = service.invite(request)
    await vi.waitFor(() => expect(localAgent.statusOf).toHaveBeenCalledTimes(2))
    release()
    const results = await Promise.all([first, second])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: { code: 'duplicate-name' } }])
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER, { name: 'same-name' }] } })
  })

  it('invite rejects a provider outside the roster delegation set, carrying the legal list', async () => {
    // The classic slip: the harness name `kimi` where the family registered
    // the delegation provider `kimi-cli`.
    const localAgent = {
      start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false),
      roster: () => [
        { name: 'kimi', displayName: 'Kimi Code' },
        { name: 'codex', displayName: 'Codex' },
        { name: 'rec', displayName: 'Record Only' },
      ],
      statusOf: vi.fn(async (name: string) => name === 'rec'
        ? { authenticated: true }
        : { authenticated: true, delegationProvider: `${name}-cli` }),
    }
    const { service, sessionId } = await bootRoom({ localAgent })
    const rejected = await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(rejected).toEqual({
      ok: false,
      // The record-only harness (no delegationProvider) is not a legal value.
      error: { code: 'unknown-provider', provider: 'kimi', available: ['kimi-cli', 'codex-cli'] },
    })
    // Nothing is journaled: the roster stays the seated main agent only.
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
    // The legal id goes through.
    expect(await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada' }))
      .toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: false } })
  })

  it('invite skips the provider check when the core predates the roster slice (degrade, never explode)', async () => {
    // The default facade stub carries no roster/statusOf: validation is
    // impossible, so invite keeps the old accept-anything behavior.
    const { service, sessionId } = await bootRoom()
    expect(await service.invite({ sessionId, provider: 'anything', name: 'ada' }))
      .toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: false } })
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

    // A blank (or null) instructions CLEARS the preset — later dispatches
    // inject none (the old empty-text rejection went away with clearing).
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: ' ' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const cleared = await service.getState({ sessionId })
    expect(cleared.ok && cleared.value.members[1]).toBeDefined()
    if (cleared.ok) expect(cleared.value.members[1]).not.toHaveProperty('instructions')
  })

  it('updateMember renames a member — migrating the board, relays and runs — and sets/clears the cwd override', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: '后端' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    await service.addTask({ sessionId, member: 'ada', title: '出方案', blockedBy: 'bill' })
    await service.receiveMemberMessage({
      from: 'ada', to: 'bill', content: '接口定稿', parentSessionId: sessionId,
    })
    ctx.sessions.get(sessionId)!.append('room/run-state', { member: 'ada', state: 'running', startedAt: 1 })

    expect(await service.updateMember({ sessionId, name: 'ada', rename: 'K酱', cwd: ' /tmp/work ' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const renamed = await service.getState({ sessionId })
    expect(renamed).toMatchObject({
      ok: true,
      value: {
        members: [MAIN_MEMBER, { name: 'K酱', instructions: '后端', cwd: '/tmp/work' }, { name: 'bill' }],
        tasks: [{ member: 'K酱', blockedBy: 'bill', title: '出方案' }],
        relays: [{ from: 'K酱', to: 'bill' }],
        // This fixture has a journal edge but no active native handle.
        runs: [{ member: 'K酱', state: 'failed', error: expect.stringContaining('unknown after restart') }],
      },
    })

    // null clears the cwd override (back to inheriting the room cwd).
    expect(await service.updateMember({ sessionId, name: 'K酱', cwd: null }))
      .toEqual({ ok: true, value: { name: 'K酱' } })
    const cleared = await service.getState({ sessionId })
    if (cleared.ok) expect(cleared.value.members[1]).not.toHaveProperty('cwd')

    // Rename validation: uniqueness, the name grammar, and the main agent is
    // the room itself — it cannot be renamed.
    expect(await service.updateMember({ sessionId, name: 'K酱', rename: 'bill' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
    expect(await service.updateMember({ sessionId, name: 'K酱', rename: 'bad name' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.updateMember({ sessionId, name: 'dsh', rename: 'boss' }))
      .toEqual({ ok: false, error: { code: 'main-member' } })
  })

  it('updateMember journals the intended model — set, trim, and null/blank clears', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', model: 'kimi-k2' })
    // A model-only edit is a legal update (not nothing-to-update).
    expect(await service.updateMember({ sessionId, name: 'ada', model: ' kimi-k1 ' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const updated = await service.getState({ sessionId })
    expect(updated).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER, { name: 'ada', model: 'kimi-k1' }] } })

    // null (or a blank string) CLEARS the intent — the member follows the
    // harness default again.
    expect(await service.updateMember({ sessionId, name: 'ada', model: ' ' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const cleared = await service.getState({ sessionId })
    if (cleared.ok) expect(cleared.value.members[1]).not.toHaveProperty('model')
    expect(await service.updateMember({ sessionId, name: 'ada', model: null }))
      .toEqual({ ok: true, value: { name: 'ada' } })
  })

  it('removeMember drops the member from the roster and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.removeMember({ sessionId, name: 'ada' })).toEqual({ ok: true, value: { name: 'ada' } })
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
    expect(await service.removeMember({ sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
  })

  it('routes a bare message through the persisted native coordinator and rejects empty input', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    expect(await service.postMessage({ sessionId, text: '今天先讨论方向' }))
      .toMatchObject({ ok: true, value: { parsed: { targets: ['dsh'], text: '今天先讨论方向' } } })
    const dispatch = ctx.sessions.get(sessionId)!.snapshotEvents().find(event => event.type === 'room/dispatch')
    expect(dispatch?.data).toMatchObject({ origin: 'human', targetIds: ['legacy:1'] })
    expect(await service.postMessage({ sessionId, text: '   ' })).toEqual({ ok: false, error: { code: 'empty-text' } })
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

    const events = ctx.sessions.get(sessionId)!.snapshotEvents()
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
    expect(dispatches.map(event => event.data)).toMatchObject([
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

  it('postMessage unions menu-picked targets with the leading tokens, dispatches the text verbatim, and validates picks against the roster', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })

    // A picked mid-sentence mention addresses without any leading token; the
    // sentence stands whole as the dispatch text.
    const picked = await service.postMessage({ sessionId, text: '接口找 @bill 对齐一下', targets: ['bill'] })
    expect(picked).toMatchObject({ ok: true, value: { parsed: { targets: ['bill'], text: '接口找 @bill 对齐一下' } } })
    // A leading token and a pick union (deduped).
    const union = await service.postMessage({ sessionId, text: '@ada 顺带 @bill 看看', targets: ['bill', 'ada'] })
    expect(union).toMatchObject({ ok: true, value: { parsed: { targets: ['ada', 'bill'], text: '顺带 @bill 看看' } } })
    // A picked member that has left the roster rejects the same way a typed
    // unknown target does.
    expect(await service.postMessage({ sessionId, text: '找 @ghost', targets: ['ghost'] }))
      .toEqual({ ok: false, error: { code: 'unknown-targets', names: ['ghost'] } })
    // Picks alone never rescue an empty text.
    expect(await service.postMessage({ sessionId, text: '  ', targets: ['ada'] }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    const events = ctx.sessions.get(sessionId)!.snapshotEvents()
    const dispatches = events.filter(event => event.type === 'room/dispatch')
    expect(dispatches.map(event => event.data)).toMatchObject([
      { targets: ['bill'], text: '接口找 @bill 对齐一下' },
      { targets: ['ada', 'bill'], text: '顺带 @bill 看看' },
    ])
    // One auto-opened task per target per dispatch.
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        tasks: [
          { member: 'bill', title: '接口找 @bill 对齐一下', status: 'in_progress' },
          { member: 'ada', title: '顺带 @bill 看看', status: 'in_progress' },
          { member: 'bill', title: '顺带 @bill 看看', status: 'in_progress' },
        ],
      },
    })
  })

  it('receiveMemberMessage journals a pending relay and always receipts pending-confirm (phase-1 gate)', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    const receipt = await service.receiveMemberMessage({
      from: 'ada', to: 'dsh', content: '接口定稿', parentSessionId: sessionId,
      provenance: { kind: 'bridge', delegationId: 'd-1' },
    })
    expect(receipt).toBe('pending-confirm')
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        relays: [{ from: 'ada', to: 'dsh', content: '接口定稿', state: 'pending', provenance: { kind: 'bridge', delegationId: 'd-1' } }],
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
    await service.receiveMemberMessage({ from: 'ada', to: 'dsh', content: '抄送', parentSessionId: sessionId })
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
    const edges = session.snapshotEvents().filter(event => event.type === 'room/run-state')
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
    await service.receiveMemberMessage({ from: 'dsh', to: 'ada', content: 'x', parentSessionId: sessionId })
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

  it('addTask journals an optional blockedBy (a roster member) and rejects an unknown one', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'kimi', name: 'bill' })
    const added = await service.addTask({ sessionId, member: 'bill', title: '搭页面', blockedBy: 'ada' })
    expect(added).toMatchObject({ ok: true })
    expect(await service.getState({ sessionId })).toMatchObject({
      ok: true,
      value: { tasks: [{ member: 'bill', title: '搭页面', status: 'pending', blockedBy: 'ada' }] },
    })
    expect(await service.addTask({ sessionId, member: 'bill', title: 'x', blockedBy: 'ghost' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
  })

  it('setGoal journals the goal (latest wins; blank clears) and getState carries it', async () => {
    const { service, sessionId } = await bootRoom()
    const fresh = await service.getState({ sessionId })
    if (!fresh.ok) throw new Error('narrowing')
    expect(fresh.value.goal).toBeUndefined()
    expect(await service.setGoal({ sessionId, text: ' 插件 API v2 上线 ' }))
      .toEqual({ ok: true, value: { goal: '插件 API v2 上线' } })
    expect(await service.getState({ sessionId })).toMatchObject({
      ok: true, value: { goal: '插件 API v2 上线' },
    })
    expect(await service.setGoal({ sessionId, text: '' })).toEqual({ ok: true, value: {} })
    const cleared = await service.getState({ sessionId })
    if (!cleared.ok) throw new Error('narrowing')
    expect(cleared.value.goal).toBeUndefined()
    expect(await service.setGoal({ sessionId: SessionId('nope'), text: 'x' }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
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
      // The record-only harness (no delegationProvider) is not invitable;
      // the roster name rides as the harnessModel lookup key.
      providers: [{ provider: 'kimi', displayName: 'Kimi Code', harness: 'kimi', authenticated: true }],
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
