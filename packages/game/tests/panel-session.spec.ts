/**
 * Panel calls name their session by id: an attached session (a room CLI
 * member's, which the host's agent/session lookups refuse) answers directly;
 * anything else goes through the host's session lookup, refusals included.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { panelSession } from '../src/panel-session.ts'

function host(lookup: (id: string) => Promise<unknown>) {
  const ctx = new Context()
  const member = { id: 'child-cli', header: { origin: 'subagent' } }
  ctx.provide('sessions' as never, { get: (id: string) => id === member.id ? member : undefined } as never)
  ctx.provide('typert' as never, { lookups: { get: (key: string) => key === 'session' ? { resolve: lookup } : undefined } } as never)
  return { ctx, member }
}

describe('panelSession', () => {
  it('answers an attached subagent session without the host lookup', async () => {
    const { ctx, member } = host(async () => { throw new Error('session "child-cli" is owned by subagent routing') })
    expect(await panelSession(ctx, SessionId('child-cli'))).toBe(member)
  })

  it('resumes anything else through the host lookup and keeps its refusals', async () => {
    const cold = { id: 'cold' }
    const { ctx } = host(async id => id === 'cold' ? cold : undefined)
    expect(await panelSession(ctx, SessionId('cold'))).toBe(cold)
    await expect(panelSession(ctx, SessionId('gone'))).rejects.toThrow('session "gone" not found')
    const refusing = host(async () => { throw new Error('session/agent-busy') })
    await expect(panelSession(refusing.ctx, SessionId('other'))).rejects.toThrow('session/agent-busy')
  })
})
