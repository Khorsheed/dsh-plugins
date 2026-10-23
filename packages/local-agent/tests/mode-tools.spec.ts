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

/** Fake host services: one preset whose scope sees a plugin tool, a room tool, a built-in and an untagged one. */
function host() {
  const ctx = new Context()
  const agent = { id: 'preset-agent' }
  const create = vi.fn(async (options: { setup: (ctx: Context) => Promise<void>; meta: { agentPreset: string } }) => {
    await options.setup(ctx)
    return { agent, dispose: vi.fn(async () => {}) }
  })
  const mount = vi.fn(async () => {})
  const definitions = new Map<string, object>([
    ['video_read', tagged('video_read', '@khorsheed/dsh-video-studio')],
    ['room_read', tagged('room_read', '@khorsheed/dsh-room')],
    ['bash', tagged('bash', 'builtin', 'builtin')],
    ['plain', { name: 'plain' }],
  ])
  const execute = vi.fn(async (_exec: { name: string; agent: object }) => ({ isError: false, content: [{ type: 'text', text: 'project: 第3期' }] }))
  ctx.provide('agents' as never, { create } as never)
  ctx.provide('agentPresets' as never, { resolve: async (id?: string) => ({ id: id ?? 'default' }), mount } as never)
  ctx.provide('tools' as never, {
    schemas: (scope?: object) => scope === agent ? [...definitions.keys()].map(name => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {} } })) : [],
    get: (name: string, scope?: object) => scope === agent ? definitions.get(name) : undefined,
    execute,
  } as never)
  return { ctx, agent, create, mount, execute }
}

describe('PresetToolHost', () => {
  it('lists only the mode\'s plugin tools, from one model-less preset agent per member', async () => {
    const h = host()
    const tools = new PresetToolHost(h.ctx)
    expect(await tools.list('child-codex', 'dsh-video', '/home/user/podcast')).toEqual([
      { name: 'video_read', description: 'video_read tool', inputSchema: { type: 'object', properties: {} } },
    ])
    await tools.list('child-codex', 'dsh-video')
    expect(h.create).toHaveBeenCalledOnce()
    expect(h.create.mock.calls[0]![0]).toMatchObject({ meta: { agentPreset: 'dsh-video', cwd: '/home/user/podcast' } })
    expect(h.mount).toHaveBeenCalledWith(h.ctx, 'dsh-video')
  })

  it('runs a plugin tool through the registry as the preset agent; refuses anything else', async () => {
    const h = host()
    const tools = new PresetToolHost(h.ctx)
    const signal = new AbortController().signal
    expect(await tools.call('child-codex', 'dsh-video', 'video_read', { project: 'p' }, signal))
      .toEqual({ content: [{ type: 'text', text: 'project: 第3期' }], isError: false })
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'video_read', arguments: { project: 'p' }, agent: h.agent, signal }))
    expect(await tools.call('child-codex', 'dsh-video', 'bash', {}, signal)).toMatchObject({ isError: true })
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('a host without presets offers nothing', async () => {
    const tools = new PresetToolHost(new Context())
    expect(await tools.list('child', 'dsh-video')).toEqual([])
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
