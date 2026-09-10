import { appendFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { DELEGATIONS_FILENAME, LOCAL_AGENT_SERVICE } from '@khorsheed/dsh-local-agent'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

/** A harness delegating through the named provider. */
function harness(provider: string | undefined): LocalAgentHarness {
  return {
    name: 'fake',
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    ...provider === undefined ? {} : { delegationProvider: provider },
    records: { listSessions: async () => [] },
  }
}

interface Mounted {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
}

/**
 * Mount the registry stack over a GIVEN homesRoot (two mounts over the same
 * root simulate a host restart).
 */
async function mountRegistry(homesRoot: string): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(localAgent, { homesRoot })
  return { ctx, registry: ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry }
}

describe('LocalAgentRegistry delegation persistence', () => {
  it('serves a recorded delegation and the kimi mirror offset after a restart', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'fake-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })
    first.registry.setKimiMirroredLines('child-1', 12)

    // "Restart": a fresh registry over the same homesRoot.
    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))

    expect(second.registry.resolveDelegation('child-1', { provider: 'fake-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_42' })
    // The mirror offset persisted WITH the record, so a resumed round mirrors
    // only its delta instead of re-mirroring round 1.
    expect(second.registry.kimiMirroredLines('child-1')).toBe(12)
  })

  it('keeps the ownership checks on restored records', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'fake-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))

    expect(() => second.registry.resolveDelegation('child-1', { provider: 'fake-cli', parentSessionId: 'parent-2' }))
      .toThrow(/belongs to another parent/)
    expect(() => second.registry.resolveDelegation('child-1', { provider: 'other-cli', parentSessionId: 'parent-1' }))
      .toThrow(/was delegated through fake-cli/)
    expect(() => second.registry.resolveDelegation('child-missing', { provider: 'fake-cli', parentSessionId: 'parent-1' }))
      .toThrow(/no delegation recorded/)
  })

  it('applies replace semantics across a restart: the later record wins', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
    })
    first.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_99',
    })

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))

    expect(second.registry.resolveDelegation('child-1', { provider: 'fake-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_99' })
    expect(second.registry.listDelegations()).toHaveLength(1)
  })

  it('skips malformed and foreign-provider lines with a warn, loading valid siblings', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
    })
    const file = join(homesRoot, 'fake', DELEGATIONS_FILENAME)
    appendFileSync(file, 'not json at all{\n')
    appendFileSync(file, `${JSON.stringify({
      childSessionId: 'child-foreign', provider: 'other-cli', parentSessionId: 'parent-1', cliSessionId: 'session_x',
    })}\n`)
    appendFileSync(file, `${JSON.stringify({
      childSessionId: 'child-2', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_43',
    })}\n`)

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))

    // Valid siblings load; the malformed line and the foreign-provider line
    // are skipped with a warn each, and registration did not fail.
    expect(second.registry.resolveDelegation('child-1', { provider: 'fake-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_42' })
    expect(second.registry.resolveDelegation('child-2', { provider: 'fake-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_43' })
    expect(() => second.registry.resolveDelegation('child-foreign', { provider: 'other-cli', parentSessionId: 'parent-1' }))
      .toThrow(/no delegation recorded/)
  })

  it('keeps an unclaimed provider\'s record in memory, warns, and never throws', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const mounted = await mountRegistry(homesRoot)
    mounted.registry.register(harness('fake-cli'))

    expect(() => mounted.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'unclaimed-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
    })).not.toThrow()
    // The in-memory record still resolves for this process's lifetime.
    expect(mounted.registry.resolveDelegation('child-1', { provider: 'unclaimed-cli', parentSessionId: 'parent-1' }))
      .toEqual({ cliSessionId: 'session_42' })
    // Nothing was written to disk: no harness owns the mapping.
    expect(existsSync(join(homesRoot, 'fake', DELEGATIONS_FILENAME))).toBe(false)
  })

  it('persists the advanced kimi mirror offset with the record', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
    })
    first.registry.setKimiMirroredLines('child-1', 12)
    first.registry.setKimiMirroredLines('child-1', 20)

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))
    expect(second.registry.kimiMirroredLines('child-1')).toBe(20)
  })
  it('loads records carrying observedModel and cwd, and old records without them', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-new', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
      cwd: '/cell-a', observedModel: 'gpt-5.6-sol',
    })
    // A record written before the fields existed loads unchanged — absence
    // stays absence, no guessing.
    appendFileSync(join(homesRoot, 'fake', DELEGATIONS_FILENAME), `${JSON.stringify({
      childSessionId: 'child-old', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_7',
    })}\n`)

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))

    expect(second.registry.delegationOf('child-new')).toEqual({
      childSessionId: 'child-new', provider: 'fake-cli', parentSessionId: 'parent-1',
      cwd: '/cell-a', observedModel: 'gpt-5.6-sol',
    })
    expect(second.registry.delegationOf('child-old')).toEqual({
      childSessionId: 'child-old', provider: 'fake-cli', parentSessionId: 'parent-1',
    })
  })

  it('persists the delegation\u2019s REQUESTED model, so a resume after a restart still asks for it', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-model', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_9',
      cwd: '/cell-a', model: 'model-a',
    })
    // A delegation that named none stays that way — which every record
    // written before the field existed is.
    appendFileSync(join(homesRoot, 'fake', DELEGATIONS_FILENAME), `${JSON.stringify({
      childSessionId: 'child-plain', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_10',
    })}\n`)

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))
    expect(second.registry.getDelegation('child-model')).toMatchObject({ model: 'model-a' })
    const plain = second.registry.getDelegation('child-plain')
    expect(plain).toBeDefined()
    expect('model' in (plain as object)).toBe(false)
  })

  it('persists a settled observedModel merge with the record', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'delegation-persist-'))
    const first = await mountRegistry(homesRoot)
    first.registry.register(harness('fake-cli'))
    first.registry.recordDelegation({
      childSessionId: 'child-1', provider: 'fake-cli', parentSessionId: 'parent-1', cliSessionId: 'session_42',
    })
    first.registry.recordRoundSettled('child-1', { observedModel: 'claude-opus-5[1m]' })

    const second = await mountRegistry(homesRoot)
    second.registry.register(harness('fake-cli'))
    expect(second.registry.delegationOf('child-1')).toMatchObject({ observedModel: 'claude-opus-5[1m]' })
  })
})
