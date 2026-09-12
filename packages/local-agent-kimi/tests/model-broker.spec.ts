/**
 * The kimi model broker: the family's fixed resolution order (override →
 * delegation → settings → scoped-config default → CLI built-in), the choices
 * vocabulary, the in-flight switch refusal, and the retire-on-switch runtime
 * handoff (same-model sets stay no-ops).
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { KimiModelBroker } from '../src/model-broker.ts'
import type { LiveDriverSwitch } from '../src/live-switch.ts'

interface Mount {
  broker: KimiModelBroker
  home: string
  active: string[]
  settings: { model?: string; live: boolean; recent: string[] }
  liveSwitch: {
    memberHasRuntime: ReturnType<typeof vi.fn>
    memberRuntimeModel: ReturnType<typeof vi.fn>
    retireMemberRuntime: ReturnType<typeof vi.fn>
  }
}

function mount(over: { settingsModel?: string; live?: boolean; recent?: string[]; config?: string } = {}): Mount {
  const home = mkdtempSync(join(tmpdir(), 'kimi-broker-'))
  if (over.config !== undefined) writeFileSync(join(home, 'config.toml'), over.config)
  const active: string[] = []
  const settings = { model: over.settingsModel, live: over.live ?? false, recent: over.recent ?? [] }
  const ctx = new Context()
  ctx.provide('localAgent', {
    activeDelegations: () => active,
  } as never)
  const liveSwitch = {
    memberHasRuntime: vi.fn(() => false),
    memberRuntimeModel: vi.fn(() => undefined as string | undefined),
    retireMemberRuntime: vi.fn(async () => {}),
  }
  const broker = new KimiModelBroker(ctx, {
    homeDir: () => home,
    settingsModel: () => settings.model,
    recentModels: () => settings.recent,
    isLive: () => settings.live,
    liveSwitch: liveSwitch as unknown as LiveDriverSwitch,
  })
  return { broker, home, active, settings, liveSwitch }
}

const CONFIG = [
  'default_model = "cli-model"',
  '',
  '[models."cli-model"]',
  'provider = "managed:kimi-code"',
  '',
  '[models."discovered/x"]',
  'provider = "managed:kimi-code"',
  '',
].join('\n')

describe('kimi model broker resolution', () => {
  it('settings model set → that value, source settings (the memberless card read)', async () => {
    const { broker } = mount({ settingsModel: 'card-model', config: CONFIG })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ effective: 'card-model', source: 'settings', settings: 'card-model', cliDefault: 'cli-model' })
  })

  it('no settings → follows the scoped config, source cli-config', async () => {
    const { broker } = mount({ config: CONFIG })
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ effective: 'cli-model', source: 'cli-config' })
  })

  it('nothing anywhere → the CLI built-in default, which names nothing', async () => {
    const { broker } = mount()
    const info = await broker.modelInfo()
    expect(info.source).toBe('cli-builtin')
    expect(info.effective).toBeUndefined()
  })

  it('the delegation model outranks settings; the override outranks everything', async () => {
    const { broker } = mount({ settingsModel: 'card-model', config: CONFIG })
    const delegated = await broker.modelInfo('child-1', 'delegation-model')
    expect(delegated).toMatchObject({ effective: 'delegation-model', source: 'delegation', delegation: 'delegation-model' })
    await broker.setMemberModel('child-1', 'picked-model')
    const overridden = await broker.modelInfo('child-1', 'delegation-model')
    expect(overridden).toMatchObject({
      effective: 'picked-model',
      source: 'override',
      override: 'picked-model',
      delegation: 'delegation-model',
    })
  })

  it('choices are the deduped union of settings, cliDefault, discovered, and recent', async () => {
    const { broker } = mount({ settingsModel: 'card-model', config: CONFIG, recent: ['recent/y', 'cli-model'] })
    const info = await broker.modelInfo()
    expect(info.choices).toEqual(['card-model', 'cli-model', 'discovered/x', 'recent/y'])
  })

  it('reports the live toggle and stays switchable without an in-flight round', async () => {
    const { broker } = mount({ live: true })
    const info = await broker.modelInfo('child-1')
    expect(info).toMatchObject({ live: true, switchable: true })
    expect(info.reason).toBeUndefined()
  })

  it('a member with an in-flight round is not switchable, with the reason', async () => {
    const { broker, active } = mount()
    active.push('child-1')
    const info = await broker.modelInfo('child-1')
    expect(info.switchable).toBe(false)
    expect(info.reason).toContain('进行中的委派轮次')
  })
})

describe('kimi model broker setMemberModel', () => {
  it('refuses while a round is in flight for the member', async () => {
    const { broker, active } = mount()
    active.push('child-1')
    await expect(broker.setMemberModel('child-1', 'model-b')).rejects.toThrow('进行中的委派轮次')
    // …and the override was never stored.
    expect((await broker.modelInfo('child-1')).override).toBeUndefined()
  })

  it('retires the member runtime when its bound model differs from the new effective model', async () => {
    const { broker, liveSwitch } = mount()
    liveSwitch.memberHasRuntime.mockReturnValue(true)
    liveSwitch.memberRuntimeModel.mockReturnValue('model-a')
    await broker.setMemberModel('child-1', 'model-b')
    expect(liveSwitch.retireMemberRuntime).toHaveBeenCalledWith('child-1')
  })

  it('a same-model switch keeps the runtime (no-op retire)', async () => {
    const { broker, liveSwitch } = mount()
    broker.noteStartModel('child-1', 'model-a')
    liveSwitch.memberHasRuntime.mockReturnValue(true)
    liveSwitch.memberRuntimeModel.mockReturnValue('model-a')
    // The override is new, but the effective model stays model-a: the
    // resident process is already running it.
    await broker.setMemberModel('child-1', 'model-a')
    expect(liveSwitch.retireMemberRuntime).not.toHaveBeenCalled()
  })

  it('re-setting the same override is a full no-op', async () => {
    const { broker, liveSwitch } = mount()
    liveSwitch.memberHasRuntime.mockReturnValue(true)
    liveSwitch.memberRuntimeModel.mockReturnValue('other')
    await broker.setMemberModel('child-1', 'model-b')
    expect(liveSwitch.retireMemberRuntime).toHaveBeenCalledTimes(1)
    await broker.setMemberModel('child-1', 'model-b')
    expect(liveSwitch.retireMemberRuntime).toHaveBeenCalledTimes(1)
  })

  it('clearing the override restores the settings-layer effective model', async () => {
    const { broker, settings } = mount({ settingsModel: 'card-model' })
    await broker.setMemberModel('child-1', 'picked')
    expect((await broker.modelInfo('child-1')).source).toBe('override')
    await broker.setMemberModel('child-1', undefined)
    const info = await broker.modelInfo('child-1')
    expect(info).toMatchObject({ effective: 'card-model', source: 'settings' })
    expect(settings.model).toBe('card-model')
  })

  it('spawnModel ranks override, then the start model, then settings', async () => {
    const { broker, settings } = mount({ settingsModel: 'card-model' })
    expect(broker.spawnModel('child-1')).toBe('card-model')
    broker.noteStartModel('child-1', 'start-model')
    expect(broker.spawnModel('child-1')).toBe('start-model')
    await broker.setMemberModel('child-1', 'picked')
    expect(broker.spawnModel('child-1')).toBe('picked')
    settings.model = undefined
    await broker.setMemberModel('child-1', undefined)
    expect(broker.spawnModel('child-1')).toBe('start-model')
  })
})
