import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import RoomService from '../src/index.ts'
import { roomInviteTool, roomMessageTool, roomTaskTool } from '../src/tool.ts'
import { stubAgents } from './agents-stub.ts'
import { createRoom } from './promote.ts'

/** The REAL composition; tools come from the factories (registration moved to the companion). */
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
  // companion `@khorsheed/dsh-room-tool` owns registration now (its own spec
  // covers registration and the origin tag).
  expect(tools.register).not.toHaveBeenCalled()
  const tool = roomInviteTool(service)
  const taskTool = roomTaskTool(service)
  const messageTool = roomMessageTool(service)
  return { ctx, service, tool, taskTool, messageTool }
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
    expect(Object.keys(parameters.properties)).toEqual(['provider', 'name', 'instructions', 'firstTask', 'cwd'])
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
      value: { members: [{ name: 'main' }, { name: 'ada', kind: 'cli', provider: 'kimi-cli', invitedBy: 'agent', instructions: '负责 API' }] },
    })
  })

  it('returns a self-correcting error text on an unknown provider (the harness-name slip)', async () => {
    const { ctx, service, tool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    // The real-machine bug: the model passed the harness name "kimi".
    const text = await call(tool, { provider: 'kimi', name: 'ada', instructions: '后端' }, execFor(room))
    expect(text).toContain('unknown-provider')
    expect(text).toContain('"kimi"')
    // The legal set is in the text, so the model can rename and retry.
    expect(text).toContain('kimi-cli')
    expect(text).toContain('codex-cli')
    expect(text).toContain('Retry')
    // Nothing was journaled.
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { members: [{ name: 'main' }] } })
    // The self-correction the text enables: rename and retry succeeds.
    const retried = await call(tool, { provider: 'kimi-cli', name: 'ada', instructions: '后端' }, execFor(room))
    expect(retried).toContain('joined')
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

describe('room_task tool (real composition)', () => {
  /** Boot a room with ada on the roster; return the board ids as they appear. */
  async function bootRoom() {
    const { ctx, service, taskTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada' })
    return { ctx, service, taskTool, sessionId, room }
  }

  it('registers with the model-facing name, the action enum, and the shared-board wording', async () => {
    const { taskTool } = await boot()
    expect(taskTool.name).toBe('room_task')
    // The description teaches the public/private split: the board is shared,
    // the agent's own todo tool stays the private plan.
    expect(taskTool.description).toContain('SHARED')
    expect(taskTool.description).toContain('todo')
    const parameters = taskTool.parameters as {
      properties: Record<string, { enum?: readonly string[] }>
    }
    expect(Object.keys(parameters.properties)).toEqual(['action', 'title', 'member', 'taskId', 'blockedBy'])
    expect(parameters.properties['action']!.enum).toEqual(['add', 'close', 'update'])
  })

  it('rejects a non-agent caller and a non-room session with readable text', async () => {
    const { ctx, taskTool } = await boot()
    expect(await call(taskTool, { action: 'add', title: 'x', member: 'main' }, execFor(undefined)))
      .toContain('requires a calling agent')
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await call(taskTool, { action: 'add', title: 'x', member: 'main' }, execFor(plain)))
      .toContain('not a room')
  })

  it('add lands a pending task through the same host function as the UI, and returns the id', async () => {
    const { service, taskTool, sessionId, room } = await bootRoom()
    const text = await call(taskTool, { action: 'add', title: '写发布稿', member: 'main', blockedBy: 'ada' }, execFor(room))
    expect(text).toContain('写发布稿')
    expect(text).toContain('main')
    const id = /id: ([0-9a-f-]{36})/.exec(text)?.[1]
    expect(id).toBeDefined()
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { tasks: [{ id, member: 'main', title: '写发布稿', status: 'pending', blockedBy: 'ada' }] },
    })
  })

  it('add requires title+member and rejects off-roster names with the roster to retry with', async () => {
    const { taskTool, room } = await bootRoom()
    expect(await call(taskTool, { action: 'add', member: 'main' }, execFor(room)))
      .toContain('requires both title and member')
    const unknown = await call(taskTool, { action: 'add', title: 'x', member: 'cathy' }, execFor(room))
    expect(unknown).toContain('member-not-found')
    expect(unknown).toContain('main')
    expect(unknown).toContain('ada')
    expect(unknown).toContain('Retry')
    const blockedBy = await call(taskTool, { action: 'add', title: 'x', member: 'main', blockedBy: 'cathy' }, execFor(room))
    expect(blockedBy).toContain('member-not-found')
    expect(blockedBy).toContain('ada')
  })

  it('close marks an open task done and refuses unknown/closed ids with self-correcting text', async () => {
    const { service, taskTool, sessionId, room } = await bootRoom()
    const added = await service.addTask({ sessionId, member: 'ada', title: '补测试' })
    if (!added.ok) throw new Error('addTask failed')
    const text = await call(taskTool, { action: 'close', taskId: added.value.id }, execFor(room))
    expect(text).toContain('done')
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ id: added.value.id, status: 'done' }] } })

    const again = await call(taskTool, { action: 'close', taskId: added.value.id }, execFor(room))
    expect(again).toContain('task-closed')
    expect(again).toContain('already closed')

    const open = await service.addTask({ sessionId, member: 'main', title: '出方案' })
    if (!open.ok) throw new Error('addTask failed')
    const missing = await call(taskTool, { action: 'close', taskId: 'no-such-id' }, execFor(room))
    expect(missing).toContain('task-not-found')
    // The open-task list lets the model retry with a real id.
    expect(missing).toContain(open.value.id)
    expect(missing).toContain('出方案')
    expect(missing).toContain('Retry')
  })

  it('update renames, re-targets and clears blockedBy, and rejects empty edits', async () => {
    const { service, taskTool, sessionId, room } = await bootRoom()
    const added = await service.addTask({ sessionId, member: 'ada', title: '旧标题' })
    if (!added.ok) throw new Error('addTask failed')

    const renamed = await call(taskTool, {
      action: 'update', taskId: added.value.id, title: '新标题', blockedBy: 'main',
    }, execFor(room))
    expect(renamed).toContain('updated')
    let state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { tasks: [{ id: added.value.id, title: '新标题', blockedBy: 'main', status: 'pending' }] },
    })

    // null clears the wait.
    await call(taskTool, { action: 'update', taskId: added.value.id, blockedBy: null }, execFor(room))
    state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ id: added.value.id }] } })
    expect((state as { value: { tasks: { blockedBy?: string }[] } }).value.tasks[0]!.blockedBy).toBeUndefined()

    const nothing = await call(taskTool, { action: 'update', taskId: added.value.id }, execFor(room))
    expect(nothing).toContain('nothing-to-update')
    const blank = await call(taskTool, { action: 'update', taskId: added.value.id, title: '  ' }, execFor(room))
    expect(blank).toContain('empty-text')

    // A closed task takes no edits.
    await service.closeTask({ sessionId, taskId: added.value.id })
    const closed = await call(taskTool, { action: 'update', taskId: added.value.id, title: '再改' }, execFor(room))
    expect(closed).toContain('task-closed')
  })
})

