/**
 * The room edit dialog's 模式工具 read and reload: what a member's CURRENT
 * process holds of its mode tools, a reload that happens now for an idle
 * member and after the round for a running one, and the room lines (an
 * automatic reload at round start, a reload that still could not get them).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness, type LocalAgentMemberReload } from '@khorsheed/dsh-local-agent'
import { MemberChannel } from '../src/member-channel.ts'
import { PresetToolHost } from '../src/preset-tool-host.ts'
import { MemberToolsTracker, RELOAD_LIST_WINDOW_MS } from '../src/member-tools.ts'
import type { MemberConfigurationAdapter } from '../src/member-control.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'room-1'
const CHILD = 'child-a'
const ORIGIN = Symbol.for('dsh.tool.origin')
const GAME = ['game_open', 'game_read', 'game_propose', 'game_publish', 'typesafe_judge']

afterEach(() => { vi.restoreAllMocks() })

/** A controllable promise. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/**
 * The registry stack, one member with a recorded delegation and a live child
 * session, a mode whose scope has the five game tools (plus a room tool the
 * bridge serves itself), a room gate, and a harness whose reload the test
 * drives by hand.
 */
async function mount(options: {
  reload?: LocalAgentHarness['reloadMember'] | false
  mode?: string | undefined
  /** A harness that can start a member's process without a round (立即载入). */
  start?: { can?: () => boolean; start: NonNullable<LocalAgentHarness['startMember']> }
  /** Whether the member's child session is loaded (false: right after a host restart). */
  live?: boolean
  /** A configuration broker: the member's rounds and 立即载入 admit through its control. */
  configuration?: MemberConfigurationAdapter
  /** The harness's background-task read (member-self-started-rounds). */
  backgroundTasks?: LocalAgentHarness['backgroundTasks']
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  ctx.provide('subagents', { getProvider: (name: string) => name === PROVIDER ? { name } : undefined } as never)
  ctx.provide('sessionPersistence', {
    open: (id: SessionId) => Promise.resolve({
      id,
      header: { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false },
      inheritedEventCount: 0,
      read: () => Promise.resolve({ events: [], eventState: 'detached' }),
      append: () => Promise.resolve(),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  })
  const homesRoot = mkdtempSync(join(tmpdir(), 'member-tools-'))
  await ctx.plugin(localAgent, { homesRoot })
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  const reloads: { childSessionId: string; onStart: () => void }[] = []
  registry.register({
    name: 'fake',
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    delegationProvider: PROVIDER,
    records: { listSessions: async () => [] },
    ...options.reload === false ? {} : {
      reloadMember: options.reload ?? ((childSessionId, hooks) => {
        reloads.push({ childSessionId, onStart: hooks.onStart })
        return undefined
      }),
    },
    ...options.backgroundTasks === undefined ? {} : { backgroundTasks: options.backgroundTasks },
    ...options.start === undefined ? {} : { canStartMember: options.start.can ?? (() => true), startMember: options.start.start },
    ...options.configuration === undefined ? {} : { modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => options.configuration! } },
  } as never)
  registry.recordDelegation({ childSessionId: CHILD, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-a', cwd: '/home/user/game' })
  const session = options.live === false ? undefined : ctx.sessions.create(SessionId(CHILD))
  const definitions = new Map<string, object>([
    ...GAME.map(name => [name, { name, [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-gamedev' } }] as const),
    ['room_read', { name: 'room_read', [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-room' } }],
  ])
  const inScope = (scope?: object) => session !== undefined && (scope as { session?: unknown } | undefined)?.session === session
  ctx.provide('agentPresets' as never, { resolve: async (id?: string) => ({ id: id ?? 'default' }), mount: async () => {} } as never)
  ctx.provide('tools' as never, {
    schemas: (scope?: object) => inScope(scope) ? [...definitions.keys()].map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } })) : [],
    get: (name: string, scope?: object) => inScope(scope) ? definitions.get(name) : undefined,
    execute: async () => ({ isError: false, content: [] }),
  } as never)
  const noteMemberTools = vi.fn(async () => {})
  const mode = 'mode' in options ? options.mode : 'gamedev'
  ctx.provide('room' as never, {
    receiveMemberMessage: async () => 'sent',
    memberMode: async () => mode === undefined ? undefined : { preset: mode, cwd: '/home/user/game' },
    noteMemberTools,
  } as never)
  const channel = new MemberChannel(ctx, registry, join(homesRoot, 'test.sock'), new PresetToolHost(ctx))
  const spawn = () => registry.registerMemberRun({ childSessionId: CHILD, parentSessionId: PARENT, provider: PROVIDER })
  const list = (token: string) => channel.handleModeTools({ token, modeTools: { list: true } })
  const placeholder = (token: string) => channel.handleModeTools({ token, modeTools: { report: { served: 'placeholder', reason: 'socket refused' } } })
  return { ctx, registry, channel, reloads, noteMemberTools, spawn, list, placeholder, definitions }
}

describe('member tools status (the edit dialog read)', () => {
  it('counts only the mode tools the current process received', async () => {
    const h = await mount()
    // No process yet: the next round's process lists afresh.
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ preset: 'gamedev', process: 'none', expected: GAME, reloadable: false })
    const token = h.spawn()
    // A live process that never listed (an old bridge, a late lister): unknown, not broken.
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'unreported', received: [] })
    await h.list(token)
    const full = await h.registry.memberToolsStatus(CHILD)
    // The room's own tools are the bridge's, never counted here.
    expect(full).toMatchObject({ process: 'full', received: GAME, expected: GAME, reloadable: true })
    expect(full?.loadedAt).toEqual(expect.any(Number))
  })

  it('a placeholder process holds none of them', async () => {
    const h = await mount()
    const token = h.spawn()
    await h.placeholder(token)
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'placeholder', received: [], expected: GAME })
  })

  it('an empty list while the mode has tools reads as empty', async () => {
    const h = await mount()
    const token = h.spawn()
    for (const name of GAME) h.definitions.delete(name)
    await h.list(token)
    for (const name of GAME) h.definitions.set(name, { name, [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-gamedev' } })
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'empty', received: [], expected: GAME })
  })

  it('a member without a mode has no status at all', async () => {
    const h = await mount({ mode: undefined })
    h.spawn()
    expect(await h.registry.memberToolsStatus(CHILD)).toBeNull()
    expect(await h.registry.memberToolsStatus('nobody')).toBeNull()
  })
})

describe('reloading a member\'s tools', () => {
  it('an idle member reloads now: a fresh process resumes and lists, the old one is gone', async () => {
    const done = deferred<'respawned'>()
    let old = ''
    const h = await mount({
      reload: (_child, hooks) => {
        queueMicrotask(hooks.onStart)
        return { when: 'now', done: done.promise } satisfies LocalAgentMemberReload
      },
    })
    old = h.spawn()
    await h.placeholder(old)
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
    await Promise.resolve()
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ reload: { state: 'reloading' } })
    // A second click while it runs is refused, not stacked.
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'busy' })
    // The driver retires the old process and spawns the new one (no round).
    h.registry.unregisterMemberRun(old)
    const fresh = h.spawn()
    done.resolve('respawned')
    await done.promise
    await Promise.resolve()
    // Still reloading until the new process lists.
    expect((await h.registry.memberToolsStatus(CHILD))?.reload).toMatchObject({ state: 'reloading' })
    await h.list(fresh)
    const after = await h.registry.memberToolsStatus(CHILD)
    expect(after).toMatchObject({ process: 'full', received: GAME, lastReload: { by: 'manual', outcome: 'loaded' } })
    expect(after?.reload).toBeUndefined()
    expect(h.noteMemberTools).not.toHaveBeenCalled()
  })

  it('a running member\'s reload is scheduled after the round, never started before it ends', async () => {
    const done = deferred<'respawned'>()
    let start: (() => void) | undefined
    const h = await mount({
      reload: (_child, hooks) => {
        start = hooks.onStart
        return { when: 'after-round', done: done.promise }
      },
    })
    const old = h.spawn()
    await h.placeholder(old)
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'after-round' })
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'placeholder', reload: { state: 'scheduled' } })
    // The round ends; the driver begins the reload.
    start!()
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ reload: { state: 'reloading' } })
    h.registry.unregisterMemberRun(old)
    const fresh = h.spawn()
    done.resolve('respawned')
    await done.promise
    await h.list(fresh)
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'full', lastReload: { outcome: 'loaded' } })
  })

  it('a reload whose new process still cannot get the tools tells the room, once', async () => {
    const done = deferred<'respawned'>()
    const h = await mount({ reload: () => ({ when: 'now', done: done.promise }) })
    const old = h.spawn()
    await h.placeholder(old)
    await h.registry.reloadMemberTools(CHILD)
    h.registry.unregisterMemberRun(old)
    const fresh = h.spawn()
    done.resolve('respawned')
    await done.promise
    await Promise.resolve()
    await h.placeholder(fresh)
    await vi.waitFor(() => { expect(h.noteMemberTools).toHaveBeenCalledOnce() })
    expect(h.noteMemberTools).toHaveBeenCalledWith(
      { childSessionId: CHILD, parentSessionId: PARENT, provider: PROVIDER },
      { kind: 'unavailable', preset: 'gamedev', during: 'idle' },
    )
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'placeholder', lastReload: { by: 'manual', outcome: 'missing' } })
    // The same process reporting again is not a second notice.
    await h.placeholder(fresh)
    expect(h.noteMemberTools).toHaveBeenCalledOnce()
  })

  it('a new process that has not listed after the window reads as pending (it lists at the next message)', async () => {
    const done = deferred<'respawned'>()
    const h = await mount({ reload: () => ({ when: 'now', done: done.promise }) })
    const old = h.spawn()
    await h.list(old)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await h.registry.reloadMemberTools(CHILD)
    h.registry.unregisterMemberRun(old)
    h.spawn()
    done.resolve('respawned')
    await done.promise
    await Promise.resolve()
    clock.mockReturnValue(now + RELOAD_LIST_WINDOW_MS + 1)
    const status = await h.registry.memberToolsStatus(CHILD)
    expect(status).toMatchObject({ process: 'unreported', lastReload: { outcome: 'pending' } })
    expect(status?.reload).toBeUndefined()
  })

  it('refuses what it cannot reload', async () => {
    expect(await (await mount({ reload: false })).registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'unsupported' })
    // The harness hosts no resident process for the member (exec path, live off).
    const h = await mount()
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'no-process' })
    expect(await h.registry.reloadMemberTools('nobody')).toEqual({ ok: false, reason: 'unknown-member' })
  })

  it('running background tasks: refused until the caller confirms they lose their process', async () => {
    const task = (id: string, state: 'running' | 'completed') => ({ id, label: id, kind: 'shell' as const, startedAt: 1, state })
    const read = { supported: true, processAlive: true, tasks: [task('bash-1', 'running'), task('bash-2', 'running'), task('bash-0', 'completed')] }
    const reloads: string[] = []
    const h = await mount({
      backgroundTasks: async () => read,
      reload: (child) => { reloads.push(child); return { when: 'now', done: Promise.resolve('respawned') } satisfies LocalAgentMemberReload },
    })
    h.spawn()
    // Nothing is done: the room asks 「会让 2 项后台工作失去联系」 first.
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'background-tasks', running: 2 })
    expect(reloads).toEqual([])
    expect(await h.registry.reloadMemberTools(CHILD, { confirmBackgroundTasks: true })).toEqual({ ok: true, when: 'now' })
    expect(reloads).toEqual([CHILD])
  })

  it('tasks of a process that is gone are not cut off by a reload: no question asked', async () => {
    const read = { supported: true, processAlive: false, tasks: [{ id: 'bash-1', label: 'bash-1', kind: 'shell' as const, startedAt: 1, state: 'running' as const }] }
    const h = await mount({
      backgroundTasks: async () => read,
      reload: () => ({ when: 'now', done: Promise.resolve('respawned') } satisfies LocalAgentMemberReload),
    })
    h.spawn()
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
  })
})

