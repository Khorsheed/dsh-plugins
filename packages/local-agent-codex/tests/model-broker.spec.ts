/**
 * The codex model broker: the family's fixed resolution order (override →
 * delegation → settings → scoped config → CLI built-in), the suggestion
 * vocabulary (settings + cliDefault + config-discovered + the probed account
 * catalog + recent, deduped, never a hardcoded catalog), the in-flight
 * switch refusal, and retire-on-switch of a live runtime bound to a
 * different model.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CodexModelBroker, type CodexModelBrokerDeps } from '../src/model-broker.ts'

/** A broker over a tmp scoped home, with every layer overridable. */
function mount(options: {
  configToml?: string
  settingsModel?: string
  recentModels?: readonly string[]
  catalog?: readonly string[]
  live?: boolean
  overrides?: Readonly<Record<string, string>>
  records?: Readonly<Record<string, { model?: string }>>
  active?: readonly string[]
  boundModel?: string | undefined | null
} = {}): {
  broker: CodexModelBroker
  overrides: Map<string, string>
  retireRuntime: ReturnType<typeof vi.fn>
} {
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-broker-'))
  if (options.configToml !== undefined) writeFileSync(join(homeDir, 'config.toml'), options.configToml)
  const ctx = new Context()
  ctx.provide('localAgent', {
    activeDelegations: () => options.active ?? [],
    getDelegation: (child: string) => options.records?.[child],
  } as never)
  ctx.provide('logger', { warn: () => {} } as never)
  const overrides = new Map(Object.entries(options.overrides ?? {}))
  const retireRuntime = vi.fn(async () => {})
  const deps: CodexModelBrokerDeps = {
    ctx,
    settingsModel: () => options.settingsModel,
    recentModels: () => options.recentModels ?? [],
    catalog: () => options.catalog ?? [],
    homeDir: () => homeDir,
    live: () => options.live ?? false,
    overrides,
    liveBoundModel: () => options.boundModel === undefined ? null : options.boundModel,
    retireRuntime,
  }
  return { broker: new CodexModelBroker(deps), overrides, retireRuntime }
}

const CHILD = 'child-1'

describe('codex model broker resolution order', () => {
  it('cli-builtin when nothing names a model, with an empty vocabulary', async () => {
    const { broker } = mount()
    const info = await broker.modelInfo()
    expect(info.source).toBe('cli-builtin')
    expect(info.effective).toBeUndefined()
    expect(info.choices).toEqual([])
  })

  it('cli-config from the scoped config.toml top-level model', async () => {
    const { broker } = mount({ configToml: 'model = "gpt-5.2"\n' })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ source: 'cli-config', effective: 'gpt-5.2', cliDefault: 'gpt-5.2' })
  })

  it('settings outrank the scoped config', async () => {
    const { broker } = mount({ configToml: 'model = "gpt-5.2"\n', settingsModel: 'config-model' })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ source: 'settings', effective: 'config-model', settings: 'config-model' })
  })

  it('the delegation model outranks settings; the override outranks the delegation', async () => {
    const { broker } = mount({ settingsModel: 'config-model', overrides: { [CHILD]: 'override-model' } })
    const delegated = await broker.modelInfo(CHILD, 'delegation-model')
    expect(delegated).toMatchObject({ source: 'override', effective: 'override-model', override: 'override-model', delegation: 'delegation-model' })
    const withoutOverride = await broker.modelInfo('child-2', 'delegation-model')
    expect(withoutOverride).toMatchObject({ source: 'delegation', effective: 'delegation-model' })
  })

  it('choices dedupe settings + cliDefault + config-discovered + recent, in that order', async () => {
    const { broker } = mount({
      configToml: [
        'model = "gpt-5.2"',
        '',
        '[profiles.fast]',
        'model = "gpt-5.1"',
        '',
        '[profiles.deep]',
        'model = "gpt-5.2"',
        '',
        '[model_providers.router]',
        'base_url = "https://proxy.example.com/v1"',
        '',
      ].join('\n'),
      settingsModel: 'config-model',
      recentModels: ['recent-model', 'gpt-5.1'],
    })
    const info = await broker.modelInfo()
    // The provider table names an endpoint, not a model — never a choice.
    expect(info.choices).toEqual(['config-model', 'gpt-5.2', 'gpt-5.1', 'recent-model'])
  })

  it('choices rank the probed account catalog ahead of recent models, deduped', async () => {
    const { broker } = mount({
      configToml: 'model = "gpt-5.2"\n',
      catalog: ['gpt-5.6-sol', 'gpt-5.2'],
      recentModels: ['recent-model', 'gpt-5.6-sol'],
    })
    const info = await broker.modelInfo()
    expect(info.choices).toEqual(['gpt-5.2', 'gpt-5.6-sol', 'recent-model'])
  })
})

describe('codex model broker member switching', () => {
  it('reports the member not switchable while a round is in flight', async () => {
    const { broker } = mount({ active: [CHILD] })
    const info = await broker.modelInfo(CHILD)
    expect(info.switchable).toBe(false)
    expect(info.reason).toBeTruthy()
    const idle = await broker.modelInfo('child-2')
    expect(idle.switchable).toBe(true)
  })

  it('setMemberModel refuses while a round is in flight', async () => {
    const { broker, overrides } = mount({ active: [CHILD] })
    await expect(broker.setMemberModel(CHILD, 'model-b')).rejects.toThrow(/进行中/)
    expect(overrides.has(CHILD)).toBe(false)
  })

  it('stores and clears the override; a same-model set is a no-op', async () => {
    const { broker, overrides, retireRuntime } = mount({ boundModel: 'model-b' })
    await broker.setMemberModel(CHILD, 'model-b')
    expect(overrides.get(CHILD)).toBe('model-b')
    const calls = retireRuntime.mock.calls.length
    await broker.setMemberModel(CHILD, 'model-b')
    expect(retireRuntime.mock.calls.length).toBe(calls)
    await broker.setMemberModel(CHILD, undefined)
    expect(overrides.has(CHILD)).toBe(false)
  })

  it('retires the live runtime when the new effective model differs from the bound one', async () => {
    const { broker, retireRuntime } = mount({ boundModel: 'model-a' })
    await broker.setMemberModel(CHILD, 'model-b')
    expect(retireRuntime).toHaveBeenCalledWith(CHILD)
  })

  it('keeps the runtime when the override names the bound model', async () => {
    const { broker, retireRuntime } = mount({ boundModel: 'model-a' })
    await broker.setMemberModel(CHILD, 'model-a')
    expect(retireRuntime).not.toHaveBeenCalled()
  })

  it('clearing the override falls back to the delegation record before settings', async () => {
    const { broker, retireRuntime } = mount({
      overrides: { [CHILD]: 'override-model' },
      records: { [CHILD]: { model: 'delegation-model' } },
      settingsModel: 'config-model',
      boundModel: 'delegation-model',
    })
    // Clearing returns the member to its recorded delegation model — which the
    // runtime is already bound to, so nothing retires.
    await broker.setMemberModel(CHILD, undefined)
    expect(retireRuntime).not.toHaveBeenCalled()
  })

  it('does not touch a member that has no live runtime', async () => {
    const { broker, retireRuntime } = mount({ boundModel: undefined })
    await broker.setMemberModel(CHILD, 'model-b')
    expect(retireRuntime).not.toHaveBeenCalled()
  })
})