describe('room_message tool (real composition)', () => {
  it('dispatches to the member like a human @-message, minus the user bubble', async () => {
    const { ctx, service, messageTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada' })

    const text = await call(messageTool, { member: 'ada', text: '看看接口定义' }, execFor(room))
    expect(text).toContain('Dispatched to ada')
    expect(text).toContain('asynchronously')

    const events = room.snapshotEvents()
    // The dispatch record and the auto-opened task journal as usual; the
    // caller is the main agent, so NO human user/message bubble is appended.
    expect(events.filter(event => event.type === 'room/dispatch').map(event => event.data))
      .toMatchObject([{ targets: ['ada'], text: '看看接口定义', origin: 'coordinator', replyTo: 'legacy:1' }])
    expect(events.some(event => event.type === 'user/message')).toBe(false)
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { tasks: [{ member: 'ada', title: '看看接口定义', status: 'in_progress' }] },
    })
  })

  it('rejects an unknown member with the live roster, a blank text, and a non-agent caller; a plain session promotes', async () => {
    const { ctx, service, messageTool } = await boot()
    const sessionId = await createRoom(ctx, service)
    const room = ctx.sessions.get(sessionId)!

    const unknown = await call(messageTool, { member: 'ghost', text: '在吗' }, execFor(room))
    expect(unknown).toContain('unknown member')
    // The live roster lets the model self-correct (main is always seated).
    expect(unknown).toContain('main')
    expect(unknown).toContain('Retry')

    expect(await call(messageTool, { member: 'main', text: '  ' }, execFor(room))).toContain('non-blank')
    expect(await call(messageTool, { member: 'main', text: 'x' }, execFor(undefined)))
      .toContain('requires a calling agent')

    // The promotion gate: messaging from a plain session turns it into a room
    // (main is seated by the promotion, so addressing main lands).
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    const text = await call(messageTool, { member: 'main', text: '给自己记一笔' }, execFor(plain))
    expect(text).toContain('Dispatched to main')
    expect(plain.snapshotEvents().some(event => event.type === 'room/created')).toBe(true)
  })
})