describe('round-start self-heal, as the dialog and the room see it', () => {
  it('tells the room before the round and keeps the line until the next normal load', async () => {
    const h = await mount()
    const old = h.spawn()
    await h.placeholder(old)
    // The live driver retired the process at round start.
    h.registry.unregisterMemberRun(old)
    h.registry.noteMemberToolsRespawn(CHILD, old)
    await vi.waitFor(() => { expect(h.noteMemberTools).toHaveBeenCalledOnce() })
    expect(h.noteMemberTools).toHaveBeenCalledWith(expect.objectContaining({ childSessionId: CHILD }), { kind: 'reloaded', preset: 'gamedev', during: 'round' })
    const fresh = h.spawn()
    await h.list(fresh)
    const healed = await h.registry.memberToolsStatus(CHILD)
    expect(healed).toMatchObject({ process: 'full', lastReload: { by: 'auto', outcome: 'loaded' } })
    expect(healed?.autoReloadAt).toEqual(expect.any(Number))
    // The next process loading normally clears the line.
    h.registry.unregisterMemberRun(fresh)
    await h.list(h.spawn())
    expect((await h.registry.memberToolsStatus(CHILD))?.autoReloadAt).toBeUndefined()
  })

  it('an auto-reloaded process that still gets the placeholder says so for the round', async () => {
    const h = await mount()
    const old = h.spawn()
    await h.placeholder(old)
    h.registry.unregisterMemberRun(old)
    h.registry.noteMemberToolsRespawn(CHILD, old)
    await h.placeholder(h.spawn())
    await vi.waitFor(() => { expect(h.noteMemberTools).toHaveBeenCalledTimes(2) })
    expect(h.noteMemberTools).toHaveBeenLastCalledWith(expect.anything(), { kind: 'unavailable', preset: 'gamedev', during: 'round' })
  })
})

