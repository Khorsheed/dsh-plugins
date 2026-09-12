/**
 * The claude-code model broker: the family's fixed resolution order
 * (override → delegation → settings → cli-config → cli-builtin), the
 * pickable choices (settings + scoped-file default + the card's recent
 * models, deduped — never a hardcoded catalog), the in-flight switch
 * refusal, and the retire-on-switch of the member's resident runtime. Also
 * the scoped-settings.json scratch memory: the live spawn's effective-model
 * writes never leak into the `cli-config` layer the broker reports.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeModelBroker, ClaudeScopedModelMemory, type ClaudeModelBrokerDeps } from '../src/model-broker.ts'

interface Mount {
  broker: ClaudeModelBroker
  overrides: Map<string, string>
  homeDir: string
  active: string[]
  retire: ReturnType<typeof vi.fn>
  runtimeModel: ReturnType<typeof vi.fn>
  settings: { model?: string; recent: string[]; live: boolean }
}

function mount(options: {
  model?: string
  recent?: string[]
  live?: boolean
  record?: { model?: string; cliSessionId?: string; observedModel?: string }
  active?: string[]
  hosting?: boolean
  boundModel?: string
  transcriptModel?: (cliSessionId?: string) => Promise<string | undefined>
} = {}): Mount {
  const homeDir = mkdtempSync(join(tmpdir(), 'claude-broker-'))
  const overrides = new Map<string, string>()
  const active = options.active ?? []
  const retire = vi.fn(async () => {})
  const runtimeModel = vi.fn(() => options.boundModel)
  const settings = { model: options.model, recent: options.recent ?? [], live: options.live ?? false }
  const deps: ClaudeModelBrokerDeps = {
    localAgent: {
      isDelegationActive: (child: string) => active.includes(child),
      getDelegation: () => options.record as never,
    },
    settingsModel: () => settings.model?.trim() === '' ? undefined : settings.model?.trim(),
    cliDefault: () => new ClaudeScopedModelMemory().cliDefault(homeDir),
    recentModels: () => settings.recent,
    live: () => settings.live,
    overrides,
    liveSwitch: {
      hostingDriver: () =>
        options.hosting === true ? { runtimeModel, retireRuntime: retire } as never : undefined,
    },
    transcriptModel: options.transcriptModel ?? (async () => undefined),
  }
  return { broker: new ClaudeModelBroker(deps), overrides, homeDir, active, retire, runtimeModel, settings }
}

describe('claude model broker resolution', () => {
  it('cli-builtin: nothing names a model, so effective stays absent', async () => {
    const { broker } = mount()
    const info = await broker.modelInfo()
    expect(info.effective).toBeUndefined()
    expect(info.source).toBe('cli-builtin')
    expect(info.choices).toEqual([])
    expect(info.switchable).toBe(true)
    expect(info.live).toBe(false)
  })

  it('cli-config: the scoped settings.json model is the effective one', async () => {
    const { broker, homeDir } = mount()
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'scoped-model' }))
    const info = await broker.modelInfo()
    expect(info).toMatchObject({ effective: 'scoped-model', source: 'cli-config', cliDefault: 'scoped-model' })
  })

  it('settings outranks cli-config; a member override outranks everything', async () => {
    const { broker, homeDir, overrides } = mount({ model: 'settings-model' })
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'scoped-model' }))
    expect(await broker.modelInfo('child-1')).toMatchObject({
      effective: 'settings-model', source: 'settings', cliDefault: 'scoped-model',
    })
    overrides.set('child-1', 'override-model')
    expect(await broker.modelInfo('child-1', 'delegation-model')).toMatchObject({
      effective: 'override-model', source: 'override', override: 'override-model', delegation: 'delegation-model',
    })
  })

  it('the delegation model ranks between override and settings', async () => {
    const { broker } = mount()
    expect(await broker.modelInfo('child-1', 'delegation-model')).toMatchObject({
      effective: 'delegation-model', source: 'delegation', delegation: 'delegation-model',
    })
  })

  it('choices dedupe the settings, scoped-file, and recent models — never a catalog', async () => {
    const { broker, homeDir } = mount({ model: 'model-a', recent: ['model-b', 'model-a', 'model-c'] })
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'model-b' }))
    const info = await broker.modelInfo()
    expect(info.choices).toEqual(['model-a', 'model-b', 'model-c'])
  })

  it('a member with an in-flight round is not switchable, and says why', async () => {
    const { broker } = mount({ active: ['child-1'] })
    const info = await broker.modelInfo('child-1')
    expect(info.switchable).toBe(false)
    expect(info.reason).toContain('进行中的委派轮次')
    // The memberless read (the settings card) is never gated.
    expect((await broker.modelInfo()).switchable).toBe(true)
  })
})

describe('claude model broker lastObserved', () => {
  it('the record’s observedModel is primary — the transcript is never read', async () => {
    const transcriptModel = vi.fn(async () => 'transcript-model')
    const { broker } = mount({
      record: { cliSessionId: 'cli-1', observedModel: 'settled-model' },
      transcriptModel,
    })
    const info = await broker.modelInfo('child-1')
    expect(info.lastObserved).toBe('settled-model')
    expect(transcriptModel).not.toHaveBeenCalled()
  })

  it('member level: the member’s own transcript answers by its recorded cliSessionId', async () => {
    const transcriptModel = vi.fn(async (id?: string) => (id === 'cli-1' ? 'history-model' : undefined))
    const { broker } = mount({ record: { cliSessionId: 'cli-1' }, transcriptModel })
    const info = await broker.modelInfo('child-1')
    expect(info.lastObserved).toBe('history-model')
    expect(transcriptModel).toHaveBeenCalledWith('cli-1')
  })

  it('harness level: the newest transcript in the tree answers (no session id)', async () => {
    const transcriptModel = vi.fn(async () => 'harness-history-model')
    const { broker } = mount({ transcriptModel })
    const info = await broker.modelInfo()
    expect(info.lastObserved).toBe('harness-history-model')
    expect(transcriptModel).toHaveBeenCalledWith(undefined)
  })

  it('a transcript read failure degrades to no lastObserved, never a throw', async () => {
    const { broker } = mount({
      record: { cliSessionId: 'cli-1' },
      transcriptModel: () => Promise.reject(new Error('disk gone')),
    })
    const info = await broker.modelInfo('child-1')
    expect(info.lastObserved).toBeUndefined()
  })

  it('the answer is TTL-cached per member (and for the harness read)', async () => {
    const transcriptModel = vi.fn(async () => 'history-model')
    const { broker } = mount({ record: { cliSessionId: 'cli-1' }, transcriptModel })
    await broker.modelInfo('child-1')
    await broker.modelInfo('child-1')
    await broker.modelInfo()
    await broker.modelInfo()
    expect(transcriptModel).toHaveBeenCalledTimes(2)
    // The miss is cached too: a member with no transcript pays no rescan.
    const missing = vi.fn(async () => undefined)
    const bare = mount({ record: { cliSessionId: 'cli-9' }, transcriptModel: missing })
    await bare.broker.modelInfo('child-9')
    await bare.broker.modelInfo('child-9')
    expect(missing).toHaveBeenCalledTimes(1)
  })

  it('the cache expires after the TTL and re-reads', async () => {
    vi.useFakeTimers()
    try {
      const transcriptModel = vi.fn(async () => 'history-model')
      const { broker } = mount({ record: { cliSessionId: 'cli-1' }, transcriptModel })
      await broker.modelInfo('child-1')
      vi.advanceTimersByTime(120_000)
      await broker.modelInfo('child-1')
      expect(transcriptModel).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('claude model broker setMemberModel', () => {
  it('refuses while a round is in flight for the member', async () => {
    const { broker, overrides } = mount({ active: ['child-1'] })
    await expect(broker.setMemberModel('child-1', 'model-b')).rejects.toThrow(/进行中的委派轮次/)
    expect(overrides.has('child-1')).toBe(false)
  })

  it('stores and clears the override; a same-model set is a no-op (no retire)', async () => {
    const { broker, overrides, retire } = mount({ hosting: true, boundModel: 'model-b' })
    await broker.setMemberModel('child-1', ' model-b ')
    expect(overrides.get('child-1')).toBe('model-b')
    // Bound model already equals the new effective model: nothing retires.
    expect(retire).not.toHaveBeenCalled()
    await broker.setMemberModel('child-1', 'model-b')
    expect(retire).not.toHaveBeenCalled()
    await broker.setMemberModel('child-1', undefined)
    expect(overrides.has('child-1')).toBe(false)
  })

  it('retires the member runtime when its bound model differs from the new effective model', async () => {
    const { broker, retire } = mount({ hosting: true, boundModel: 'model-a' })
    await broker.setMemberModel('child-1', 'model-b')
    expect(retire).toHaveBeenCalledTimes(1)
    expect(retire).toHaveBeenCalledWith('child-1')
  })

  it('clearing the override retires a runtime bound to the override, back onto the settings model', async () => {
    const { broker, overrides, retire } = mount({ model: 'settings-model', hosting: true, boundModel: 'model-b' })
    overrides.set('child-1', 'model-b')
    await broker.setMemberModel('child-1', undefined)
    expect(retire).toHaveBeenCalledTimes(1)
  })

  it('clearing the override keeps a runtime already bound to the recorded delegation model', async () => {
    const { broker, overrides, retire } = mount({ record: { model: 'delegation-model' }, hosting: true, boundModel: 'delegation-model' })
    overrides.set('child-1', 'model-b')
    await broker.setMemberModel('child-1', undefined)
    expect(retire).not.toHaveBeenCalled()
  })

  it('without a live runtime there is nothing to retire', async () => {
    const { broker, retire } = mount({ hosting: false })
    await broker.setMemberModel('child-1', 'model-b')
    expect(retire).not.toHaveBeenCalled()
  })
})

describe('claude scoped-model memory', () => {
  it('provision writes the effective model; cliDefault keeps reporting the person’s value', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-memory-'))
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'person-model', env: {} }))
    const memory = new ClaudeScopedModelMemory()
    await memory.provision(homeDir, 'member-model')
    const file = JSON.parse(readFileSync(join(homeDir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(file['model']).toBe('member-model')
    // The rest of the file is merged, never replaced.
    expect(file['env']).toEqual({})
    // The scratch write never becomes the cli-config layer.
    await expect(memory.cliDefault(homeDir)).resolves.toBe('person-model')
  })

  it('a spawn with no model restores the person’s value instead of leaking the scratch', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-memory-'))
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'person-model' }))
    const memory = new ClaudeScopedModelMemory()
    await memory.provision(homeDir, 'member-model')
    await memory.provision(homeDir, undefined)
    const file = JSON.parse(readFileSync(join(homeDir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(file['model']).toBe('person-model')
  })

  it('a spawn with no model REMOVES a scratch that replaced an absent key', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-memory-'))
    const memory = new ClaudeScopedModelMemory()
    await memory.provision(homeDir, 'member-model')
    await memory.provision(homeDir, undefined)
    const file = JSON.parse(readFileSync(join(homeDir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect('model' in file).toBe(false)
  })

  it('a person edit underneath the scratch is adopted, never overwritten by a restore', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-memory-'))
    const memory = new ClaudeScopedModelMemory()
    await memory.provision(homeDir, 'member-model')
    // The person edits the file while our scratch sits in it.
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({ model: 'edited-model' }))
    await expect(memory.cliDefault(homeDir)).resolves.toBe('edited-model')
    await memory.provision(homeDir, undefined)
    const file = JSON.parse(readFileSync(join(homeDir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(file['model']).toBe('edited-model')
  })
})
