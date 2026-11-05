/**
 * Mode tools: a CLI member with a mode (a host agent preset) reaches that
 * preset's plugin tools through its bridge — the preset tool host lists them
 * from a model-less preset agent's scope and runs them through the registry.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemberChannel } from '../src/member-channel.ts'
import { PresetToolHost } from '../src/preset-tool-host.ts'
import { listModeTools, callModeTool } from '../src/member-bridge.ts'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harnessSkillsDir, installModeSkills } from '../src/mode-skills.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')
const tagged = (name: string, owner: string, channel = 'plugin') => ({ name, [ORIGIN]: { channel, owner } })

/** Fake host services: the member's live session, one preset whose scope sees a plugin tool, a room tool, a family tool, a built-in and an untagged one. */
function host(others: Record<string, unknown> = {}, options: { batched?: boolean } = {}) {
  const ctx = new Context()
  const appended: { type: string; data: unknown }[] = []
  const session = {
    id: 'child-codex',
    header: { agentPreset: undefined as string | undefined },
    snapshotEvents: () => appended,
    append: (type: string, data: unknown) => { appended.push({ type, data }) },
  }
  const mount = vi.fn(async (_ctx: Context, _id?: string) => {})
  const definitions = new Map<string, object>([
    ['video_read', tagged('video_read', '@khorsheed/dsh-video-studio')],
    ['room_read', tagged('room_read', '@khorsheed/dsh-room')],
    ['subagent_dsh', tagged('subagent_dsh', '@khorsheed/dsh-local-agent-dsh')],
    ['bash', tagged('bash', 'builtin', 'builtin')],
    ['plain', { name: 'plain' }],
  ])
  const inScope = (scope?: object) => (scope as { session?: unknown } | undefined)?.session === session
  const outcome = { isError: false, content: [{ type: 'text', text: 'project: 第3期' }] }
  const execute = vi.fn(async (_exec: { name: string; agent: { id: string; session: unknown } }) =>
    options.batched === true ? { results: [{ result: outcome }] } : outcome)
  ctx.provide('sessions' as never, { get: (id: string) => id === 'child-codex' ? session : others[id] } as never)
  ctx.provide('agentPresets' as never, { resolve: async (id?: string) => ({ id: id ?? 'default' }), mount } as never)
  ctx.provide('tools' as never, {
    schemas: (scope?: object) => inScope(scope) ? [...definitions.keys()].map(name => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {} } })) : [],
    get: (name: string, scope?: object) => inScope(scope) ? definitions.get(name) : undefined,
    ...options.batched === true ? { executable: () => undefined } : {},
    execute,
  } as never)
  return { ctx, session, appended, mount, execute, definitions }
}

