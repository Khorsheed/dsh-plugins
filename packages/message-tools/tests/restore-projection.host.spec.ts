import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionMessageProjection, SessionMessageProjectionContext } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import MessageToolsService from '../src/index.ts'
import { MESSAGE_TOOLS_PLUGIN, RESTORED_ASSISTANT_NOTICE, restoreAssistantSource } from '../src/marker.ts'
import {
  registerRestoreProjection, restoreAssistantProjection, restoreProjectionFoldSupported,
} from '../src/restore-projection.ts'

let seqCounter = 0

function userMessageEvent(
  source: MessageSource,
  content: SessionEvent<'user/message'>['data']['content'],
): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seqCounter++),
    time: 0,
    data: createUserMessage({ content, source }),
    surfaceOp: 'append',
  }
}

function restoreEvent(text: string): SessionEvent<'user/message'> {
  return userMessageEvent(restoreAssistantSource(), [{ type: 'text', text }])
}

function projectionContext(
  overrides: Partial<SessionMessageProjectionContext> = {},
): SessionMessageProjectionContext {
  return { nodes: [], events: [], baseSeq: SessionLogOffset(0), messages: new Map(), ...overrides }
}

describe('restoreAssistantProjection.project', () => {
  it('rewrites a restore-marked replay to assistant role, frame stripped, id kept', () => {
    const event = restoreEvent(`${RESTORED_ASSISTANT_NOTICE}\n答`)
    const result = restoreAssistantProjection.project(event, projectionContext({ events: [event] }))
    expect(result.size).toBe(1)
    const projected = result.get(event.seq)
    expect(projected?.role).toBe('assistant')
    expect(projected?.id).toBe(event.data.id)
    expect(projected?.source).toEqual(event.data.source)
    expect(projected?.content).toEqual([{ type: 'text', text: '答' }])
    // The input event is not mutated.
    expect(event.data.role).toBe('user')
    expect(event.data.content).toEqual([{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n答` }])
  })

  it('strips per text block and preserves non-text blocks as-is', () => {
    const reasoning = { type: 'reasoning', text: '想' } as const
    const event = userMessageEvent(restoreAssistantSource(), [
      { type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n答` },
      reasoning,
      { type: 'text', text: 'no frame here' },
    ])
    const projected = restoreAssistantProjection.project(event, projectionContext()).get(event.seq)
    expect(projected?.content).toEqual([
      { type: 'text', text: '答' },
      { type: 'reasoning', text: '想' },
      { type: 'text', text: 'no frame here' },
    ])
    expect(projected?.content[1]).toBe(event.data.content[1])
  })

  it('prefers an earlier projection rewrite from context.messages over the raw event', () => {
    const event = restoreEvent(`${RESTORED_ASSISTANT_NOTICE}\n答`)
    const prior = createUserMessage({
      content: [{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n先前投影` }],
      source: restoreAssistantSource(),
    })
    const result = restoreAssistantProjection.project(
      event, projectionContext({ messages: new Map([[event.seq, prior]]) }),
    )
    const projected = result.get(event.seq)
    expect(projected?.id).toBe(prior.id)
    expect(projected?.content).toEqual([{ type: 'text', text: '先前投影' }])
  })

  it('passes plain user messages and other plugin ops through untouched', () => {
    const plain = userMessageEvent({ kind: 'user' }, [{ type: 'text', text: '你好' }])
    expect(restoreAssistantProjection.project(plain, projectionContext()).size).toBe(0)
    const edit = userMessageEvent(
      { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'edit' },
      [{ type: 'text', text: '编辑后' }],
    )
    expect(restoreAssistantProjection.project(edit, projectionContext()).size).toBe(0)
    const foreign = userMessageEvent(
      { kind: 'plugin', plugin: 'other-plugin' },
      [{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\nnot ours` }],
    )
    expect(restoreAssistantProjection.project(foreign, projectionContext()).size).toBe(0)
  })

  it('returns an empty map for malformed payloads instead of throwing', () => {
    const noSource = {
      type: 'user/message', seq: SessionSeq(seqCounter++), time: 0,
      data: { content: [{ type: 'text', text: 'x' }] }, surfaceOp: 'append',
    } as unknown as SessionEvent<'user/message'>
    expect(() => restoreAssistantProjection.project(noSource, projectionContext())).not.toThrow()
    expect(restoreAssistantProjection.project(noSource, projectionContext()).size).toBe(0)

    const noContent = {
      type: 'user/message', seq: SessionSeq(seqCounter++), time: 0,
      data: { source: restoreAssistantSource() }, surfaceOp: 'append',
    } as unknown as SessionEvent<'user/message'>
    expect(() => restoreAssistantProjection.project(noContent, projectionContext())).not.toThrow()
    expect(restoreAssistantProjection.project(noContent, projectionContext()).size).toBe(0)

    const noData = {
      type: 'user/message', seq: SessionSeq(seqCounter++), time: 0, surfaceOp: 'append',
    } as unknown as SessionEvent<'user/message'>
    expect(() => restoreAssistantProjection.project(noData, projectionContext())).not.toThrow()
    expect(restoreAssistantProjection.project(noData, projectionContext()).size).toBe(0)
  })
})

describe('restoreProjectionFoldSupported', () => {
  it('reports false on the 0.1.6-alpha.1 fold: a projected user/message never joins the surface', () => {
    // Host-reality pin: 0.1.6-alpha.1 routes projected types through the
    // projection plan without surface membership, so the probe MUST refuse
    // registration. When a future host fold composes, this test flips red —
    // re-verify the channel end to end before flipping it green.
    expect(restoreProjectionFoldSupported()).toBe(false)
  })

  it('accepts a composing fold and rejects broken or missing folds', () => {
    const fold = ((events: readonly SessionEvent[]) => ({
      nodes: events.map(event => event.seq),
      replacements: [],
      projectedMessages: new Map(),
    })) as unknown as typeof import('@deepseek-ai/dsh-session').foldSurface
    const derive = (() => createUserMessage({
      content: [{ type: 'text', text: 'probe answer' }],
      source: restoreAssistantSource(),
    })) as unknown as typeof import('@deepseek-ai/dsh-session').deriveEventMessage
    // The fake derive returns a user-role message — the probe requires the
    // assistant rewrite, so this must still refuse.
    expect(restoreProjectionFoldSupported(fold, derive)).toBe(false)
    const derivingAssistant = (() => ({
      ...createUserMessage({ content: [{ type: 'text', text: 'probe answer' }], source: restoreAssistantSource() }),
      role: 'assistant',
    })) as unknown as typeof import('@deepseek-ai/dsh-session').deriveEventMessage
    expect(restoreProjectionFoldSupported(fold, derivingAssistant)).toBe(true)
    expect(restoreProjectionFoldSupported(undefined, derivingAssistant)).toBe(false)
    const throwing = (() => { throw new Error('fold exploded') }) as unknown as typeof import('@deepseek-ai/dsh-session').foldSurface
    expect(restoreProjectionFoldSupported(throwing, derivingAssistant)).toBe(false)
  })
})

describe('registerRestoreProjection', () => {
  function stubSessions(register?: (projection: SessionMessageProjection) => () => Promise<void>) {
    return register === undefined ? {} as { registerMessageProjection?: unknown } : { registerMessageProjection: register }
  }

  it('does nothing when the host lacks registerMessageProjection', async () => {
    const ctx = new Context()
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessions', stubSessions() as never)
    await ctx.plugin(MessageToolsService)
    expect(registerRestoreProjection(ctx)).toBe(false)
  })

  it('does not register when the fold probe refuses (0.1.6-alpha.1 semantics)', async () => {
    const register = vi.fn()
    const ctx = new Context()
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessions', stubSessions(register) as never)
    await ctx.plugin(MessageToolsService)
    expect(register).not.toHaveBeenCalled()
  })

  it('swallows a duplicate-registration conflict and degrades', () => {
    const ctx = new Context()
    ctx.provide('sessions', stubSessions(() => {
      throw new Error('session message projection "user/message" is already registered')
    }) as never)
    expect(registerRestoreProjection(ctx, () => true)).toBe(false)
  })

  it('registers on a composing host and unregisters with the plugin fiber', async () => {
    const dispose = vi.fn(() => Promise.resolve())
    const register = vi.fn((_projection: SessionMessageProjection) => dispose)
    const ctx = new Context()
    ctx.provide('sessions', stubSessions(register) as never)
    let active = false
    const fiber = await ctx.plugin({
      inject: ['sessions'],
      apply(owner: Context) { active = registerRestoreProjection(owner, () => true) },
    })
    expect(active).toBe(true)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(restoreAssistantProjection)
    await fiber.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('leaves the framed user-role channel verbatim on the real 0.1.6-alpha.1 store', async () => {
    // The real composition: registration degrades through the fold probe, so
    // the restore append stays a framed user-role replay (storage channel).
    const ctx = new Context()
    ctx.provide('agents', { get: () => undefined } as never)
    await ctx.plugin(SessionStore)
    await ctx.plugin(MessageToolsService)
    expect(ctx.sessions.messageProjections).toEqual([])
    ctx.sessions.create(SessionId('s1'), { meta: {} })
    const session = ctx.sessions.get(SessionId('s1'))!
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '问' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: {
        id: 'a1-1', role: 'assistant',
        content: [{ type: 'text', text: '答' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
    } as never, { surfaceOp: 'append' })
    const service = ctx.get('messageTools') as MessageToolsService
    await service.withdraw({ sessionId: SessionId('s1'), targetSeq: 0 })
    await service.restore({ sessionId: SessionId('s1'), targetSeq: 0 })
    const derived = session.deriveMessages()
    // The withdrawal placeholder plus the two replays, all user-role.
    expect(derived.map(message => message.role)).toEqual(['user', 'user', 'user'])
    expect(derived[1]?.content).toEqual([{ type: 'text', text: '问' }])
    expect(derived[2]?.content).toEqual([{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n答` }])
  })
})
