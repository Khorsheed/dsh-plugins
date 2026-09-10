import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm/message'
import MessageToolsService from '../src/index.ts'
import { MESSAGE_TOOLS_PLUGIN, RESTORED_ASSISTANT_NOTICE, WITHDRAWN_NOTICE } from '../src/marker.ts'

/** The REAL composition: a cordis root, the real SessionStore plugin, and the package's own service plugin. */
async function boot(agent?: { followup: (message: UserMessage) => void }) {
  const ctx = new Context()
  // The agents registry is an external service to this package; stub its face.
  ctx.provide('agents', { get: () => agent } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(MessageToolsService)
  return { ctx, service: ctx.get('messageTools') as MessageToolsService }
}

const SESSION = SessionId('s1')

function appendUser(ctx: Context, text: string): number {
  const session = ctx.sessions.get(SESSION)!
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

function appendAssistant(ctx: Context, turn: number, step: number, text: string): number {
  const session = ctx.sessions.get(SESSION)!
  const message = {
    id: `a${turn}-${step}`, role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
  } as unknown as AssistantMessage
  return session.append('assistant/message', { turn, step, message, stream: [] }, { surfaceOp: 'append' }).seq
}

describe('MessageToolsService (real composition)', () => {
  it('withdraw replaces the span with the placeholder and reports the receipt', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const first = appendUser(ctx, 'first')
    appendAssistant(ctx, 1, 1, 'reply one')
    const second = appendUser(ctx, 'second')

    const result = await service.withdraw({ sessionId: SESSION, targetSeq: first })
    expect(result).toEqual({
      ok: true,
      value: { replacementSeq: second + 1, shadowedCount: 3 },
    })
    const session = ctx.sessions.get(SESSION)!
    expect(session.surface.nodes).toEqual([second + 1])
    const replacement = session.snapshotEvents()[second + 1]!
    expect(replacement.type).toBe('user/message')
    if (replacement.type !== 'user/message') throw new Error('narrowing')
    expect(replacement.data.content).toEqual([{ type: 'text', text: WITHDRAWN_NOTICE }])
    expect(replacement.data.source).toMatchObject({ kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN })
    expect(replacement.sourceEventSeqs).toEqual([first, first + 1, second])
  })

  it('rejects an unknown session and an already-withdrawn target', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const only = appendUser(ctx, 'only')
    expect(await service.withdraw({ sessionId: SessionId('nope'), targetSeq: 0 }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
    expect(await service.withdraw({ sessionId: SESSION, targetSeq: only })).toMatchObject({ ok: true })
    expect(await service.withdraw({ sessionId: SESSION, targetSeq: only }))
      .toEqual({ ok: false, error: { code: 'already-withdrawn' } })
  })

  it('restore tail-replays the withdrawn span in original order, framing assistant text', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const first = appendUser(ctx, '问')
    appendAssistant(ctx, 1, 1, '答')
    await service.withdraw({ sessionId: SESSION, targetSeq: first })

    const result = await service.restore({ sessionId: SESSION, targetSeq: first })
    expect(result).toMatchObject({ ok: true })
    const session = ctx.sessions.get(SESSION)!
    const replay = session.surface.nodes.slice(-2).map(seq => session.snapshotEvents()[seq]!)
    expect(replay.map(event => event.type)).toEqual(['user/message', 'user/message'])
    const [user, assistant] = replay
    if (user?.type !== 'user/message' || assistant?.type !== 'user/message') throw new Error('narrowing')
    expect(user.data.content).toEqual([{ type: 'text', text: '问' }])
    expect(user.sourceEventSeqs).toEqual([first])
    expect(assistant.data.content).toEqual([{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n答` }])
    expect(assistant.data.source).toMatchObject({ kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'restore-assistant' })
    expect(assistant.sourceEventSeqs).toEqual([first + 1])
  })

  it('restore rejects a message still on the surface', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const only = appendUser(ctx, 'only')
    expect(await service.restore({ sessionId: SessionId('nope'), targetSeq: only }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
    expect(await service.restore({ sessionId: SESSION, targetSeq: only }))
      .toEqual({ ok: false, error: { code: 'not-withdrawn' } })
  })

  it('edit replaces in place and triggers regeneration through agent.followup', async () => {
    const followup = vi.fn()
    const { ctx, service } = await boot({ followup })
    ctx.sessions.create(SESSION, { meta: {} })
    const target = appendUser(ctx, '原文')
    appendAssistant(ctx, 1, 1, '答')

    const result = await service.edit({ sessionId: SESSION, targetSeq: target, text: '编辑后' })
    expect(result).toMatchObject({ ok: true, value: { triggered: true } })
    expect(followup).toHaveBeenCalledTimes(1)
    const session = ctx.sessions.get(SESSION)!
    const replacement = session.snapshotEvents()[session.surface.nodes[0]!]!
    if (replacement.type !== 'user/message') throw new Error('narrowing')
    expect(replacement.data.content).toEqual([{ type: 'text', text: '编辑后' }])
    expect(replacement.data.source).toMatchObject({ kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'edit' })
  })

  it('edit reports triggered:false without a live agent and rejects blank text', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const target = appendUser(ctx, '原文')
    expect(await service.edit({ sessionId: SESSION, targetSeq: target, text: '  ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
    const result = await service.edit({ sessionId: SESSION, targetSeq: target, text: '编辑后' })
    expect(result).toMatchObject({ ok: true, value: { triggered: false } })
    expect(await service.edit({ sessionId: SessionId('nope'), targetSeq: target, text: 'x' }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
  })
})
