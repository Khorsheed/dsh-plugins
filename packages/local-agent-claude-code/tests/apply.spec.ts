import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'

describe('local-agent-claude-code apply', () => {
  it('registers the claude-code harness and provisions a scoped home', async () => {
    const ctx = new Context()
    const registered: LocalAgentHarness[] = []
    const home = mkdtempSync(join(tmpdir(), 'claude-apply-home-'))
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
      name: 'claude-code',
      displayName: 'Claude Code',
      homeEnvVar: 'CLAUDE_CONFIG_DIR',
      delegationProvider: 'claude-local',
      login: { command: 'claude', args: ['auth', 'login'], capture: 'stdout' },
    })
    expect(registered[0]?.records).toBeDefined()
    // The scoped home is provisioned eagerly.
    await new Promise(resolve => setTimeout(resolve, 10))
    const { access } = await import('node:fs/promises')
    await expect(access(home)).resolves.toBeUndefined()
  })
})
