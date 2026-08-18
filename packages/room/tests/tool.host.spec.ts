import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import RoomService from '../src/index.ts'
import type { LocalAgentFacade } from '../src/adapter.ts'

/** The REAL composition plus a stubbed tools registry capturing the registered definition. */
async function boot() {
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined } as never)
  const facade: LocalAgentFacade = {
    start: vi.fn(async () => new Promise(() => {}) as never),
    resume: vi.fn(async () => new Promise(() => {}) as never),
    cancel: vi.fn(() => false),
  }
  ctx.provide('localAgent', facade as never)
  const tools = { register: vi.fn((_tool: ToolDefinition) => () => {}) }
  ctx.provide('tools', tools as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  expect(tools.register).toHaveBeenCalledTimes(1)
  const tool = tools.register.mock.calls[0]![0] as ToolDefinition
  return { ctx, service, tool }
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
    expect(Object.keys(parameters.properties)).toEqual(['provider', 'name', 'instructions', 'firstTask'])
  })

  it('rejects a non-agent caller and a non-room session with readable text', async () => {
    const { ctx, tool } = await boot()
    expect(await call(tool, { provider: 'kimi', name: 'ada', instructions: '后端' }, execFor(undefined)))
      .toContain('requires a calling agent')
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await call(tool, { provider: 'kimi', name: 'ada', instructions: '后端' }, execFor(plain)))
      .toContain('not a room')
  })

  it('invites an agent-originated member inside a room', async () => {
    const { ctx, service, tool } = await boot()
    const { sessionId } = await service.createRoom({})
    const room = ctx.sessions.get(sessionId)!
    const text = await call(tool, {
      provider: 'kimi', name: 'ada', instructions: '负责 API',
    }, execFor(room))
    expect(text).toContain('ada')
    expect(text).toContain('joined')
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { members: [{ name: 'main' }, { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'agent', instructions: '负责 API' }] },
    })
  })

  it('returns a retryable error text on a name collision and an invalid name', async () => {
    const { ctx, service, tool } = await boot()
    const { sessionId } = await service.createRoom({})
    const room = ctx.sessions.get(sessionId)!
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })

    const duplicate = await call(tool, { provider: 'codex', name: 'ada', instructions: 'x' }, execFor(room))
    expect(duplicate).toContain('duplicate-name')
    expect(duplicate).toContain('retry')
    const invalid = await call(tool, { provider: 'kimi', name: 'a b', instructions: 'x' }, execFor(room))
    expect(invalid).toContain('invalid-name')
  })
})
