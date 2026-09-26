import { afterEach, describe, expect, it, vi } from 'vitest'

// Dual-name probe against a host that installs NEITHER name (a preset-less
// host): both dynamic imports reject, the loader settles null, and the
// derivation host stays `{}` — the established no-preset degrade (the resume
// falls back to the deployment's default preset).
const attempts = vi.hoisted(() => ({ registry: 0, presets: 0 }))
vi.mock('@deepseek-ai/dsh-agent-preset-registry', () => {
  attempts.registry += 1
  throw new Error('Cannot find package (new name not installed)')
})
vi.mock('@deepseek-ai/dsh-agent-presets', () => {
  attempts.presets += 1
  throw new Error('Cannot find package (old name not installed)')
})

import {
  deriveSessionPreset,
  loadPresetRegistry,
  preloadPresetDerivationHost,
  presetDerivationHost,
  resetPresetRegistryProbeForTest,
} from '../src/agent-setup.ts'

describe('preset-registry dual-name probe with neither name installed', () => {
  afterEach(() => { resetPresetRegistryProbeForTest() })

  it('resolves null instead of throwing when both names reject', async () => {
    await expect(loadPresetRegistry()).resolves.toBeNull()
    expect(attempts).toEqual({ registry: 1, presets: 1 })
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