describe('MemberToolsTracker', () => {
  it('a placeholder from the replaced process does not settle the reload', () => {
    const tracker = new MemberToolsTracker(() => 1)
    tracker.reloadAccepted('m', 'now')
    tracker.reloadDone('m', 'respawned', 'old')
    expect(tracker.served('m', 'old', 'placeholder')).toEqual({})
    expect(tracker.reloadState('m')).toMatchObject({ reload: { state: 'reloading' } })
    expect(tracker.served('m', 'new', 'complete')).toEqual({})
    expect(tracker.reloadState('m')).toMatchObject({ lastReload: { outcome: 'loaded' } })
  })

  it('a reload with nothing to replace, or that failed, is finished at once', () => {
    const tracker = new MemberToolsTracker(() => 1)
    tracker.reloadAccepted('m', 'after-round')
    expect(tracker.reloadState('m')).toMatchObject({ reload: { state: 'scheduled' } })
    tracker.reloadDone('m', 'no-process', undefined)
    expect(tracker.reloadState('m')).toEqual({ lastReload: { at: 1, by: 'manual', outcome: 'no-process' } })
    tracker.reloadAccepted('m', 'now')
    tracker.reloadDone('m', 'failed', undefined)
    expect(tracker.reloadState('m')).toEqual({ lastReload: { at: 1, by: 'manual', outcome: 'failed' } })
  })
})

