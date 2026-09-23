import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CodexModelBroker } from '../src/model-broker.ts'
import type { LocalAgentModelDirectory, LocalAgentMemberBinding, LocalAgentMemberConfiguration } from '@khorsheed/dsh-local-agent/types'

describe('Codex configuration admission adapter', () => {
  it('resolves inheritance separately from harness defaults and validates native efforts for the selected model', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-admission-'))
    writeFileSync(join(home, 'config.toml'), 'model = "config-model"\nmodel_reasoning_effort = "low"\n')
    const ctx = new Context()
    const homeDir = vi.fn(() => home)
    const retireRuntime = vi.fn(async () => {})
    ctx.provide('localAgent', { homeDir, activeDelegations: () => [], getDelegation: () => undefined } as never)
    const directory: LocalAgentModelDirectory = {
      entries: ['created-model', 'setting-model'].map(value => ({ value, label: value, source: 'native', reasoning: { default: 'medium', options: ['low', 'medium', 'high'].map(value => ({ value, label: value })) } })),
      complete: true, customInput: true, status: 'ready', refreshing: false, revision: 1,
    }
    const broker = new CodexModelBroker({
      ctx, settingsModel: () => 'setting-model', recentModels: () => [], catalog: () => [], catalogDefault: () => undefined,
      homeDir: () => home, directory: () => directory, live: () => true, overrides: new Map(), liveBoundModel: () => null, retireRuntime,
    })
    const binding: LocalAgentMemberBinding = { childSessionId: 'member', provider: 'codex-local', parentSessionId: 'parent', cwd: '/home/user/work', scope: 'private', model: 'created-model', effort: 'high' }
    const adapter = broker.configurationAdapter(binding)
    const inherit: LocalAgentMemberConfiguration = { model: { mode: 'inherit' }, effort: { mode: 'inherit' } }
    const defaults: LocalAgentMemberConfiguration = { model: { mode: 'default' }, effort: { mode: 'default' } }
    expect(await adapter.prepare!(inherit)).toEqual({ model: 'created-model', effort: 'high' })
    expect(await adapter.prepare!(defaults)).toEqual({ model: 'setting-model', effort: 'low' })
    expect(homeDir).toHaveBeenCalledWith('codex', 'private')
    await expect(adapter.validate({ ...inherit, effort: { mode: 'value', value: 'unsupported' } })).rejects.toThrow('not advertised')
    expect(retireRuntime).not.toHaveBeenCalled()
    const applied = await adapter.apply(defaults, { revision: 0, selection: inherit, resolved: {} }, 'selection-1')
    expect(applied).toEqual({ model: 'setting-model', effort: 'low' })
    expect(retireRuntime).toHaveBeenCalledWith('member')
  })
})
