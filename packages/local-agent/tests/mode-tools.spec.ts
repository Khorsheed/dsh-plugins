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

const ORIGIN = Symbol.for('dsh.tool.origin')
const tagged = (name: string, owner: string, channel = 'plugin') => ({ name, [ORIGIN]: { channel, owner } })

/** Fake host services: the member's live session, one preset whose scope sees a plugin tool, a room tool, a family tool, a built-in and an untagged one. */
function host() {
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
  const execute = vi.fn(async (_exec: { name: string; agent: { id: string; session: unknown } }) => ({ isError: false, content: [{ type: 'text', text: 'project: 第3期' }] }))
  ctx.provide('sessions' as never, { get: (id: string) => id === 'child-codex' ? session : undefined } as never)
  ctx.provide('agentPresets' as never, { resolve: async (id?: string) => ({ id: id ?? 'default' }), mount } as never)
  ctx.provide('tools' as never, {
    schemas: (scope?: object) => inScope(scope) ? [...definitions.keys()].map(name => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {} } })) : [],
    get: (name: string, scope?: object) => inScope(scope) ? definitions.get(name) : undefined,
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
    expect(await tools.call('child-codex', 'dsh-video', 'bash', {}, signal)).toMatchObject({ isError: true })
    expect(h.execute).toHaveBeenCalledOnce()
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
})
