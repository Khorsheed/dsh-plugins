import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import RoomService from '../src/index.ts'
import { roomInviteTool, roomMessageTool, roomReadTool } from '../src/tool-definition.ts'
import { stubAgents } from './agents-stub.ts'
import { createRoom } from './promote.ts'

/** The REAL composition; tools come from the factories (registration moved to the `./tool` row). */
async function boot() {
  const ctx = new Context()
  stubAgents(ctx)
  // Production-faithful stub: the family's registry serves the roster slice
  // alongside the M1 facade, so invite validates against the delegation
  // provider ids (`kimi-cli`, `codex-cli` — NOT the harness names).
  const localAgent = {
    start: vi.fn(async () => new Promise(() => {}) as never),
    resume: vi.fn(async () => new Promise(() => {}) as never),
    cancel: vi.fn(() => false),
    roster: () => [
      { name: 'kimi', displayName: 'Kimi Code' },
      { name: 'codex', displayName: 'Codex' },
    ],
    statusOf: vi.fn(async (name: string) => ({ authenticated: true, delegationProvider: `${name}-cli` })),
  }
  ctx.provide('localAgent', localAgent as never)
  const tools = { register: vi.fn((_tool: ToolDefinition) => () => {}) }
  ctx.provide('tools', tools as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  // The split, pinned: mounting the core registers NO model tool — the
  // package's own `./tool` composition entry (src/tool.ts) owns registration
  // now (its own spec covers registration and the origin tag).
  expect(tools.register).not.toHaveBeenCalled()
  const tool = roomInviteTool(service)
  const messageTool = roomMessageTool(service)
  return { ctx, service, tool, messageTool }
}

/** A minimal exec context: the calling agent driving `session`. */
function execFor(session: Session | undefined) {
  return { agent: session === undefined ? undefined : { session } } as never
}

/** Run the tool and read its result text. */
async function call(tool: ToolDefinition, args: Record<string, unknown>, exec: unknown): Promise<string> {
  const value = await tool.execute(args, exec as never) as { text: string }
  return value.text
}

describe('room_invite tool (real composition)', () => {
  it('registers with the model-facing name and parameter shape', async () => {
    const { tool } = await boot()
    expect(tool.name).toBe('room_invite')
    expect(tool.description).toContain('room')
    const parameters = tool.parameters as { properties: Record<string, unknown> }
    expect(Object.keys(parameters.properties)).toEqual(['provider', 'name', 'role', 'instructions', 'firstTask', 'note', 'cwd', 'mode'])
  })

  it('maps mode: omitted keeps the room\'s own mode, "none" asks for none, an id is passed through', async () => {
    const inviteMember = vi.fn(async (request: { name: string; preset?: string }) => ({ ok: true as const, value: { name: request.name, pendingFirstTask: false, ...request.preset === undefined ? {} : { preset: request.preset } } }))
    const invite = roomInviteTool({ inviteMember } as never)
    const exec = execFor({ id: 'room-1' } as unknown as Session)
    expect(await call(invite as never, { provider: 'codex-cli', name: 'a', instructions: 'x' }, exec)).toContain('Mode: none')
    expect(inviteMember.mock.calls[0]![0]).toMatchObject({ inheritPreset: true })
    await call(invite as never, { provider: 'codex-cli', name: 'b', instructions: 'x', mode: 'none' }, exec)
    expect(inviteMember.mock.calls[1]![0]).not.toHaveProperty('inheritPreset')
    expect(inviteMember.mock.calls[1]![0]).not.toHaveProperty('preset')
    expect(await call(invite as never, { provider: 'codex-cli', name: 'c', instructions: 'x', mode: 'dsh-gamedev' }, exec)).toContain('Mode: dsh-gamedev')
    expect(inviteMember.mock.calls[2]![0]).toMatchObject({ preset: 'dsh-gamedev' })
  })

  it('rejects a non-agent caller, and PROMOTES a plain session on invite', async () => {
    const { ctx, tool } = await boot()
    expect(await call(tool, { provider: 'kimi-cli', name: 'ada', instructions: '后端' }, execFor(undefined)))
      .toContain('requires a calling agent')
    // The promotion entry model: inviting into a plain session makes it a room.
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    const text = await call(tool, { provider: 'kimi-cli', name: 'ada', instructions: '后端' }, execFor(plain))
    expect(text).toContain('joined')
    expect(plain.snapshotEvents().filter(event => event.type.startsWith('room/')).map(event => event.type))
      .toEqual(['room/created', 'room/member-added', 'room/member-added'])
  })

  it('invites an agent-originated member inside a room', async () => {
    const { ctx, service, tool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    const text = await call(tool, {
      provider: 'kimi-cli', name: 'ada', instructions: '负责 API',
    }, execFor(room))
    expect(text).toContain('ada')
    expect(text).toContain('joined')
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { members: [{ name: 'dsh' }, { name: 'ada', kind: 'cli', provider: 'kimi-cli', invitedBy: 'agent', instructions: '负责 API' }] },
    })
  })

  it('returns a self-correcting error text on an unknown provider; the harness name itself resolves', async () => {
    const { ctx, service, tool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    const text = await call(tool, { provider: 'gemini', name: 'ada', instructions: '后端' }, execFor(room))
    expect(text).toContain('unknown-provider')
    expect(text).toContain('"gemini"')
    // The legal set is in the text, so the model can rename and retry.
    expect(text).toContain('kimi-cli')
    expect(text).toContain('codex-cli')
    expect(text).toContain('Retry')
    // Nothing was journaled.
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { members: [{ name: 'dsh' }] } })
    // The self-correction the text enables: rename and retry succeeds.
    const retried = await call(tool, { provider: 'kimi-cli', name: 'ada', instructions: '后端' }, execFor(room))
    expect(retried).toContain('joined')
    // The real-machine slip: the harness name "kimi" now resolves to kimi-cli.
    expect(await call(tool, { provider: 'kimi', name: 'bob', instructions: '后端' }, execFor(room))).toContain('joined')
  })

  it('room_read in a plain session lists what an invite needs instead of failing', async () => {
    const { ctx, service } = await boot()
    const plain = ctx.sessions.create(SessionId('plain-read'), { meta: {} })
    const read = JSON.parse(await service.readRoomContext(plain.id)) as { room: boolean; providers: { provider: string }[] }
    expect(read.room).toBe(false)
    expect(read.providers.map(entry => entry.provider)).toEqual(expect.arrayContaining(['kimi-cli', 'codex-cli']))
  })

  it('returns a retryable error text on a name collision and an invalid name', async () => {
    const { ctx, service, tool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada' })

    const duplicate = await call(tool, { provider: 'codex-cli', name: 'ada', instructions: 'x' }, execFor(room))
    expect(duplicate).toContain('duplicate-name')
    expect(duplicate).toContain('retry')
    const invalid = await call(tool, { provider: 'kimi-cli', name: 'a b', instructions: 'x' }, execFor(room))
    expect(invalid).toContain('invalid-name')
  })
})

