import { describe, expect, it } from 'vitest'
import { DshModelCatalog, type DshModelDirectoryFace } from '../src/model-catalog.ts'

describe('DSH public adapter directory', () => {
  it('preserves route identity, display metadata and adapter-owned effort values', async () => {
    const catalog = new DshModelCatalog({ defaultModel: () => 'provider/model', llm: () => ({
      listProviders: () => [{ id: 'provider' }],
      listModels: async () => [{ provider: 'provider', id: 'model', name: 'Readable model' }],
      resolveModelInfo: async () => ({ provider: 'provider', id: 'model', name: 'Readable model', reasoning: {
        efforts: [{ id: 'native-high' as never, name: 'More thought' }], defaultEffort: 'native-high' as never,
      } }),
    }) })
    expect(await catalog.refresh()).toMatchObject({ status: 'ready', complete: true, defaultModel: 'provider/model', entries: [{
      value: 'provider/model', label: 'Readable model', resolvedModel: 'provider/model', source: 'native',
      reasoning: { default: 'native-high', options: [{ value: 'native-high', label: 'More thought' }] },
    }] })
    catalog.dispose()
  })

  it('marks partial enumeration and retains a success when all adapters later fail', async () => {
    let failAll = false
    const llm: DshModelDirectoryFace = {
      listProviders: () => [{ id: 'good' }, { id: 'bad' }],
      listModels: async provider => {
        if (provider === 'bad' || failAll) throw new Error('adapter unavailable')
        return [{ provider, id: 'one', name: 'One' }]
      },
    }
    const catalog = new DshModelCatalog({ defaultModel: () => undefined, llm: () => llm })
    expect(await catalog.refresh()).toMatchObject({ complete: false, entries: [{ value: 'good/one' }] })
    failAll = true
    expect(await catalog.refresh()).toMatchObject({ status: 'stale', entries: [{ value: 'good/one' }] })
    catalog.dispose()
  })

  it('degrades when the public model surface is absent', async () => {
    const catalog = new DshModelCatalog({ defaultModel: () => undefined, llm: () => undefined })
    expect(await catalog.refresh()).toMatchObject({ status: 'unsupported', complete: false })
    catalog.dispose()
  })
})
