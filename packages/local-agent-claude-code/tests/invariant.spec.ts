import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ClaudeHarnessInvariant from '@khorsheed/dsh-local-agent-claude-code/invariant'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

async function mount(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ClaudeHarnessInvariant)
  return { ctx }
}

function claudeHarness(over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name: 'claude-code',
    displayName: 'Claude Code',
    homeEnvVar: 'CLAUDE_CONFIG_DIR',
    login: { command: 'claude', args: ['auth', 'login'], capture: 'stdout' },
    records: { listSessions: async () => [] },
    ...over,
  }
}

describe('local-agent-claude-code invariant', () => {
  it('accepts the claude-code harness with the pinned home env', async () => {
    const { ctx } = await mount()
    expect(() => { ctx.emit('localAgent/harness-added', claudeHarness()) }).not.toThrow()
  })

  it('rejects a claude-code harness with a different home env', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', claudeHarness({ homeEnvVar: 'OTHER_HOME' }))
    }).toThrow(/home env/)
  })

  it('ignores other harnesses', async () => {
    const { ctx } = await mount()
    expect(() => {
      ctx.emit('localAgent/harness-added', claudeHarness({ name: 'kimi' }))
    }).not.toThrow()
  })
})
