import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as FilePreviewInvariant from '@deepseek-ai/dsh-file-preview/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(FilePreviewInvariant)
  return ctx
}

describe('file-preview invariant companion', () => {
  it('claims the package ownership once and rejects a duplicate registration', async () => {
    const ctx = await setup()
    await expect(ctx.plugin(FilePreviewInvariant)).rejects.toThrow(/already registered/)
  })
})
