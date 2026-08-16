import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE } from '@khorsheed/dsh-local-agent'

/** Mount the registry stack and return the live registry. */
async function mountRegistry(): Promise<localAgent.LocalAgentRegistry> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(localAgent, { homesRoot: mkdtempSync(join(tmpdir(), 'delegation-homes-')) })
  return ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
}

describe('LocalAgentRegistry delegation registry', () => {
  it('records a delegation and resolves it for the owning parent and provider', async () => {
    const registry = await mountRegistry()
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    expect(registry.resolveDelegation('child-1', { provider: 'kimi-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_42' })
    expect(registry.listDelegations()).toHaveLength(1)
  })

  it('rejects an unknown child session handle', async () => {
    const registry = await mountRegistry()
    expect(() => registry.resolveDelegation('child-missing', { provider: 'kimi-cli', parentSessionId: 'parent-1' }))
      .toThrow(/no delegation recorded/)
  })

  it('rejects a handle owned by another parent session', async () => {
    const registry = await mountRegistry()
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    // A forged handle naming a child another parent delegated must not resume
    // that conversation: the caller's parent session must be the recorded one.
    expect(() => registry.resolveDelegation('child-1', { provider: 'kimi-cli', parentSessionId: 'parent-2' }))
      .toThrow(/belongs to another parent/)
  })

  it('rejects a handle claimed through the wrong provider', async () => {
    const registry = await mountRegistry()
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    expect(() => registry.resolveDelegation('child-1', { provider: 'claude-local', parentSessionId: 'parent-1' }))
      .toThrow(/was delegated through kimi-cli/)
  })

  it('stages and consumes delegation intents in FIFO order per parent and provider', async () => {
    const registry = await mountRegistry()
    registry.stageDelegationIntent('parent-1', 'kimi-cli', { kind: 'fresh' })
    registry.stageDelegationIntent('parent-1', 'kimi-cli', {
      kind: 'resume',
      childSessionId: 'child-1',
      cliSessionId: 'session_42',
    })

    expect(registry.takeDelegationIntent('parent-1', 'kimi-cli')).toEqual({ kind: 'fresh' })
    expect(registry.takeDelegationIntent('parent-1', 'kimi-cli')).toEqual({
      kind: 'resume',
      childSessionId: 'child-1',
      cliSessionId: 'session_42',
    })
    // The queue is empty again: a direct start without the family tool is fresh.
    expect(registry.takeDelegationIntent('parent-1', 'kimi-cli')).toBeUndefined()
  })

  it('keeps delegation intent queues separate per parent and provider', async () => {
    const registry = await mountRegistry()
    registry.stageDelegationIntent('parent-1', 'kimi-cli', { kind: 'fresh' })
    registry.stageDelegationIntent('parent-2', 'kimi-cli', {
      kind: 'resume',
      childSessionId: 'child-2',
      cliSessionId: 'session_7',
    })

    // A different parent's queue does not consume parent-1's intent.
    expect(registry.takeDelegationIntent('parent-2', 'kimi-cli')).toEqual({
      kind: 'resume',
      childSessionId: 'child-2',
      cliSessionId: 'session_7',
    })
    expect(registry.takeDelegationIntent('parent-1', 'kimi-cli')).toEqual({ kind: 'fresh' })
    expect(registry.takeDelegationIntent('parent-1', 'claude-local')).toBeUndefined()
  })

  it('tracks the kimi mirror offset per child session', async () => {
    const registry = await mountRegistry()
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    expect(registry.kimiMirroredLines('child-1')).toBeUndefined()
    registry.setKimiMirroredLines('child-1', 12)
    expect(registry.kimiMirroredLines('child-1')).toBe(12)
    registry.setKimiMirroredLines('child-1', 20)
    expect(registry.kimiMirroredLines('child-1')).toBe(20)
    // A record without a child session ignores the offset update.
    registry.setKimiMirroredLines('child-missing', 3)
    expect(registry.kimiMirroredLines('child-missing')).toBeUndefined()
  })

  it('replaces a duplicate child session record with the newer mapping', async () => {
    const registry = await mountRegistry()
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'kimi-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_99',
    })

    expect(registry.resolveDelegation('child-1', { provider: 'kimi-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_99' })
    expect(registry.listDelegations()).toHaveLength(1)
  })
})