describe('what the mode has, right after a host restart', () => {
  it('waits for a freshly mounted preset to finish registering, as a list does', async () => {
    const h = await mount()
    // The preset scope is fresh: two rows registered at mount, three a tick later.
    const late = GAME.slice(2)
    for (const name of late) h.definitions.delete(name)
    setTimeout(() => {
      for (const name of late) h.definitions.set(name, { name, [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-gamedev' } })
    }, 20)
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'none', expected: GAME })
  })

  it('a list and the dialog read share one settle wait on a fresh scope', async () => {
    const h = await mount()
    const late = GAME.slice(1)
    for (const name of late) h.definitions.delete(name)
    setTimeout(() => {
      for (const name of late) h.definitions.set(name, { name, [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-gamedev' } })
    }, 20)
    const host = new PresetToolHost(h.ctx)
    const [names, listed] = await Promise.all([host.names(CHILD, 'gamedev'), host.list(CHILD, 'gamedev')])
    expect(names).toEqual(GAME)
    expect(listed.map(tool => tool.name)).toEqual(GAME)
    // Settled once: a later read answers at once with the same set.
    const started = Date.now()
    expect(await host.names(CHILD, 'gamedev')).toEqual(GAME)
    expect(Date.now() - started).toBeLessThan(100)
    await host.dispose()
  })

  it('reads as unknown, never 0, when the host cannot tell', async () => {
    // The member's session is not loaded yet: no scope to ask.
    const h = await mount({ live: false })
    const status = await h.registry.memberToolsStatus(CHILD)
    expect(status).toMatchObject({ process: 'none', expected: [], expectedUnknown: true })
    // Known (even when it is empty) carries no unknown mark.
    const known = await mount()
    for (const name of GAME) known.definitions.delete(name)
    const empty = await known.registry.memberToolsStatus(CHILD)
    expect(empty?.expected).toEqual([])
    expect(empty?.expectedUnknown).toBeUndefined()
  })
})

describe('立即载入: starting a member that has no process', () => {
  it('starts the process with no round, resuming the recorded CLI session, and settles on its list', async () => {
    const calls: Parameters<NonNullable<LocalAgentHarness['startMember']>>[0][] = []
    let h!: Awaited<ReturnType<typeof mount>>
    h = await mount({
      start: {
        start: async (request) => {
          calls.push(request)
          // The fresh process lists while it is being prepared, before the start returns.
          await h.list(h.spawn())
          return 'respawned'
        },
      },
    })
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'none', startable: true, reloadable: false })
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
    await vi.waitFor(async () => {
      expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'full', received: GAME, lastReload: { by: 'manual', outcome: 'loaded' } })
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      binding: { childSessionId: CHILD, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/game' },
      resume: { cliSessionId: 'cli-a', turn: 1 },
    })
    expect(String(calls[0]!.childSession.id)).toBe(CHILD)
    const after = await h.registry.memberToolsStatus(CHILD)
    expect(after?.reload).toBeUndefined()
    expect(after?.startable).toBeUndefined()
  })

  it('shows 载入中 while the process starts, and refuses a second click', async () => {
    const done = deferred<'respawned'>()
    const h = await mount({ start: { start: () => done.promise } })
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'none', reload: { state: 'reloading' } })
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'busy' })
    done.resolve('respawned')
    await done.promise
  })

  it('a start that fails reads as failed, with the member still startable', async () => {
    const h = await mount({ start: { start: async () => 'failed' } })
    await h.registry.reloadMemberTools(CHILD)
    await vi.waitFor(async () => {
      expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'none', startable: true, lastReload: { by: 'manual', outcome: 'failed' } })
    })
  })

  it('never starts a member mid-round, removed, or on a harness that cannot', async () => {
    const start = vi.fn(async () => 'respawned' as const)
    // A round is starting: the provider holds the member's resume lock.
    const locked = await mount({ start: { start } })
    locked.registry.acquireResumeLock(CHILD)
    expect(await locked.registry.memberToolsStatus(CHILD)).not.toHaveProperty('startable')
    expect(await locked.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'busy' })
    // A process is running: that is 重新载入's job.
    const running = await mount({ start: { start } })
    running.spawn()
    expect(await running.registry.memberToolsStatus(CHILD)).not.toHaveProperty('startable')
    // The member left the room (no mode any more).
    const removed = await mount({ mode: undefined, start: { start } })
    expect(await removed.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'unknown-member' })
    // The driver is off for it (exec path, live off).
    const off = await mount({ start: { start, can: () => false } })
    expect(await off.registry.memberToolsStatus(CHILD)).not.toHaveProperty('startable')
    expect(await off.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'no-process' })
    // A harness without the hook keeps the text-only line.
    const plain = await mount()
    expect(await plain.registry.memberToolsStatus(CHILD)).not.toHaveProperty('startable')
    expect(start).not.toHaveBeenCalled()
  })
})

