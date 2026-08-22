import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'

describe('local-agent-codex apply', () => {
  it('registers the codex harness and provisions a scoped config', async () => {
    const ctx = new Context()
    const registered: LocalAgentHarness[] = []
    const home = mkdtempSync(join(tmpdir(), 'codex-apply-home-'))
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
      name: 'codex',
      displayName: 'Codex',
      homeEnvVar: 'CODEX_HOME',
      delegationProvider: 'codex-local',
      login: { pty: { command: 'codex', args: ['login'] } },
    })
    // The records adapter is exercised end-to-end by the records spec.
    expect(registered[0]?.records).toBeDefined()
    // The scoped home is provisioned with the file-credential config.
    await new Promise(resolve => setTimeout(resolve, 10))
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toContain('cli_auth_credentials_store = "file"')
  })
})
