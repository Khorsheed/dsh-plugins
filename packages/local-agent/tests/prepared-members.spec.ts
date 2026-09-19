import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { LocalAgentRegistry, type LocalAgentPreparation } from '../src/index.ts'
import { PreparedMembers } from '../src/prepared-members.ts'

type StoredSessions = Map<string, { header: SessionHeader; events: SessionEvent[] }>

async function mount(previous?: { root: string; stored: StoredSessions }) {
  const ctx = new Context()
  await ctx.plugin(Commands)
  await ctx.plugin(SessionStore)
  const root = previous?.root ?? mkdtempSync(join(tmpdir(), 'prepared-members-'))
  const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: root } })
  ctx.provide('agents', { get: (id: string) => id === 'parent' ? { session: parent } : undefined } as never)
  let authenticated = true
  let flushFailure = false
  const stored: StoredSessions = previous?.stored ?? new Map()
  const handle = (id: string) => ({
    header: stored.get(id)!.header, inheritedEventCount: 0,
    read: async () => ({ events: [...stored.get(id)!.events], eventState: 'detached' }),
    append: async (events: SessionEvent[]) => { stored.get(id)!.events.push(...events) },
    flush: async () => { if (flushFailure) throw new Error('disk unavailable') }, close: async () => {},
  })
  ctx.provide('sessionPersistence', {
    stat: async (id: string) => stored.get(id)?.header,
    create: async (header: SessionHeader) => { stored.set(header.id, { header, events: [] }); return handle(header.id) },
    open: async (id: string) => handle(id),
  } as never)
  const registry = new LocalAgentRegistry(ctx, root, 10)
  ctx.provide('localAgent', registry)
  const nativePrepare = vi.fn(async (_request: LocalAgentPreparation) => {})
  const starts = vi.fn(async (_provider: string, request: SubagentStartRequest) => {
    const intent = registry.takeDelegationIntent(request.parent.session.id, 'fake-cli')
    if (intent?.kind !== 'fresh' || intent.preparedMemberId === undefined) throw new Error('missing prepared identity')
    const binding = registry.memberBinding(intent.preparedMemberId)!
    return registry.withMemberConfigurationRound(binding, async () => ({
      id: SessionId(intent.preparedMemberId!), localAgent: undefined,
      result: Promise.resolve({ output: [], stopReason: 'completed' as const }), dispose: async () => {},
    }))
  })
  ctx.provide('subagents', { getProvider: () => ({ name: 'fake-cli' }), start: starts } as never)
  registry.register({ name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: 'fake-cli',
    records: { listSessions: async () => [] }, isAuthenticated: async () => authenticated, prepareMember: nativePrepare,
    modelBroker: {
      modelInfo: () => ({ choices: [], switchable: true }),
      configurationAdapter: binding => {
        const resolve = async (selection: { model: { mode: string; value?: string } }) => ({ model: selection.model.value ?? binding.model ?? 'default-model' })
        return { validate: async () => {}, prepare: resolve, apply: resolve,
          reconcile: async state => ({ active: false, matches: 'current', resolved: await resolve(state.current.selection) }) }
      },
    },
  })
  return { ctx, root, registry, nativePrepare, starts, stored, unauthenticate: () => { authenticated = false }, failFlush: () => { flushFailure = true }, restoreFlush: () => { flushFailure = false } }
}