describe('立即载入 / 重新载入 recover a failed start first', () => {
  const binding = { childSessionId: CHILD, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/game' }
  const adapter = (reconcile: MemberConfigurationAdapter['reconcile'] = async () => ({ active: false, matches: 'current', resolved: { model: 'm' } })): MemberConfigurationAdapter => ({
    validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }), reconcile,
  })
  /** The 11-04 state: a native start failed (not retryable), the member then failed in 0 ms. */
  async function failStart(h: Awaited<ReturnType<typeof mount>>): Promise<void> {
    await expect(h.registry.withMemberConfigurationRound(binding, async () => { throw new Error('session busy elsewhere') })).rejects.toThrow('busy elsewhere')
    expect(h.registry.memberConfiguration(CHILD)).toMatchObject({ status: 'failed', error: 'session busy elsewhere' })
  }

  it('立即载入 retries the failed start, then starts the process', async () => {
    let h!: Awaited<ReturnType<typeof mount>>
    const start = vi.fn(async () => { await h.list(h.spawn()); return 'respawned' as const })
    h = await mount({ start: { start }, configuration: adapter() })
    await failStart(h)
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
    await vi.waitFor(async () => {
      expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ process: 'full', lastReload: { outcome: 'loaded' } })
    })
    expect(start).toHaveBeenCalledOnce()
    expect(h.registry.memberConfiguration(CHILD).status).not.toBe('failed')
  })

  it('a retry that fails again answers with the new reason and starts nothing', async () => {
    const start = vi.fn(async () => 'respawned' as const)
    let reconcileFails = false
    const h = await mount({ start: { start }, configuration: adapter(async () => {
      if (reconcileFails) throw new Error('still busy elsewhere')
      return { active: false, matches: 'current', resolved: { model: 'm' } }
    }) })
    await failStart(h)
    reconcileFails = true
    expect(await h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'start-failed', error: 'still busy elsewhere' })
    expect(start).not.toHaveBeenCalled()
    expect(h.registry.memberConfiguration(CHILD)).toMatchObject({ status: 'failed', error: 'still busy elsewhere' })
  })

  it('a start that fails after the recovery carries its reason to the dialog', async () => {
    const h = await mount({ start: { start: async () => { throw new Error('the CLI exited at once') } }, configuration: adapter() })
    await h.registry.reloadMemberTools(CHILD)
    await vi.waitFor(async () => {
      expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ lastReload: { outcome: 'failed', error: 'the CLI exited at once' } })
    })
  })

  it('重新载入 also recovers first; a selection that did not apply is left for the user', async () => {
    const reload = vi.fn(() => undefined)
    const h = await mount({ reload, configuration: adapter() })
    h.spawn()
    await failStart(h)
    await h.registry.reloadMemberTools(CHILD)
    expect(h.registry.memberConfiguration(CHILD).status).not.toBe('failed')
    expect(reload).toHaveBeenCalledOnce()
    // A selection that did not apply is not a failed start: no retry.
    const pick = await mount({ reload, configuration: { ...adapter(), apply: async () => { throw new Error('model refused') } } })
    pick.spawn()
    const state = pick.registry.memberConfiguration(CHILD)
    await pick.registry.selectMemberConfiguration(CHILD, 'pick-1', state.revision, { model: { mode: 'value', value: 'other' }, effort: { mode: 'inherit' } })
    await vi.waitFor(() => expect(pick.registry.memberConfiguration(CHILD).status).toBe('failed'))
    await pick.registry.reloadMemberTools(CHILD)
    expect(pick.registry.memberConfiguration(CHILD)).toMatchObject({ status: 'failed', error: 'model refused' })
  })
})

describe('a reload whose new process listed while it was being prepared', () => {
  it('settles as loaded at once, not pending', async () => {
    let h!: Awaited<ReturnType<typeof mount>>
    let old = ''
    h = await mount({
      reload: (_child, hooks) => {
        hooks.onStart()
        const done = (async () => {
          h.registry.unregisterMemberRun(old)
          await h.list(h.spawn())
          return 'respawned' as const
        })()
        return { when: 'now', done }
      },
    })
    old = h.spawn()
    await h.placeholder(old)
    await h.registry.reloadMemberTools(CHILD)
    await vi.waitFor(async () => {
      const status = await h.registry.memberToolsStatus(CHILD)
      expect(status).toMatchObject({ process: 'full', lastReload: { by: 'manual', outcome: 'loaded' } })
      expect(status?.reload).toBeUndefined()
    })
  })
})
