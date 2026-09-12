import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE } from '@khorsheed/dsh-local-agent'

/**
 * A handle-based sessionPersistence fake (the host 0.1.5 API) with REAL
 * write-ownership enforcement: a second `open(id, 'write')` while another
 * write handle for the same id is open rejects SessionAlreadyOwnedError, the
 * collision the registry's handle cache exists to prevent.
 */
function fakePersistence(): {
  /** Stored events per session id. */
  stored: Map<string, unknown[]>
  /** Every accepted append batch, in order. */
  appended: unknown[][]
  /** Ids whose handle was flushed. */
  flushed: string[]
  /** Ids passed to create. */
  created: string[]
  /** Ids passed to open. */
  opened: string[]
  /** Make every subsequent append reject with this error (null clears). */
  failAppendWith: { current: Error | null }
  stat(id: string): Promise<{ eventCount: number } | undefined>
  create(header: { id: string }): Promise<unknown>
  open(id: string, access: string): Promise<unknown>
} {
  const stored = new Map<string, unknown[]>()
  const appended: unknown[][] = []
  const flushed: string[] = []
  const created: string[] = []
  const opened: string[] = []
  const failAppendWith = { current: null as Error | null }
  /** Open WRITE handle count per id (the ownership ledger). */
  const writeHandles = new Map<string, number>()
  const makeHandle = (id: string, header: unknown, own: boolean) => ({
    id,
    header,
    inheritedEventCount: 0,
    access: 'write',
    read: async (offset = 0) => ({ events: (stored.get(id) ?? []).slice(offset), eventState: 'detached' }),
    append: async (events: readonly unknown[]) => {
      if (failAppendWith.current !== null) throw failAppendWith.current
      stored.set(id, [...(stored.get(id) ?? []), ...events])
      appended.push([...events])
    },
    flush: async () => { flushed.push(id) },
    close: async () => {
      if (!own) return
      const count = (writeHandles.get(id) ?? 1) - 1
      if (count <= 0) writeHandles.delete(id)
      else writeHandles.set(id, count)
    },
  })
  return {
    stored,
    appended,
    flushed,
    created,
    opened,
    failAppendWith,
    stat: async (id) => stored.has(id) ? { eventCount: stored.get(id)!.length } : undefined,
    create: async (header: { id: string }) => {
      created.push(header.id)
      stored.set(header.id, [])
      writeHandles.set(header.id, 1)
      return makeHandle(header.id, header, true)
    },
    open: async (id: string, access: string) => {
      opened.push(id)
      if (access === 'write') {
        if ((writeHandles.get(id) ?? 0) > 0) {
          const error = new Error(`session ${id} already has a write handle`)
          error.name = 'SessionAlreadyOwnedError'
          throw error
        }
        writeHandles.set(id, 1)
      }
      return makeHandle(id, { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false }, access === 'write')
    },
  }
}

interface Mounted {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
  warns: string[]
}

/** Mount the registry stack over a fake persistence and a capturing logger. */
async function mount(persistence: ReturnType<typeof fakePersistence>): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const warns: string[] = []
  ctx.logger.exporter({
    // cordis thresholds default to INFO (1); WARN is level 2 in its enum.
    levels: { default: 3 },
    export(message) {
      if (message.type === 'warn') warns.push(message.args.map(String).join(' '))
    },
  })
  ctx.provide('sessionPersistence', persistence as never)
  await ctx.plugin(localAgent, { homesRoot: mkdtempSync(join(tmpdir(), 'sync-homes-')) })
  return { ctx, registry: ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry, warns }
}

