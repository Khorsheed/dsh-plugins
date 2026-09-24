/**
 * V4 durable-source runtime probe — the rc.1 native admission rejects the
 * retired `{ kind: 'plugin', plugin: X }` wrapper at the durable write
 * (`encodeEvent` → `assertV4SourceRowAdmission`), which the in-memory
 * Session validation never does, so only a REAL JSONL-persistence
 * composition can pin the producer-owned source contract:
 *
 *  1. every source shape this package writes (plain, op 'edit',
 *     'edit-trigger', 'restore-assistant') lands through the real
 *     SessionStore + V4 writer, flush included;
 *  2. a remounted backend (the restart boundary) reads every producer field
 *     back verbatim — kind, op, and the replacement span metadata;
 *  3. the read-back log re-derives the framed user-role restore channel
 *     (rc.1's fold keeps the S12 projection dormant — the host-reality pin
 *     in restore-projection.host.spec.ts), and the projection itself still
 *     rewrites the V4-read-back replay event;
 *  4. the retired wrapper is refused at flush time, proving why the write
 *     side had to move.
 *
 * The 0.1.5 host's user/message admission accepts any non-empty kind string
 * (dsh-v0.1.5-rc.3 packages/core/session/src/index.ts
 * assertMessageEventShape), so the producer kind these events carry writes
 * durably on both host lines; marker.host.spec.ts pins the read side for the
 * legacy and migrated forms.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import MessageToolsService from '../src/index.ts'
import {
  MESSAGE_TOOLS_PLUGIN, RESTORED_ASSISTANT_NOTICE,
  editTriggerSource,
} from '../src/marker.ts'
import { restoreAssistantProjection } from '../src/restore-projection.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** The REAL composition: cordis root + SessionStore + JSONL V4 persistence + the package's service. */
async function boot(root: string): Promise<Context> {
  const ctx = new Context()
  // The agents registry is an external service to this package; stub its face
  // (no live agent — edit reports triggered:false, no followup persists).
  ctx.provide('agents', { get: () => undefined } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(MessageToolsService)
  return ctx
}

function appendUser(ctx: Context, id: SessionId, text: string): number {
  return ctx.sessions.get(id)!.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

function appendAssistant(ctx: Context, id: SessionId, turn: number, text: string): number {
  return ctx.sessions.get(id)!.append('assistant/message', {
    turn, step: 1, stream: [],
    message: {
      id: `a${turn}`, role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
    },
  } as never, { surfaceOp: 'append' }).seq
}

/** Reopen one persisted session read-only on a FRESH context (the restart boundary). */
async function readBack(root: string, id: SessionId): Promise<{
  events: readonly SessionEvent[]
  header: import('@deepseek-ai/dsh-session/types').SessionHeader
  inheritedEventCount: import('@deepseek-ai/dsh-session/types').SessionLogOffset
  ctx: Context
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    const stored = await handle.read()
    return { events: stored.events, header: handle.header, inheritedEventCount: handle.inheritedEventCount, ctx }
  } finally {
    await handle.close()
  }
}

/** The user/message sources of one read-back log, in log order. */
function userMessageSources(events: readonly SessionEvent[]): unknown[] {
  return events.filter(event => event.type === 'user/message').map(event => event.data.source)
}

describe('V4 durable producer sources (real JSONL persistence)', () => {
  it('flushes every written source shape and reads it back verbatim after a remount', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mt-v4-probe-'))
    dirs.push(root)
    const withdrawSession = SessionId('probe-withdraw')
    const editSession = SessionId('probe-edit')
    const ctx = await boot(root)

    // Session 1: withdraw + restore — the plain source (replacement and user
    // replay) and op 'restore-assistant' (framed assistant replay). The V4
    // read validates lifecycle relationships, so the assistant message sits
    // inside a real open turn/step (the in-memory Session never checks).
    ctx.sessions.create(withdrawSession, { meta: {} })
    const first = await ctx.sessionPersistence.create(ctx.sessions.get(withdrawSession)!.header)
    const service = ctx.get('messageTools') as MessageToolsService
    const session1 = ctx.sessions.get(withdrawSession)!
    session1.append('turn/start', { turn: 1 })
    session1.append('step/start', { turn: 1, step: 1 })
    appendUser(ctx, withdrawSession, '问')
    appendAssistant(ctx, withdrawSession, 1, '答')
    expect(await service.withdraw({ sessionId: withdrawSession, targetSeq: 2 })).toMatchObject({ ok: true })
    expect(await service.restore({ sessionId: withdrawSession, targetSeq: 2 })).toMatchObject({ ok: true })

    // Session 2: edit — op 'edit' on the replacement; the trigger follows
    // through agent.followup in production, so this composition appends the
    // same trigger shape directly (no live agent here).
    ctx.sessions.create(editSession, { meta: {} })
    const second = await ctx.sessionPersistence.create(ctx.sessions.get(editSession)!.header)
    appendUser(ctx, editSession, '原文')
    expect(await service.edit({ sessionId: editSession, targetSeq: 0, text: '编辑后' }))
      .toMatchObject({ ok: true, value: { triggered: false } })
    ctx.sessions.get(editSession)!.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '(trigger)' }],
      source: editTriggerSource(),
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(ctx.sessions.get(editSession)!)

    await first.close()
    await second.close()
    await ctx.fiber.dispose()

    // The restart boundary: a fresh context on the same root reads both logs.
    const withdrawn = await readBack(root, withdrawSession)
    try {
      expect(userMessageSources(withdrawn.events)).toEqual([
        { kind: 'user' },
        { kind: MESSAGE_TOOLS_PLUGIN },
        { kind: MESSAGE_TOOLS_PLUGIN },
        { kind: MESSAGE_TOOLS_PLUGIN, op: 'restore-assistant' },
      ])
      // The replacement span metadata survived the same round trip.
      const replacement = withdrawn.events.find(event => event.type === 'user/message' && typeof event.surfaceOp === 'object')
      expect(replacement?.surfaceOp).toEqual({ op: 'replace', startSeq: 2, endSeq: 3 })
      expect(replacement?.sourceEventSeqs).toEqual([2, 3])

      // Restart re-derivation, dormant-projection channel (rc.1 fold): the
      // replayed span derives as the framed user-role channel.
      const restored = Session.fromRestore(
        withdrawSession, [...withdrawn.events], withdrawn.header, withdrawn.inheritedEventCount, 'detached',
      )
      const derived = restored.deriveMessages()
      expect(derived.map(message => message.role)).toEqual(['user', 'user', 'user'])
      expect(derived[1]?.content).toEqual([{ type: 'text', text: '问' }])
      expect(derived[2]?.content).toEqual([{ type: 'text', text: `${RESTORED_ASSISTANT_NOTICE}\n答` }])

      // The S12 projection consumes the V4-read-back replay event as-is:
      // op survived on the source, so the rewrite still derives assistant
      // role with the frame stripped on a host whose fold carries it.
      const replay = withdrawn.events.find(
        (event): event is SessionEvent<'user/message'> =>
          event.type === 'user/message' && event.surfaceOp === 'append'
          && (event.data.source as { op?: unknown }).op === 'restore-assistant',
      )
      if (replay === undefined) throw new Error('the restore-assistant replay did not read back')
      const rewritten = restoreAssistantProjection.project(replay, {
        nodes: [], events: [replay], baseSeq: replay.seq as unknown as import('@deepseek-ai/dsh-session/types').SessionLogOffset, messages: new Map(),
      })
      expect(rewritten.get(replay.seq)?.role).toBe('assistant')
      expect(rewritten.get(replay.seq)?.content).toEqual([{ type: 'text', text: '答' }])
    } finally {
      await withdrawn.ctx.fiber.dispose()
    }

    const edited = await readBack(root, editSession)
    try {
      expect(userMessageSources(edited.events)).toEqual([
        { kind: 'user' },
        { kind: MESSAGE_TOOLS_PLUGIN, op: 'edit' },
        { kind: MESSAGE_TOOLS_PLUGIN, op: 'edit-trigger' },
      ])
    } finally {
      await edited.ctx.fiber.dispose()
    }
  })

  it('refuses the retired plugin wrapper at the durable write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mt-v4-refusal-'))
    dirs.push(root)
    const id = SessionId('probe-refusal')
    const ctx = await boot(root)
    ctx.sessions.create(id, { meta: {} })
    const handle = await ctx.sessionPersistence.create(ctx.sessions.get(id)!.header)
    // The in-memory Session admission accepts any non-empty user/message
    // kind (the append itself succeeds); the V4 durable write is the refusal
    // point — released V3 writers accepted exactly this wrapper shape.
    ctx.sessions.get(id)!.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'legacy' }],
      source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN } as unknown as UserMessage['source'],
    }), { surfaceOp: 'append' })
    await expect(ctx.sessions.flush(ctx.sessions.get(id)!))
      .rejects.toThrow('producer-owned source kind')
    // The undrainable buffer refuses again on close; the probe already made
    // its assertion, so swallow the repeated refusal and the teardown one.
    await handle.close().catch(() => undefined)
    await ctx.fiber.dispose().catch(() => undefined)
    // Nothing of the refused event became durable — the session never even
    // materialized a log, so a read open answers not-found.
    const readBackCtx = new Context()
    await readBackCtx.plugin(SessionStore)
    await readBackCtx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    try {
      await expect(readBackCtx.sessionPersistence.open(id, 'read')).rejects.toThrow()
    } finally {
      await readBackCtx.fiber.dispose()
    }
  })
})
