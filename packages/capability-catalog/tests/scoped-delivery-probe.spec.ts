import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

// Dual-name probe against a host that installs NEITHER name (a preset-less
// host): both dynamic imports reject, the loader settles null, and the
// delivery starts anyway with liveKeys() reporting nothing live — the same
// degrade the call's own catch encodes.
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
  loadPresetRegistry,
  resetPresetRegistryProbeForTest,
  scopedSkillsRoot,
  ScopedSkillDelivery,
  type ScopedDeliveryRegistry,
} from '../src/scoped-delivery.ts'
import type { PresetRosterSlice } from '../src/preset-scope.ts'

/** One scoped managed SKILL.md (mirrors scoped-delivery.spec's helper). */
function skillText(name: string, scope: string): string {
  return ['---', `name: ${name}`, `description: The ${name} skill`, 'metadata:', `  presetScope: ${scope}`, '---', '', `# ${name}`, ''].join('\n')
}

describe('ScopedSkillDelivery with neither preset-registry name installed', () => {
  afterEach(() => { resetPresetRegistryProbeForTest() })

  it('the probe resolves null instead of throwing when both names reject', async () => {
    await expect(loadPresetRegistry()).resolves.toBeNull()
    expect(attempts).toEqual({ registry: 1, presets: 1 })
  })

  it('start() completes, liveKeys() reports nothing live, and delivery is unaffected', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-probe-'))
    const ctx = new Context()
    const delivery = new ScopedSkillDelivery(ctx, {
      dshHome: () => home,
      roster: () => ctx.get('agentPresets') as PresetRosterSlice,
      registry: () => ctx.get('skills') as unknown as ScopedDeliveryRegistry,
      log: () => {},
    })
    try {
      const root = scopedSkillsRoot(home)
      await mkdir(join(root, 'md-to-wechat'), { recursive: true })
      await writeFile(join(root, 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', '[dsh-writing]'))
      const keys = new Map<string, ScopeKey>([['dsh-writing', { agentPreset: 'dsh-writing' }]])
      const roster: PresetRosterSlice = {
        defaultId: 'standard',
        standingKeyFor: vi.fn(async (id?: string) => keys.get(id ?? 'standard')),
      }
      ctx.provide('agentPresets', roster as never)
      await ctx.plugin(SkillRegistry)

      await delivery.start()
      expect(delivery.status().enabled).toBe(true)
      // Neither name resolved: no mount list, so nothing is KNOWN to be live.
      const live = (delivery as unknown as { liveKeys(): Set<ScopeKey> }).liveKeys()
      expect(live.size).toBe(0)
      // The delivery itself is unaffected: the skill still lands in its layer.
      const names = (await ctx.skills.snapshot({ scope: keys.get('dsh-writing') })).skills.map(skill => skill.name)
      expect(names).toContain('md-to-wechat')
    } finally {
      await delivery.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
