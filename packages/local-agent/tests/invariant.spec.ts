import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as LocalAgentInvariant from '@khorsheed/dsh-local-agent/invariant'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness, type LocalAgentRegistry } from '@khorsheed/dsh-local-agent'

async function mount(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(LocalAgentInvariant)
  return { ctx }
}

/** Stub localAgent registry plus loader/subagents services for the cross-check. */
function crossCheckContext(harness: LocalAgentHarness, mountedProviders: readonly string[]): Context {
  const ctx = new Context()
  const registry = {
    list: () => [harness.name],
    get: (name: string) => (name === harness.name ? harness : undefined),
  } as unknown as LocalAgentRegistry
  ctx.provide(LOCAL_AGENT_SERVICE, registry)
  ctx.provide('loader', { await: async () => {} })
  ctx.provide('subagents', { getProvider: (name: string) => mountedProviders.includes(name) ? {} : undefined })
  return ctx
}

function harness(name: string, over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name,
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    login: { command: 'fake', args: ['login'] },
    records: { listSessions: async () => [] },
    ...over,
  }
}

describe('local-agent invariant', () => {
  it('rejects a harness with an invalid name', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', harness('Bad Name')) }).toThrow(/invalid name/)
  })

  it('rejects a repeated harness name', async () => {
    const { ctx } = await mount()
    ctx.emit('localAgent/harness-added', harness('kimi'))
    expect(() => { ctx.emit('localAgent/harness-added', harness('kimi')) }).toThrow(/repeats name/)
  })

  it('rejects a harness without a home environment variable', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', harness('kimi', { homeEnvVar: '' })) }).toThrow(/empty homeEnvVar/)
  })

  it('accepts a valid registration and a matching removal', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', harness('kimi')) }).not.toThrow()
    expect(() => { ctx.emit('localAgent/harness-removed', 'kimi') }).not.toThrow()
  })

  it('rejects removal of a harness never registered', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-removed', 'codex') }).toThrow(/unknown harness/)
  })
})

describe('local-agent delegation cross-check', () => {
  it('fails loud when a harness names a delegation provider that is not mounted', async () => {
    const ctx = crossCheckContext(harness('kimi', { delegationProvider: 'kimi-acp' }), [])
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocalAgentInvariant)).rejects.toThrow(/not mounted/)
  })

  it('accepts a harness whose delegation provider is mounted', async () => {
    const ctx = crossCheckContext(harness('kimi', { delegationProvider: 'kimi-acp' }), ['kimi-acp'])
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocalAgentInvariant)).resolves.toBeDefined()
  })

  it('skips a harness without a delegation provider', async () => {
    const ctx = crossCheckContext(harness('kimi'), [])
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocalAgentInvariant)).resolves.toBeDefined()
  })

  it('skips the check when the subagent seam is absent', async () => {
    const ctx = new Context()
    const registry = {
      list: () => ['kimi'],
      get: (name: string) => (name === 'kimi' ? harness('kimi', { delegationProvider: 'kimi-acp' }) : undefined),
    } as unknown as LocalAgentRegistry
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('loader', { await: async () => {} })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocalAgentInvariant)).resolves.toBeDefined()
  })
})
