import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolInvariant from '@khorsheed/dsh-local-agent-tool-subagent/invariant'

describe('local-agent-tool-subagent invariant', () => {
  it('mounts without failing (empty installer owning the package name)', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ToolInvariant)).resolves.toBeDefined()
  })
})
