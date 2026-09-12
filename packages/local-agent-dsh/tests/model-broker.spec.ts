/**
 * The dsh model broker: the family's fixed resolution order (override →
 * delegation → settings → host default selection → CLI built-in), the
 * suggestion vocabulary (settings + cliDefault + recent — the host exposes no
 * adapter enumeration, so there is nothing further to discover), the
 * in-flight switch refusal, and retire-on-switch of a live runtime bound to a
 * different model.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { DshModelBroker, type DshModelBrokerDeps } from '../src/model-broker.ts'

/** A broker with every layer overridable. */
function mount(options: {
  settingsModel?: string
  cliDefault?: string
  discovered?: readonly string[]
  recentModels?: readonly string[]
  live?: boolean
  overrides?: Readonly<Record<string, string>>
  records?: Readonly<Record<string, { model?: string }>>
  active?: readonly string[]
  boundModel?: string | undefined | null
} = {}): {
  broker: DshModelBroker
  overrides: Map<string, string>
  retireRuntime: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  ctx.provide('localAgent', {
    activeDelegations: () => options.active ?? [],
    getDelegation: (child: string) => options.records?.[child],
  } as never)
  ctx.provide('logger', { warn: () => {} } as never)
  const overrides = new Map(Object.entries(options.overrides ?? {}))
  const retireRuntime = vi.fn(async () => {})
  const deps: DshModelBrokerDeps = {
    ctx,
    settingsModel: () => options.settingsModel,
    cliDefault: () => options.cliDefault,
    recentModels: () => options.recentModels ?? [],
    discovered: () => options.discovered ?? [],
    live: () => options.live ?? false,
    overrides,
    liveBoundModel: () => options.boundModel === undefined ? null : options.boundModel,
    retireRuntime,
  }
  return { broker: new DshModelBroker(deps), overrides, retireRuntime }
}

const CHILD = 'child-1'

describe('dsh model broker resolution order', () => {
  it('cli-builtin when nothing names a model, with an empty vocabulary', async () => {
    const { broker } = mount()
    const info = await broker.modelInfo()
    expect(info.source).toBe('cli-builtin')
    expect(info.effective).toBeUndefined()
    expect(info.choices).toEqual([])
  })

  it('cli-config from the host default model selection, spelled provider/model', async () => {
    const { broker } = mount({ cliDefault: 'deepseek-official/deepseek-chat' })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({
      source: 'cli-config',
      effective: 'deepseek-official/deepseek-chat',
      cliDefault: 'deepseek-official/deepseek-chat',
    })
  })

  it('settings outrank the host default selection', async () => {
    const { broker } = mount({ cliDefault: 'deepseek-official/deepseek-chat', settingsModel: 'config/model' })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ source: 'settings', effective: 'config/model', settings: 'config/model' })
  })

  it('the delegation model outranks settings; the override outranks the delegation', async () => {
    const { broker } = mount({ settingsModel: 'config/model', overrides: { [CHILD]: 'override/model' } })
    const delegated = await broker.modelInfo(CHILD, 'delegation/model')
    expect(delegated).toMatchObject({ source: 'override', effective: 'override/model', override: 'override/model', delegation: 'delegation/model' })
    const withoutOverride = await broker.modelInfo('child-2', 'delegation/model')
    expect(withoutOverride).toMatchObject({ source: 'delegation', effective: 'delegation/model' })
  })

  it('choices dedupe settings + cliDefault + discovered + recent, in that order', async () => {
    const { broker } = mount({
      settingsModel: 'config/model',
      cliDefault: 'deepseek-official/deepseek-chat',
      discovered: ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-chat'],
      recentModels: ['recent/model', 'config/model'],
    })
    const info = await broker.modelInfo()
    expect(info.choices).toEqual(['config/model', 'deepseek-official/deepseek-chat', 'deepseek-official/deepseek-flash', 'recent/model'])
  })
})

describe('dsh model broker member switching', () => {
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
    await expect(broker.setMemberModel(CHILD, 'other/model')).rejects.toThrow(/进行中/)
    expect(overrides.has(CHILD)).toBe(false)
  })

  it('stores and clears the override; a same-model set is a no-op', async () => {
    const { broker, overrides, retireRuntime } = mount({ boundModel: 'bound/model' })
    await broker.setMemberModel(CHILD, 'bound/model')
    expect(overrides.get(CHILD)).toBe('bound/model')
    const calls = retireRuntime.mock.calls.length
    await broker.setMemberModel(CHILD, 'bound/model')
    expect(retireRuntime.mock.calls.length).toBe(calls)
    await broker.setMemberModel(CHILD, undefined)
    expect(overrides.has(CHILD)).toBe(false)
  })

  it('retires the live runtime when the new effective model differs from the bound one', async () => {
    const { broker, retireRuntime } = mount({ boundModel: 'old/model' })
    await broker.setMemberModel(CHILD, 'new/model')
    expect(retireRuntime).toHaveBeenCalledWith(CHILD)
  })

  it('keeps the runtime when the override names the bound model', async () => {
    const { broker, retireRuntime } = mount({ boundModel: 'same/model' })
    await broker.setMemberModel(CHILD, 'same/model')
    expect(retireRuntime).not.toHaveBeenCalled()
  })

  it('clearing the override falls back to the delegation record before settings', async () => {
    const { broker, retireRuntime } = mount({
      overrides: { [CHILD]: 'override/model' },
      records: { [CHILD]: { model: 'delegation/model' } },
      settingsModel: 'config/model',
      boundModel: 'delegation/model',
    })
    // Clearing returns the member to its recorded delegation model — which the
    // runtime is already bound to, so nothing retires.
    await broker.setMemberModel(CHILD, undefined)
    expect(retireRuntime).not.toHaveBeenCalled()
  })

  it('does not touch a member that has no live runtime', async () => {
    const { broker, retireRuntime } = mount({ boundModel: undefined })
    await broker.setMemberModel(CHILD, 'new/model')
    expect(retireRuntime).not.toHaveBeenCalled()
  })
})