describe('PresetToolHost', () => {
  it('lists only the mode\'s plugin tools, scoping the member\'s own session with the preset once', async () => {
    const h = host()
    const tools = new PresetToolHost(h.ctx)
    expect(await tools.list('child-codex', 'dsh-video', '/home/user/podcast')).toEqual([
      { name: 'video_read', description: 'video_read tool', inputSchema: { type: 'object', properties: {} } },
    ])
    await tools.list('child-codex', 'dsh-video')
    expect(h.mount).toHaveBeenCalledOnce()
    expect(h.mount.mock.calls[0]![1]).toBe('dsh-video')
    // The member's session records its mode (per-session plugin visibility), once.
    expect(h.appended).toEqual([{ type: 'agent-preset/selected', data: { agentPreset: 'dsh-video' } }])
  })

  it('runs a plugin tool through the registry as the preset agent; refuses anything else', async () => {
    const h = host()
    const tools = new PresetToolHost(h.ctx)
    const signal = new AbortController().signal
    expect(await tools.call('child-codex', 'dsh-video', 'video_read', { project: 'p' }, signal))
      .toEqual({ content: [{ type: 'text', text: 'project: 第3期' }], isError: false })
    // As the member itself: plugin state lands on its own session.
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'video_read', arguments: { project: 'p' }, signal }))
    expect(h.execute.mock.calls[0]![0].agent).toMatchObject({ id: 'child-codex', session: h.session })
    // The stand-in is how an approval its call raises finds the member (and the room asks).
    expect(tools.memberOf(h.execute.mock.calls[0]![0].agent)).toBe('child-codex')
    expect(tools.memberOf({ id: 'child-codex', session: h.session })).toBeUndefined()
    expect(await tools.call('child-codex', 'dsh-video', 'bash', {}, signal)).toMatchObject({ isError: true })
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('uses the batch API when the host exposes scoped executors', async () => {
    const h = host({}, { batched: true })
    const result = await new PresetToolHost(h.ctx).call('child-codex', 'dsh-video', 'video_read', { project: 'p' }, new AbortController().signal)
    expect(result).toEqual({ content: [{ type: 'text', text: 'project: 第3期' }], isError: false })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      calls: [expect.objectContaining({ name: 'video_read', arguments: '{"project":"p"}' })],
    }))
    expect(h.execute.mock.calls[0]![0]).not.toHaveProperty('arguments')
  })

  it('announces each stand-in it composes and disposes, so per-agent grants can reach it', async () => {
    const h = host()
    const created = vi.fn()
    const disposed = vi.fn()
    const on = h.ctx.on.bind(h.ctx) as unknown as (name: string, listener: (payload: { agent: unknown }) => void) => void
    on('local-agent/stand-in-created', ({ agent }) => { created(agent) })
    on('local-agent/stand-in-disposed', ({ agent }) => { disposed(agent) })
    const tools = new PresetToolHost(h.ctx)
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, new AbortController().signal)
    const standIn = h.execute.mock.calls[0]![0].agent
    expect(created).toHaveBeenCalledExactlyOnceWith(standIn)
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, new AbortController().signal)
    expect(created).toHaveBeenCalledOnce()
    await tools.dispose()
    expect(disposed).toHaveBeenCalledExactlyOnceWith(standIn)
  })

  it('marks the room as the stand-in\'s desk with the member\'s current role; no desk, no mark', async () => {
    const room = { id: 'room-1', header: {}, snapshotEvents: () => [], append: () => {} }
    const h = host({ 'room-1': room })
    const tools = new PresetToolHost(h.ctx)
    const signal = new AbortController().signal
    const DESK = Symbol.for('dsh.agent.desk')
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, signal, undefined, { sessionId: 'room-1', role: 'member', member: 'bill' })
    const standIn = h.execute.mock.calls[0]![0].agent as unknown as Record<symbol, unknown>
    // Only the desk moves: the call still runs as the member's own session.
    expect(h.execute.mock.calls[0]![0].agent.session).toBe(h.session)
    expect(standIn[DESK]).toEqual({ session: room, role: 'member', member: 'bill' })
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, signal, undefined, { sessionId: 'room-1', role: 'coordinator', member: 'bill' })
    expect(standIn[DESK]).toMatchObject({ role: 'coordinator' })
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, signal)
    expect(standIn[DESK]).toBeUndefined()
    // A room that is not live here gives no desk rather than a dangling one.
    await tools.call('child-codex', 'dsh-writing', 'video_read', {}, signal, undefined, { sessionId: 'room-gone', role: 'member', member: 'bill' })
    expect(standIn[DESK]).toBeUndefined()
  })

  it('waits for a freshly mounted preset to finish registering before listing', async () => {
    const h = host()
    h.definitions.delete('video_read')
    setTimeout(() => { h.definitions.set('video_read', tagged('video_read', '@khorsheed/dsh-video-studio')) }, 200)
    expect((await new PresetToolHost(h.ctx).list('child-codex', 'dsh-video')).map(tool => tool.name)).toEqual(['video_read'])
  })

  it('a host without presets, or a member whose session is not live, offers nothing', async () => {
    expect(await new PresetToolHost(new Context()).list('child', 'dsh-video')).toEqual([])
    expect(await new PresetToolHost(host().ctx).list('child-gone', 'dsh-video')).toEqual([])
  })
})

