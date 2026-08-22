import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as CodexHarnessInvariant from '@khorsheed/dsh-local-agent-codex/invariant'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

async function mount(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(CodexHarnessInvariant)
  return { ctx }
}

function codexHarness(over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name: 'codex',
    displayName: 'Codex',
    homeEnvVar: 'CODEX_HOME',
    login: { pty: { command: 'codex', args: ['login'] } },
    records: { listSessions: async () => [] },
    ...over,
  }
}

describe('local-agent-codex invariant', () => {
  it('accepts the codex harness with the pinned home env', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', codexHarness()) }).not.toThrow()
  })

  it('rejects a codex harness with a different home env', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', codexHarness({ homeEnvVar: 'OTHER_HOME' }))
    }).toThrow(/home env/)
  })

  it('ignores other harnesses', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', codexHarness({ name: 'kimi' }))
    }).not.toThrow()
  })
})