describe('native member preparation', () => {
  it('creates a durable configurable identity without a paid prompt and consumes it once on real input', async () => {
    const m = await mount()
    const id = await m.registry.prepareMember('parent', 'fake-cli', 'reserved-member', { model: 'initial' })
    expect(m.starts).not.toHaveBeenCalled()
    expect(m.nativePrepare).toHaveBeenCalledOnce()
    expect(m.registry.isPreparedMember(id)).toBe(true)
    expect(m.stored.get(id)?.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(m.registry.memberConfiguration(id).round).toBeUndefined()
    await m.registry.selectMemberConfiguration(id, 'choose-next', 0, { model: { mode: 'value', value: 'chosen' }, effort: { mode: 'inherit' } })
    const run = await m.registry.start('parent', 'fake-cli', [{ type: 'text', text: 'real work' }], { preparedMemberId: id })
    expect(run.id).toBe(id)
    expect(m.registry.runConfiguration(run)?.resolved.model).toBe('chosen')
    expect(m.registry.isPreparedMember(id)).toBe(false)
    await expect(m.registry.start('parent', 'fake-cli', [], { preparedMemberId: id })).rejects.toThrow('unavailable')
    await m.ctx.fiber.dispose()
  })

  it('fails authentication and persistence before claiming readiness', async () => {
    const unauth = await mount()
    unauth.unauthenticate()
    await expect(unauth.registry.prepareMember('parent', 'fake-cli', 'unauth')).rejects.toThrow('not authenticated')
    expect(unauth.nativePrepare).not.toHaveBeenCalled()
    const m = await mount()
    m.failFlush()
    await expect(m.registry.prepareMember('parent', 'fake-cli', 'unflushed')).rejects.toThrow('disk unavailable')
    expect(m.registry.isPreparedMember('unflushed')).toBe(false)
    expect(m.registry.memberConfiguration('unflushed').status).toBe('failed')
    await unauth.ctx.fiber.dispose()
    await m.ctx.fiber.dispose()
  })

  it('coalesces matching preparation but rejects another owner and overlapping first starts', async () => {
    const m = await mount()
    let finish!: () => void
    m.nativePrepare.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const first = m.registry.prepareMember('parent', 'fake-cli', 'shared')
    const same = m.registry.prepareMember('parent', 'fake-cli', 'shared')
    expect(same).toBe(first)
    await expect(m.registry.prepareMember('other-parent', 'fake-cli', 'shared')).rejects.toThrow('identity cannot change')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish()
    await first
    const run = m.registry.start('parent', 'fake-cli', [], { preparedMemberId: 'shared' })
    await expect(m.registry.start('parent', 'fake-cli', [], { preparedMemberId: 'shared' })).rejects.toThrow('unavailable')
    await run
    expect(m.starts).toHaveBeenCalledOnce()
    await m.ctx.fiber.dispose()
  })

  it('retries failed preparation explicitly without admitting a paid turn', async () => {
    const m = await mount()
    m.failFlush()
    await expect(m.registry.prepareMember('parent', 'fake-cli', 'retry')).rejects.toThrow('disk unavailable')
    m.restoreFlush()
    await m.registry.prepareMember('parent', 'fake-cli', 'retry')
    expect(m.registry.isPreparedMember('retry')).toBe(true)
    expect(m.registry.memberConfiguration('retry').status).toBe('idle')
    expect(m.starts).not.toHaveBeenCalled()
    expect(m.nativePrepare).toHaveBeenCalledTimes(2)
    await m.ctx.fiber.dispose()
  })

  it('reattaches a ready identity after restart and preserves the consumed barrier', async () => {
    const before = await mount()
    await before.registry.prepareMember('parent', 'fake-cli', 'restart', { model: 'initial' })
    await before.registry.selectMemberConfiguration('restart', 'choose', 0, { model: { mode: 'value', value: 'chosen' }, effort: { mode: 'inherit' } })
    await before.ctx.fiber.dispose()
    const after = await mount(before)
    expect(after.registry.isPreparedMember('restart')).toBe(true)
    const run = await after.registry.start('parent', 'fake-cli', [], { preparedMemberId: 'restart' })
    expect(run.id).toBe('restart')
    expect(after.registry.runConfiguration(run)?.resolved.model).toBe('chosen')
    await after.ctx.fiber.dispose()
    const again = await mount(after)
    await expect(again.registry.prepareMember('parent', 'fake-cli', 'restart', { model: 'initial' })).rejects.toThrow('already entered execution')
    await expect(again.registry.start('parent', 'fake-cli', [], { preparedMemberId: 'restart' })).rejects.toThrow('unavailable')
    expect(again.starts).not.toHaveBeenCalled()
    await again.ctx.fiber.dispose()
  })

  it('does not prepare an already cancelled request', async () => {
    const m = await mount()
    await expect(m.registry.prepareMember('parent', 'fake-cli', 'cancelled', { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(m.nativePrepare).not.toHaveBeenCalled()
    expect(m.registry.memberBinding('cancelled')).toBeUndefined()
    await m.ctx.fiber.dispose()
  })

  it('persists binding identity, rejects corrupted storage and prohibits changing a prepared scope', async () => {
    const m = await mount()
    await m.registry.prepareMember('parent', 'fake-cli', 'member', { scope: 'isolated' })
    const directory = join(m.root, '.prepared-members')
    const store = new PreparedMembers(directory)
    expect(store.read('member')?.binding.scope).toBe('isolated')
    await expect(m.registry.prepareMember('parent', 'fake-cli', 'member')).rejects.toThrow('identity cannot change')
    writeFileSync(join(directory, createHash('sha256').update('member').digest('hex') + '.json'), JSON.stringify({ version: 1, phase: 'ready', binding: { childSessionId: 'different' } }))
    expect(() => store.read('member')).toThrow('Invalid prepared member')
    await m.ctx.fiber.dispose()
  })
})