describe('room_message tool (real composition)', () => {
  it('dispatches to the member like a human @-message, minus the user bubble', async () => {
    const { ctx, service, messageTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada' })

    const text = await call(messageTool, { member: 'ada', text: '看看接口定义' }, execFor(room))
    expect(text).toMatch(/^Sent m\d+ to ada/)
    expect(text).toContain('asynchronously')

    const events = room.snapshotEvents()
    // The dispatch record journals as usual; the caller is the main agent,
    // so NO human user/message bubble is appended.
    expect(events.filter(event => event.type === 'room/dispatch').map(event => event.data))
      .toMatchObject([{ targets: ['ada'], text: '看看接口定义', origin: 'coordinator', replyTo: 'legacy:1' }])
    expect(events.some(event => event.type === 'user/message')).toBe(false)
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { jobs: [{ number: 1, title: '看看接口定义' }] } })
  })

  it('rejects an unknown member with the live roster, a blank text, and a non-agent caller; a plain session promotes', async () => {
    const { ctx, service, messageTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!

    const unknown = await call(messageTool, { member: 'ghost', text: '在吗' }, execFor(room))
    expect(unknown).toContain('unknown member')
    // The live roster lets the model self-correct (main is always seated).
    expect(unknown).toContain('dsh')
    expect(unknown).toContain('Retry')

    expect(await call(messageTool, { member: 'dsh', text: '  ' }, execFor(room))).toContain('non-blank')
    expect(await call(messageTool, { member: 'dsh', text: 'x' }, execFor(undefined)))
      .toContain('requires a calling agent')

    // The promotion gate: messaging from a plain session turns it into a room
    // (main is seated by the promotion — it is the sender, so addressing
    // itself is refused, but the promotion stands).
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    const text = await call(messageTool, { member: 'dsh', text: '给自己记一笔' }, execFor(plain))
    expect(text).toContain('cannot message yourself')
    expect(plain.snapshotEvents().some(event => event.type === 'room/created')).toBe(true)
  })
})


describe('room coordinator tool ownership', () => {
  it('shares the context reader and denies former native coordinator invites after handoff', async () => {
    const { ctx, service, tool, messageTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi-cli', name: 'planner' })
    const state = await service.getState({ sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const planner = state.value.members.find(member => member.name === 'planner')!
    room.append('room/coordinator', { version: 1, memberId: planner.id!, revision: 1, previousMemberId: 'legacy:1', handoff: 'handoff' })
    expect(JSON.parse(await call(roomReadTool(service), {}, execFor(room)))).toMatchObject({ coordinator: 'planner', state: { members: [{ name: 'dsh' }, { name: 'planner' }] } })
    expect(await call(tool, { provider: 'kimi-cli', name: 'forbidden', instructions: 'work' }, execFor(room))).toContain('not-coordinator')
    // Messaging is free between members: the former coordinator sends as a member.
    expect(await call(messageTool, { member: 'planner', text: 'work' }, execFor(room))).toMatch(/^Sent m\d+ to planner/)
  })
})
