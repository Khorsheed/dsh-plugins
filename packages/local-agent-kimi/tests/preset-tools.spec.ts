import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { removeLegacyVariants } from '../src/preset-tools.ts'

/** A context whose agentPresets service records remove calls. */
function ctxWithPresets(removed: string[]): Context {
  return {
    get: (name: string) => name === 'agentPresets'
      ? { remove: async (id: string) => { removed.push(id) } }
      : undefined,
  } as unknown as Context
}

describe('preset-tools legacy cleanup', () => {
  it('removes every legacy variant preset', async () => {
    const removed: string[] = []
    await removeLegacyVariants(ctxWithPresets(removed))
    expect(removed.sort()).toEqual(['code-kimi', 'kimi', 'minimal-kimi', 'standard-kimi'])
  })

  it('tolerates a variant that never existed', async () => {
    const removed: string[] = []
    const ctx = {
      get: (name: string) => name === 'agentPresets'
        ? {
          remove: async (id: string) => {
            if (id === 'standard-kimi') throw Object.assign(new Error('not found'), { code: 'ENOENT' })
            removed.push(id)
          },
        }
        : undefined,
    } as unknown as Context
    await removeLegacyVariants(ctx)
    expect(removed.sort()).toEqual(['code-kimi', 'kimi', 'minimal-kimi'])
  })

  it('is a no-op when the agent-presets service is absent', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(removeLegacyVariants(ctx)).resolves.toBeUndefined()
  })

  it('rethrows a non-ENOENT remove failure', async () => {
    const ctx = {
      get: () => ({
        remove: async () => { throw new Error('roster locked') },
      }),
    } as unknown as Context
    await expect(removeLegacyVariants(ctx)).rejects.toThrow('roster locked')
  })
})