describe('mode skills', () => {
  it('finds the skills the mode contributes (scope minus global) and installs them the CLI\'s way', async () => {
    const h = host()
    const skills = [{ name: 'video-studio', description: '剪辑工作流', content: '先 video_project open' }]
    h.ctx.provide('skills' as never, {
      list: async (options?: { scope?: { session?: unknown } }) => options?.scope?.session === h.session
        ? [{ name: 'global-one', description: 'g' }, ...skills] : [{ name: 'global-one', description: 'g' }],
      get: async (name: string) => skills.find(skill => skill.name === name),
    } as never)
    const found = await new PresetToolHost(h.ctx).skills('child-codex', 'dsh-video')
    expect(found).toEqual(skills)

    const home = mkdtempSync(join(tmpdir(), 'mode-skills-'))
    const dir = harnessSkillsDir('codex', home)!
    expect(installModeSkills(dir, 'dsh-video', found)).toEqual(['dsh-video-studio'])
    const file = join(dir, 'dsh-video-studio', 'SKILL.md')
    const text = readFileSync(file, 'utf8')
    expect(text).toMatch(/^---\nname: dsh-video-studio\ndescription: ".*dsh mode \\"dsh-video\\".*"\n---\n\n先 video_project open\n$/)
    const written = statSync(file).mtimeMs
    installModeSkills(dir, 'dsh-video', found)
    expect(statSync(file).mtimeMs).toBe(written)
    expect(harnessSkillsDir('kimi', home)).toBe(join(home, 'skills'))
    // A dsh command-line member: the sub-dsh reads $DSH_HOME/skills (its user-dsh root).
    expect(harnessSkillsDir('dsh', home)).toBe(join(home, 'skills'))
    expect(harnessSkillsDir('other', home)).toBeUndefined()
  })
})

describe('MemberChannel mode tools', () => {
  const run = { childSessionId: 'child-codex', parentSessionId: 'room-1', provider: 'codex-cli' }
  const registry = { resolveMemberRun: (token: string) => token === 'live' ? run : undefined } as never

  it('answers with the mode the room gives the member, and nothing without one', async () => {
    const h = host()
    const memberMode = vi.fn(async () => ({ preset: 'dsh-video', cwd: '/home/user/podcast' }))
    h.ctx.provide('room' as never, { receiveMemberMessage: async () => 'sent', memberMode } as never)
    const channel = new MemberChannel(h.ctx, registry, '/home/user/unused.sock', new PresetToolHost(h.ctx))
    expect(await channel.handleModeTools({ token: 'live', modeTools: { list: true } })).toMatchObject({ ok: true, tools: [{ name: 'video_read' }] })
    expect(memberMode).toHaveBeenCalledWith(run)
    expect(await channel.handleModeTools({ token: 'live', modeTools: { call: { name: 'video_read', arguments: {} } } }))
      .toEqual({ ok: true, result: { content: [{ type: 'text', text: 'project: 第3期' }], isError: false } })
    expect(await channel.handleModeTools({ token: 'stale', modeTools: { list: true } })).toMatchObject({ ok: false })
    memberMode.mockResolvedValue(undefined as never)
    expect(await channel.handleModeTools({ token: 'live', modeTools: { list: true } })).toEqual({ ok: true, tools: [] })
  })

  it('the bridge degrades to no mode tools when the host is unreachable', async () => {
    expect(await listModeTools({})).toEqual([])
    expect(await listModeTools({ socket: '/home/user/missing.sock', token: 't' })).toEqual([])
    expect(await callModeTool({ socket: '/home/user/missing.sock', token: 't' }, 'video_read', {})).toMatchObject({ isError: true })
  })

  it('a host-side listing failure is not "no mode": the bridge gets an error to retry on', async () => {
    const h = host()
    h.mount.mockRejectedValue(new Error('preset mount failed'))
    h.ctx.provide('room' as never, { receiveMemberMessage: async () => 'sent', memberMode: async () => ({ preset: 'dsh-video' }) } as never)
    const channel = new MemberChannel(h.ctx, registry, '/home/user/unused.sock', new PresetToolHost(h.ctx))
    expect(await channel.handleModeTools({ token: 'live', modeTools: { list: true } })).toEqual({ ok: false, error: 'mode dsh-video tools could not be listed: preset mount failed' })
    expect(channel.servedModeTools('live')).toBeUndefined()
  })
})

