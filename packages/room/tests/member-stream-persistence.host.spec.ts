/** Integration with the real host backend: the fake writer cannot detect unknown vocabulary. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as localAgent from '@khorsheed/dsh-local-agent'

describe('member stream durability through the host backend', () => {
  it.each(['none', 'zstd'] as const)('reads a checkpoint then stores and cold-replays the whole turn (%s)', async compression => {
    const root = await mkdtemp(join(tmpdir(), 'member-stream-durable-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const persistence = await ctx.plugin(JsonlSessionPersistence, { root, compression })
    const core = await ctx.plugin(localAgent, { homesRoot: join(root, 'members') })
    try {
      const session = ctx.sessions.create(SessionId('member-stream-durable'))
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('local-agent/stream', { id: '1:1', sessionId: session.id, turn: 1, step: 1, kind: 'text', text: 'partial', receivedAt: 1, opening: true, append: false })
      await ctx.localAgent.syncChildSession(session, true)
      session.append('local-agent/stream', { id: '1:1', sessionId: session.id, turn: 1, step: 1, kind: 'text', text: ' answer', receivedAt: 2, append: true })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await ctx.localAgent.syncChildSession(session, true)
      const reader = await ctx.sessionPersistence.open(session.id, 'read')
      try { expect((await reader.read()).events).toEqual(session.snapshotEvents()) }
      finally { await reader.close() }
    } finally {
      await core.dispose()
      await persistence.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