describe('LocalAgentRegistry.syncChildSession', () => {
  it('persists a live child session’s events through the cached write handle, creating the stored session', async () => {
    const persistence = fakePersistence()
    const { ctx, registry } = await mount(persistence)
    const child = ctx.sessions.create(SessionId('child-1'))
    child.append('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'fake', label: 'fake' })
    child.append('turn/start', { turn: 1 })

    await registry.syncChildSession(child)

    // The stored session was created from the live session's header, the full
    // snapshot landed as one suffix append, and the durability barrier ran.
    expect(persistence.created).toEqual(['child-1'])
    expect(persistence.opened).toEqual([])
    expect(persistence.appended).toEqual([child.snapshotEvents()])
    expect(persistence.flushed).toEqual(['child-1'])
    expect(persistence.stored.get('child-1')).toHaveLength(child.snapshotEvents().length)
  })

  it('is idempotent: a repeat sync with no new events appends nothing', async () => {
    const persistence = fakePersistence()
    const { ctx, registry } = await mount(persistence)
    const child = ctx.sessions.create(SessionId('child-1'))
    child.append('turn/start', { turn: 1 })

    await registry.syncChildSession(child)
    await registry.syncChildSession(child)

    expect(persistence.appended).toHaveLength(1)
    // The flush barrier still ran on the repeat (an empty sync is a valid one).
    expect(persistence.flushed).toEqual(['child-1', 'child-1'])

    // A new event lands as exactly the delta on the next sync, through the
    // SAME cached handle (no second open/create).
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await registry.syncChildSession(child)
    expect(persistence.appended).toHaveLength(2)
    expect(persistence.appended[1]).toHaveLength(1)
    expect(persistence.stored.get('child-1')).toHaveLength(child.snapshotEvents().length)
  })

  it('shares the write-handle cache with the reattach recipe — reattach then sync never double-opens', async () => {
    const persistence = fakePersistence()
    const { ctx, registry, warns } = await mount(persistence)
    // A host restart evicted the child from the live store; the public
    // reattach entry (the facade resume's recipe) restores it.
    await registry.ensureChildLive('child-1')
    const live = ctx.sessions.get(SessionId('child-1'))
    expect(live).toBeDefined()
    expect(persistence.opened).toEqual(['child-1'])

    // The sync reuses the reattach's cached handle: with real ownership
    // enforcement a second open would reject SessionAlreadyOwnedError (and
    // downgrade to a warn with nothing appended).
    live!.append('turn/start', { turn: 1 })
    await registry.syncChildSession(live!)

    expect(persistence.opened).toEqual(['child-1'])
    expect(warns).toEqual([])
    expect(persistence.appended.length).toBeGreaterThan(0)
    expect(persistence.stored.get('child-1')).toHaveLength(live!.snapshotEvents().length)
  })

  it('downgrades a sync failure to a warn, never throws, and keeps the handle for the next sync', async () => {
    const persistence = fakePersistence()
    const { ctx, registry, warns } = await mount(persistence)
    const child = ctx.sessions.create(SessionId('child-1'))
    child.append('turn/start', { turn: 1 })

    persistence.failAppendWith.current = new Error('disk full')
    await expect(registry.syncChildSession(child)).resolves.toBeUndefined()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('disk full')
    expect(persistence.stored.get('child-1')).toHaveLength(0)

    // The cached handle survived the failure: once the backend recovers the
    // next sync lands the whole missing suffix without re-acquiring.
    persistence.failAppendWith.current = null
    await registry.syncChildSession(child)
    expect(persistence.created).toEqual(['child-1'])
    expect(persistence.stored.get('child-1')).toHaveLength(child.snapshotEvents().length)
  })
})

describe('persistChildSession', () => {
  it('delegates a live session to the core’s syncChildSession', async () => {
    const persistence = fakePersistence()
    const { ctx, registry } = await mount(persistence)
    const child = ctx.sessions.create(SessionId('child-1'))
    child.append('turn/start', { turn: 1 })
    let synced: string | undefined
    const original = registry.syncChildSession.bind(registry)
    registry.syncChildSession = async (session) => {
      synced = String(session.id)
      await original(session)
    }

    await localAgent.persistChildSession(ctx, child)

    expect(synced).toBe('child-1')
    expect(persistence.stored.get('child-1')).toHaveLength(child.snapshotEvents().length)
  })

  it('persists a standalone session through the one-shot handle flow', async () => {
    const persistence = fakePersistence()
    const { ctx } = await mount(persistence)
    // NOT entered into the live store: the standalone (test/ad-hoc) path.
    const child = Session.create(SessionId('child-detached'))
    child.append('turn/start', { turn: 1 })

    await localAgent.persistChildSession(ctx, child)

    expect(persistence.created).toEqual(['child-detached'])
    expect(persistence.stored.get('child-detached')).toHaveLength(child.snapshotEvents().length)
    // The one-shot flow closes its own handle: write ownership is free again,
    // and the repeat is a stored-prefix no-op.
    await localAgent.persistChildSession(ctx, child)
    expect(persistence.appended).toHaveLength(1)
  })
})
