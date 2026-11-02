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
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness, type LocalAgentMemberReload } from '@khorsheed/dsh-local-agent'
import { MemberChannel } from '../src/member-channel.ts'
import { PresetToolHost } from '../src/preset-tool-host.ts'
import { MemberToolsTracker, RELOAD_LIST_WINDOW_MS } from '../src/member-tools.ts'

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
async function mount(options: { reload?: LocalAgentHarness['reloadMember'] | false; mode?: string | undefined } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
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
  })
  registry.recordDelegation({ childSessionId: CHILD, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-a', cwd: '/home/user/game' })
  const session = ctx.sessions.create(SessionId(CHILD))
  const definitions = new Map<string, object>([
    ...GAME.map(name => [name, { name, [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-gamedev' } }] as const),
    ['room_read', { name: 'room_read', [ORIGIN]: { channel: 'plugin', owner: '@khorsheed/dsh-room' } }],
  ])
  const inScope = (scope?: object) => (scope as { session?: unknown } | undefined)?.session === session
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
    expect(h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'now' })
    await Promise.resolve()
    expect(await h.registry.memberToolsStatus(CHILD)).toMatchObject({ reload: { state: 'reloading' } })
    // A second click while it runs is refused, not stacked.
    expect(h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'busy' })
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
    expect(h.registry.reloadMemberTools(CHILD)).toEqual({ ok: true, when: 'after-round' })
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
    h.registry.reloadMemberTools(CHILD)
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
    h.registry.reloadMemberTools(CHILD)
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
    expect((await mount({ reload: false })).registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'unsupported' })
    // The harness hosts no resident process for the member (exec path, live off).
    const h = await mount()
    expect(h.registry.reloadMemberTools(CHILD)).toEqual({ ok: false, reason: 'no-process' })
    expect(h.registry.reloadMemberTools('nobody')).toEqual({ ok: false, reason: 'unknown-member' })
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
