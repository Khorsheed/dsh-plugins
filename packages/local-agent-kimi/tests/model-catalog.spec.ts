import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KimiModelCatalog, kimiNativeConfiguration } from '../src/model-catalog.ts'

const configuration = { configOptions: [
  { id: 'route', category: 'model', type: 'select', currentValue: 'one', options: [{ value: 'one', name: 'Model One' }, { value: 'two', name: 'Model Two' }] },
  { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
] }

describe('Kimi model directory', () => {
  it('preserves ACP controls and binds dependent effort choices to the current model only', () => {
    const native = kimiNativeConfiguration(configuration)
    expect(native).toMatchObject({ modelConfigId: 'route', effortConfigId: 'thinking', currentModel: 'one', currentEffort: 'high' })
    expect(native?.directory.entries[0]).toMatchObject({ label: 'Model One', source: 'native', reasoning: { options: [{ value: 'low' }, { value: 'high' }] } })
    expect(native?.directory.entries[1]?.reasoning).toBeUndefined()
    expect(native?.directory.defaultModel).toBeUndefined()
    expect(kimiNativeConfiguration({})).toBeUndefined()
  })

  it('reads legacy ACP model metadata without inventing a config control ID', () => {
    expect(kimiNativeConfiguration({ models: { currentModelId: 'old', availableModels: [{ modelId: 'old', name: 'Legacy model' }] } })).toEqual({
      currentModel: 'old', directory: { entries: [{ value: 'old', label: 'Legacy model', source: 'native' }], complete: true, customInput: false },
    })
  })

  it('starts from labelled scoped configuration, then follows actual native session metadata', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-directory-'))
    writeFileSync(join(homeDir, 'config.toml'), 'default_model = "configured"\n[models.configured]\nmodel = "underlying"\n')
    let native: ReturnType<typeof kimiNativeConfiguration>
    const catalog = new KimiModelCatalog(() => ({ homeDir, ...native === undefined ? {} : { native } }))
    expect(await catalog.refresh('member')).toMatchObject({ complete: false, defaultModel: 'configured', entries: [{ value: 'configured', source: 'configuration' }] })
    native = kimiNativeConfiguration(configuration)
    expect(catalog.read('member').status).toBe('loading')
    expect(await catalog.refresh('member')).toMatchObject({ complete: true, entries: [{ value: 'one', source: 'native' }, { value: 'two' }] })
    catalog.dispose()
  })
})
