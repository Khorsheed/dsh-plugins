import { afterEach, describe, expect, it, vi } from 'vitest'

// Preset-registry probe against a host that does not install the module (a
// preset-less host): the dynamic import rejects, the loader settles null, and
// the derivation host stays `{}` — the established no-preset degrade (the
// resume falls back to the deployment's default preset).
const attempts = vi.hoisted(() => ({ registry: 0 }))
vi.mock('@deepseek-ai/dsh-agent-preset-registry', () => {
  attempts.registry += 1
  throw new Error('Cannot find package (not installed)')
})

import {
  deriveSessionPreset,
  loadPresetRegistry,
  preloadPresetDerivationHost,
  presetDerivationHost,
  resetPresetRegistryProbeForTest,
} from '../src/agent-setup.ts'

describe('preset-registry probe with the module not installed', () => {
  afterEach(() => { resetPresetRegistryProbeForTest() })

  it('resolves null instead of throwing when the import rejects', async () => {
    await expect(loadPresetRegistry()).resolves.toBeNull()
    expect(attempts).toEqual({ registry: 1 })
  })

  it('preloads to the empty host, and the derivation degrades to no-preset', async () => {
    await expect(preloadPresetDerivationHost()).resolves.toBeUndefined()
    expect(presetDerivationHost()).toEqual({})
    expect(deriveSessionPreset(presetDerivationHost(), {
      header: { agentPreset: 'from-header' },
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'switched' } }],
    })).toBeUndefined()
  })
})
