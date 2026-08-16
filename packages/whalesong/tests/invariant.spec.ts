import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WhalesongInvariant from '@khorsheed/dsh-whalesong/invariant'

const PACKAGE_NAME = '@khorsheed/dsh-whalesong'

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(WhalesongInvariant)
  return ctx
}

describe('whalesong invariant', () => {
  it('reserves the package name while mounted', async () => {
    const ctx = await mount()
    // The companion's apply ran register(PACKAGE_NAME, install): the name is
    // reserved, so a second registration fails loud.
    expect(() => ctx.invariants.register(PACKAGE_NAME, () => {})).toThrow(/already registered/)
    await ctx.fiber.dispose()
  })

  it('releases the reservation on dispose', async () => {
    const ctx = await mount()
    await ctx.fiber.dispose()
    // Re-mounting on a fresh root succeeds: disposal freed the reservation.
    const again = await mount()
    await again.fiber.dispose()
  })
})