describe('MemberChannel served mode tools (round-start self-heal)', () => {
  const runs: Record<string, { childSessionId: string; parentSessionId: string; provider: string }> = {
    live: { childSessionId: 'child-codex', parentSessionId: 'room-1', provider: 'codex-cli' },
    quiet: { childSessionId: 'child-codex', parentSessionId: 'room-1', provider: 'codex-cli' },
  }
  const registry = { resolveMemberRun: (token: string) => runs[token] } as never

  function channelWithMode(mode: { preset: string } | undefined) {
    const h = host()
    const memberMode = vi.fn(async () => mode)
    h.ctx.provide('room' as never, { receiveMemberMessage: async () => 'sent', memberMode } as never)
    return { h, memberMode, channel: new MemberChannel(h.ctx, registry, '/home/user/unused.sock', new PresetToolHost(h.ctx)) }
  }

  it('records each served list per process and asks for a respawn only after a placeholder', async () => {
    const { channel } = channelWithMode({ preset: 'dsh-video' })
    await channel.handleModeTools({ token: 'live', modeTools: { list: true } })
    expect(channel.servedModeTools('live')).toMatchObject({ served: 'complete', count: 1 })
    expect(await channel.staleModeTools('live')).toBeUndefined()

    // The bridge could not ask and served its placeholder: the next round respawns.
    expect(await channel.handleModeTools({ token: 'live', modeTools: { report: { served: 'placeholder', reason: 'host restarting' } } })).toEqual({ ok: true, recorded: true })
    expect(await channel.staleModeTools('live')).toMatch(/placeholder \(host restarting\)/)

    // The CLI honored list_changed and re-listed: healthy again.
    await channel.handleModeTools({ token: 'live', modeTools: { list: true } })
    expect(await channel.staleModeTools('live')).toBeUndefined()

    // A background probe means the CLI still holds the placeholder, whatever the probe found.
    expect(await channel.handleModeTools({ token: 'live', modeTools: { list: true, probe: true } })).toMatchObject({ ok: true, tools: [{ name: 'video_read' }] })
    expect(channel.servedModeTools('live')).toMatchObject({ served: 'placeholder' })
    expect(await channel.staleModeTools('live')).toMatch(/placeholder/)
  })

  it('keeps a process that never listed, and replaces one whose token is gone', async () => {
    const { channel } = channelWithMode({ preset: 'dsh-video' })
    // A bridge from before reports existed, or a CLI that lists at its first prompt.
    expect(await channel.staleModeTools('quiet')).toBeUndefined()
    expect(await channel.staleModeTools('gone')).toMatch(/no longer registered/)
    // An unknown token's report is refused, never recorded.
    expect(await channel.handleModeTools({ token: 'gone', modeTools: { report: { served: 'placeholder' } } })).toMatchObject({ ok: false })
  })

  it('an empty list is stale only when the member\'s mode has tools now', async () => {
    const { channel, memberMode } = channelWithMode(undefined)
    await channel.handleModeTools({ token: 'live', modeTools: { list: true } })
    expect(channel.servedModeTools('live')).toMatchObject({ served: 'complete', count: 0 })
    // Still no mode: a member without one is never respawned.
    expect(await channel.staleModeTools('live')).toBeUndefined()
    // The room was not ready when it listed; it is now, and the mode has tools.
    memberMode.mockResolvedValue({ preset: 'dsh-video' } as never)
    expect(await channel.staleModeTools('live')).toMatch(/listed no mode tools, but mode dsh-video has 1 now/)
  })
})

