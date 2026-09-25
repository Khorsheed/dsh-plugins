/**
 * V4 durable-source runtime probe: the rc.1 native admission rejects the
 * retired `{ kind: 'plugin', plugin: X }` wrapper at the durable write
 * (`encodeEvent` → `assertV4SourceRowAdmission`), which the in-memory
 * Session validation never does, so only a REAL JSONL-persistence
 * composition pins the producer-owned source contract. The 0.1.5 host's
 * user/message admission accepts any non-empty kind string, and both lines'
 * transcript renderers classify an unknown non-`user` kind as a context
 * (上下文注入) row labeled by the kind — so the producer kind keeps the
 * directAgent message's row type and writes durably on both lines.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { WORKTREES_KIND, WORKTREES_PLUGIN, isWorktreesSource } from '../src/remote.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const ID = SessionId('worktrees-v4-probe')

describe('isWorktreesSource (durable source forms)', () => {
  // Three durable forms: the current producer-owned kind, the V3→V4 migrated
  // kind, and the released V3 wrapper a pre-V4 (0.1.5) host serves verbatim.
  const forms = [
    ['current producer kind', { kind: WORKTREES_KIND }],
    ['V3→V4 migrated kind', { kind: `plugin:${WORKTREES_PLUGIN}` }],
    ['released V3 wrapper (0.1.5)', { kind: 'plugin', plugin: WORKTREES_PLUGIN }],
  ] as const

  it.each(forms)('accepts the %s form', (_label, source) => {
    expect(isWorktreesSource(source)).toBe(true)
    expect(isWorktreesSource({ ...source, form: 'notice', summary: '已切换' })).toBe(true)
  })

  it('rejects foreign producers in every form and malformed values', () => {
    expect(isWorktreesSource({ kind: 'user' })).toBe(false)
    expect(isWorktreesSource({ kind: 'plugin', plugin: 'other-plugin' })).toBe(false)
    expect(isWorktreesSource({ kind: 'plugin:other-plugin' })).toBe(false)
    expect(isWorktreesSource({ kind: `plugin:${WORKTREES_PLUGIN}-extra` })).toBe(false)
    expect(isWorktreesSource({ kind: 'worktrees-extra' })).toBe(false)
    expect(isWorktreesSource({ kind: 'plugin' })).toBe(false)
    expect(isWorktreesSource({})).toBe(false)
    expect(isWorktreesSource(null)).toBe(false)
    expect(isWorktreesSource(undefined)).toBe(false)
  })
})

describe('V4 durable producer source (real JSONL persistence)', () => {
  it('flushes the directAgent source with its notice form and reads it back verbatim; refuses the retired wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worktrees-v4-probe-'))
    dirs.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    ctx.sessions.create(ID, { meta: {} })
    const session = ctx.sessions.get(ID)!
    const handle = await ctx.sessionPersistence.create(session.header)
    // The exact shape directAgent appends (producer kind + notice form).
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '本会话已切换到 worktree「feature」(/repo/.worktrees/feature)。' }],
      source: {
        kind: WORKTREES_KIND,
        form: 'notice',
        summary: boundContextSummary('已切换到 worktree「feature」'),
      },
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)

    // The retired wrapper: the append lands in memory, the V4 durable write
    // refuses it (the in-memory admission accepts any non-empty kind).
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'legacy' }],
      source: { kind: 'plugin', plugin: WORKTREES_PLUGIN } as never,
    }), { surfaceOp: 'append' })
    await expect(ctx.sessions.flush(session)).rejects.toThrow('producer-owned source kind')
    // The undrainable buffer refuses again on close/teardown; the round-trip
    // assertion below only covers the first, already-flushed event.
    await handle.close().catch(() => undefined)
    await ctx.fiber.dispose().catch(() => undefined)

    const reopened = new Context()
    try {
      await reopened.plugin(SessionStore)
      await reopened.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const reader = await reopened.sessionPersistence.open(ID, 'read')
      try {
        const sources = (await reader.read(0)).events
          .filter(event => event.type === 'user/message')
          .map(event => event.data.source)
        // kind、form、summary 全部逐字存活(producer 自有 JSON 元数据原样保留)。
        expect(sources).toEqual([{
          kind: WORKTREES_KIND,
          form: 'notice',
          summary: '已切换到 worktree「feature」',
        }])
      } finally {
        await reader.close()
      }
    } finally {
      await reopened.fiber.dispose()
    }
  })
})
