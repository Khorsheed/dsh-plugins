import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as KimiHarnessInvariant from '@khorsheed/dsh-local-agent-kimi/invariant'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

async function mount(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(KimiHarnessInvariant)
  return { ctx }
}

function kimiHarness(over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name: 'kimi',
    displayName: 'Kimi Code',
    homeEnvVar: 'KIMI_CODE_HOME',
    login: { command: 'kimi', args: ['login'] },
    records: { listSessions: async () => [] },
    ...over,
  }
}

describe('local-agent-kimi invariant', () => {
  it('accepts the kimi harness with the pinned home env', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', kimiHarness()) }).not.toThrow()
  })

  it('rejects a kimi harness with a different home env', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', kimiHarness({ homeEnvVar: 'OTHER_HOME' }))
    }).toThrow(/home env/)
  })

  it('ignores other harnesses', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', kimiHarness({ name: 'codex' }))
    }).not.toThrow()
  })
})
