import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'

describe('local-agent-kimi apply', () => {
  it('registers the kimi harness and provisions a config into the scoped home', () => {
    const ctx = new Context()
    const registered: LocalAgentHarness[] = []
    const home = mkdtempSync(join(tmpdir(), 'kimi-apply-home-'))
    const registry = {
      homeDir: () => home,
      register: (harness: LocalAgentHarness) => {
        registered.push(harness)
        return () => {}
      },
    } as unknown as LocalAgentRegistry
    ctx.provide('localAgent', registry)
    ctx.provide('logger', { warn: () => {} })
    ctx.provide('subagents', { registerProvider: () => {} })
    ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in apply test') } })

    apply(ctx, {})

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'kimi',
      displayName: 'Kimi Code',
      homeEnvVar: 'KIMI_CODE_HOME',
      delegationProvider: 'kimi-cli',
      login: { command: 'kimi', args: ['login'] },
    })
    // The records adapter is exercised end-to-end by the kimi-records spec.
    expect(registered[0]?.records).toBeDefined()
  })
})
