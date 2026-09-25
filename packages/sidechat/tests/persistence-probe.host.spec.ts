/**
 * V4 durable-source runtime probe: the rc.1 native admission rejects the
 * retired `{ kind: 'plugin', plugin: X }` wrapper at the durable write
 * (`encodeEvent` → `assertV4SourceRowAdmission`), which the in-memory
 * Session validation never does, so only a REAL JSONL-persistence
 * composition pins the producer-owned source contract. The 0.1.5 host's
 * user/message admission accepts any non-empty kind string, so the producer
 * kind writes durably on both host lines; journal.spec.ts pins the read
 * side (the transcript keeps the own send visible in all three forms).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SIDECHAT_KIND, sidechatSource } from '../src/service.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const ID = SessionId('sidechat-v4-probe')

describe('V4 durable producer source (real JSONL persistence)', () => {
  it('flushes the producer-owned send source and reads it back verbatim after a remount; refuses the retired wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidechat-v4-probe-'))
    dirs.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    ctx.sessions.create(ID, { meta: {} })
    const session = ctx.sessions.get(ID)!
    const handle = await ctx.sessionPersistence.create(session.header)
    // The shape send()'s followup carries; the agent runtime appends it to
    // the side session's log in production — here the append is direct.
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '侧边你好' }],
      source: sidechatSource(),
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    await handle.close()
    await ctx.fiber.dispose()

    const reopened = new Context()
    try {
      await reopened.plugin(SessionStore)
      await reopened.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const reader = await reopened.sessionPersistence.open(ID, 'read')
      try {
        const sources = (await reader.read(0)).events
          .filter(event => event.type === 'user/message')
          .map(event => event.data.source)
        expect(sources).toEqual([{ kind: SIDECHAT_KIND }])
      } finally {
        await reader.close()
      }
    } finally {
      await reopened.fiber.dispose()
    }
  })

  it('refuses the retired plugin wrapper at the durable write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidechat-v4-refusal-'))
    dirs.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    ctx.sessions.create(ID, { meta: {} })
    const session = ctx.sessions.get(ID)!
    const handle = await ctx.sessionPersistence.create(session.header)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'legacy' }],
      source: { kind: 'plugin', plugin: '@khorsheed/dsh-sidechat' } as never,
    }), { surfaceOp: 'append' })
    await expect(ctx.sessions.flush(session)).rejects.toThrow('producer-owned source kind')
    // The undrainable buffer refuses again on close/teardown; the probe
    // already made its assertion.
    await handle.close().catch(() => undefined)
    await ctx.fiber.dispose().catch(() => undefined)
  })
})
